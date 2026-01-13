# Docker Deployment Guide

## Quick Start

### Using Docker Hub (Recommended)
```bash
docker pull tr1ckz/printhive:latest

docker run -d \
  --name printhive \
  -p 3000:3000 \
  -e PORT=3000 \
  -v printhive_data:/app/data \
  -v printhive_library:/app/library \
  -v printhive_sessions:/app/sessions \
  tr1ckz/printhive:latest
```

**Custom Port Example:**
```bash
# Run on port 8080 instead
docker run -d \
  --name printhive \
  -p 8080:8080 \
  -e PORT=8080 \
  -v printhive_data:/app/data \
  -v printhive_library:/app/library \
  -v printhive_sessions:/app/sessions \
  tr1ckz/printhive:latest
```

### Building Locally
```bash
docker build -t printhive:latest .
docker run -d --name printhive -p 3000:3000 -e PORT=3000 printhive:latest
```

## Configuration

Create a `.env` file or set environment variables. Most settings can also be configured via the web interface Settings page:

```bash
PORT=3000                   # Change this to use a different port
HOST_PORT=3000             # For docker-compose: host machine port
SESSION_SECRET=your-secret  # Required: random secret for sessions
PUBLIC_URL=http://localhost:3000  # Where the app is publicly accessible
```

**Log Level Management:**
- Log level is now managed in the web UI (Settings > System)
- Default: `INFO` level (changed at runtime without restart)
- Options: DEBUG, INFO, WARNING, ERROR
- No need to set via environment variables

**Using docker-compose with custom port:**
```bash
# Create .env file
echo "PORT=8080" > .env
echo "HOST_PORT=8080" >> .env

# Start with docker-compose
docker-compose up -d
```

## Unraid Installation

### Step 1: Add Container
1. Go to **Docker** tab in Unraid
2. Click **Add Container**
3. Set **Template**: `Custom`

### Step 2: Basic Configuration
- **Name**: `printhive`
- **Repository**: `tr1ckz/printhive:latest`
- **Network Type**: `Bridge`
- **WebUI**: `http://[IP]:[PORT:3000]`

### Step 3: Port Mapping
| Container Port | Host Port | Type | Note |
|----------------|-----------|------|------|
| 3000           | 3000      | TCP  | Change both if using custom PORT env |

**For custom port:** Set the PORT environment variable and update both ports accordingly.

### Step 4: Path Mappings
Add these volume mappings:

| Container Path | Host Path | Mode |
|----------------|-----------|------|
| `/app/data` | `/mnt/user/appdata/printhive/data` | RW |
| `/app/library` | `/mnt/user/appdata/printhive/library` | RW |
| `/app/sessions` | `/mnt/user/appdata/printhive/sessions` | RW |

### Step 5: Environment Variables
Add these variables (optional but recommended):

| Variable | Value | Description |
|----------|-------|-------------|
| `BAMBU_HOST` | `192.168.1.100` | Your Bambu printer IP |
| `BAMBU_ACCESS_CODE` | `12345678` | Access code from printer LCD |
| `BAMBU_SERIAL` | `01234567` | Printer serial number |
| `PORT` | `3000` | Web interface port |

### Step 6: Getting Printer Info
1. **IP Address**: Check your router's DHCP leases or printer LCD > Network
2. **Access Code**: LCD Menu > Settings > LAN Only Mode (8-digit code)
3. **Serial Number**: LCD Menu > Settings > Device Info

### Step 7: Apply & Start
1. Click **Apply**
2. Container will download and start
3. Access web interface: `http://your-unraid-ip:3000`

### Optional: Custom Template
Save this configuration as a custom template for easy reinstallation:
1. After setup, click container icon > **Edit**
2. Click **Save as Template** at bottom
3. Name it "Bambu Lab Integration"

## Troubleshooting

### Build Errors Fixed
- ✅ **Git dependency error**: Fixed by installing git in container
- ✅ **Canvas compilation error**: Switched to @napi-rs/canvas with prebuilt binaries
- ✅ **Rollup missing error**: Install dependencies normally to get rollup binaries
- ✅ **GL package error**: Removed unused gl package

### Common Issues

**Container won't start:**
```bash
docker logs printhive
```

**Can't connect to printer:**
- Verify printer IP is correct
- Check access code from printer LCD > Settings > LAN Only Mode
- Ensure printer and container on same network

**No thumbnails generating:**
- @napi-rs/canvas is installed with prebuilt binaries
- Check logs for rendering errors

## GitHub Actions

Automatic builds trigger on push to `main` branch. Images published to Docker Hub:
- `tr1ckz/printhive:latest`
- `tr1ckz/printhive:main`

Multi-platform support: `linux/amd64`, `linux/arm64`

