# syntax=docker/dockerfile:1.7

# Node 26 is the Active LTS line; trixie-slim is Debian 13, the current stable.
ARG NODE_VERSION=26

# ---------------------------------------------------------------------------
# build: toolchain, dev dependencies and the frontend build. Nothing from this
# stage reaches the runtime image except the files copied out explicitly below.
# ---------------------------------------------------------------------------
FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-trixie-slim AS build

ENV DEBIAN_FRONTEND=noninteractive \
    npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

WORKDIR /app

# python3/make/g++: native addons that compile from source when no prebuilt
# binary matches (better-sqlite3, ssh2's crypto binding, cpu-features).
# git: the 3MF loader is a git-hosted dependency.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      git \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Use the checked-in lockfile for deterministic multi-arch installs.
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .

# Frontend bundle into dist/, then bake version.json (the runtime user cannot
# write to /app), then drop everything that is not a production dependency.
RUN npm run build \
 && test -f dist/index.html \
 && node version-sync.js \
 && npm prune --omit=dev --legacy-peer-deps

# ---------------------------------------------------------------------------
# runtime: the built app, production node_modules and the OS tools the server
# actually execs. No compilers, headers, git, npm/npx/corepack or apt.
# ---------------------------------------------------------------------------
FROM --platform=$TARGETPLATFORM node:${NODE_VERSION}-trixie-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

# Runtime packages, each one exec'd by the server:
#   curl               printer FTPS (server/services/bambuFtp.js)
#   ffmpeg             camera snapshots, RTSP relay, timelapse AVI->MP4
#   postgresql-client  pg_dump / pg_restore for backups (server/services/pgBackup.js)
#   tesseract-ocr(-eng) receipt OCR (server/routes/filament.js)
#   tini               PID 1, reaps orphaned children
#   ca-certificates    trust store for curl / libpq TLS
# Then: pick up every pending security update, and remove what only installing
# needed — apt and its keyring, plus Node's bundled npm/npx/corepack/yarn.
#
# Debian's ffmpeg pulls in Mesa's GPU drivers (and LLVM/z3 for their shader
# compiler) through libavdevice -> libgl1. ffmpeg links only the libGL/libvulkan
# dispatch stubs; the drivers are dlopen'ed solely when a GPU context is
# created, and PrintHive runs ffmpeg CPU-only (no hwaccel/vaapi/vulkan/opengl).
# Dropping them saves ~190 MB; the ldd check fails the build if any library
# ffmpeg actually links ever goes missing.
RUN apt-get update \
 && apt-get upgrade -y \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      ffmpeg \
      postgresql-client \
      tesseract-ocr \
      tesseract-ocr-eng \
      tini \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /var/log/apt /var/log/dpkg.log \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && dpkg --purge --force-depends libgl1-mesa-dri mesa-libgallium libllvm19 libz3-4 \
 && if ldd /usr/bin/ffmpeg /usr/bin/tesseract /usr/bin/curl | grep "not found"; then exit 1; fi \
 && ffmpeg -hide_banner -version >/dev/null \
 && dpkg --purge apt debian-archive-keyring sqv \
 && rm -rf /etc/apt /var/lib/apt /var/cache/apt

# Only what the server loads at runtime (see the require graph of
# simple-server.js / watchdog.js and the thumbnail worker).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/version.json /app/*.js ./
COPY docker/entrypoint.sh /usr/local/bin/printhive-entrypoint.sh

RUN chmod 0755 /usr/local/bin/printhive-entrypoint.sh \
 && mkdir -p \
      /app/data/thumbnails \
      /app/data/covers \
      /app/data/models \
      /app/data/videos \
      /app/data/geometry \
      /app/library \
      /app/sessions \
      /app/public/images/covers

EXPOSE ${PORT}

# Exec form, no shell and no curl: the probe is a single node process, so a
# probe that Docker kills on timeout cannot leave an orphaned child behind.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["node", "/app/healthcheck.js"]

# tini is PID 1 and reaps orphans; the entrypoint maps PUID/PGID, hands the
# writable paths to that user and drops all privileges before exec'ing the app.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/printhive-entrypoint.sh"]

CMD ["node", "watchdog.js"]
