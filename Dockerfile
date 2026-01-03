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
RUN rm -f package-lock.json && \
    npm install --omit=optional --legacy-peer-deps

# Copy application files
COPY . .

# Use container-specific server file
RUN cp simple-server-from-container.js simple-server.js 2>/dev/null || echo "Using existing simple-server.js"

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

# Expose the application port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "simple-server.js"]
