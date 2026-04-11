import './Docs.css';

interface DocsProps {
  standalone?: boolean;
}

const tocItems = [
  { id: 'overview', label: 'Overview' },
  { id: 'features', label: 'Features' },
  { id: 'pages', label: 'Pages & Workflows' },
  { id: 'docker', label: 'Docker Setup' },
  { id: 'sso', label: 'SSO / OIDC' },
  { id: 'printers', label: 'Printer Setup' },
  { id: 'backups', label: 'Backups & Maintenance' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
] as const;

const featureGroups = [
  {
    title: 'Print management',
    items: [
      'Cloud sync with Bambu accounts and local printer history import',
      'Print History with search, filtering, CSV export, covers, and timelapse support',
      'Statistics for success rates, material use, time, and printer activity',
      'Model Library uploads for .3mf, .stl, and .gcode files',
    ],
  },
  {
    title: 'Live monitoring',
    items: [
      'Real-time printer state via MQTT',
      'AMS status, trays, temperatures, fans, speed mode, and progress details',
      'Frigate or Native RTSP camera feeds with optional per-printer assignment',
      'Background job tracking for sync and media processing tasks',
    ],
  },
  {
    title: 'Administration',
    items: [
      'OIDC / SSO login support with role mapping',
      'User management for User, Admin, and Super Admin roles',
      'Backup scheduling, restore tools, database maintenance, and remote backup upload',
      'UI preferences, themes, notifications, and watchdog/system controls',
    ],
  },
] as const;

const pageGuide = [
  ['Home', 'Live dashboard with printer health, queue visibility, shortcuts, and recent activity.'],
  ['History', 'Full print history, sync actions, SD card import, video matching, exports, and file downloads.'],
  ['Stats', 'Aggregated analytics: totals, success rate, materials, duration, and printer usage.'],
  ['Library', 'Upload and organize local 3D files used across your workflow.'],
  ['Duplicates', 'Find repeated or duplicate files in the local model library.'],
  ['Maintenance', 'Track recurring maintenance jobs and log completed service actions.'],
  ['Printers', 'Monitor printer status, active jobs, telemetry, AMS trays, and camera feeds.'],
  ['Settings', 'Configure accounts, printers, SSO, notifications, system jobs, costs, and administration.'],
  ['Docs', 'This page: full deployment, setup, usage, and troubleshooting guide.'],
] as const;

const overviewStats = [
  { value: '10 min', label: 'Typical Docker deploy' },
  { value: 'Live', label: 'MQTT printer telemetry' },
  { value: 'Cloud + LAN', label: 'Hybrid sync coverage' },
] as const;

const envVars = [
  ['SESSION_SECRET', 'Required', 'Random secret used to sign sessions.'],
  ['PUBLIC_URL', 'Required', 'External URL users visit, such as `https://printhive.example.com`.'],
  ['PORT', 'Optional', 'HTTP port for the app; defaults to `3000`.'],
  ['OAUTH_ISSUER', 'Optional', 'OIDC issuer URL from Authentik, Keycloak, Auth0, Okta, etc.'],
  ['OAUTH_CLIENT_ID', 'Optional', 'OIDC client ID.'],
  ['OAUTH_CLIENT_SECRET', 'Optional', 'OIDC client secret.'],
  ['OAUTH_REDIRECT_URI', 'Optional', 'Usually `${PUBLIC_URL}/auth/callback`.'],
  ['OAUTH_GROUPS_CLAIM', 'Optional', 'Claim name containing group membership, usually `groups`.'],
  ['LOCALAUTH', 'Optional', 'Set to `true` only if you want the local `/admin` login route enabled.'],
] as const;

const dockerRunExample = `docker run -d \
  --name printhive \
  -p 3000:3000 \
  -e PORT=3000 \
  -e SESSION_SECRET=change-me \
  -e PUBLIC_URL=http://localhost:3000 \
  -v printhive_data:/app/data \
  -v printhive_library:/app/library \
  -v printhive_sessions:/app/sessions \
  tr1ckz/printhive:latest`;

const dockerComposeExample = `services:\n  printhive:\n    image: tr1ckz/printhive:latest\n    container_name: printhive\n    restart: unless-stopped\n    ports:\n      - \"3000:3000\"\n    environment:\n      SESSION_SECRET: change-me\n      PUBLIC_URL: https://printhive.example.com\n      PORT: 3000\n      OAUTH_ISSUER: https://auth.example.com/application/o/printhive/\n      OAUTH_CLIENT_ID: your-client-id\n      OAUTH_CLIENT_SECRET: your-client-secret\n      OAUTH_REDIRECT_URI: https://printhive.example.com/auth/callback\n    volumes:\n      - ./data:/app/data\n      - ./library:/app/library\n      - ./sessions:/app/sessions`;

const ssoExample = `OAUTH_ISSUER=https://auth.example.com/application/o/printhive/\nOAUTH_CLIENT_ID=your_client_id\nOAUTH_CLIENT_SECRET=your_client_secret\nOAUTH_REDIRECT_URI=https://printhive.example.com/auth/callback\nOAUTH_GROUPS_CLAIM=groups`;

function Docs({ standalone = false }: DocsProps) {
  return (
    <div className={`docs-page ${standalone ? 'standalone' : ''}`}>
      <header className="docs-hero">
        <div className="docs-hero-copy">
          <div>
            <span className="docs-badge">/docs</span>
            {standalone ? (
              <>
                <h1>PrintHive Documentation</h1>
                <p>
                  Everything you need to install, secure, connect, and run PrintHive — including Docker,
                  SSO, printer onboarding, sync, backups, and day-to-day workflows.
                </p>
              </>
            ) : null}
          </div>

          <div className="docs-hero-links">
            {tocItems.slice(0, 6).map((item) => (
              <a key={item.id} href={`#${item.id}`} className="docs-anchor-link">
                {item.label}
              </a>
            ))}
            {standalone && (
              <a href="/" className="docs-anchor-link docs-anchor-link-primary">
                Open App
              </a>
            )}
          </div>

          <div className="docs-chip-list docs-chip-list-hero">
            <span>Docker-ready</span>
            <span>OIDC / SSO</span>
            <span>MQTT live status</span>
            <span>Backups + restore</span>
            <span>Cloud + local sync</span>
          </div>
        </div>

        <div className="docs-hero-panel">
          <div className="docs-stack-card">
            <span className="docs-stack-label">Recommended rollout</span>
            <ol className="docs-steps docs-hero-steps">
              <li>Deploy with Docker and mount persistent data volumes.</li>
              <li>Connect Bambu cloud or LAN printers from Settings.</li>
              <li>Enable SSO, backups, and notifications for day-two ops.</li>
            </ol>
          </div>

          <div className="docs-stat-grid">
            {overviewStats.map((item) => (
              <article key={item.label} className="docs-stat-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
        </div>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <div className="docs-sidebar-card">
            <h2>On this page</h2>
            <nav>
              {tocItems.map((item) => (
                <a key={item.id} href={`#${item.id}`} className="docs-sidebar-link">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="docs-content">
          <section id="overview" className="docs-section">
            <h2>Overview</h2>
            <p>
              PrintHive is a web app for running a Bambu-centered print farm or personal 3D printing setup.
              It combines cloud print history, local printer telemetry, file management, statistics, backups,
              and admin tools into one dashboard.
            </p>
            <div className="docs-callout">
              <strong>Best fit:</strong> users who want one place to manage Bambu accounts, LAN printers,
              timelapses, model files, maintenance, and team access.
            </div>
            <div className="docs-chip-list">
              <span>Docker-ready</span>
              <span>OIDC / SSO</span>
              <span>MQTT live status</span>
              <span>Backups + restore</span>
              <span>Multi-user</span>
              <span>Cloud + local sync</span>
            </div>
          </section>

          <section id="features" className="docs-section">
            <h2>Features</h2>
            <div className="docs-grid docs-grid-3 docs-feature-grid">
              {featureGroups.map((group) => (
                <article key={group.title} className="docs-card">
                  <h3>{group.title}</h3>
                  <ul>
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          <section id="pages" className="docs-section">
            <h2>Pages & workflows</h2>
            <div className="docs-grid docs-grid-3 docs-page-grid">
              {pageGuide.map(([page, description]) => (
                <article key={page} className="docs-card docs-page-tile">
                  <span className="docs-page-label">{page}</span>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="docker" className="docs-section">
            <h2>Docker setup</h2>
            <div className="docs-grid docs-grid-2">
              <article className="docs-card">
                <h3>Quick start</h3>
                <ol className="docs-steps">
                  <li>Pull `tr1ckz/printhive:latest`.</li>
                  <li>Mount persistent volumes for `data`, `library`, and `sessions`.</li>
                  <li>Set `SESSION_SECRET` and `PUBLIC_URL`.</li>
                  <li>Expose port `3000` or your preferred mapped port.</li>
                </ol>
              </article>
              <article className="docs-card">
                <h3>Persistent paths</h3>
                <ul>
                  <li><code>/app/data</code> — database, videos, backups, caches</li>
                  <li><code>/app/library</code> — uploaded local model files</li>
                  <li><code>/app/sessions</code> — authenticated session storage</li>
                </ul>
              </article>
            </div>

            <div className="docs-code-block">
              <div className="docs-code-title">docker run</div>
              <pre>{dockerRunExample}</pre>
            </div>

            <div className="docs-code-block">
              <div className="docs-code-title">docker-compose.yml</div>
              <pre>{dockerComposeExample}</pre>
            </div>

            <div className="docs-callout warning">
              <strong>Important:</strong> if you update or recreate the container without persistent volumes,
              you will lose the database, uploaded files, and sessions.
            </div>

            <div className="docs-table-wrap">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Variable</th>
                    <th>Need</th>
                    <th>Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {envVars.map(([name, need, purpose]) => (
                    <tr key={name}>
                      <td><code>{name}</code></td>
                      <td>{need}</td>
                      <td>{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="sso" className="docs-section">
            <h2>SSO / OIDC setup</h2>
            <p>
              PrintHive supports OpenID Connect providers such as Authentik, Keycloak, Auth0, Okta, and similar systems.
              Configure the provider, then add the values in your container environment or the Settings page.
            </p>

            <div className="docs-grid docs-grid-2">
              <article className="docs-card">
                <h3>Provider checklist</h3>
                <ol className="docs-steps">
                  <li>Create a new OIDC application/client for PrintHive.</li>
                  <li>Set the redirect URI to <code>{'${PUBLIC_URL}/auth/callback'}</code>.</li>
                  <li>Enable the `openid`, `profile`, and `email` scopes.</li>
                  <li>Ensure group membership is exposed, usually through the `groups` claim.</li>
                </ol>
              </article>
              <article className="docs-card">
                <h3>Role mapping</h3>
                <ul>
                  <li><strong>Admin</strong> / <strong>Admins</strong> group → <strong>Super Admin</strong></li>
                  <li><strong>Users</strong> / <strong>Friends</strong> group → <strong>User</strong></li>
                  <li>Group matching is case-insensitive.</li>
                </ul>
              </article>
            </div>

            <div className="docs-code-block">
              <div className="docs-code-title">Example OIDC environment</div>
              <pre>{ssoExample}</pre>
            </div>
          </section>

          <section id="printers" className="docs-section">
            <h2>Printer setup</h2>
            <div className="docs-grid docs-grid-2">
              <article className="docs-card">
                <h3>1. Bambu cloud account</h3>
                <ol className="docs-steps">
                  <li>Open <strong>Settings → Bambu</strong>.</li>
                  <li>Add one or more Bambu accounts and choose the correct region.</li>
                  <li>Mark the main account as primary if you use several accounts.</li>
                  <li>Run sync from <strong>History</strong> or allow recurring background sync.</li>
                </ol>
              </article>

              <article className="docs-card">
                <h3>2. Local / LAN printer</h3>
                <ol className="docs-steps">
                  <li>Open <strong>Settings → Local Printer / FTP</strong>.</li>
                  <li>Enter the printer IP, serial number, and access code from the printer screen.</li>
                  <li>Save the printer so it appears in the <strong>Printers</strong> page and sync jobs.</li>
                  <li>Optional: assign a camera RTSP URL per printer if you use multiple feeds.</li>
                </ol>
              </article>

              <article className="docs-card">
                <h3>3. SD card import</h3>
                <p>
                  Use <strong>History → Sync SD Card</strong> to scan `.gcode` and `.3mf` files stored locally on the printer.
                  This is ideal for jobs sliced in OrcaSlicer, PrusaSlicer, or other non-cloud workflows.
                </p>
              </article>

              <article className="docs-card">
                <h3>4. Camera / monitoring</h3>
                <p>
                  The <strong>Printers</strong> page shows online state, active job progress, temperatures, AMS trays,
                  and optional camera snapshots when an RTSP URL is configured.
                </p>
              </article>
            </div>

            <div className="docs-callout">
              <strong>Need for LAN setup:</strong> printer IP, access code, serial number, and network reachability between the app and the printer.
            </div>
          </section>

          <section id="backups" className="docs-section">
            <h2>Backups, maintenance, and admin tools</h2>
            <div className="docs-grid docs-grid-2">
              <article className="docs-card">
                <h3>Backups</h3>
                <ul>
                  <li>Schedule local backups in <strong>Settings → System</strong>.</li>
                  <li>Store them under <code>/app/data/backups</code>.</li>
                  <li>Optionally upload backups to SFTP or FTP targets.</li>
                  <li>Restore from backup through the built-in restore UI.</li>
                </ul>
              </article>
              <article className="docs-card">
                <h3>Database maintenance</h3>
                <ul>
                  <li>Run Vacuum to reclaim space.</li>
                  <li>Run Analyze to refresh database stats.</li>
                  <li>Rebuild indexes when needed.</li>
                  <li>Use retention settings to clean old backups automatically.</li>
                </ul>
              </article>
            </div>
          </section>

          <section id="integrations" className="docs-section">
            <h2>Integrations</h2>
            <div className="docs-grid docs-grid-2">
              <article className="docs-card">
                <h3>Built-in now</h3>
                <ul>
                  <li>Discord notifications / webhooks</li>
                  <li>MQTT-based printer monitoring</li>
                  <li>SFTP / FTP backup destinations</li>
                  <li>OIDC / SSO authentication</li>
                </ul>
              </article>
              <article className="docs-card">
                <h3>Good usage patterns</h3>
                <ul>
                  <li>Post failure alerts to Discord</li>
                  <li>Use SSO for household or team access</li>
                  <li>Back up to remote storage for disaster recovery</li>
                  <li>Combine cloud sync with SD card sync for full print coverage</li>
                </ul>
              </article>
            </div>
          </section>

          <section id="troubleshooting" className="docs-section">
            <h2>Troubleshooting</h2>
            <div className="docs-grid docs-grid-2">
              <article className="docs-card">
                <h3>Printer not showing up</h3>
                <ul>
                  <li>Confirm it was saved in <strong>Settings → Local Printer / FTP</strong>.</li>
                  <li>Verify IP address, serial number, and access code.</li>
                  <li>Check network connectivity from the app host to the printer.</li>
                </ul>
              </article>
              <article className="docs-card">
                <h3>SSO login not working</h3>
                <ul>
                  <li>Confirm redirect URI exactly matches the provider config.</li>
                  <li>Check the issuer URL and client credentials.</li>
                  <li>Make sure the groups claim is present if you need role mapping.</li>
                </ul>
              </article>
              <article className="docs-card">
                <h3>Docker issues</h3>
                <ul>
                  <li>Run <code>docker logs printhive</code> first.</li>
                  <li>Verify port mappings and volume permissions.</li>
                  <li>Keep persistent volumes mounted before upgrading.</li>
                </ul>
              </article>
              <article className="docs-card">
                <h3>History missing local prints</h3>
                <ul>
                  <li>Use <strong>Sync SD Card</strong> for locally sliced jobs.</li>
                  <li>Run cloud sync after adding or updating Bambu accounts.</li>
                  <li>Make sure the printer is reachable for LAN/FTP operations.</li>
                </ul>
              </article>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default Docs;
