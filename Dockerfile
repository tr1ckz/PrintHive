# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=20

FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-bookworm-slim AS build

ENV DEBIAN_FRONTEND=noninteractive \
    npm_config_update_notifier=false \
    npm_config_fund=false

WORKDIR /app

# Native deps for better-sqlite3, ffmpeg, and optional image tooling.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libjpeg62-turbo-dev \
    libpango1.0-dev \
    libgif-dev \
    libpixman-1-dev \
    git \
    curl \
    ffmpeg \
    ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Use the checked-in lockfile for deterministic multi-arch installs.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

RUN echo "Checking for logo files..." && \
    ls -la data/ && \
    test -f data/logo.png && echo "✓ logo.png found" || echo "✗ logo.png missing" && \
    test -f data/bmc-brand-logo.svg && echo "✓ bmc-brand-logo.svg found" || echo "✗ bmc-brand-logo.svg missing"

RUN npm run build && \
    ls -la dist/ && \
    echo "Build successful - dist directory created"

RUN npm prune --omit=dev

FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    ca-certificates \
    postgresql-client \
    tini \
    tesseract-ocr \
    tesseract-ocr-eng && \
    rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

RUN mkdir -p \
    /app/data/thumbnails \
    /app/data/covers \
    /app/data/models \
    /app/data/videos \
    /app/data/geometry \
    /app/library \
    /app/sessions

EXPOSE ${PORT}

# Exec form, no shell and no curl: the probe is a single node process, so a
# probe that Docker kills on timeout cannot leave an orphaned child behind.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["node", "/app/healthcheck.js"]

# tini runs as PID 1 and reaps any orphaned process (e.g. a child the app
# spawned that outlived it). Node as PID 1 never reaps processes it did not
# spawn itself, so they would otherwise pile up as zombies.
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "watchdog.js"]
