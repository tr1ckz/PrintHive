#!/bin/sh
# Container entrypoint: run PrintHive as an unprivileged user.
#
# The container starts as root only so this script can (1) map PUID/PGID to a
# user, (2) hand the writable paths to that user, then (3) drop every
# privilege and exec the app. Nothing in PrintHive itself needs root: it
# listens on an unprivileged port (3000) and only makes outbound connections.
#
#   PUID / PGID        uid/gid to run as (default 99/100, Unraid's nobody:users)
#   PUID=0             opt out: keep running as root, like older images did
#   PRINTHIVE_SKIP_CHOWN=true
#                      don't touch ownership (e.g. the library is on a share that
#                      already grants PUID access, or the filesystem refuses chown)
#
# Started with `docker run --user ...`? Then we are not root and simply exec.
set -eu

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

PUID="${PUID:-99}"
PGID="${PGID:-100}"

case "$PUID$PGID" in
  *[!0-9]*) echo "[entrypoint] PUID/PGID must be numeric (got PUID=$PUID PGID=$PGID)" >&2; exit 64 ;;
esac

if [ "$PUID" = "0" ]; then
  echo "[entrypoint] PUID=0: running as root"
  exec "$@"
fi

# A passwd/group entry for the ids, so initgroups and anything that looks up
# the current user works. -o allows reusing an id that already has a name.
if ! getent group "$PGID" >/dev/null 2>&1; then
  groupadd -o -g "$PGID" printhive
fi
if ! getent passwd "$PUID" >/dev/null 2>&1; then
  useradd -o -u "$PUID" -g "$PGID" -d /app -M -s /usr/sbin/nologin printhive
fi

# Everything the app writes: data (db exports, thumbnails, caches, backups,
# go2rtc config, session secret), sessions, the model library, and the legacy
# covers folder that backup/restore still use. Custom locations from
# PRINTHIVE_DATA_DIR / PRINTHIVE_LIBRARY_DIR are included. Only entries not
# already owned by PUID:PGID are changed, so after the first start this is a
# read-only walk.
WRITABLE="/app/data /app/sessions /app/library /app/public/images/covers"
[ -n "${PRINTHIVE_DATA_DIR:-}" ] && WRITABLE="$WRITABLE $PRINTHIVE_DATA_DIR"
[ -n "${PRINTHIVE_LIBRARY_DIR:-}" ] && WRITABLE="$WRITABLE $PRINTHIVE_LIBRARY_DIR"

for dir in $WRITABLE; do
  mkdir -p "$dir"
  if [ "${PRINTHIVE_SKIP_CHOWN:-false}" = "true" ]; then
    continue
  fi
  if ! find "$dir" \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} + 2>/dev/null; then
    echo "[entrypoint] warning: could not hand all of $dir to $PUID:$PGID; files PrintHive cannot write there will fail to update" >&2
  fi
done

echo "[entrypoint] running as uid $PUID gid $PGID"
exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups \
  --inh-caps=-all --bounding-set=-all --no-new-privs -- "$@"
