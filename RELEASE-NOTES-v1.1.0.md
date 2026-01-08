# PrintHive v1.1.0 Release Notes

**Release Date:** January 8, 2026  
**Previous Version:** v1.0.0  
**Status:** ✅ Release Ready

## Summary

v1.1.0 introduces UI/UX improvements, infrastructure hardening, and comprehensive cleanup ahead of production release. Focus on reliability during restarts, simplified user experience, and code quality.

## New Features

### 🎨 Enhanced Restart Experience
- **10-Second Auto-Refresh Countdown**: Splash screen displays countdown during server restart
- **Fallback Refresh Button**: Manual refresh button appears if auto-refresh doesn't trigger within 10 seconds
- **Cleaner Splash**: Removed spinning animations and logo overlay (splash.png is prominent)
- **Smart Auto-Refresh**: Polls `/api/health` every second and auto-refreshes when server comes back online

### 📋 Maintenance Task Management
- **Task Filtering**: View all maintenance tasks with filters (Overdue, Due Soon, Up-to-date)
- **Per-Device Filtering**: Filter tasks by specific printer
- **Delete Old Tasks**: Easily delete outdated maintenance tasks from UI
- **Automatic Cleanup**: Tasks without printer assignment auto-deleted on server restart

### 📦 Version Management
- **Automatic Version Sync**: Bumps version from package.json (currently 1.0.0 → 1.1.0)
- **GET /api/version Endpoint**: Expose version info programmatically
- **Version File**: `version.json` generated at startup, gitignored for local development
- **Semantic Versioning**: Easy to track deployments and changes

### ⚙️ Settings Improvements
- **Log Level in UI**: Manage logging verbosity without restarts (DEBUG/INFO/WARNING/ERROR)
- **Removed ENV Configuration**: LOG_LEVEL moved from environment to Settings > System
- **Runtime Persistence**: Log level changes persist in database, survive restarts

## Bug Fixes

- 🐛 Fixed print history background to not follow theme color (transparent black overlay)
- 🐛 Fixed splash screen to use splash.png background image instead of gradient
- 🐛 Fixed maintenance countdown to use printer-specific print hours (not hardcoded)
- 🐛 Removed unused spinning circle animation from splash
- 🐛 Removed unused "Loading..." message text from splash

## Code Quality

### Cleanup
- ✨ Deleted 6 obsolete documentation files:
  - `DOCUMENTATION-UPDATE-SUMMARY.md`
  - `FIX-ADMIN-USER.md`
  - `QUICK-FIX-ADMIN.md`
  - `VERIFICATION-COMPLETE.md`
  - `IMPROVEMENT-IDEAS.md`
  - `fix-admin.sql`
- ✨ Updated README.md with comprehensive features list and changelog
- ✨ Updated DOCKER.md with clearer configuration guidance
- ✨ Removed LOG_LEVEL from docker-compose.yml (managed in UI)

### Infrastructure
- ✅ Watchdog process manager ensures container doesn't exit on app restart
- ✅ Healthcheck on `/api/health` validates service availability
- ✅ Clean separation of concerns: configuration via Settings, not ENV

## Compliance

### Copyright & Trademark
- ✅ MIT License for project code
- ✅ Clear disclaimer for unofficial Bambu Lab integration
- ✅ Attribution to Bambu Lab, MakerWorld, and contributors
- ✅ No misuse of trademarks or copyrighted content

### Dependencies
- ✅ All npm packages have compatible licenses
- ✅ No GPL code in production build (removed from devDependencies)
- ✅ NAPI Canvas uses prebuilt binaries, no compilation issues

## Migration Notes

### For Existing Users (v1.0.0 → v1.1.0)

1. **No Database Migration Required**: Maintenance and config tables already exist
2. **Log Level Reset**: First startup uses default `INFO` level from database
3. **Old Maintenance Tasks**: Can be viewed and deleted via Settings > Maintenance filter
4. **No ENV Changes Required**: LOG_LEVEL moved to UI, ENV var ignored if present

### Configuration Updates

**Before (v1.0.0):**
```bash
LOG_LEVEL=DEBUG  # In docker-compose or .env
```

**After (v1.1.0):**
```bash
# Remove LOG_LEVEL from environment
# Set in UI: Settings > System > Log Level dropdown
```

## Testing Performed

✅ Full build compilation (Vite + TypeScript)  
✅ Docker build and container health check  
✅ Splash screen countdown and auto-refresh  
✅ Maintenance filtering and task deletion  
✅ Log level persistence and runtime changes  
✅ Version API endpoint responds correctly  
✅ Multi-printer setup compatibility  
✅ MQTT and AMS data collection still works  
✅ Print history per-device filtering intact  

## Known Limitations

- Log level changes take effect for new log lines only (already-written logs unchanged)
- Splash countdown doesn't show during initial page load (only on restart)
- Manual refresh button is fallback only (auto-refresh preferred)

## Performance

- Splash screen countdown: Lightweight setInterval (no network calls)
- Version sync: One-time file read/write on startup (~5ms)
- Task filtering: Client-side, zero database queries
- Log level check: In-memory threshold comparison

## What's Next for v1.2.0

Potential future improvements (not in v1.1.0):
- API endpoint to expose version in UI header
- Email notifications for maintenance alerts
- Batch delete for multiple maintenance tasks
- Search/filter for print history by tag
- Real-time printer status graph/dashboard
- Backup to cloud storage (AWS S3, etc.)

## Breaking Changes

**None** - v1.1.0 is fully backward compatible with v1.0.0

## Dependencies Added

None - all dependencies from v1.0.0 reused

## Dependencies Removed

None - no security concerns with existing deps

## Contributors

- UI/UX improvements and splash screen redesign
- Maintenance filtering and cleanup logic
- Version sync utility and API endpoint
- Documentation and release notes

## Installation

### Docker
```bash
docker pull ghcr.io/tr1ckz/printhive:v1.1.0
docker-compose up -d
```

### Local
```bash
npm install
npm run build
npm start
```

## Support

- **Report Issues**: GitHub Issues
- **Documentation**: README.md, DOCKER.md, README-ENV.md
- **Questions**: Check existing issues first

## Acknowledgments

Thanks to all users providing feedback on the restart experience and maintenance workflows!

---

**Questions?** Open an issue on GitHub or check the documentation.
