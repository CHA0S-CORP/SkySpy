FROM python:3.11-slim

LABEL maintainer="SkySpyAPI"
LABEL description="Mock Airband Transmission Uploader for testing"

# Install ffmpeg for pydub audio generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY mock_uploader.py .

# Create output directory
RUN mkdir -p /tmp/mock-airband

# Environment defaults
ENV SKYSPY_API_URL=http://skyspy:5000
ENV METRICS_PORT=9091
ENV OUTPUT_DIR=/tmp/mock-airband
ENV MIN_TRANSMISSION_INTERVAL=5
ENV MAX_TRANSMISSION_INTERVAL=30

# Expose metrics port
EXPOSE 9091

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:9091/metrics', timeout=5)" || exit 1

ENTRYPOINT ["python", "mock_uploader.py"]
CMD ["--rate", "2.0"]
