# Bambu Lab 3D Printing Integration

A comprehensive web application for managing Bambu Lab 3D printers, including print history tracking, model library management, real-time printer monitoring via MQTT, and cloud synchronization with Bambu Lab MakerWorld.

## Features

- **Authentication**: Secure login with OIDC support (Authentik, Keycloak, Auth0, etc.)
- **Print History**: Track all your prints with cover images from MakerWorld
- **Model Library**: Upload and manage your 3D model files (.3mf, .stl, .gcode)
- **Printer Monitoring**: Real-time status updates via MQTT
- **Cloud Sync**: Automatic synchronization with Bambu Cloud
- **Timelapse Videos**: Download and convert print timelapses
- **Statistics**: View print success rates and analytics
- **Duplicate Detection**: Find duplicate models in your library
- **User Management**: Multi-user support with admin controls

## Quick Start

### Prerequisites

- Node.js 18+ or Docker
- Bambu Lab account
- (Optional) OIDC identity provider for SSO

### Installation

#### Option 1: Docker (Recommended)

1. Pull the latest image:
```bash
docker pull ghcr.io/tr1ckz/bambu-lab-integration:latest
```

2. Create a docker-compose.yml:
```yaml
version: '3.8'
services:
  bambu:
    image: ghcr.io/tr1ckz/bambu-lab-integration:latest
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./sessions:/app/sessions
      - ./library:/app/library
      - ./videos:/app/data/videos
    environment:
      - SESSION_SECRET=your-random-secret-key
      - PUBLIC_URL=https://your-domain.com
```

3. Start the container:
```bash
docker-compose up -d
```

For detailed Docker and Unraid instructions, see [DOCKER.md](DOCKER.md).

#### Option 2: Local Development

1. Clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/bambu-lab-integration.git
cd bambu-lab-integration
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

## Deployment

### Docker & Unraid

See [DOCKER.md](DOCKER.md) for complete Docker and Unraid deployment instructions including:
- Docker Hub installation
- Docker Compose setup
- Unraid step-by-step guide with volume mappings
- Troubleshooting common issues

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
```

## Tech Stack

- **Backend**: Node.js, Express.js
- **Frontend**: React 19.2, Vite 7.2, TypeScript
- **Database**: SQLite
- **Authentication**: OpenID Connect (OIDC)
- **Real-time**: MQTT for printer monitoring
- **Container**: Docker with multi-architecture support

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Security

- Never commit your `.env` file with actual credentials
- Use strong, random `SESSION_SECRET` in production
- Configure HTTPS in production deployments

## License

MIT License - feel free to use and modify as needed.

## Support

- **Issues**: Report bugs via GitHub Issues
- **Documentation**: Check [README-ENV.md](README-ENV.md) and [DOCKER.md](DOCKER.md)
- **Community**: Contributions welcome!

## Acknowledgments

- Bambu Lab for their excellent 3D printers and API
- MakerWorld community for model sharing
- Contributors and testers

## Disclaimer

This is an unofficial integration with Bambu Lab's cloud services. It is not affiliated with, endorsed by, or supported by Bambu Lab. Use at your own risk.
