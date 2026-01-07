# PrintHive - 3D Printer Management

A comprehensive web application for managing 3D printers, including print history tracking, model library management, real-time printer monitoring via MQTT, cloud synchronization with Bambu MakerWorld, and complete database backup & maintenance tools.

## Features

### Core Features
- **Authentication**: Secure login with OIDC support (Authentik, Keycloak, Auth0, etc.)
- **Print History**: Track all your prints with cover images from MakerWorld, paginated display
- **Model Library**: Upload and manage your 3D model files (.3mf, .stl, .gcode)
- **Printer Monitoring**: Real-time status updates via MQTT
- **Cloud Sync**: Automatic synchronization with Bambu Cloud
- **Timelapse Videos**: Download and convert print timelapses
- **Statistics**: View print success rates and analytics
- **Duplicate Detection**: Find duplicate models in your library
- **User Management**: Multi-user support with admin controls

### Database & Maintenance
- **Database Maintenance**: Vacuum, Analyze, and Reindex operations with detailed results
- **Automatic Backups**: Schedule automatic database backups (local storage)
- **Remote Backups**: Upload backups to SFTP or FTP servers
- **Backup Retention**: Automatic cleanup of old backups based on retention policy
- **Settings Management**: Organized settings with collapsible categories

### Printer Maintenance
- **Maintenance Tracking**: Track scheduled printer maintenance tasks
- **Maintenance Intervals**: Set maintenance schedules for different printer models
- **Maintenance Alerts**: Get notified via Discord when maintenance is due
- **Task Management**: Mark maintenance tasks as complete and track history

### Integrations
- **Discord Webhooks**: Get notifications for print failures and maintenance alerts
- **MQTT Monitoring**: Real-time printer status updates
- **SFTP/FTP Backup**: Upload database backups to remote servers
- **OAuth/SSO**: Enterprise authentication with OIDC providers

## Quick Start

### Prerequisites

- Node.js 18+ or Docker
- Bambu printer account
- (Optional) OIDC identity provider for SSO
- (Optional) SFTP/FTP server for remote backups

### Installation

#### Option 1: Docker (Recommended)

1. Pull the latest image:
```bash
docker pull ghcr.io/tr1ckz/printhive:latest
```

2. Create a docker-compose.yml:
```yaml
version: '3.8'
services:
  printhive:
    image: ghcr.io/tr1ckz/printhive:latest
    container_name: printhive
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./sessions:/app/sessions
      - ./library:/app/library
      - ./videos:/app/data/videos
      - ./backups:/app/data/backups
    environment:
      - SESSION_SECRET=your-random-secret-key
      - PUBLIC_URL=https://your-domain.com
      - LOG_LEVEL=info
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

- `SESSION_SECRET`: Random secret key for session encryption
- `PUBLIC_URL`: Your application's public URL

### Optional Environment Variables

- `OAUTH_ISSUER`: OIDC provider URL
- `OAUTH_CLIENT_ID`: OAuth client ID
- `OAUTH_CLIENT_SECRET`: OAuth client secret
- `DISCORD_WEBHOOK_URL`: Discord webhook for notifications
- `MQTT_BROKER`: MQTT broker address

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

- Create new users
- Assign roles (user, admin, superadmin)
- Enable/disable accounts
- Reset passwords
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

### Backup Strategy

**Local Backups:**
```
/app/data/backups/
├── printhive_backup_2024-01-06_1704528000000.db
├── printhive_backup_2024-01-05_1704441600000.db
└── ... (older backups auto-deleted based on retention)
```

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

# Build for production
npm run build

# Run production server
npm start

# Reset admin user
npm run reset-admin
```

## Tech Stack

- **Backend**: Node.js, Express.js
- **Frontend**: React 19.2, Vite 7.2, TypeScript
- **Database**: SQLite (printhive.db)
- **Authentication**: OpenID Connect (OIDC)
- **Real-time**: MQTT for printer monitoring
- **Backup**: SFTP & FTP support
- **Container**: Docker with multi-architecture support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Security

- Never commit your `.env` file with actual credentials
- Use strong, random `SESSION_SECRET` in production
- Configure HTTPS in production deployments
- Passwords in database settings are masked (only updated if explicitly changed)
- Remote backup credentials are stored encrypted in config

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
