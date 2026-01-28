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
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt


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
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd --gid 1000 skyspy && \
    useradd --uid 1000 --gid 1000 --create-home skyspy

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv

# Set working directory
WORKDIR /app

# Copy application code
COPY --chown=skyspy:skyspy . .

COPY --from=frontend-builder /app/dist ./app/static
COPY ./web/public/ ./app/static/

# Create required directories
RUN mkdir -p /data/photos /data/radio /data/opensky staticfiles && \
    chown -R skyspy:skyspy /data staticfiles

# Collect static files
RUN python manage.py collectstatic --noinput

# Switch to non-root user
USER skyspy

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health/ || exit 1

# Default command - Daphne ASGI server for WebSocket support
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "skyspy.asgi:application"]
