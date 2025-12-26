# ACARSHUB Mock Service
# Multi-arch build supporting x86_64 and ARM64

FROM python:3.12-slim

LABEL maintainer="acarshub-mock"
LABEL description="Mock service for acarshub"

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY app.py .

# Expose ports
# UDP ports (matching ACARSHUB)
EXPOSE 5550/udp
EXPOSE 5555/udp
EXPOSE 5556/udp
EXPOSE 5557/udp
EXPOSE 5558/udp

# TCP relay ports
EXPOSE 15550
EXPOSE 15555
EXPOSE 15556
EXPOSE 15557
EXPOSE 15558

# Web interface
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/stats || exit 1

# Run the application
CMD ["python", "app.py"]
