ARG DISTRO=bookworm
ARG PYTHON=3.13.7

# --- Node Build Stage ---
FROM node:22.22.0-bookworm-slim AS node-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm test -- --run && npm run build:check

# --- Python Build Stage ---
# Use Python slim as the base (it already has Python), install Rust on top
# to compile C-extension wheels, then copy them to the runtime stage.
FROM python:${PYTHON}-slim-${DISTRO} AS builder
WORKDIR /wheels

# Install Build Dependencies + Rust
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential libssl-dev libffi-dev pkg-config \
        cargo rustc && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Compile Wheels
COPY requirements.txt ./
RUN pip3 wheel --wheel-dir=/wheels -r requirements.txt

# --- Runtime Stage ---
FROM python:${PYTHON}-slim-${DISTRO} AS runtime
WORKDIR /app

COPY --from=tianon/gosu:1.17 /gosu /usr/local/bin/

# Install Compiled Wheels
COPY --from=builder /wheels /wheels
RUN pip3 install --no-index --find-links=/wheels -r /wheels/requirements.txt && \
    rm -rf /wheels

RUN groupadd -g 1000 kapowarr && \
    useradd -u 1000 -g kapowarr -d /nonexistent -M -s /bin/bash kapowarr && \
    mkdir -p /app/db /app/logs /app/temp_downloads

ARG CACHE_BUST=0
COPY . .
RUN chmod -R 755 /app && \
    chown -R kapowarr:kapowarr /app/db /app/logs /app/temp_downloads && \
    find /app -name "*.sh" -exec sed -i 's/\r$//' {} +

# Copy built SPA from Node stage (overwrites source files with dist)
COPY --from=node-builder /app/frontend/dist /app/frontend/dist

ENV PUID=1000 \
    PGID=1000 \
    TZ=UTC \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 5656

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python3", "-c", "import json,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:5656/api/health', timeout=3); assert r.status == 200 and json.load(r).get('healthy') is True"]

USER kapowarr:kapowarr

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["python3", "/app/Kapowarr.py", "--LogFolder", "/app/logs"]
