---
title: Deployment Guide
slug: deployment
category:
  uri: operations
position: 1
privacy:
  view: public
---

# Deployment Guide

> **Deploy SkysPy anywhere** - from local development to production Raspberry Pi installations. This guide covers every deployment scenario with step-by-step instructions.

---

## Quick Navigation

| Section | Description |
|---------|-------------|
| [Quick Start](#-quick-start-development) | Get running in 5 minutes |
| [Docker Deployment](#-docker-compose-deployment) | Development & testing environments |
| [Production](#-production-deployment) | Full production setup |
| [Raspberry Pi](#-raspberry-pi-deployment) | Optimized RPi5 deployment |
| [Scaling](#-scaling-considerations) | High-traffic configurations |
| [Security](#-security-considerations) | Production security checklist |

---

## Architecture Overview

SkysPy is a real-time ADS-B aircraft tracking system built on modern, battle-tested technologies.

### Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | Django 5.0+ | REST API & WebSocket server |
| **ASGI Server** | Daphne | WebSocket support |
| **Task Queue** | Celery + gevent | Background processing |
| **Database** | PostgreSQL 16 | Primary data store |
| **Cache/Broker** | Redis 7 | Message broker & cache |
| **Frontend** | React + Vite | Dashboard UI |

### System Architecture Diagram

```mermaid
flowchart TB
    subgraph External["External Data"]
        UF[Ultrafeeder<br/>ADS-B Data]
        D978[Dump978<br/>UAT Data]
        ACARS[ACARS/VDL2<br/>Messages]
    end

    subgraph Frontend["Frontend Layer"]
        NGINX[Nginx<br/>Reverse Proxy]
        REACT[React/Vite<br/>Dashboard]
    end

    subgraph Application["Application Layer"]
        DAPHNE[Daphne<br/>ASGI Server]
        CELERY[Celery Worker<br/>gevent pool]
        BEAT[Celery Beat<br/>Scheduler]
    end

    subgraph Data["Data Layer"]
        REDIS[(Redis<br/>Cache & Broker)]
        POSTGRES[(PostgreSQL<br/>Database)]
    end

    UF --> DAPHNE
    D978 --> DAPHNE
    ACARS --> DAPHNE

    REACT <--> NGINX
    NGINX <--> DAPHNE

    DAPHNE <--> REDIS
    DAPHNE <--> POSTGRES

    CELERY <--> REDIS
    CELERY <--> POSTGRES

    BEAT --> REDIS

    style UF fill:#e1f5fe
    style D978 fill:#e1f5fe
    style ACARS fill:#e1f5fe
    style NGINX fill:#fff3e0
    style REACT fill:#fff3e0
    style DAPHNE fill:#e8f5e9
    style CELERY fill:#e8f5e9
    style BEAT fill:#e8f5e9
    style REDIS fill:#ffebee
    style POSTGRES fill:#ffebee
```

### Service Ports

| Service | Port | Protocol | Description |
|---------|------|----------|-------------|
| `api` | `8000` | HTTP/WS | Django API server (Daphne ASGI) |
| `celery-worker` | - | - | Background task processing |
| `celery-beat` | - | - | Periodic task scheduler |
| `redis` | `6379` | TCP | Message broker and cache |
| `postgres` | `5432` | TCP | PostgreSQL database |
| `acars-listener` | `5555`/`5556` | UDP | ACARS/VDL2 listener (optional) |

---

## Prerequisites

### System Requirements

| Environment | CPU | Memory | Storage |
|-------------|-----|--------|---------|
| Development | 2+ cores | 4GB+ | 10GB |
| Production | 4+ cores | 8GB+ | 50GB+ |
| Raspberry Pi 5 | 4 cores | 8GB | 32GB+ SD/NVMe |

### Software Requirements

> **Required Software**
> - Docker 24.0+ and Docker Compose v2
> - Git
>
> **Optional Software**
> - Nginx (reverse proxy)
> - Certbot (SSL certificates)

### Verify Docker Installation

> **Info:** Run these commands to ensure Docker is properly installed.

```bash
# 1. Check Docker version
docker --version
# Expected: Docker version 24.0.0 or higher

# 2. Check Docker Compose version
docker compose version
# Expected: Docker Compose version v2.0.0 or higher

# 3. Verify Docker is running
docker info
```

---

## Quick Start (Development)

> **Time to deploy: ~5 minutes**

### Step-by-Step Guide

> **Step 1: Clone the Repository** - Get the latest SkysPy source code.

```bash
git clone https://github.com/your-org/skyspy.git
cd skyspy
```

> **Step 2: Create Environment File** - Copy the example and configure your settings.

```bash
cp .env.example .env
```

Edit `.env` with minimum required settings:

```bash
# Security (REQUIRED)
DJANGO_SECRET_KEY=your-super-secret-key-change-this

# Your Location (REQUIRED)
FEEDER_LAT=47.9377
FEEDER_LON=-121.9687

# Data Source (REQUIRED)
ULTRAFEEDER_HOST=ultrafeeder
ULTRAFEEDER_PORT=80
```

> **Step 3: Start Services** - Launch all containers with Docker Compose.

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f api
```

> **Step 4: Access the Dashboard** - Open your browser and navigate to your SkysPy instance.

| Endpoint | URL | Description |
|----------|-----|-------------|
| **Dashboard** | http://localhost:8000 | Main web interface |
| **API Docs** | http://localhost:8000/api/docs/ | Interactive API documentation |
| **Health Check** | http://localhost:8000/health/ | System health status |

---

## Docker Compose Deployment

### Development Environment

The `docker-compose.test.yaml` provides a complete development environment with hot-reload and mock data sources.

```mermaid
flowchart LR
    subgraph Dev["Development Stack"]
        API[API<br/>Hot Reload]
        WORKER[Celery Worker]
        BEAT[Celery Beat]
        VITE[Vite Dev<br/>Port 3000]
    end

    subgraph Mock["Mock Services"]
        UF[Ultrafeeder Mock]
        D978[Dump978 Mock]
    end

    subgraph Data["Test Data"]
        PG[(PostgreSQL<br/>tmpfs)]
        PGBOUNCER[PgBouncer]
        REDIS[(Redis)]
    end

    Mock --> API
    API --> PGBOUNCER
    PGBOUNCER --> PG
    API --> REDIS
    WORKER --> REDIS
    WORKER --> PGBOUNCER

    style API fill:#c8e6c9
    style VITE fill:#c8e6c9
    style UF fill:#ffe0b2
    style D978 fill:#ffe0b2
```

> **Info:** Launch the full development stack with hot-reload enabled.

```bash
# Start development environment
docker compose -f docker-compose.test.yaml --profile dev up -d

# Services started:
# - api (Django with hot reload)
# - celery-worker
# - celery-beat
# - postgres (with tmpfs for speed)
# - pgbouncer
# - redis
# - ultrafeeder (mock)
# - dump978 (mock)
# - adsb-dashboard (Vite dev server on port 3000)
```

### Running Tests

```bash
# Run the test suite
docker compose -f docker-compose.test.yaml --profile test run --rm api-test

# Test results are saved to ./test-results/
```

### Service Profiles

| Profile | Description | Use Case |
|---------|-------------|----------|
| `dev` | Full development environment with hot reload | Local development |
| `test` | Test runner with mock services | CI/CD pipelines |
| `acars` | Include ACARS listener service | ACARS message capture |

```bash
# Start with ACARS listener
docker compose --profile acars up -d

# Start development with ACARS
docker compose -f docker-compose.test.yaml --profile dev --profile acars up -d
```

---

## Production Deployment

### Deployment Roadmap

```mermaid
flowchart LR
    A[1. Prepare<br/>Environment] --> B[2. Configure<br/>Variables]
    B --> C[3. Generate<br/>Secrets]
    C --> D[4. Start<br/>Services]
    D --> E[5. Initial<br/>Setup]
    E --> F[Verify<br/>Health]

    style A fill:#e3f2fd
    style B fill:#e3f2fd
    style C fill:#fff3e0
    style D fill:#e8f5e9
    style E fill:#e8f5e9
    style F fill:#c8e6c9
```

### 1. Prepare the Environment

```bash
# Create application directory
sudo mkdir -p /opt/skyspy
cd /opt/skyspy

# Clone repository
sudo git clone https://github.com/your-org/skyspy.git .

# Create secure environment file
sudo cp .env.example .env
sudo chmod 600 .env
```

### 2. Configure Environment Variables

> **Warning:** Never commit your `.env` file to version control. Generate unique secrets for each deployment.

Edit `/opt/skyspy/.env` with production settings:

```bash
# =============================================================================
# Django Settings (REQUIRED)
# =============================================================================
DEBUG=False
DJANGO_SECRET_KEY=generate-a-secure-64-character-key-here
ALLOWED_HOSTS=skyspy.example.com,192.168.1.100

# Superuser (auto-created on startup)
DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_EMAIL=admin@example.com
DJANGO_SUPERUSER_PASSWORD=your-secure-password

# =============================================================================
# Database (REQUIRED)
# =============================================================================
POSTGRES_USER=skyspy_prod
POSTGRES_PASSWORD=generate-a-secure-database-password
POSTGRES_DB=skyspy_prod

# =============================================================================
# Authentication
# =============================================================================
# Options: public, private, hybrid
AUTH_MODE=hybrid

# JWT Configuration
JWT_SECRET_KEY=generate-a-separate-jwt-secret-key
JWT_ACCESS_TOKEN_LIFETIME_MINUTES=60
JWT_REFRESH_TOKEN_LIFETIME_DAYS=7

# =============================================================================
# ADS-B Data Sources (REQUIRED)
# =============================================================================
ULTRAFEEDER_HOST=192.168.1.50
ULTRAFEEDER_PORT=80
DUMP978_HOST=192.168.1.50
DUMP978_PORT=8978

# Feeder Location (REQUIRED)
FEEDER_LAT=47.9377
FEEDER_LON=-121.9687

# =============================================================================
# Polling Configuration
# =============================================================================
POLLING_INTERVAL=2
DB_STORE_INTERVAL=5
SESSION_TIMEOUT_MINUTES=30

# =============================================================================
# Notifications (Optional)
# =============================================================================
# Apprise URLs for notifications
# Format: service1://...,service2://...
APPRISE_URLS=telegram://123456:ABC-DEF1234/987654321
NOTIFICATION_COOLDOWN=300

# =============================================================================
# Safety Monitoring
# =============================================================================
SAFETY_MONITORING_ENABLED=True
SAFETY_VS_CHANGE_THRESHOLD=2000
SAFETY_VS_EXTREME_THRESHOLD=6000
SAFETY_PROXIMITY_NM=0.5

# =============================================================================
# Photo Cache
# =============================================================================
PHOTO_CACHE_ENABLED=True
PHOTO_AUTO_DOWNLOAD=True

# =============================================================================
# Radio/Audio
# =============================================================================
RADIO_ENABLED=True
RADIO_MAX_FILE_SIZE_MB=50
RADIO_RETENTION_DAYS=7

# =============================================================================
# S3 Storage (Optional)
# =============================================================================
S3_ENABLED=False
S3_BUCKET=skyspy-photos
S3_REGION=us-east-1
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_ENDPOINT_URL=  # For MinIO: http://minio:9000

# =============================================================================
# Monitoring (Optional)
# =============================================================================
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
SENTRY_ENVIRONMENT=production
PROMETHEUS_ENABLED=True

# =============================================================================
# CORS (adjust for your domain)
# =============================================================================
CORS_ALLOWED_ORIGINS=https://skyspy.example.com
```

### 3. Generate Secure Keys

> **Danger:** Always generate unique, cryptographically secure keys for production deployments.

```bash
# Generate Django secret key
python3 -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"

# Generate database password
openssl rand -base64 32

# Generate JWT secret key
openssl rand -base64 48
```

### 4. Start Production Services

```bash
# Build and start services
docker compose up -d --build

# Verify services are running
docker compose ps

# Check service health
docker compose exec api curl -f http://localhost:8000/health/
```

### 5. Initial Setup Commands

```bash
# Create superuser (if not auto-created)
docker compose exec api python manage.py createsuperuser

# Populate aviation data
docker compose exec api python manage.py populate_data

# Sync Celery tasks to database
docker compose exec api python manage.py sync_celery_tasks
```

---

## Environment Variables Reference

### Core Django Settings

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEBUG` | Optional | `False` | Enable debug mode (never in production) |
| `DJANGO_SECRET_KEY` | **Required** | - | Secret key for cryptographic signing |
| `ALLOWED_HOSTS` | Optional | `*` | Comma-separated list of allowed hostnames |
| `DJANGO_LOG_LEVEL` | Optional | `INFO` | Logging level |

### Authentication

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_MODE` | Optional | `hybrid` | `public`, `private`, or `hybrid` |
| `JWT_SECRET_KEY` | Recommended | `DJANGO_SECRET_KEY` | Separate JWT signing key |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | Optional | `60` | Access token validity |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | Optional | `7` | Refresh token validity |
| `LOCAL_AUTH_ENABLED` | Optional | `True` | Enable local username/password auth |
| `API_KEY_ENABLED` | Optional | `True` | Enable API key authentication |

### OIDC Configuration (SSO)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OIDC_ENABLED` | Optional | `False` | Enable OIDC authentication |
| `OIDC_PROVIDER_URL` | Required if OIDC | - | OIDC provider base URL |
| `OIDC_PROVIDER_NAME` | Optional | `SSO` | Display name on login button |
| `OIDC_CLIENT_ID` | Required if OIDC | - | OIDC client ID |
| `OIDC_CLIENT_SECRET` | Required if OIDC | - | OIDC client secret |
| `OIDC_SCOPES` | Optional | `openid profile email groups` | Requested scopes |
| `OIDC_DEFAULT_ROLE` | Optional | `viewer` | Default role for new users |

### Database

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_USER` | Optional | `adsb` | PostgreSQL username |
| `POSTGRES_PASSWORD` | **Required** | `adsb` | PostgreSQL password |
| `POSTGRES_DB` | Optional | `adsb` | Database name |
| `DATABASE_URL` | Optional | - | Full database URL (auto-constructed) |

### Redis

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | Optional | `redis://redis:6379/0` | Redis connection URL |

### ADS-B Sources

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ULTRAFEEDER_HOST` | **Required** | `ultrafeeder` | Ultrafeeder hostname |
| `ULTRAFEEDER_PORT` | Optional | `80` | Ultrafeeder port |
| `DUMP978_HOST` | Optional | `dump978` | Dump978 hostname |
| `DUMP978_PORT` | Optional | `80` | Dump978 port |
| `FEEDER_LAT` | **Required** | `47.9377` | Antenna latitude |
| `FEEDER_LON` | **Required** | `-121.9687` | Antenna longitude |

### Polling & Sessions

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POLLING_INTERVAL` | Optional | `2` | Seconds between ADS-B polls |
| `DB_STORE_INTERVAL` | Optional | `5` | Seconds between database writes |
| `SESSION_TIMEOUT_MINUTES` | Optional | `30` | Minutes before aircraft session ends |

### Safety Monitoring

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SAFETY_MONITORING_ENABLED` | Optional | `True` | Enable safety event detection |
| `SAFETY_VS_CHANGE_THRESHOLD` | Optional | `2000` | Vertical speed change threshold (ft/min) |
| `SAFETY_VS_EXTREME_THRESHOLD` | Optional | `6000` | Extreme vertical speed (ft/min) |
| `SAFETY_PROXIMITY_NM` | Optional | `0.5` | Proximity alert distance (nm) |
| `SAFETY_ALTITUDE_DIFF_FT` | Optional | `500` | Altitude difference for proximity (ft) |

### ACARS/VDL2

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ACARS_ENABLED` | Optional | `True` | Enable ACARS message processing |
| `ACARS_PORT` | Optional | `5555` | ACARS UDP listen port |
| `VDLM2_PORT` | Optional | `5556` | VDL Mode 2 UDP listen port |

### Transcription

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TRANSCRIPTION_ENABLED` | Optional | `False` | Enable audio transcription |
| `WHISPER_ENABLED` | Optional | `False` | Enable local Whisper |
| `WHISPER_URL` | Optional | `http://whisper:9000` | Whisper service URL |

### LLM Integration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_ENABLED` | Optional | `False` | Enable LLM for transcript analysis |
| `LLM_API_URL` | Required if LLM | `https://api.openai.com/v1` | OpenAI-compatible API URL |
| `LLM_API_KEY` | Required if LLM | - | API key |
| `LLM_MODEL` | Optional | `gpt-4o-mini` | Model to use |

### S3 Storage

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `S3_ENABLED` | Optional | `False` | Enable S3 storage |
| `S3_BUCKET` | Required if S3 | - | Bucket name |
| `S3_REGION` | Optional | `us-east-1` | AWS region |
| `S3_ACCESS_KEY` | Required if S3 | - | Access key |
| `S3_SECRET_KEY` | Required if S3 | - | Secret key |
| `S3_ENDPOINT_URL` | Optional | - | Custom endpoint (for MinIO) |

### Monitoring

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENTRY_DSN` | Optional | - | Sentry error tracking DSN |
| `SENTRY_ENVIRONMENT` | Optional | `production` | Environment name |
| `PROMETHEUS_ENABLED` | Optional | `True` | Enable Prometheus metrics |

---

## Database Setup

### PostgreSQL Configuration

The default `docker-compose.yml` includes a PostgreSQL container with:

- PostgreSQL 16 Alpine image
- Persistent volume for data
- Health checks enabled
- Automatic restart

### Production Database Tuning

```yaml
# docker-compose.override.yml for production PostgreSQL tuning
services:
  postgres:
    command: >
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=768MB
      -c maintenance_work_mem=128MB
      -c checkpoint_completion_target=0.9
      -c wal_buffers=16MB
      -c default_statistics_target=100
      -c random_page_cost=1.1
      -c effective_io_concurrency=200
      -c work_mem=16MB
      -c min_wal_size=1GB
      -c max_wal_size=4GB
      -c max_worker_processes=4
      -c max_parallel_workers_per_gather=2
      -c max_parallel_workers=4
```

### External PostgreSQL

```bash
# In .env
DATABASE_URL=postgresql://username:password@db.example.com:5432/skyspy

# Remove postgres service from docker-compose
docker compose up -d api celery-worker celery-beat redis
```

### Database Migrations

```bash
# Run migrations
docker compose exec api python manage.py migrate

# Check migration status
docker compose exec api python manage.py showmigrations
```

### Database Backups

```bash
# Create backup
docker compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore backup
cat backup.sql | docker compose exec -T postgres psql -U $POSTGRES_USER $POSTGRES_DB
```

---

## Redis Setup

### Default Configuration

Redis is configured with:

- Persistence enabled (`appendonly yes`)
- Memory limit of 256MB
- LRU eviction policy

```bash
# Redis configuration in docker-compose.yml
command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
```

### Production Redis Recommendations

```yaml
# docker-compose.override.yml for production Redis
services:
  redis:
    command: >
      redis-server
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
      --tcp-keepalive 300
      --save 900 1
      --save 300 10
      --save 60 10000
```

### External Redis

```bash
# In .env
REDIS_URL=redis://:password@redis.example.com:6379/0

# Remove redis service from docker-compose
docker compose up -d api celery-worker celery-beat postgres
```

---

## Nginx / Reverse Proxy

### Basic Nginx Configuration

Create `/etc/nginx/sites-available/skyspy`:

```nginx
upstream skyspy_api {
    server 127.0.0.1:8000;
    keepalive 32;
}

server {
    listen 80;
    server_name skyspy.example.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name skyspy.example.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/skyspy.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/skyspy.example.com/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;
    ssl_session_tickets off;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/skyspy_access.log;
    error_log /var/log/nginx/skyspy_error.log;

    # Max upload size for audio files
    client_max_body_size 100M;

    # API and static files
    location / {
        proxy_pass http://skyspy_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # WebSocket endpoints
    location /ws/ {
        proxy_pass http://skyspy_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # Health check (no logging)
    location /health/ {
        proxy_pass http://skyspy_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        access_log off;
    }

    # Metrics endpoint (restrict access)
    location /api/v1/system/metrics {
        proxy_pass http://skyspy_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        allow 127.0.0.1;
        allow 10.0.0.0/8;
        allow 172.16.0.0/12;
        allow 192.168.0.0/16;
        deny all;
    }
}
```

### Enable Site

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/skyspy /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### SSL with Certbot

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d skyspy.example.com

# Auto-renewal is configured automatically
sudo systemctl status certbot.timer
```

---

## Raspberry Pi Deployment

> **Optimized for Raspberry Pi 5** - SkysPy includes special settings for resource-constrained environments.

### Prerequisites

| Requirement | Recommended | Minimum |
|-------------|-------------|---------|
| **Hardware** | Raspberry Pi 5 (8GB) | Raspberry Pi 4 (4GB) |
| **Storage** | NVMe SSD | 32GB+ high-speed SD card |
| **OS** | Raspberry Pi OS Lite (64-bit) | Ubuntu Server 24.04 |

### 1. Installation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Reboot to apply group changes
sudo reboot
```

### 2. Deploy SkysPy

```bash
# Clone repository
cd /opt
sudo git clone https://github.com/your-org/skyspy.git
sudo chown -R $USER:$USER skyspy
cd skyspy

# Create environment file
cp .env.example .env

# Edit with RPi-specific settings
nano .env
```

### 3. Raspberry Pi Environment Configuration

```bash
# =============================================================================
# RPi-Optimized Settings
# =============================================================================
DEBUG=False
DJANGO_SECRET_KEY=your-secure-key
ALLOWED_HOSTS=*

# Use RPi-optimized Django settings
DJANGO_SETTINGS_MODULE=skyspy.settings_rpi

# Database
POSTGRES_USER=skyspy
POSTGRES_PASSWORD=secure-password
POSTGRES_DB=skyspy

# Reduced polling for lower CPU usage
POLLING_INTERVAL=3
DB_STORE_INTERVAL=10

# Disable resource-intensive features
TRANSCRIPTION_ENABLED=False
WHISPER_ENABLED=False
LLM_ENABLED=False
PHOTO_AUTO_DOWNLOAD=False

# Your ADS-B source
ULTRAFEEDER_HOST=192.168.1.50
ULTRAFEEDER_PORT=80

# Your location
FEEDER_LAT=47.9377
FEEDER_LON=-121.9687

# Notifications (lightweight)
APPRISE_URLS=
NOTIFICATION_COOLDOWN=600

# Monitoring (optional - disable if low on resources)
PROMETHEUS_ENABLED=False
SENTRY_DSN=
```

### RPi-Optimized Settings

The `settings_rpi.py` module provides these optimizations:

| Setting | Default | RPi Value | Benefit |
|---------|---------|-----------|---------|
| `POLLING_INTERVAL` | 2s | 3s | 33% CPU reduction |
| `DB_STORE_INTERVAL` | 5s | 10s | 50% fewer DB writes |
| `CACHE_TTL` | 5s | 10s | Doubled cache effectiveness |
| `CONN_MAX_AGE` | 60s | 120s | Fewer DB connections |
| `WEBSOCKET_CAPACITY` | 1500 | 1000 | Lower memory usage |
| `ACARS_BUFFER_SIZE` | 50 | 30 | Smaller memory footprint |

### 4. RPi Docker Compose Override

Create `docker-compose.override.yml`:

```yaml
services:
  api:
    environment:
      - DJANGO_SETTINGS_MODULE=skyspy.settings_rpi
    deploy:
      resources:
        limits:
          memory: 1G

  celery-worker:
    environment:
      - DJANGO_SETTINGS_MODULE=skyspy.settings_rpi
    command: >
      celery -A skyspy worker
      --loglevel=info
      --concurrency=20
      --queues=polling,default,database,notifications
      --pool=gevent
    deploy:
      resources:
        limits:
          memory: 512M

  postgres:
    command: >
      postgres
      -c shared_buffers=128MB
      -c effective_cache_size=256MB
      -c maintenance_work_mem=32MB
      -c work_mem=4MB
    deploy:
      resources:
        limits:
          memory: 512M

  redis:
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    deploy:
      resources:
        limits:
          memory: 192M
```

### 5. Start Services on RPi

```bash
# Start with resource limits
docker compose up -d

# Monitor resource usage
docker stats
```

### Performance Monitoring

```bash
# Check CPU and memory
htop

# Check disk I/O
iotop

# Check container stats
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Check API response time
time curl -s http://localhost:8000/health/ | jq .
```

---

## Scaling Considerations

### Horizontal Scaling Architecture

```mermaid
flowchart TB
    subgraph LB["Load Balancer"]
        NGINX[Nginx]
    end

    subgraph API["API Servers"]
        API1[API Server 1]
        API2[API Server 2]
        API3[API Server 3<br/>backup]
    end

    subgraph Workers["Celery Workers"]
        W1[Polling Worker<br/>concurrency: 50]
        W2[Default Worker<br/>concurrency: 20]
        W3[Transcription Worker<br/>concurrency: 2]
    end

    subgraph Data["Data Layer"]
        PGBOUNCER[PgBouncer]
        PG[(PostgreSQL)]
        REDIS[(Redis)]
    end

    NGINX --> API1
    NGINX --> API2
    NGINX --> API3

    API1 --> PGBOUNCER
    API2 --> PGBOUNCER
    API3 --> PGBOUNCER
    PGBOUNCER --> PG

    API1 --> REDIS
    API2 --> REDIS
    API3 --> REDIS

    W1 --> REDIS
    W2 --> REDIS
    W3 --> REDIS
    W1 --> PGBOUNCER
    W2 --> PGBOUNCER
    W3 --> PGBOUNCER

    style NGINX fill:#fff3e0
    style API1 fill:#e8f5e9
    style API2 fill:#e8f5e9
    style API3 fill:#ffebee
    style W1 fill:#e3f2fd
    style W2 fill:#e3f2fd
    style W3 fill:#e3f2fd
```

### Multiple Celery Workers

```yaml
# docker-compose.override.yml
services:
  celery-worker-polling:
    extends:
      service: celery-worker
    container_name: skyspy-celery-polling
    command: >
      celery -A skyspy worker
      --loglevel=info
      --concurrency=50
      --queues=polling
      --pool=gevent
      --hostname=polling@%h

  celery-worker-default:
    extends:
      service: celery-worker
    container_name: skyspy-celery-default
    command: >
      celery -A skyspy worker
      --loglevel=info
      --concurrency=20
      --queues=default,database,notifications
      --pool=gevent
      --hostname=default@%h

  celery-worker-transcription:
    extends:
      service: celery-worker
    container_name: skyspy-celery-transcription
    command: >
      celery -A skyspy worker
      --loglevel=info
      --concurrency=2
      --queues=transcription
      --pool=prefork
      --hostname=transcription@%h
```

### Task Queue Configuration

SkysPy uses multiple Celery queues for task prioritization:

| Queue | Priority | Tasks |
|-------|----------|-------|
| `polling` | **High** | Aircraft polling, stats updates |
| `default` | Normal | General background tasks |
| `database` | Normal | Database sync, cleanup |
| `transcription` | Low | Audio transcription |
| `notifications` | Normal | Alert notifications |
| `low_priority` | Low | Analytics, cleanup |

### Load Balancing Multiple API Instances

```nginx
upstream skyspy_api {
    least_conn;
    server 10.0.0.10:8000 weight=5;
    server 10.0.0.11:8000 weight=5;
    server 10.0.0.12:8000 backup;
    keepalive 32;
}
```

### Database Connection Pooling

For high-traffic deployments, use PgBouncer:

```yaml
services:
  pgbouncer:
    image: edoburu/pgbouncer:latest
    environment:
      - DB_USER=${POSTGRES_USER}
      - DB_PASSWORD=${POSTGRES_PASSWORD}
      - DB_HOST=postgres
      - DB_NAME=${POSTGRES_DB}
      - POOL_MODE=transaction
      - MAX_CLIENT_CONN=1000
      - DEFAULT_POOL_SIZE=20
    depends_on:
      - postgres

  api:
    environment:
      - DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@pgbouncer:5432/${POSTGRES_DB}
    depends_on:
      - pgbouncer
```

---

## Health Checks and Monitoring

### Health Check Endpoints

| Endpoint | Description | Auth | Status |
|----------|-------------|------|--------|
| `/health/` | Basic health check | None | Public |
| `/api/v1/system/status` | Detailed system status | None | Public |
| `/api/v1/system/info` | API information | None | Public |
| `/api/v1/system/metrics` | Prometheus metrics | None | Restrict in prod |

### Health Check Response

```bash
curl http://localhost:8000/health/ | jq .
```

```json
{
  "status": "healthy",
  "services": {
    "database": {
      "status": "up",
      "latency_ms": 1.23
    },
    "cache": {
      "status": "up"
    },
    "celery": {
      "status": "up"
    },
    "libacars": {
      "status": "up",
      "circuit_state": "closed",
      "healthy": true
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Service Health Status Indicators

```mermaid
flowchart LR
    subgraph Health["Health Status"]
        DB[Database<br/>up - 1.23ms]
        CACHE[Cache<br/>up]
        CELERY[Celery<br/>up]
        ACARS[libacars<br/>closed]
    end

    API[API] --> DB
    API --> CACHE
    API --> CELERY
    API --> ACARS

    style DB fill:#c8e6c9
    style CACHE fill:#c8e6c9
    style CELERY fill:#c8e6c9
    style ACARS fill:#c8e6c9
    style API fill:#e8f5e9
```

### Prometheus Configuration

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'skyspy'
    static_configs:
      - targets: ['skyspy-api:8000']
    metrics_path: '/api/v1/system/metrics'
    scrape_interval: 15s
```

### Docker Health Checks

```bash
# Check container health
docker compose ps

# View health check logs
docker inspect --format='{{json .State.Health}}' skyspy-api | jq .
```

### Sentry Error Tracking

```bash
# Configure Sentry in .env
SENTRY_DSN=https://your-key@sentry.io/project-id
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
```

### Log Monitoring

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f api

# View logs with timestamps
docker compose logs -f --timestamps api

# Tail last 100 lines
docker compose logs --tail=100 api
```

---

## Backup and Recovery

### Automated Backup Script

Create `/opt/skyspy/backup.sh`:

```bash
#!/bin/bash
# SkysPy Backup Script

set -e

BACKUP_DIR="/opt/skyspy/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=7

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup PostgreSQL
echo "Backing up PostgreSQL..."
docker compose exec -T postgres pg_dump -U ${POSTGRES_USER:-adsb} ${POSTGRES_DB:-adsb} | gzip > "$BACKUP_DIR/postgres_$DATE.sql.gz"

# Backup Redis
echo "Backing up Redis..."
docker compose exec -T redis redis-cli BGSAVE
sleep 5
docker compose cp redis:/data/dump.rdb "$BACKUP_DIR/redis_$DATE.rdb"

# Backup environment file
echo "Backing up environment..."
cp /opt/skyspy/.env "$BACKUP_DIR/env_$DATE.backup"

# Backup photo cache (optional, can be large)
if [ "${BACKUP_PHOTOS:-false}" = "true" ]; then
    echo "Backing up photo cache..."
    docker compose cp api:/data/photos "$BACKUP_DIR/photos_$DATE"
fi

# Cleanup old backups
echo "Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -type f -mtime +$RETENTION_DAYS -delete

echo "Backup complete: $BACKUP_DIR"
ls -lh "$BACKUP_DIR"/*_$DATE*
```

### Schedule Automated Backups

```bash
# Make script executable
chmod +x /opt/skyspy/backup.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/skyspy/backup.sh >> /var/log/skyspy-backup.log 2>&1") | crontab -
```

### Recovery Procedures

#### Restore PostgreSQL

```bash
# Stop services
docker compose stop api celery-worker celery-beat

# Restore database
gunzip -c backups/postgres_20240115_020000.sql.gz | docker compose exec -T postgres psql -U ${POSTGRES_USER:-adsb} ${POSTGRES_DB:-adsb}

# Run migrations (in case of schema changes)
docker compose exec api python manage.py migrate

# Restart services
docker compose start api celery-worker celery-beat
```

#### Restore Redis

```bash
# Stop Redis
docker compose stop redis

# Copy backup file
docker compose cp backups/redis_20240115_020000.rdb redis:/data/dump.rdb

# Start Redis
docker compose start redis
```

#### Full System Recovery

```bash
# 1. Clone fresh repository
cd /opt
git clone https://github.com/your-org/skyspy.git skyspy-new
cd skyspy-new

# 2. Restore environment file
cp /path/to/backup/env_20240115_020000.backup .env

# 3. Start infrastructure services
docker compose up -d postgres redis

# 4. Wait for PostgreSQL to be ready
sleep 10

# 5. Restore database
gunzip -c /path/to/backup/postgres_20240115_020000.sql.gz | docker compose exec -T postgres psql -U ${POSTGRES_USER:-adsb} ${POSTGRES_DB:-adsb}

# 6. Start remaining services
docker compose up -d

# 7. Verify health
curl http://localhost:8000/health/
```

### Disaster Recovery Checklist

- [ ] Verify backups exist and are valid
- [ ] Test restore in staging environment
- [ ] Document recovery time objective (RTO): ~15 minutes
- [ ] Document recovery point objective (RPO): Up to 24 hours

---

## Upgrading

### Standard Upgrade Procedure

```bash
cd /opt/skyspy

# 1. Pull latest changes
git fetch origin
git checkout main
git pull origin main

# 2. Backup database
./backup.sh

# 3. Pull new images
docker compose pull

# 4. Rebuild custom images
docker compose build

# 5. Apply database migrations
docker compose exec api python manage.py migrate

# 6. Restart services with new images
docker compose up -d

# 7. Verify health
curl http://localhost:8000/health/
docker compose logs -f api
```

### Zero-Downtime Upgrade (Advanced)

```bash
# 1. Build new images without stopping services
docker compose build

# 2. Start new API container alongside old one
docker compose up -d --scale api=2 --no-recreate

# 3. Run migrations (during overlap)
docker compose exec api python manage.py migrate

# 4. Gradually shift traffic to new container
# (Requires external load balancer configuration)

# 5. Stop old containers
docker compose up -d --scale api=1

# 6. Verify
curl http://localhost:8000/health/
```

---

## Troubleshooting

### Common Issues

> **Error: API Not Starting** - Check logs and verify database connectivity.

```bash
# Check logs
docker compose logs api

# Verify PostgreSQL is ready
docker compose exec postgres pg_isready

# Generate new secret key if invalid
python3 -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"

# Run migrations manually
docker compose exec api python manage.py migrate
```

> **Warning: WebSocket Connection Issues** - Verify Daphne is running and nginx is configured correctly.

```bash
# Check Daphne is running
docker compose exec api ps aux | grep daphne

# Verify WebSocket endpoint
curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:8000/ws/aircraft/

# Ensure nginx proxy_read_timeout is high enough (86400 for 24 hours)
```

> **Warning: Celery Tasks Not Running** - Check worker status and Redis connectivity.

```bash
# Check Celery worker status
docker compose exec celery-worker celery -A skyspy inspect active

# Check Celery beat schedule
docker compose exec celery-beat celery -A skyspy inspect scheduled

# Verify Redis connectivity
docker compose exec celery-worker python -c "import redis; r = redis.from_url('redis://redis:6379/0'); print(r.ping())"
```

> **Warning: Database Connection Issues** - Verify PostgreSQL is running and connections are not exhausted.

```bash
# Check PostgreSQL is running
docker compose exec postgres pg_isready -U ${POSTGRES_USER:-adsb}

# Check connection from API
docker compose exec api python -c "
from django.db import connection
cursor = connection.cursor()
cursor.execute('SELECT 1')
print('Database OK')
"

# Check for connection pool exhaustion
docker compose exec postgres psql -U ${POSTGRES_USER:-adsb} -c "SELECT count(*) FROM pg_stat_activity;"
```

> **Info: High Memory Usage** - Reduce worker concurrency and cache limits.

```bash
# Check container memory usage
docker stats --no-stream

# Reduce Celery concurrency in docker-compose.override.yml:
# command: celery -A skyspy worker --concurrency=20 ...

# Reduce Redis memory:
# command: redis-server --maxmemory 128mb ...
```

### Getting Help

| Resource | URL |
|----------|-----|
| **GitHub Issues** | https://github.com/your-org/skyspy/issues |
| **Documentation** | https://skyspy.example.com/docs |
| **API Reference** | https://skyspy.example.com/api/docs/ |

---

## Security Considerations

### Production Security Checklist

> **Danger:** Complete ALL items before deploying to production.

#### Authentication & Secrets

- [ ] Set `DEBUG=False`
- [ ] Generate strong `DJANGO_SECRET_KEY` (64+ characters)
- [ ] Generate separate `JWT_SECRET_KEY`
- [ ] Use strong database passwords
- [ ] Configure `ALLOWED_HOSTS` properly
- [ ] Configure `AUTH_MODE=private` or `hybrid` for sensitive deployments

#### Network Security

- [ ] Enable HTTPS with valid SSL certificate
- [ ] Configure firewall rules
- [ ] Set up fail2ban for brute force protection
- [ ] Enable rate limiting in nginx
- [ ] Restrict access to `/api/v1/system/metrics`

#### Container Security

- [ ] Use non-root user in containers (already configured)
- [ ] Keep Docker and dependencies updated
- [ ] Scan images for vulnerabilities

### Firewall Configuration

```bash
# Allow only necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### Container Security Features

The Docker images are built with security in mind:

| Feature | Status | Description |
|---------|--------|-------------|
| **Non-root user** | Enabled | Runs as `skyspy:skyspy` (UID/GID 1000) |
| **Minimal base** | Enabled | Python 3.12-slim images |
| **No shell access** | Enabled | Production containers |
| **Read-only volumes** | Enabled | Code volumes where possible |

---

## Platform Deployment Options

| Platform | Best For | Resources |
|----------|----------|-----------|
| **Docker** - Full containerized deployment with Docker Compose. | Development, testing, CI/CD | 4GB RAM, 2 cores |
| **Raspberry Pi** - Optimized for edge deployment on Pi 5. | Home users, remote stations | 8GB RAM, NVMe SSD |
| **Cloud** - Scalable production deployment. | High-traffic, enterprise | 8GB+ RAM, 4+ cores |

---

> **Next Steps**: After deployment, check out the [API Reference](/api-reference) and [WebSocket Guide](/websockets) to start building integrations.
