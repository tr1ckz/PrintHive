# PrintHive - 3D Printer Management

**Version: 1.4.39** | [View Changelog](#changelog)

A comprehensive web application for managing 3D printers, including print history tracking, model library management, real-time printer monitoring via MQTT, cloud synchronization with Bambu MakerWorld, and complete database backup & maintenance tools.

## Features

### Core Features
- **Authentication**: Secure login with OIDC support (Authentik, Keycloak, Auth0, etc.)
- **Print History**: Track all your prints with cover images from MakerWorld, paginated display, per-device filtering
- **SD Card Sync**: Automatically import print history from printer SD card for locally sliced files
- **Model Library**: Upload and manage your 3D model files (.3mf, .stl, .gcode)
- **Printer Monitoring**: Real-time status updates via MQTT including AMS data and live camera feeds
- **Cloud Sync**: Automatic synchronization with Bambu Cloud
- **Timelapse Videos**: Download and convert print timelapses
- **Statistics**: View print success rates and analytics
- **Duplicate Detection**: Find duplicate models in your library
- **User Management**: Multi-user support with admin controls
- **Dynamic Theming**: Customizable accent colors applied throughout the app

### Database & Maintenance
- **Database Maintenance**: Vacuum, Analyze, and Reindex operations with detailed results
- **Automatic Backups**: Schedule automatic database backups (local storage)
- **Remote Backups**: Upload backups to SFTP or FTP servers
- **Backup Retention**: Automatic cleanup of old backups based on retention policy
- **Settings Management**: Organized settings with collapsible categories and per-printer camera assignment

### Printer Maintenance
- **Maintenance Tracking**: Track scheduled printer maintenance tasks with history logs
- **Maintenance Intervals**: Set maintenance schedules based on print hours
- **Per-Device Maintenance**: Track maintenance separately for each printer
- **Maintenance History**: View completion history for each task
- **Task Management**: Mark maintenance tasks as complete and track history
- **Maintenance Alerts**: Get notified via Discord when maintenance is due

### Integrations
- **Discord Webhooks**: Get notifications for print failures and maintenance alerts
- **MQTT Monitoring**: Real-time printer status and AMS updates
- **SFTP/FTP Backup**: Upload database backups to remote servers
- **OAuth/SSO**: Enterprise authentication with OIDC providers

### Infrastructure
- **Container-Safe Supervision**: Watchdog process manager that doesn't kill containers on app restart
- **Configurable Logging**: Dynamic log level control (DEBUG/INFO/WARNING/ERROR) in Settings
- **Version Tracking**: Automatic semantic versioning from package.json

## Quick Start

### Prerequisites

- Node.js 18+ or Docker
- PostgreSQL 13+ (required)
- Bambu printer account
- (Optional) OIDC identity provider for SSO
- (Optional) SFTP/FTP server for remote backups

### Installation

#### Option 1: Docker (Recommended)

1. Pull the latest image:
```bash
docker pull tr1ckz/printhive:latest
```

2. Create a docker-compose.yml:
```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    container_name: printhive-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: printhive
      POSTGRES_PASSWORD: your-secure-db-password
      POSTGRES_DB: printhive
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U printhive"]
      interval: 10s
      timeout: 5s
      retries: 5

  printhive:
    image: tr1ckz/printhive:latest
    container_name: printhive
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./library:/app/library
    environment:
      - PORT=3000
      - PUBLIC_URL=https://your-domain.com
      - PG_HOST=postgres:5432
      - PG_USER=printhive
      - PG_PASSWORD=your-secure-db-password
      - PG_DB=printhive
      - SESSION_SECRET=your-random-secret-key

volumes:
  postgres_data:
```

3. Start the container:
```bash
docker-compose up -d
```

For detailed Docker and Unraid instructions, see [DOCKER.md](DOCKER.md).

#### Option 2: Local Development

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/printhive.git
cd printhive
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the development server:
```bash
npm run dev
```

## Configuration

See [README-ENV.md](README-ENV.md) for detailed environment variable documentation.

### Required Environment Variables

- `PUBLIC_URL`: Your application's public URL
- `PG_HOST`: PostgreSQL host (supports `host:port` format, e.g., `localhost:5432`)
- `PG_USER`: PostgreSQL database user
- `PG_PASSWORD`: PostgreSQL database password
- `PG_DB`: PostgreSQL database name

### Optional Environment Variables

- `PG_SCHEMA`: PostgreSQL schema name (default: `public`). Useful for test isolation or multi-tenant setups.
- `SESSION_SECRET`: Secret key for session encryption. If unset, PrintHive generates a random 32-byte secret on first boot and persists it to `data/session-secret`, so sessions survive restarts without any configuration. Set it explicitly when you want to share one secret across multiple instances.
- `COOKIE_SECURE`: Set to `true` to mark the session cookie `Secure` (HTTPS-only). Leave unset/`false` for plain-HTTP LAN deployments. Default: `false`.
- `PRINTHIVE_DATA_DIR`: Override the data directory (sessions secret, videos, thumbnails, backups). Default: `./data`. **Note:** Legacy SQLite database at `./data/printhive.db` is automatically migrated to PostgreSQL on first boot if the schema is empty.
- `PRINTHIVE_LIBRARY_DIR`: Override the model library directory. Default: `./library`.
- `OAUTH_ISSUER`: OIDC provider URL
- `OAUTH_CLIENT_ID`: OAuth client ID
- `OAUTH_CLIENT_SECRET`: OAuth client secret
- `OAUTH_GROUPS_CLAIM`: Claim name for groups (default: 'groups')
- `LOCALAUTH`: Set to 'true' to enable /admin local login route (default: false)
- `DISCORD_WEBHOOK_URL`: Discord webhook for notifications

### MQTT / LAN Telemetry

PrintHive does not require an external MQTT broker for Bambu printer monitoring. Instead, it connects directly to each configured printer over its built-in secure MQTT endpoint.

**How it works:**
- PrintHive opens an `mqtts` connection to `PRINTER_IP:8883`
- It authenticates with username `bblp` and the printer access code
- It subscribes to `device/SERIAL_NUMBER/report`
- It sends a `pushall` request after connect so the printer returns its current state immediately

**Required per printer:**
- Printer IP address
- Printer access code
- Printer serial number
- Network reachability from the PrintHive host to the printer on port `8883`

**You do not need:**
- A separate Mosquitto, EMQX, or other MQTT broker
- An `MQTT_BROKER` environment variable for printer telemetry
- Manual topic configuration

**What to expect when idle:**
- The printer can still report online or idle state when no job is running
- Detailed telemetry such as temperatures, fans, Wi-Fi signal, and some AMS details only appear after the printer publishes those fields
- If the UI shows **Awaiting telemetry**, that usually means the specific detailed fields have not arrived yet, not that MQTT is necessarily disconnected

**Real-time updates to the browser:**
- The server pushes live printer telemetry to the UI over a WebSocket at `/ws/printers` (no polling)
- MQTT connections are managed lazily: a printer is dialed when it first appears in a status poll, and an unreachable printer enters a 60-second cooldown so it is not re-dialed on every poll
- Transient network drops are recovered automatically by the MQTT client; only genuinely unreachable printers are marked offline
- If you run PrintHive behind a reverse proxy, make sure it forwards WebSocket upgrade headers (see the Nginx example below)

### Authentication & Authorization

#### Local Authentication
By default, local authentication via `/admin` is disabled for security. To enable it:
```yaml
environment:
  - LOCALAUTH=true
```

#### OIDC/SSO Authentication (Authentik, Keycloak, etc.)
PrintHive supports automatic role mapping from OIDC provider groups:

**Group-Based Role Assignment:**
- Users in **Admin** or **Admins** group → Assigned **Super Admin** role
- Users in **Users** or **Friends** group → Assigned **User** role
- Groups are case-insensitive

Configure your OIDC provider to include groups in the ID token:
```yaml
environment:
  - OAUTH_ISSUER=https://auth.yourdomain.com/application/o/printhive/
  - OAUTH_CLIENT_ID=your-client-id
  - OAUTH_CLIENT_SECRET=your-client-secret
  - OAUTH_GROUPS_CLAIM=groups  # Default claim name
```

**User Roles:**
- **Super Admin**: Full access, can promote other users to super admin, manage all settings
- **Admin**: Can manage users, settings, and perform administrative tasks
- **User**: Can view and use printers, manage their own prints and library

#### Multiple Bambu Lab Accounts
Users can connect multiple Bambu Lab accounts to manage all their printers in one place:
- Add multiple accounts from different regions (Global/China)
- Set one account as primary
- Printers from all connected accounts appear in the dashboard
- Perfect for users with multiple Bambu Cloud accounts

#### SD Card Print History Sync
Track manually sliced prints that aren't synced to Bambu Cloud:

**What it does:**
- Scans printer SD card for .gcode and .3mf files via FTP/FTPS
- Compares files to existing print history
- Automatically adds missing prints to your history
- Perfect for tracking prints sliced in OrcaSlicer, PrusaSlicer, or other third-party slicers

**How to use:**
1. Navigate to **Print History** page
2. Click **Sync SD Card** button
3. Enter your printer's IP address and access code
4. Click **Sync SD Card** to scan and import

**Requirements:**
- Printer must be accessible on your network
- FTP/FTPS access must be enabled (default on most Bambu printers)
- Access code from printer settings

**Note:** The printer doesn't need to be in LAN-only mode. When connecting via Bambu Lab account, you can find the access code in the Printers view.

#### Local Printer / FTP Setup

For direct LAN telemetry and SD card access:

1. Open **Settings > Local Printer / FTP**
2. Add the printer name and serial number (access code can be pulled from connected Bambu Cloud account when available)
3. Save the printer to trigger a one-time auto-discovery attempt
4. Use **Manual Discover Missing IPs** to retry unresolved printers when needed
5. Use per-printer **Discover IP** for targeted manual retries
6. Use **Test** to confirm connectivity
7. Optionally assign a per-printer RTSP URL for camera routing

The serial number is especially important if the printer is not being discovered through a connected Bambu Cloud account.

**Different subnet/VLAN?**
- Discover IP now auto-scans route-table networks, local interfaces, ARP neighbors, and remembered subnets
- In most setups, you should not need to enter CIDRs manually
- If your network is unusual, use **Advanced Discovery** to add optional extra CIDRs (for example `10.20.30.0/24`)
- Discovery still requires network reachability from the PrintHive host to the printer on MQTT port `8883`
- Manual bulk discovery stops once enough printers are resolved to match cloud-configured printer count

**Access code source order:**
- Per-printer saved access code
- Access code from matching Bambu Cloud device
- Legacy global access code fallback

**Cloud match behavior:**
- When you save a local printer entry, PrintHive tries to bind it to the matching cloud printer first
- Matching prefers serial/dev_id and falls back to a unique cloud printer name match
- That binding is then used for IP discovery and cloud-sourced access code lookup

## Administration

### Database Maintenance

Access database maintenance tools in **Settings > Advanced > System**:

1. **Vacuum Database**: Removes unused space (shows size before/after and space saved)
2. **Analyze Database**: Updates query statistics for optimization
3. **Rebuild Indexes**: Rebuilds all database indexes
4. **Manual Backup**: Create an immediate backup

All operations display detailed results in a modal popup.

### Backup Settings

Configure in **Settings > Advanced > System > Backup Schedule**:

- **Local Backups**: Automatic daily/weekly backups stored in `/data/backups`
- **Backup Interval**: Set frequency (1-365 days)
- **Retention Period**: Automatic cleanup after X days

#### Backup Options

Choose what to include in your backups:
- ✅ **Timelapse Videos** - Include all print timelapse videos
- ✅ **Library Files** - Include .3mf, .stl, .gcode files
- ✅ **Cover Images** - Include model cover images
- Database is always included

Uncheck options to create smaller, faster backups.

#### Remote Backup (SFTP/FTP)

1. Enable in **Settings > Advanced > System > Remote Backup Location**
2. Choose protocol: SFTP (secure) or FTP
3. Configure host, port, username, password, and remote path
4. Click **Test Connection** to verify settings
5. Save - backups will auto-upload when created

#### Restore from Backup

1. Go to **Settings > Advanced > System > Restore from Backup**
2. Select a backup from the dropdown list
3. Click **Refresh List** to see the latest backups
4. Click **Restore Backup** and confirm
5. After restore completes, refresh the page

**⚠️ Warning**: Restoring replaces the current database!

### Printer Maintenance

Configure in **Settings > Advanced > System**:

- Add maintenance tasks with intervals
- Set alerts and notifications
- Track completion history
- Get Discord alerts when maintenance is due

### User Management

Manage users in **Settings > Administration > User Management**:

- View all users with their roles and authentication methods
- Change user roles (User, Admin, Super Admin)
- Super Admins can promote users to Super Admin
- Delete users (cannot delete last admin or super admin)
- See authentication method (Local, OIDC, etc.)

**Role Permissions:**
- **Super Admin**: Full system access, can manage all users and promote to super admin
- **Admin**: Can manage users (except super admins), configure settings
- **User**: Basic access to printers, prints, and personal library
- View user activity

### Settings Organization

Settings are organized in collapsible categories:

- **Printer Connection**: Bambu Lab account, FTP settings, RTSP camera
- **Account**: Profile, security, password changes
- **Preferences**: Cost calculator, UI settings
- **Integrations**: Discord webhooks, OAuth/SSO
- **Advanced**: Watchdog, database maintenance, backups
- **Administration**: User management (admins only)

## Deployment

### Docker & Unraid
See [DOCKER.md](DOCKER.md) for complete Docker and Unraid deployment instructions including:
- Docker Hub installation
- Docker Compose setup
- Unraid step-by-step guide with volume mappings
- Troubleshooting common issues

### Production Deployment Guide

For production deployments with authentication and reverse proxy, see our comprehensive guides:
- **[Authentik SSO Integration](#authentik-sso-integration)** - Set up enterprise authentication with Authentik
- **[Nginx Reverse Proxy Setup](#nginx-reverse-proxy-setup)** - Configure SSL and reverse proxy with Nginx
- **[Complete Production Setup](#complete-production-deployment)** - Full walkthrough combining both

### Backup Strategy

**Local Backups:**
```
/app/data/backups/
├── printhive_pg.dump
├── printhive_pg.dump.1
├── printhive_pg.dump.2
└── ... (older backups auto-deleted based on retention)
```
Backups are created using `pg_dump` in custom format and can be restored with `pg_restore`.

**Remote Backups:**
1. Enable SFTP/FTP in settings
2. Backups automatically upload to remote server
3. Same retention policy applies (files deleted after retention period)

## Development

```bash
# Install dependencies
npm install

# Start development server (frontend + backend)
npm run dev

# Run the test suite (contract snapshots, MQTT lifecycle, job manager)
npm test

# Build for production
npm run build

# Run production server
npm start

# Reset admin user
npm run reset-admin
```

### Backend Architecture

The backend is organised under `server/` rather than a single monolith:

- `server/config.js` — port, bcrypt policy, data-dir paths, session-secret loader
- `server/middleware/` — auth guards (`requireAuth`, `requireAdmin`) and security middleware (helmet, login rate limit, cross-site checks)
- `server/routes/` — Express routers grouped by domain (`auth`, `settings`, `maintenance`, …)
- `server/services/` — `printerConnectionManager` (LAN-mode MQTT lifecycle), `oidcProvider`, `notifications`, `bambuFtp`, `backgroundSync`, `mqtt-client`
- `server/realtime/wsServer.js` — the `/ws/printers` WebSocket telemetry bridge
- `server/jobs/` — an in-process job manager plus a worker thread for CPU-heavy thumbnail rendering

`simple-server.js` remains the entry point and wires these modules together.

### Testing

The repo uses [Vitest](https://vitest.dev/). `npm test` runs:

- **Contract snapshots** that pin the JSON shape of ~40 API endpoints against a throwaway database
- **A fake Bambu printer** (an in-process TLS MQTT broker) that exercises the LAN-mode connect/cooldown/reconnect lifecycle without hardware
- **Unit tests** for the printer connection manager, job manager, and thumbnail worker

## Tech Stack

- **Backend**: Node.js, Express.js (modular `server/` layout)
- **Frontend**: React 19.2, Vite 7.2, TypeScript
- **Database**: PostgreSQL 13+ (async driver: node-postgres)
- **Authentication**: OpenID Connect (OIDC), bcrypt-hashed local passwords
- **Real-time**: direct `mqtts` to each printer, pushed to the browser over a WebSocket bridge
- **Background work**: in-process job manager with a serialized "heavy" lane; thumbnail rendering in a worker thread
- **Backup**: pg_dump/pg_restore for database; SFTP & FTP support for backup uploads
- **Testing**: Vitest (contract snapshots + fake-printer MQTT harness)
- **Container**: Docker with multi-architecture support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Security

- **Password hashing**: local account passwords are hashed with bcrypt. Any legacy plaintext passwords are migrated to bcrypt automatically on first boot after upgrading.
- **Session secret**: generated and persisted automatically if `SESSION_SECRET` is not set (no more shared default secret). Set it explicitly to share sessions across instances.
- **Login rate limiting**: repeated failed logins are throttled (10 attempts / 15 minutes / IP) to slow brute-force attempts.
- **Security headers**: applied via [helmet](https://helmetjs.github.io/) plus a strict Content-Security-Policy and Permissions-Policy.
- **Cross-site protection**: state-changing requests from a foreign origin are rejected (defense-in-depth alongside `SameSite=Lax` cookies).
- **Secret redaction**: OIDC client secrets and Bambu Cloud tokens are never returned in API responses; settings show a mask and keep the stored value unless you enter a new one.
- Never commit your `.env` file with actual credentials.
- Configure HTTPS in production and set `COOKIE_SECURE=true` so session cookies are only sent over TLS.

> **Upgrade note:** the first boot after upgrading generates a new session secret and re-hashes stored passwords, which invalidates existing sessions — all users will need to log in again once. Take a database backup before upgrading.

See [SECURITY.md](SECURITY.md) for the full security posture.

## Changelog

### Database Migration: SQLite → PostgreSQL (2026-07)
- 🗄️ Migrated from SQLite (better-sqlite3) to PostgreSQL 13+
- 🔄 Automatic first-boot migration: legacy `printhive.db` is automatically migrated to Postgres with verification
- ✅ Full async rewrite: 490+ database call sites converted to async/await (db.prepare().get/all/run())
- 🔒 SQL dialect translation: ?, @named params → $n; INSERT OR IGNORE/REPLACE; GROUP_CONCAT; datetime/julianday functions
- 📦 Backup improvements: pg_dump/pg_restore for efficient database backups
- 🧪 Test isolation: Per-boot PostgreSQL schema isolation for concurrent test execution

### Architecture & Security Hardening (2026-07)
- 🏗️ Refactored the backend monolith into a modular `server/` layout (config, middleware, routers, services, realtime, jobs)
- 🔌 Extracted a dedicated `PrinterConnectionManager` and `/ws/printers` WebSocket bridge, decoupling MQTT logic from the web routes (LAN-mode connect/cooldown/reconnect behavior unchanged)
- 🔐 Hashed local passwords with bcrypt (auto-migrates legacy plaintext on first boot)
- 🔐 Auto-generated & persisted session secret; removed the hardcoded default
- 🔐 Added login rate limiting, helmet security headers, and cross-site request rejection
- 🔐 Redacted OIDC client secrets and Bambu tokens from API responses
- ⚙️ Moved thumbnail rendering to a worker thread and serialized ffmpeg/backup work through an in-process job manager
- ✅ Added a Vitest test suite: API contract snapshots and a fake-printer MQTT harness that verifies LAN-mode behavior without hardware
- 🐛 Fixed two latent LAN-mode bugs surfaced during the refactor (a 500 on unreachable-printer connect timeouts, and a leaked pending request per poll)

### v1.1.0 (2026-01-08)
- ✨ Added 10-second countdown to restart splash screen with manual refresh fallback
- ✨ Added filter UI to maintenance tasks for viewing/deleting old tasks
- ✨ Auto-refresh on server recovery when app restarts
- ✨ Added `/api/version` endpoint for version tracking
- 🔧 Removed LOG_LEVEL from docker-compose (now managed in Settings)
- 🐛 Fixed splash screen to remove spinning animation and use splash.png background
- 📝 Improved maintenance task display with per-device filtering
- 🚀 Bump to semantic versioning with automatic sync

### v1.0.0 (Initial Release)
- 🎉 Full 3D printer management system
- 📊 Print history and statistics
- 🖼️ Model library with MakerWorld integration
- 🔄 Real-time MQTT monitoring with AMS support
- 🛡️ OIDC authentication with role-based access
- 🔐 Database maintenance and backup tools
- 📋 Maintenance task tracking with history
- 🐳 Docker container with watchdog process management
- 🎨 Dynamic theme customization
- 📱 Responsive web UI

---

## Authentik SSO Integration

PrintHive supports OIDC authentication with Authentik for enterprise-grade single sign-on.

### Prerequisites
- Running Authentik instance (https://goauthentik.io/)
- Admin access to Authentik
- PrintHive deployed and accessible via domain name

### Step 1: Create Application in Authentik

1. **Create Provider**
   - Go to **Applications** > **Providers** > **Create**
   - Select **OAuth2/OpenID Provider**
   - Configure:
     - **Name**: `PrintHive`
     - **Authentication flow**: `default-authentication-flow`
     - **Authorization flow**: `default-provider-authorization-explicit-consent`
     - **Client type**: `Confidential`
     - **Client ID**: Auto-generated (copy this!)
     - **Client Secret**: Auto-generated (copy this!)
     - **Redirect URIs**: `https://printhive.yourdomain.com/auth/callback`
     - **Signing Key**: `authentik Self-signed Certificate`

2. **Create Application**
   - Go to **Applications** > **Applications** > **Create**
   - Configure:
     - **Name**: `PrintHive`
     - **Slug**: `printhive`
     - **Provider**: Select the provider created above
     - **Launch URL**: `https://printhive.yourdomain.com`

3. **Configure Outpost (if using proxy)**
   - Go to **Outposts** > Select your outpost
   - Add the PrintHive application

### Step 2: Configure PrintHive

**Option A: Via Environment Variables**

Add to your `docker-compose.yml` or `.env`:

```env
PUBLIC_URL=https://printhive.yourdomain.com
OAUTH_ISSUER=https://auth.yourdomain.com/application/o/printhive/
OAUTH_CLIENT_ID=your-client-id-from-authentik
OAUTH_CLIENT_SECRET=your-client-secret-from-authentik
OAUTH_REDIRECT_URI=https://printhive.yourdomain.com/auth/callback
```

**Option B: Via Web Interface**

1. Login to PrintHive as admin
2. Go to **Settings** > **OAuth/SSO**
3. Enable OAuth and enter:
   - **Issuer URL**: `https://auth.yourdomain.com/application/o/printhive/`
   - **Client ID**: From Authentik provider
   - **Client Secret**: From Authentik provider
   - **Redirect URI**: `https://printhive.yourdomain.com/auth/callback`

### Step 3: Configure Bypass for Public Endpoints

Some endpoints like share links should bypass authentication:

1. In Authentik, go to your **Provider** > **Advanced protocol settings**
2. Add to **Redirect URIs/Origins**:
   ```
   https://printhive.yourdomain.com/library/share
   ```

3. Or use Authentik's proxy provider with bypass rules:
   ```
   ^/library/share.*
   ^/api/health.*
   ```

### Step 4: Test Login

1. Navigate to `https://printhive.yourdomain.com`
2. Click **Login with SSO**
3. Authenticate via Authentik
4. You'll be redirected back to PrintHive

### Troubleshooting

**"Invalid redirect_uri"**
- Ensure the redirect URI in Authentik exactly matches: `https://printhive.yourdomain.com/auth/callback`
- Check for trailing slashes (don't use them)

**"Failed to fetch user info"**
- Verify the Issuer URL ends with `/` (important!)
- Check Authentik provider is assigned to the application

**"Session not created"**
- Ensure `SESSION_SECRET` is set in environment variables
- Check that cookies are enabled in browser

---

## Nginx Reverse Proxy Setup

Configure Nginx as a reverse proxy with SSL for PrintHive.

### Prerequisites
- Nginx installed
- SSL certificate (Let's Encrypt recommended)
- Domain name pointing to your server

### Step 1: Install Nginx and Certbot

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx

# RHEL/CentOS
sudo yum install nginx certbot python3-certbot-nginx
```

### Step 2: Obtain SSL Certificate

```bash
# Replace with your actual domain
sudo certbot --nginx -d printhive.yourdomain.com
```

Follow the prompts to complete certificate setup.

### Step 3: Configure Nginx

Create `/etc/nginx/sites-available/printhive`:

```nginx
# Upstream to PrintHive container
upstream printhive_backend {
    server localhost:3000;
    keepalive 64;
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name printhive.yourdomain.com;
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name printhive.yourdomain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/printhive.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/printhive.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers off;
    
    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Max upload size (for 3D models)
    client_max_body_size 500M;
    
    # Timeouts for large uploads
    client_body_timeout 300s;
    client_header_timeout 300s;
    
    # Logging
    access_log /var/log/nginx/printhive_access.log;
    error_log /var/log/nginx/printhive_error.log;

    # Proxy to PrintHive
    location / {
        proxy_pass http://printhive_backend;
        proxy_http_version 1.1;
        
        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        # WebSocket support (required for live printer telemetry at /ws/printers)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Timeouts
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        
        # Buffering
        proxy_buffering off;
        proxy_request_buffering off;
    }
    
    # Bypass auth for public share links (if using Authentik)
    location /library/share {
        proxy_pass http://printhive_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    # Health check endpoint
    location /api/health {
        proxy_pass http://printhive_backend;
        access_log off;
    }
}
```

### Step 4: Enable Site and Restart Nginx

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/printhive /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Enable on boot
sudo systemctl enable nginx
```

### Step 5: Configure Firewall

```bash
# UFW (Ubuntu/Debian)
sudo ufw allow 'Nginx Full'
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Firewalld (RHEL/CentOS)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### Step 6: Update PrintHive Configuration

Update your `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: printhive-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: printhive
      POSTGRES_PASSWORD: your-secure-db-password
      POSTGRES_DB: printhive
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U printhive"]
      interval: 10s
      timeout: 5s
      retries: 5

  printhive:
    image: tr1ckz/printhive:latest
    container_name: printhive
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:3000:3000"  # Only bind to localhost
    environment:
      - PUBLIC_URL=https://printhive.yourdomain.com
      - SESSION_SECRET=your-random-secret-here
      - PG_HOST=postgres:5432
      - PG_USER=printhive
      - PG_PASSWORD=your-secure-db-password
      - PG_DB=printhive
    volumes:
      - ./data:/app/data
      - ./library:/app/library

volumes:
  postgres_data:
```

Restart the container:
```bash
docker-compose down && docker-compose up -d
```

### Testing

1. Visit `http://printhive.yourdomain.com` - should redirect to HTTPS
2. Visit `https://printhive.yourdomain.com` - should load PrintHive
3. Check SSL certificate: Click padlock icon in browser

### Nginx Tips

**Monitor Logs:**
```bash
# Watch access logs
sudo tail -f /var/log/nginx/printhive_access.log

# Watch error logs
sudo tail -f /var/log/nginx/printhive_error.log
```

**Reload Configuration:**
```bash
# After making changes
sudo nginx -t && sudo systemctl reload nginx
```

**SSL Certificate Renewal:**
```bash
# Certbot auto-renews, but you can test:
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal
```

---

## Complete Production Deployment

Full walkthrough combining Authentik SSO and Nginx reverse proxy.

### Architecture Overview

```
Internet → Nginx (443) → Authentik (optional) → PrintHive (3000)
                ↓
         Let's Encrypt SSL
```

### Prerequisites Checklist

- [ ] Domain name configured (A record pointing to your server)
- [ ] Server with Docker and Docker Compose
- [ ] Ports 80 and 443 accessible
- [ ] Email address for Let's Encrypt notifications

### Complete Setup Steps

#### 1. Install Docker and Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin
```

#### 2. Create Project Directory

```bash
mkdir -p ~/printhive-prod
cd ~/printhive-prod
```

#### 3. Create docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: printhive-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${PG_USER}
      POSTGRES_PASSWORD: ${PG_PASSWORD}
      POSTGRES_DB: ${PG_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PG_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  printhive:
    image: tr1ckz/printhive:latest
    container_name: printhive
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:3000:3000"
    environment:
      - PORT=3000
      - PUBLIC_URL=https://printhive.yourdomain.com
      - SESSION_SECRET=${SESSION_SECRET}
      - PG_HOST=postgres:5432
      - PG_USER=${PG_USER}
      - PG_PASSWORD=${PG_PASSWORD}
      - PG_DB=${PG_DB}
      # OAuth (optional - can configure via UI)
      - OAUTH_ISSUER=${OAUTH_ISSUER:-}
      - OAUTH_CLIENT_ID=${OAUTH_CLIENT_ID:-}
      - OAUTH_CLIENT_SECRET=${OAUTH_CLIENT_SECRET:-}
      - OAUTH_REDIRECT_URI=https://printhive.yourdomain.com/auth/callback
    volumes:
      - ./data:/app/data
      - ./library:/app/library
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  postgres_data:
```

#### 4. Create .env File

```bash
# Generate random session secret
SESSION_SECRET=$(openssl rand -hex 32)
PG_PASSWORD=$(openssl rand -hex 16)

cat > .env << EOF
SESSION_SECRET=${SESSION_SECRET}
PG_USER=printhive
PG_PASSWORD=${PG_PASSWORD}
PG_DB=printhive
# OAuth (fill in if using Authentik)
OAUTH_ISSUER=
OAUTH_CLIENT_ID=
OAUTH_CLIENT_SECRET=
EOF

chmod 600 .env
```

#### 5. Start PrintHive

```bash
docker-compose up -d
docker-compose logs -f
```

Verify it's running: `curl http://localhost:3000/api/health`

#### 6. Install and Configure Nginx

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx

# Copy the Nginx config from above section
sudo nano /etc/nginx/sites-available/printhive

# Enable site
sudo ln -s /etc/nginx/sites-available/printhive /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 7. Obtain SSL Certificate

```bash
sudo certbot --nginx -d printhive.yourdomain.com
```

#### 8. Configure Authentik (Optional)

Follow the [Authentik SSO Integration](#authentik-sso-integration) section above.

#### 9. First Login

1. Navigate to `https://printhive.yourdomain.com`
2. Login with default credentials: `admin` / `admin`
3. **IMMEDIATELY** change the password:
   - Go to Settings > Account
   - Click "Change Password"
4. Configure your Bambu Lab printer:
   - Settings > Printer Connection
   - Enter IP, access code, serial number

#### 10. Configure Backups

1. Go to Settings > Advanced > Database Backups
2. Enable automatic backups
3. Set retention period (e.g., 7 days)
4. (Optional) Configure SFTP/FTP remote backup

### Security Checklist

- [ ] Changed default admin password
- [ ] Generated strong SESSION_SECRET
- [ ] SSL certificate installed and auto-renewing
- [ ] Firewall configured (only 80/443 open)
- [ ] Automatic backups enabled
- [ ] OAuth/SSO configured (recommended)
- [ ] Nginx security headers enabled
- [ ] Container only accessible via localhost
- [ ] Regular updates scheduled (`docker-compose pull && docker-compose up -d`)

### Maintenance

**Update PrintHive:**
```bash
cd ~/printhive-prod
docker-compose pull
docker-compose up -d
```

**View Logs:**
```bash
docker-compose logs -f
```

**Backup Database Manually:**
```bash
docker exec printhive-postgres pg_dump -U printhive printhive > /backup/manual_backup_$(date +%s).dump
```

**Restart Services:**
```bash
docker-compose restart
sudo systemctl restart nginx
```

---

## License

MIT License - feel free to use and modify as needed.

## Support

- **Issues**: Report bugs via GitHub Issues
- **Documentation**: Check [README-ENV.md](README-ENV.md), [DOCKER.md](DOCKER.md), and [CONTRIBUTING.md](CONTRIBUTING.md)
- **Community**: Contributions welcome!

## Acknowledgments

- Bambu Lab for their 3D printers and API
- MakerWorld community for model sharing
- Contributors and testers

## Disclaimer

This is an unofficial integration with Bambu Lab cloud services. It is not affiliated with, endorsed by, or supported by Bambu Lab. Use at your own risk.
