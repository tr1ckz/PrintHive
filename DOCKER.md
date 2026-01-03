# Docker Deployment Guide

## Quick Start

### Using Docker Hub (Recommended)
```bash
docker pull ghcr.io/tr1ckz/bambu-lab-integration:latest

docker run -d \
  --name bambu-lab \
  -p 3000:3000 \
  -v bambu_data:/app/data \
  -v bambu_library:/app/library \
  -v bambu_sessions:/app/sessions \
  ghcr.io/tr1ckz/bambu-lab-integration:latest
```

### Building Locally
```bash
docker build -t bambu-lab-integration:latest .
docker run -d --name bambu-lab -p 3000:3000 bambu-lab-integration:latest
```

## Configuration

Create a `.env` file or set environment variables:
```bash
BAMBU_HOST=192.168.1.100
BAMBU_ACCESS_CODE=your_access_code
BAMBU_SERIAL=your_serial_number
PORT=3000
```

## Unraid Installation

### Step 1: Add Container
1. Go to **Docker** tab in Unraid
2. Click **Add Container**
3. Set **Template**: `Custom`

### Step 2: Basic Configuration
- **Name**: `bambu-lab-integration`
- **Repository**: `ghcr.io/tr1ckz/bambu-lab-integration:latest`
- **Network Type**: `Bridge`
- **WebUI**: `http://[IP]:[PORT:3000]`

### Step 3: Port Mapping
| Container Port | Host Port | Type |
|----------------|-----------|------|
| 3000           | 3000      | TCP  |

### Step 4: Path Mappings
Add these volume mappings:

| Container Path | Host Path | Mode |
|----------------|-----------|------|
| `/app/data` | `/mnt/user/appdata/bambu-lab/data` | RW |
| `/app/library` | `/mnt/user/appdata/bambu-lab/library` | RW |
| `/app/sessions` | `/mnt/user/appdata/bambu-lab/sessions` | RW |

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
docker logs bambu-lab
```

**Can't connect to printer:**
- Verify printer IP is correct
- Check access code from printer LCD > Settings > LAN Only Mode
- Ensure printer and container on same network

**No thumbnails generating:**
- @napi-rs/canvas is installed with prebuilt binaries
- Check logs for rendering errors

## GitHub Actions

Automatic builds trigger on push to `main` branch. Images published to:
- `ghcr.io/tr1ckz/bambu-lab-integration:latest`
- `ghcr.io/tr1ckz/bambu-lab-integration:main`

Multi-platform support: `linux/amd64`, `linux/arm64`
