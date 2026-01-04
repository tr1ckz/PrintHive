# Use Node.js LTS (Alpine)
FROM node:20-alpine

# Install system dependencies including git for GitHub dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    curl \
    git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Remove unused packages that require compilation (gl, old canvas)
# Keep only @napi-rs/canvas which has prebuilt binaries
RUN npm pkg delete dependencies.canvas dependencies.gl 2>/dev/null || true && \
    npm pkg set dependencies.@napi-rs/canvas="^0.1.53"

# Install dependencies
# @napi-rs/canvas should install without compilation thanks to prebuilt binaries
# Don't omit optional deps - rollup needs platform-specific binaries
RUN rm -f package-lock.json && \
    npm install --legacy-peer-deps

# Copy application files
COPY . .

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
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start the application
CMD ["node", "simple-server.js"]
