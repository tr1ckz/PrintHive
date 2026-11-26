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

  // The Docker image bakes version.json in at build time and runs the app as
  // an unprivileged user that cannot write to /app, so only rewrite it when
  // the version actually changed (e.g. a local checkout after a pull).
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  } catch (_) {
    // missing or unreadable: (re)generate below
  }

  if (current && current.version === version) {
    console.log(`[version-sync] version.json is current: v${version}`);
  } else {
    try {
      fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
      console.log(`[version-sync] Generated version.json: v${version}`);
    } catch (error) {
      // Never take the server down over the version label; /api/version
      // already answers 404 when the file is missing.
      console.warn(`[version-sync] Could not write version.json (${error.code || error.message}); continuing`);
    }
  }
} catch (error) {
  console.error('[version-sync] Failed to sync version:', error.message);
  process.exit(1);
}
