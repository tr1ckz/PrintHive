// Container health probe, run by Docker's HEALTHCHECK.
//
// Replaces `curl -f http://localhost:${PORT}/api/health || exit 1`. That form
// ran curl under a shell; when a probe overran Docker's timeout, Docker killed
// only the shell and the orphaned curl was re-parented to the container's
// PID 1, where it stayed a zombie once it finished. This probe makes the same
// request in-process with fetch(), so there is no child process to orphan.
//
// Same contract as `curl -f`: GET, no redirect following, any status below 400
// is healthy. Exit code 0 = healthy, 1 = unhealthy.

// Just under the HEALTHCHECK --timeout=10s, so a hung probe ends itself and
// reports why instead of being killed by Docker.
const DEFAULT_TIMEOUT_MS = 9000;

function healthUrl(env = process.env) {
  return `http://localhost:${env.PORT || 3000}/api/health`;
}

async function checkHealth({ url = healthUrl(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
    // Only the status matters; drop the body so the socket is released.
    if (res.body) await res.body.cancel().catch(() => {});

    if (res.status >= 400) {
      return { ok: false, status: res.status, error: `The requested URL returned error: ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, error: `Timed out after ${timeoutMs}ms` };
    }
    const cause = error && error.cause;
    return { ok: false, error: (cause && (cause.code || cause.message)) || error.message };
  } finally {
    clearTimeout(timer);
  }
}

if (require.main === module) {
  const url = healthUrl();
  checkHealth({ url }).then((result) => {
    if (!result.ok) console.error(`healthcheck: ${url} failed: ${result.error}`);
    process.exit(result.ok ? 0 : 1);
  });
}

module.exports = { checkHealth, healthUrl, DEFAULT_TIMEOUT_MS };
