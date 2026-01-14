# Use Node.js LTS (Alpine) - Latest stable with security patches
FROM node:25-alpine AS base

# Use Alpine Edge repository for latest security patches
RUN echo 'https://dl-cdn.alpinelinux.org/alpine/edge/main' > /etc/apk/repositories && \
    echo 'https://dl-cdn.alpinelinux.org/alpine/edge/community' >> /etc/apk/repositories && \
    echo 'https://dl-cdn.alpinelinux.org/alpine/edge/testing' >> /etc/apk/repositories

# Install system dependencies including git for GitHub dependencies
# Update package index and upgrade existing packages for security
RUN apk update && apk upgrade --available && apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    curl \
    git \
    ffmpeg

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Override vulnerable transitive dependencies
RUN npm pkg set overrides.async="^3.2.6" && \
    npm pkg set overrides.cross-spawn="^7.0.6" && \
    npm pkg set overrides.glob="^11.0.0"

# Remove unused packages that require compilation (gl, old canvas)
# Keep only @napi-rs/canvas which has prebuilt binaries
RUN npm pkg delete dependencies.canvas dependencies.gl 2>/dev/null || true && \
    npm pkg set dependencies.@napi-rs/canvas="^0.1.53"

# Install dependencies
# @napi-rs/canvas should install without compilation thanks to prebuilt binaries
# Don't omit optional deps - rollup needs platform-specific binaries
RUN rm -f package-lock.json && \
    npm install --legacy-peer-deps && \
    npm audit fix --force

# Copy application files
COPY . .

# Verify logo files are present
RUN echo "Checking for logo files..." && \
    ls -la data/ && \
    test -f data/logo.png && echo "✓ logo.png found" || echo "✗ logo.png missing" && \
    test -f data/bmc-brand-logo.svg && echo "✓ bmc-brand-logo.svg found" || echo "✗ bmc-brand-logo.svg missing"

# Build the application
RUN npm run build && \
    ls -la dist/ && \
    echo "Build successful - dist directory created"

# Clean up dev dependencies
RUN npm prune --production 2>/dev/null || true

# Create necessary directories
RUN mkdir -p \
    /app/data/thumbnails \
    /app/data/covers \
    /app/data/models \
    /app/data/videos \
    /app/data/geometry \
    /app/library \
    /app/sessions

# Set default port (can be overridden with environment variable)
ENV PORT=3000

# Expose the application port
EXPOSE ${PORT}

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

# Start the application under a watchdog so restarts don't kill the container
CMD ["node", "watchdog.js"]
