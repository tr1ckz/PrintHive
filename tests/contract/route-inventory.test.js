import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Static route inventory: every literal route registration across the server
 * sources. Catches endpoints silently dropped during router extraction —
 * shape snapshots can't, because a missing route just 404s.
 */
function collectServerFiles() {
  const files = [path.join(ROOT, 'simple-server.js')];
  const routesDir = path.join(ROOT, 'server');
  if (fs.existsSync(routesDir)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.js')) files.push(p);
      }
    };
    walk(routesDir);
  }
  return files;
}

function extractRoutes(source) {
  const routes = [];
  const pattern = /^\s*(?:app|router)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    routes.push(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return routes;
}

describe('route inventory', () => {
  it('matches the pinned endpoint list', () => {
    const routes = collectServerFiles()
      .flatMap((f) => extractRoutes(fs.readFileSync(f, 'utf8')))
      .sort();
    expect(routes.length).toBeGreaterThan(100);
    expect(routes).toMatchSnapshot();
  });
});
