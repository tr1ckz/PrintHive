const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

// Standard security headers. CSP stays off in helmet because the app sets
// its own (appHeaders below); COEP/CORP off so camera streams and cover
// images from other local devices keep loading.
const securityHeaders = helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

// App-specific headers helmet doesn't cover: the CSP allows inline scripts
// for the model viewer + jsdelivr; Permissions-Policy locks down sensors.
const appHeaders = (req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self'; media-src 'self' http: https: blob: data:; connect-src 'self' http: https: ws: wss: blob: https://cdn.jsdelivr.net https://cloudflareinsights.com");
  res.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
  next();
};

// Cross-site defense-in-depth for a same-origin SPA: sameSite=lax already
// keeps the session cookie off cross-site POSTs; this also rejects any
// mutating request whose Origin hostname differs from the Host (hostname
// only, so the Vite dev proxy on another port keeps working).
const rejectCrossSite = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
    return res.status(403).json({ error: 'Cross-site request rejected' });
  }
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    try {
      const originHost = new URL(origin).hostname;
      const requestHost = String(req.headers.host || '').split(':')[0];
      if (originHost && requestHost && originHost !== requestHost) {
        return res.status(403).json({ error: 'Cross-site request rejected' });
      }
    } catch { /* malformed Origin — let it through, sec-fetch-site already checked */ }
  }
  return next();
};

// Brute-force protection for credential submission
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
});

module.exports = { securityHeaders, appHeaders, rejectCrossSite, loginRateLimiter };
