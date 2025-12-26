FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir flask requests

COPY mock_server.py .
COPY mock_1090.py .

EXPOSE 80

CMD ["python", "mock_server.py"]