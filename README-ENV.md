# Environment Configuration

This application uses environment variables for configuration. Copy `.env.example` to `.env` and update the values.

## Required Environment Variables

### Server Configuration
- `PORT`: Port number the server will listen on (default: 3000)
- `SESSION_SECRET`: Secret key for session encryption (must be a random string)
- `PUBLIC_URL`: Public URL where your application is hosted (e.g., https://your-domain.com)

### OAuth Configuration
Configure OIDC authentication with your identity provider:
- `OAUTH_ISSUER`: Your OAuth issuer URL (e.g., https://authentik.company.com/application/o/your-app)
- `OAUTH_CLIENT_ID`: OAuth client ID
- `OAUTH_CLIENT_SECRET`: OAuth client secret
- `OAUTH_REDIRECT_URI`: OAuth callback URL (should be PUBLIC_URL + /auth/callback)

### Optional Configuration
- Configure OAuth via environment variables or through the web interface Settings page

## Setup Examples

### Using Authentik
```bash
PUBLIC_URL=https://printhive.yourdomain.com
OAUTH_ISSUER=https://auth.yourdomain.com/application/o/printhive
OAUTH_CLIENT_ID=your_client_id_from_authentik
OAUTH_CLIENT_SECRET=your_client_secret_from_authentik
OAUTH_REDIRECT_URI=https://printhive.yourdomain.com/auth/callback
```

### Using Other OIDC Providers
Works with any OpenID Connect compatible provider (Keycloak, Auth0, Okta, etc.)

## Docker Environment Variables

When running in Docker, set these in your docker-compose.yml or pass them via -e flags:

```yaml
environment:
  - SESSION_SECRET=your-random-secret-key
  - PUBLIC_URL=https://your-domain.com
  - OAUTH_ISSUER=https://your-auth-server.com/application/o/your-app
  - OAUTH_CLIENT_ID=your-client-id
  - OAUTH_CLIENT_SECRET=your-client-secret
  - OAUTH_REDIRECT_URI=https://your-domain.com/auth/callback
```

## Generating SESSION_SECRET

Generate a secure random string:
```bash
# Linux/Mac
openssl rand -base64 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## Anonymous Telemetry (Optional)

The application supports sending anonymous usage statistics to help improve the product. This is **completely optional** and disabled by default.

### What's collected (when enabled):
- Random anonymous install ID (UUID)
- App version
- Platform (Linux/Windows/Mac)
- Basic counts: printers, prints, library items, users
- Feature flags (notifications enabled, etc.)

### What's NOT collected:
- IP addresses
- Usernames, emails, or personal info
- File names or print data
- Bambu account credentials

### Enable telemetry:
Set the `TELEMETRY_ENDPOINT` environment variable to your analytics endpoint:

```bash
# In .env or docker-compose.yml
TELEMETRY_ENDPOINT=https://your-analytics-server.com/api/heartbeat
```

You can use services like Supabase (free tier), your own server, or any webhook endpoint.
