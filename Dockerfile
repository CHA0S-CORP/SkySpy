FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY ./web/package.json ./

RUN npm install

COPY ./web/index.html ./web/vite.config.js ./

COPY ./web/src/ ./src/

RUN npm run build

# Build libacars in a separate stage
FROM debian:bookworm-slim AS libacars-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    zlib1g-dev \
    libxml2-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch v2.2.0 https://github.com/szpajder/libacars.git /tmp/libacars \
    && cd /tmp/libacars \
    && mkdir build && cd build \
    && cmake -DCMAKE_BUILD_TYPE=Release .. \
    && make -j$(nproc) \
    && make install

FROM python:3.12-slim

WORKDIR /app

# Install only runtime dependencies for libacars
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    zlib1g \
    libxml2 \
    && rm -rf /var/lib/apt/lists/*

# Copy libacars from builder stage
COPY --from=libacars-builder /usr/local/lib/libacars-2* /usr/local/lib/
COPY --from=libacars-builder /usr/local/include/libacars-2/ /usr/local/include/libacars-2/
RUN ldconfig

COPY adsb-api/pyproject.toml .
RUN pip install --no-cache-dir -e .

# Copy application package
COPY adsb-api/app/ ./app/

# Copy frontend build to app/static
COPY --from=frontend-builder /app/dist ./app/static
COPY ./web/public/ ./app/static/

# Create non-root user
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 5000

# Use uvicorn for production (single worker for SSE state)
# For multi-worker, use Redis and gunicorn with uvicorn workers
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5000"]