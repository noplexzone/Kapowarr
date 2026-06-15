ARG DISTRO=bookworm
ARG PYTHON=3.13

# --- Node Build Stage ---
FROM node:22-slim AS node-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

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

# Install Runtime Dependencies
RUN apt-get update && \
    apt-get full-upgrade -y && \
    apt-get autoremove -y && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY --from=tianon/gosu /gosu /usr/local/bin/

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
    find /app -name "*.sh" -exec sed -i 's/\r$//' {} +

# Copy built SPA from Node stage (overwrites source files with dist)
COPY --from=node-builder /app/frontend/dist /app/frontend/dist

ENV PUID=0 \
    PGID=0 \
    TZ=UTC

EXPOSE 5656

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["python3", "/app/Kapowarr.py", "--LogFolder", "/app/logs"]
