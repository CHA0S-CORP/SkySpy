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

# =============================================================================
# SkysPy Django API - Multi-stage Production Dockerfile
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Build dependencies
# -----------------------------------------------------------------------------
FROM python:3.12-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    zlib1g \
    libxml2 \
    # For scipy/numpy performance (atc-whisper)
    libopenblas0 \
    libatlas3-base \
    # For building webrtcvad (atc-whisper)
    build-essential \
    python3-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy and install shared package first (no -e for production)
COPY ./skyspy_common /app/skyspy_common
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir /app/skyspy_common[cffi]

# Install Python dependencies (filter out local editable installs for Docker)
COPY ./skyspy_django/requirements.txt .
RUN grep -v '^-e \.\.' requirements.txt > requirements-docker.txt && \
    pip install --no-cache-dir -r requirements-docker.txt


# -----------------------------------------------------------------------------
# Stage 2: Production image
# -----------------------------------------------------------------------------
FROM python:3.12-slim as production

# Labels
LABEL maintainer="SkysPy Team"
LABEL description="SkysPy ADS-B Tracking API (Django)"
LABEL version="2.6.0"

# Environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONFAULTHANDLER=1 \
    PATH="/opt/venv/bin:$PATH" \
    # Django settings
    DJANGO_SETTINGS_MODULE=skyspy.settings \
    # Default ports
    PORT=8000

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    # Required for libacars runtime
    zlib1g \
    libxml2 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

    # Copy libacars from builder stage
COPY --from=libacars-builder /usr/local/lib/libacars-2* /usr/local/lib/
COPY --from=libacars-builder /usr/local/include/libacars-2/ /usr/local/include/libacars-2/
RUN ldconfig

# Create non-root user for security
RUN groupadd --gid 1000 skyspy && \
    useradd --uid 1000 --gid 1000 --create-home skyspy

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
COPY --from=frontend-builder /app/dist /app/static

# Set working directory
WORKDIR /app

# Copy application code
COPY --chown=skyspy:skyspy ./skyspy_django/ .

# Note: web/public files are already included in the frontend build (Vite copies them to dist)

# Create required directories
RUN mkdir -p /data/photos /data/radio /data/opensky staticfiles && \
    chown -R skyspy:skyspy /data staticfiles

# Collect static files (BUILD_MODE disables external service connections)
RUN BUILD_MODE=1 python manage.py collectstatic --noinput

# Switch to non-root user
USER skyspy

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health/ || exit 1

# Default command - Daphne ASGI server for WebSocket support
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "skyspy.asgi:application"]
