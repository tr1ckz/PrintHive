# Security Policy

## Security Audit Results

PrintHive has undergone a comprehensive security audit. This document outlines our security practices and vulnerability handling procedures.

### Audit Date: January 13, 2026

## Verified Security Controls

### ✅ Input Validation & Sanitization
- **Path Traversal Protection**: All file paths validated with `sanitizeFilePath()` function
- **HTML Escaping**: User input escaped with `htmlEscape()` to prevent XSS attacks
- **SQL Injection Prevention**: All database queries use parameterized statements
- **File Upload Validation**: Only `.stl`, `.3mf`, and `.gcode` files accepted

### ✅ Authentication & Authorization
- Session-based authentication required for all protected endpoints
- Local account passwords hashed with **bcrypt** (legacy plaintext auto-migrated on first boot)
- **Login rate limiting**: failed logins throttled to 10 attempts / 15 minutes / IP
- OAuth/OIDC SSO integration support (Authentik, etc.)
- Share links use cryptographically random hashes (16 bytes)
- Share link expiration enforced (24-hour TTL)
- Role-based access control (admin, user roles)

### ✅ Secrets Management
- ✓ No hardcoded credentials or secrets in codebase
- ✓ Session secret sourced from `SESSION_SECRET` or an auto-generated 32-byte value persisted to the data directory (no shared default secret)
- ✓ OIDC client secrets and Bambu Cloud tokens are redacted from all API responses (settings return a mask and retain the stored value unless a new one is entered)
- `.env` file excluded from git via `.gitignore`
- `SESSION_SECRET`, `OAUTH_CLIENT_SECRET`, etc. configured via environment
- Database credentials managed securely

### ✅ Security Headers
Applied via [helmet](https://helmetjs.github.io/) plus an app-specific CSP and Permissions-Policy:
```
X-Frame-Options: SAMEORIGIN              (Clickjacking protection)
X-Content-Type-Options: nosniff           (MIME type sniffing prevention)
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: restricted       (Only self + trusted CDNs)
Permissions-Policy: disabled              (Camera, mic, geolocation, etc.)
```
Plus **cross-site request rejection**: state-changing requests with a foreign `Origin`/`Sec-Fetch-Site` are blocked, as defense-in-depth alongside `SameSite=Lax` session cookies.

### ✅ Dependency Security
- Zero npm vulnerabilities (verified with `npm audit`)
- Transitive dependencies pinned to secure versions
- Regular dependency updates via Dependabot

### ✅ Network Security
- Express app trusts proxy headers for X-Forwarded-* 
- HTTPS recommended in production (via reverse proxy like Nginx)
- CORS properly configured where needed
- Session cookies marked as `httpOnly` and `SameSite=Lax`; set `COOKIE_SECURE=true` to also mark them `Secure` for HTTPS deployments

### ✅ Data Privacy
- Share access tracking (for monitoring)
- No telemetry or usage tracking
- Database encryption recommended for sensitive deployments
- User data stored locally (not sent to third parties)

### ✅ Code Quality
- Debug logs removed from production code (console.log/debug stripped)
- Console.error/warn retained for monitoring
- Type-safe database operations
- Proper error handling without leaking internals

### ✅ Docker Container Security
- Alpine Linux base image (minimal attack surface)
- Non-root user execution
- Read-only filesystem where possible
- Security vulnerability scanning in CI/CD
- Health checks configured

### ✅ File System Security
- `.gitignore` excludes:
  - `.env` files
  - Database files (*.db*)
  - Session data
  - Application data directories
  - Sensitive logs

## Endpoints Security Summary

### Protected Endpoints (Authentication Required)
- `/api/library/*` (upload, list, edit metadata)
- `/api/settings/*` (user settings, printer config)
- `/admin/*` (admin panel)
- `/api/log-level` (log configuration)

### Public Endpoints (No Auth, Limited Scope)
- `/library/share?hash=*` (share page view)
- `/api/library/share/:hash/download` (download model)
- `/api/library/share/:hash/geometry` (3D geometry)
- `/api/library/share/:hash/thumbnail` (preview image)

## Reporting Security Vulnerabilities

If you discover a security vulnerability in PrintHive, please email security concerns to the maintainers or create a private security advisory on GitHub. Please do NOT create public issues for security vulnerabilities.

### Responsible Disclosure
1. Report the vulnerability privately
2. Allow 90 days for patch development
3. Vulnerability will be disclosed after patch release
4. Security advisory will credit researchers (if desired)

## Security Best Practices for Deployment

### 1. Environment Configuration
```bash
# Generate a strong SESSION_SECRET
SESSION_SECRET=$(openssl rand -base64 32)

# Set PUBLIC_URL to your actual domain
PUBLIC_URL=https://printhive.example.com

# Configure OAuth if using SSO
OAUTH_PROVIDER=oidc
OAUTH_ISSUER=https://auth.example.com
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
```

### 2. Reverse Proxy Setup (Nginx Recommended)
```nginx
server {
    listen 443 ssl http2;
    server_name printhive.example.com;
    
    # SSL certificates (use Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/printhive.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/printhive.example.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Database Security
- Back up database regularly
- Encrypt database backups
- Use strong passwords for local database access
- Run database in read-only mode where applicable

### 4. Regular Maintenance
- Keep Node.js and dependencies updated
- Monitor logs for suspicious activity
- Review user accounts and permissions regularly
- Update Docker base image regularly

### 5. Access Control
- Limit admin account creation
- Use strong passwords or SSO
- Enable MFA if available through OAuth provider
- Regularly audit user roles

## Known Limitations

1. **Database Encryption**: Application-level encryption not implemented - use full-disk encryption
2. **Audit Logging**: Limited - consider implementing detailed audit trails
3. **DDOS Protection**: Rely on reverse proxy and CDN for volumetric attacks (application-level login rate limiting is in place)
4. **Backup Integrity**: Verify backups regularly

## Security Roadmap

Future security improvements planned:
- [x] Login rate limiting *(implemented — 10 attempts / 15 min / IP)*
- [x] bcrypt password hashing *(implemented — auto-migrates legacy plaintext)*
- [ ] Request signing for API calls
- [ ] Database-level encryption
- [ ] Comprehensive audit logging
- [ ] Security key/WebAuthn support
- [ ] Automatic vulnerability scanning in CI/CD

## References

- [OWASP Top 10](https://owasp.org/Top10/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express Security](https://expressjs.com/en/advanced/best-practice-security.html)
- [CWE-79: Cross-site Scripting](https://cwe.mitre.org/data/definitions/79.html)
- [CWE-89: SQL Injection](https://cwe.mitre.org/data/definitions/89.html)

## Last Updated

July 2, 2026 - Security hardening: bcrypt password hashing, auto-generated session secret, login rate limiting, helmet headers, cross-site request rejection, and secret redaction from API responses

January 13, 2026 - Comprehensive security audit completed
