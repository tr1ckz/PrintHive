const oidc = require('openid-client');
const { db } = require('../../database');

// OIDC configuration cache
let oidcConfig = null;

// Configure OIDC Client (using openid-client v6.x API)
async function configureOIDC() {
  const settings = (await db.prepare('SELECT key, value FROM config WHERE key LIKE ?').all('oauth_%'));
  const oauthConfig = {};
  settings.forEach(row => {
    const key = row.key.replace('oauth_', '');
    oauthConfig[key] = row.value || '';
  });

  if (oauthConfig.provider === 'oidc' && oauthConfig.oidcIssuer && oauthConfig.oidcClientId) {
    try {
      // Keep the issuer URL exactly as configured (including trailing slash)
      const issuerUrl = oauthConfig.oidcIssuer;

      const publicUrl = oauthConfig.publicHostname || process.env.PUBLIC_URL || 'http://localhost:3000';

      console.log('Discovering OIDC configuration from:', issuerUrl);

      // Fetch the .well-known configuration manually to get endpoints
      const wellKnownUrl = issuerUrl.endsWith('/')
        ? `${issuerUrl}.well-known/openid-configuration`
        : `${issuerUrl}/.well-known/openid-configuration`;

      const axios = require('axios');
      const response = await axios.get(wellKnownUrl, { timeout: 10000 });
      const metadata = response.data;

      // The document must describe the issuer we were told to trust;
      // otherwise a hijacked discovery URL could point us at another AS.
      const normalize = (u) => String(u || '').replace(/\/+$/, '');
      if (!metadata || normalize(metadata.issuer) !== normalize(issuerUrl)) {
        throw new Error(`Discovery issuer mismatch: configured "${issuerUrl}", document says "${metadata?.issuer}"`);
      }

      console.log('Discovered issuer:', metadata.issuer);
      console.log('Authorization endpoint:', metadata.authorization_endpoint);
      console.log('Token endpoint:', metadata.token_endpoint);
      console.log('UserInfo endpoint:', metadata.userinfo_endpoint);

      // Create a Configuration object with server metadata, client ID, and client secret
      const server = new oidc.Configuration(
        metadata, // server metadata from .well-known
        oauthConfig.oidcClientId, // client ID
        oauthConfig.oidcClientSecret // client secret (can be string or object)
      );

      // openid-client refuses plain-http endpoints by default; LAN IdPs
      // (and docker-internal hostnames) are commonly http.
      if (issuerUrl.startsWith('http://')) {
        oidc.allowInsecureRequests(server);
        console.warn('OIDC issuer is plain http; allowing insecure requests to the IdP');
      }

      // Store configuration for use in routes
      oidcConfig = {
        server,
        clientId: oauthConfig.oidcClientId,
        clientSecret: oauthConfig.oidcClientSecret,
        redirectUri: `${publicUrl}/auth/oidc/callback`,
        issuerUrl: metadata.issuer
      };

      console.log('✓ OIDC client configured successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to configure OIDC:', error.message);
      oidcConfig = null;
      return false;
    }
  } else {
    console.log('OIDC not configured (missing provider, issuer, or client ID)');
    oidcConfig = null;
    return false;
  }
}

const getOidcConfig = () => oidcConfig;

module.exports = { configureOIDC, getOidcConfig };
