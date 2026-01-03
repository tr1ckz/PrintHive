# Use Node.js LTS version
FROM node:20-alpine

# Install build dependencies for native modules and curl for healthcheck
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Remove canvas from package.json since it fails to compile and isn't critical
RUN npm pkg delete dependencies.canvas dependencies.@napi-rs/canvas optionalDependencies.canvas optionalDependencies.@napi-rs/canvas 2>/dev/null || true

# Clean install to avoid lock file issues with native dependencies
RUN rm -f package-lock.json && npm install --omit=optional

# Copy source files
COPY . .

# Use the container version of simple-server with all routes
RUN cp simple-server-from-container.js simple-server.js

# Build Vite frontend (clean reinstall if needed for native deps)
RUN npm run build || (rm -rf node_modules package-lock.json && npm install --omit=optional && npm run build)

# Remove dev dependencies after build
RUN npm prune --production

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Create data directories
RUN mkdir -p /app/data/thumbnails /app/data/covers /app/data/models /app/data/videos /app/data/geometry /app/library /app/sessions

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["node", "simple-server.js"]
