# Environment Configuration

This application uses environment variables for configuration. Copy `.env.example` to `.env` and update the values.

## Required Environment Variables

### Server Configuration
- `PORT`: Port number the server will listen on (default: 3000)
- `PUBLIC_URL`: Public URL where your application is hosted (e.g., https://your-domain.com)

### PostgreSQL (required)
PrintHive stores all of its data in PostgreSQL. These must be set or the app will refuse to start:
- `PG_HOST`: PostgreSQL host, optionally with a port as `host:port` (e.g. `10.0.0.5` or `10.0.0.5:5432`).
- `PG_USER`: Database user.
- `PG_PASSWORD`: Database password (masked in logs).
- `PG_DB`: Database name.
- `PG_SCHEMA` *(optional)*: Schema to use (default `public`). Mainly useful for test isolation / multi-tenant setups.

**First-boot migration:** on startup PrintHive checks the target database. If the schema is empty and a legacy SQLite database exists at `<data dir>/printhive.db`, all data is migrated into PostgreSQL, the migration is verified by comparing row counts, and the SQLite file is then renamed to `printhive.db.BK` (kept as a backup; safe to delete once you've confirmed everything works).

Database backup/restore uses `pg_dump`/`pg_restore` (bundled in the Docker image via `postgresql-client`).

### OAuth Configuration
Configure OIDC authentication with your identity provider:
- `OAUTH_ISSUER`: Your OAuth issuer URL (e.g., https://authentik.company.com/application/o/your-app)
- `OAUTH_CLIENT_ID`: OAuth client ID
- `OAUTH_CLIENT_SECRET`: OAuth client secret
- `OAUTH_REDIRECT_URI`: OAuth callback URL (should be PUBLIC_URL + /auth/callback)

## Optional Environment Variables

### Sessions & Cookies
- `SESSION_SECRET`: Secret key for session encryption. **Optional** — if unset, PrintHive generates a random 32-byte secret on first boot and persists it to `<data dir>/session-secret`, so sessions survive restarts with no configuration. Set it explicitly only when you need to share one secret across multiple instances (e.g. load-balanced deployments).
- `COOKIE_SECURE`: Set to `true` to mark the session cookie `Secure` so it is only sent over HTTPS. Leave unset/`false` for plain-HTTP LAN deployments (default: `false`).

### Storage Locations
- `PRINTHIVE_DATA_DIR`: Absolute path for the data directory (session secret, videos, thumbnails, cover cache, backups, and any legacy `printhive.db` to migrate on first boot). The primary datastore is PostgreSQL. Default: `./data`.
- `PRINTHIVE_LIBRARY_DIR`: Absolute path for the model library directory. Default: `./library`.

### Other
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

`SESSION_SECRET` is optional — PrintHive auto-generates and persists one if you don't provide it. If you do want to set it explicitly (for example to share a session across multiple instances), generate a secure random string:
```bash
# Linux/Mac
openssl rand -base64 32

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
