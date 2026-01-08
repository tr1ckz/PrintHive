#!/usr/bin/env node
/**
 * Version sync utility
 * Generates version.json from package.json
 * Run on startup to ensure version is always current
 */

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, 'package.json');
const versionPath = path.join(__dirname, 'version.json');

try {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const version = pkg.version || '0.0.0';
  const timestamp = new Date().toISOString();

  const versionData = {
    version,
    name: pkg.name,
    description: pkg.description,
    timestamp,
    buildTime: new Date().toLocaleString()
  };

  fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
  console.log(`[version-sync] Generated version.json: v${version}`);
} catch (error) {
  console.error('[version-sync] Failed to sync version:', error.message);
  process.exit(1);
}
