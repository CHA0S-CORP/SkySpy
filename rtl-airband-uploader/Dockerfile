FROM python:3.12-alpine

LABEL org.opencontainers.image.source="https://github.com/cha0s-corp/pi-sky"
LABEL org.opencontainers.image.description="RTL-Airband Recording Uploader with Prometheus Metrics"

# Install dependencies
RUN apk add --no-cache tini

# Create non-root user
RUN adduser -D -u 1000 uploader

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY uploader.py .

# Create recordings directory
RUN mkdir -p /recordings/failed && chown -R uploader:uploader /recordings

USER uploader

# Expose metrics port
EXPOSE 9090

# Use tini as init
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["python", "-u", "uploader.py"]
