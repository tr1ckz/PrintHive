const express = require('express');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const oidc = require('openid-client');
const { db } = require('../../database');
const { isBcryptHash } = require('../config');
const { loginRateLimiter } = require('../middleware/security');
const { getOidcConfig, configureOIDC } = require('../services/oidcProvider');

const router = express.Router();

// Short-lived cookie set when we send the browser to the IdP. If the browser
// comes back to `/` still unauthenticated while it is present, the main route
// serves the login page instead of bouncing to the IdP again — that bounce is
// what used to turn any failed SSO round-trip into an endless redirect loop.
const SSO_BOUNCE_COOKIE = 'printhive.sso';
const SSO_BOUNCE_MAX_AGE_MS = 5 * 60 * 1000;

function setSsoBounceCookie(req, res) {
  res.cookie(SSO_BOUNCE_COOKIE, '1', {
    maxAge: SSO_BOUNCE_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
  });
}

function clearSsoBounceCookie(res) {
  res.clearCookie(SSO_BOUNCE_COOKIE, { path: '/' });
}

// Where to send the browser when SSO fails. `/admin` only works when
// LOCALAUTH is on; otherwise it bounced to `/`, which bounced to the IdP, and
// the error never reached anyone. `/?error=` is handled by the main route and
// the login page, which shows the form plus a notice instead of redirecting.
function ssoErrorRedirect(code) {
  return `/?error=${encodeURIComponent(code)}`;
}

// Split a stored group list ("Admins, PrintHive Admins" or newline-separated)
// into a normalized, lowercased array for case-insensitive matching.
function parseGroupList(value) {
  return String(value || '')
    .split(/[\n,]/)
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean);
}

// Resolve an OIDC user's PrintHive role from their IdP groups using the
// admin-configured mapping. OIDC only ever grants 'admin' or 'user' — the
// 'superadmin' tier is a manually-assigned local bootstrap role and is never
// derived from (or revoked by) SSO.
async function resolveOidcRole(claims) {
  const rows = (await db.prepare('SELECT key, value FROM config WHERE key LIKE ?').all('oauth_%'));
  const cfg = {};
  rows.forEach((row) => { cfg[row.key.replace('oauth_', '')] = row.value || ''; });

  const groupsClaim = (cfg.groupsClaim || 'groups').trim() || 'groups';
  const adminGroups = parseGroupList(cfg.adminGroups);
  const userGroups = parseGroupList(cfg.userGroups);
  const defaultRole = cfg.defaultRole === 'admin' ? 'admin' : 'user';

  const raw = claims[groupsClaim];
  const groups = (Array.isArray(raw) ? raw : (raw != null ? [raw] : []))
    .map((g) => String(g).toLowerCase());
  console.log(`OIDC groups (claim "${groupsClaim}"):`, groups);

  if (adminGroups.length && groups.some((g) => adminGroups.includes(g))) return 'admin';
  if (userGroups.length && groups.some((g) => userGroups.includes(g))) return 'user';
  return defaultRole;
}

// OAuth routes (MUST be registered before static middleware to catch callbacks)
router.get('/auth/oidc', async (req, res) => {
  console.log('=== OIDC AUTH START ===');

  // Discovery runs once at boot; if the IdP was still starting (docker-compose
  // brings both up together) the client stayed unconfigured until an admin
  // re-saved the settings. Retry discovery on demand instead.
  let oidcConfig = getOidcConfig();
  if (!oidcConfig) {
    console.log('OIDC client not configured, retrying discovery');
    await configureOIDC();
    oidcConfig = getOidcConfig();
  }
  if (!oidcConfig) {
    console.error('OIDC client not configured');
    return res.redirect(ssoErrorRedirect('oidc_not_configured'));
  }

  try {
    // Generate PKCE code verifier, state and nonce
    const code_verifier = oidc.randomPKCECodeVerifier();
    const code_challenge = await oidc.calculatePKCECodeChallenge(code_verifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();

    // Store in session for callback
    req.session.oidc_code_verifier = code_verifier;
    req.session.oidc_state = state;
    req.session.oidc_nonce = nonce;

    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });

    // Build authorization URL using v6.x API
    const authUrl = oidc.buildAuthorizationUrl(oidcConfig.server, {
      redirect_uri: oidcConfig.redirectUri,
      scope: 'openid profile email',
      code_challenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    console.log('Redirecting to:', authUrl.href);
    setSsoBounceCookie(req, res);
    res.redirect(authUrl.href);
  } catch (error) {
    console.error('OIDC auth error:', error);
    res.redirect(ssoErrorRedirect('oidc_auth_failed'));
  }
});

router.get('/auth/oidc/callback', async (req, res) => {
  console.log('=== OIDC CALLBACK RECEIVED ===');
  console.log('Session ID:', req.sessionID);

  const oidcConfig = getOidcConfig();
  if (!oidcConfig) {
    console.error('OIDC client not configured');
    return res.redirect(ssoErrorRedirect('oidc_not_configured'));
  }

  // Two tabs can race to the IdP; the second one's cookie wins and the first
  // callback arrives against a session that was already signed in by the
  // other tab. Nothing is wrong — just go to the app.
  if (req.session.authenticated && !req.session.oidc_code_verifier) {
    console.log('Session already authenticated, skipping token exchange');
    clearSsoBounceCookie(res);
    return res.redirect('/');
  }

  try {
    // Get code verifier, state and nonce from session
    const code_verifier = req.session.oidc_code_verifier;
    const saved_state = req.session.oidc_state;
    const saved_nonce = req.session.oidc_nonce;

    if (!code_verifier) {
      console.error('No code verifier in session (session cookie did not survive the IdP round-trip)');
      return res.redirect(ssoErrorRedirect('invalid_session'));
    }

    // openid-client derives the redirect_uri it sends to the token endpoint
    // from this URL. Behind a reverse proxy req.protocol/host often read as
    // http://printhive:3000 while the IdP has https://public.host registered,
    // and the exchange fails with invalid_grant. Use the configured redirect
    // URI (the one buildAuthorizationUrl sent) and only take the IdP's query
    // string from the actual request.
    const currentUrl = new URL(oidcConfig.redirectUri);
    currentUrl.search = new URL(req.originalUrl, 'http://localhost').search;

    console.log('Calling authorizationCodeGrant...');

    // Exchange authorization code for tokens using v6.x API
    // In v6.x, authorizationCodeGrant validates the response automatically
    const tokens = await oidc.authorizationCodeGrant(
      oidcConfig.server,
      currentUrl,
      {
        pkceCodeVerifier: code_verifier,
        expectedState: saved_state,
        ...(saved_nonce ? { expectedNonce: saved_nonce } : {}),
      }
    );

    console.log('Token exchange successful');

    // Get claims from ID token
    const claims = tokens.claims();

    // Extract user information from claims
    const sub = claims.sub;
    const email = claims.email || claims.preferred_username;
    const username = claims.preferred_username || claims.username || email?.split('@')[0] || sub;
    const name = claims.name || username;

    console.log('Extracted data:');
    console.log('  Sub:', sub);
    console.log('  Email:', email);
    console.log('  Username:', username);
    console.log('  Name:', name);

    // Check if user exists by OAuth ID
    let user = (await db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?').get('oidc', sub));
    console.log('Existing user by OAuth ID:', user ? user.username : 'none');

    if (!user && email) {
      // Check by email
      user = (await db.prepare('SELECT * FROM users WHERE email = ?').get(email));
      console.log('Existing user by email:', user ? user.username : 'none');

      if (user) {
        // Link existing user to OAuth and update display name
        console.log('Linking existing user to OAuth');
        (await db.prepare('UPDATE users SET oauth_provider = ?, oauth_id = ?, display_name = ? WHERE id = ?').run('oidc', sub, name, user.id));
      }
    }

    // Determine role from the configured OIDC group mapping (admin | user).
    const role = await resolveOidcRole(claims);
    console.log('Resolved role from OIDC groups:', role);

    if (!user) {
      // Create new user with role based on groups
      console.log('Creating new OIDC user:', username, email, 'with role:', role);
      const result = (await db.prepare(
        'INSERT INTO users (username, email, oauth_provider, oauth_id, role, password, display_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        username,
        email || '',
        'oidc',
        sub,
        role,
        '', // No password for OAuth users
        name
      ));
      user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid));
      console.log('New user created with ID:', user.id);
    } else {
      // Re-sync role from groups on each login, but never touch a superadmin —
      // that tier is managed locally and must not be revoked by SSO.
      if (user.role !== 'superadmin' && user.role !== role) {
        console.log('Updating user role from', user.role, 'to', role, 'based on groups');
        (await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id));
        user.role = role;
      }
    }

    console.log('=== OIDC AUTH SUCCESS ===');
    console.log('User:', user.username, 'Role:', user.role);

    // Set session for compatibility with existing auth system
    req.session.authenticated = true;
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role || 'user';
    // Kept for id_token_hint on RP-initiated logout (Keycloak and friends
    // refuse post_logout_redirect_uri without it).
    req.session.oidc_id_token = tokens.id_token;

    // Clean up OIDC session data
    delete req.session.oidc_code_verifier;
    delete req.session.oidc_state;
    delete req.session.oidc_nonce;

    await new Promise((resolve, reject) => {
      req.session.save((err) => err ? reject(err) : resolve());
    });

    console.log('Session saved successfully, redirecting to /');
    clearSsoBounceCookie(res);
    res.redirect('/');
  } catch (error) {
    console.error('=== OIDC CALLBACK ERROR ===');
    console.error('Error:', error.message);
    if (error.cause) console.error('Cause:', error.cause);
    console.error('Stack:', error.stack);

    // Clean up session on error
    delete req.session.oidc_code_verifier;
    delete req.session.oidc_state;
    delete req.session.oidc_nonce;

    res.redirect(ssoErrorRedirect('oidc_callback_failed'));
  }
});

router.get('/auth/google', (req, res) => {
  res.status(501).send('Google OAuth not yet implemented. Configure OIDC instead or install passport-google-oauth20.');
});

router.get('/auth/google/callback', (req, res) => {
  res.redirect('/admin');
});

// Simple local login
router.post('/auth/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  console.log(`Login attempt for user: ${username}`);

  try {
    const row = (await db.prepare('SELECT * FROM users WHERE username = ?').get(username));
    // OAuth-only accounts have an empty password column and can never
    // password-login; bcrypt.compare against a non-hash is always false.
    const user = (row && row.password && isBcryptHash(row.password)
      && await bcrypt.compare(String(password || ''), row.password)) ? row : null;

    if (user) {
      console.log('Login successful for user:', user.username);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.role = user.role || 'user';
      req.session.authenticated = true;

      // Load global Bambu credentials if they exist
      const token = (await db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_token'));
      const region = (await db.prepare('SELECT value FROM config WHERE key = ?').get('bambu_region'));
      if (token && token.value) {
        req.session.token = token.value;
        req.session.region = region?.value || 'global';
      }
      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.json({ success: false, error: 'Session save failed' });
        }
        res.json({ success: true });
      });
    } else {
      console.log('Invalid credentials for user:', username);
      res.json({ success: false, error: 'Invalid username or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, error: 'Login failed' });
  }
});

router.get('/api/check-auth', async (req, res) => {
  if (req.session.authenticated && req.session.userId) {
    // Fetch current user role from database to ensure it's up to date
    try {
      const user = (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId));
      const currentRole = user ? user.role : (req.session.role || 'user');

      // Update session if role changed
      if (user && req.session.role !== currentRole) {
        req.session.role = currentRole;
        console.log(`Updated session role to: ${currentRole}`);
      }

      res.json({
        authenticated: true,
        username: req.session.username,
        role: currentRole
      });
    } catch (e) {
      console.error('Error fetching user role:', e);
      res.json({
        authenticated: true,
        username: req.session.username,
        role: req.session.role || 'user'
      });
    }
  } else {
    res.json({ authenticated: false });
  }
});

// Logout endpoint
router.post('/auth/logout', (req, res) => {
  console.log('=== LOGOUT ===');

  // The session is destroyed below; keep what the end-session request needs.
  const idTokenHint = req.session.oidc_id_token;

  // Check if user logged in via OIDC
  const isOidcUser = req.session.userId ? (async () => {
    try {
      const user = (await db.prepare('SELECT oauth_provider FROM users WHERE id = ?').get(req.session.userId));
      return user?.oauth_provider === 'oidc';
    } catch (err) {
      console.error('Error checking OAuth provider:', err);
      return false;
    }
  })() : false;

  req.session.destroy(async (err) => {
    if (err) {
      console.error('Session destroy error:', err);
      res.json({ success: false, error: 'Failed to logout' });
    } else {
      // If OIDC user, return the end-session URL for redirect.
      // isOidcUser is a promise for logged-in sessions, so it must be awaited —
      // otherwise every local account gets bounced through the IdP on logout.
      if (await isOidcUser) {
        try {
          const publicHostname = (await db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_publicHostname'));
          const configuredEndSessionUrl = (await db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_oidcEndSessionUrl'));
          const publicUrl = publicHostname?.value || process.env.PUBLIC_URL || 'http://localhost:3000';

          let endSessionUrl;

          // Use configured end-session URL if provided
          if (configuredEndSessionUrl?.value) {
            // Build full logout URL with post_logout_redirect_uri parameter
            const logoutUrl = new URL(configuredEndSessionUrl.value);
            // Add flag to prevent auto-redirect after logout
            logoutUrl.searchParams.set('post_logout_redirect_uri', `${publicUrl}/admin?logout=1`);
            if (idTokenHint) logoutUrl.searchParams.set('id_token_hint', idTokenHint);
            const clientId = getOidcConfig()?.clientId
              || (await db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_oidcClientId'))?.value;
            if (clientId && !logoutUrl.searchParams.has('client_id')) logoutUrl.searchParams.set('client_id', clientId);
            endSessionUrl = logoutUrl.href;
            console.log('OIDC logout using configured URL:', endSessionUrl);
          } else if (getOidcConfig()) {
            // Fallback: try to build from OIDC discovery
            try {
              const builtUrl = oidc.buildEndSessionUrl(getOidcConfig().server, {
                post_logout_redirect_uri: `${publicUrl}/admin?logout=1`,
                ...(idTokenHint ? { id_token_hint: idTokenHint } : {}),
              });
              endSessionUrl = builtUrl.href;
              console.log('OIDC logout using discovered URL:', endSessionUrl);
            } catch (buildErr) {
              console.error('Failed to build end-session URL:', buildErr);
              // Manual fallback - construct from issuer
              const issuer = (await db.prepare('SELECT value FROM config WHERE key = ?').get('oauth_oidcIssuer'));
              if (issuer?.value) {
                endSessionUrl = `${issuer.value}${issuer.value.endsWith('/') ? '' : '/'}end-session/?post_logout_redirect_uri=${encodeURIComponent(`${publicUrl}/admin?logout=1`)}`;
                console.log('OIDC logout using manual URL:', endSessionUrl);
              }
            }
          }

          if (endSessionUrl) {
            res.json({ success: true, oidcLogout: true, endSessionUrl });
          } else {
            console.log('No OIDC logout URL available, doing local logout only');
            res.json({ success: true });
          }
        } catch (err) {
          console.error('Error building end-session URL:', err);
          res.json({ success: true });
        }
      } else {
        res.json({ success: true });
      }
    }
  });
});

// Request new email verification code
router.post('/auth/request-code', async (req, res) => {
  const { email, region } = req.body;

  console.log('=== REQUEST NEW CODE ===');

  const apiUrl = region === 'china'
    ? 'https://api.bambulab.cn/v1/user-service/user/sendemail/code'
    : 'https://api.bambulab.com/v1/user-service/user/sendemail/code';

  try {
    await axios.post(apiUrl, {
      email: email,
      type: 'codeLogin'
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('Verification code requested successfully');
    res.json({ success: true, message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Request code error:', error.response?.data || error.message);
    res.json({
      success: false,
      error: error.response?.data?.message || 'Failed to send verification code'
    });
  }
});

// Get current user info
router.get('/api/user/me', async (req, res) => {
  if (!req.session.authenticated || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Try with all columns, fall back if columns don't exist
    let user;
    try {
      user = (await db.prepare('SELECT id, username, email, role, display_name FROM users WHERE id = ?').get(req.session.userId));
    } catch (e) {
      if (e.message.includes('no such column')) {
        user = (await db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.session.userId));
        user.email = null;
        user.display_name = null;
      } else {
        throw e;
      }
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
// Exported for unit testing of the OIDC group -> role mapping.
module.exports.resolveOidcRole = resolveOidcRole;
module.exports.parseGroupList = parseGroupList;
module.exports.SSO_BOUNCE_COOKIE = SSO_BOUNCE_COOKIE;
