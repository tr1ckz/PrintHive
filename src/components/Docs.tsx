import { useDeferredValue, useId, useState } from 'react';

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
  { id: 'mqtt', label: 'MQTT & LAN Telemetry' },
  { id: 'backups', label: 'Backups & Maintenance' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
] as const;

const sectionSearchContent: Record<(typeof tocItems)[number]['id'], string> = {
  overview: 'overview install deploy secure connect run printhive bambu dashboard print farm personal setup',
  features: 'features print history library live monitoring mqtt ams cameras backups maintenance users administration',
  pages: 'pages workflows home history stats library duplicates maintenance printers settings docs',
  docker: 'docker compose container volumes environment public url session secret ports deployment upgrade',
  sso: 'sso oidc oauth authentik keycloak auth0 okta issuer client secret groups roles login callback',
  printers: 'printer setup bambu cloud local ftp lan ip address access code serial number rtsp camera sd card sync',
  mqtt: 'mqtt telemetry lan local broker brokerless pushall mqtts 8883 device report request idle awaiting telemetry temperatures fans wifi ams',
  backups: 'backups maintenance admin restore retention vacuum analyze reindex sftp ftp schedule',
  integrations: 'integrations discord mqtt oidc sftp ftp notifications webhooks',
  troubleshooting: 'troubleshooting printer offline missing telemetry awaiting telemetry login docker history sync network access code serial number',
};

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

const ssoExample = `OAUTH_ISSUER=https://auth.example.com/application/o/printhive/\nOAUTH_CLIENT_ID=your_client_id\nOAUTH_CLIENT_SECRET=your_client_secret\nOAUTH_REDIRECT_URI=https://printhive.example.com/auth/callback`;

function Docs({ standalone = false }: DocsProps) {
  const searchId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery.trim().toLowerCase());
  const visibleTocItems = tocItems.filter((item) => {
    if (!deferredSearchQuery) {
      return true;
    }

    const haystack = `${item.label} ${sectionSearchContent[item.id]}`.toLowerCase();
    return haystack.includes(deferredSearchQuery);
  });
  const hasSearchResults = visibleTocItems.length > 0;
  const shouldShowSection = (id: (typeof tocItems)[number]['id']) => {
    if (!deferredSearchQuery) {
      return true;
    }

    const item = tocItems.find((entry) => entry.id === id);
    const haystack = `${item?.label || ''} ${sectionSearchContent[id]}`.toLowerCase();
    return haystack.includes(deferredSearchQuery);
  };

  return (
    <div className={`space-y-8 ${standalone ? 'mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8' : ''}`}>
      <header className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 [&_h1]:mt-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-fg [&_h1+p]:mt-2 [&_h1+p]:max-w-prose [&_h1+p]:text-sm [&_h1+p]:leading-relaxed [&_h1+p]:text-fg-soft">
          {standalone ? (
            <div>
              <h1>PrintHive Documentation</h1>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {visibleTocItems.slice(0, 6).map((item) => (
              <a key={item.id} href={`#${item.id}`} className="inline-flex min-h-9 items-center rounded-md bg-white/5 px-3 text-xs font-medium text-fg-soft transition-colors hover:bg-white/10 hover:text-fg">
                {item.label}
              </a>
            ))}
            {standalone && (
              <a href="/" className="inline-flex min-h-9 items-center rounded-md bg-accent px-3 text-xs font-semibold text-accent-contrast transition-colors hover:bg-accent-strong">
                Open App
              </a>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={searchId} className="block text-xs font-medium text-muted">Search docs</label>
            <div className="flex gap-2">
              <input
                id={searchId}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="min-h-11 md:min-h-10 w-full max-w-md"
                placeholder="Search MQTT, access code, Docker, SSO..."
              />
              {searchQuery ? (
                <button type="button" className="inline-flex min-h-11 md:min-h-10 items-center rounded-md bg-white/5 px-3 text-sm text-fg-soft transition-colors hover:bg-white/10 hover:text-fg" onClick={() => setSearchQuery('')}>
                  Clear
                </button>
              ) : null}
            </div>
            <span className="block text-xs text-muted">
              {deferredSearchQuery
                ? `${visibleTocItems.length} section${visibleTocItems.length === 1 ? '' : 's'} match "${searchQuery.trim()}"`
                : 'Search filters the table of contents and visible sections in place.'}
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-fg">Recommended rollout</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-soft [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
              <li>Deploy with Docker and mount persistent data volumes.</li>
              <li>Connect Bambu cloud or LAN printers from Settings.</li>
              <li>Enable SSO, backups, and notifications for day-two ops.</li>
            </ol>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {overviewStats.map((item) => (
              <article key={item.label} className="flex flex-col gap-0.5 rounded-lg bg-card p-3 text-center shadow-sm [&>strong]:text-sm [&>strong]:font-semibold [&>strong]:text-accent [&>span]:text-[11px] [&>span]:text-muted">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-20 rounded-lg bg-card p-4 shadow-sm [&>h2]:text-xs [&>h2]:font-semibold [&>h2]:uppercase [&>h2]:tracking-widest [&>h2]:text-muted [&>nav]:mt-2 [&>nav]:flex [&>nav]:flex-col [&>nav]:gap-0.5">
            <h2>On this page</h2>
            <nav>
              {visibleTocItems.map((item) => (
                <a key={item.id} href={`#${item.id}`} className="flex min-h-8 items-center rounded px-2 text-[13px] text-fg-soft transition-colors hover:bg-white/5 hover:text-fg">
                  {item.label}
                </a>
              ))}
            </nav>
            {deferredSearchQuery && !hasSearchResults ? (
              <p className="mt-2 text-xs text-muted">No sections match the current search.</p>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0 space-y-10">
          {!hasSearchResults ? (
            <section className="py-8 text-center [&>h2]:text-base [&>h2]:font-semibold [&>h2]:text-fg [&>p]:mt-1 [&>p]:text-sm [&>p]:text-muted">
              <h2>No matching sections</h2>
              <p>Try broader terms like printer, mqtt, docker, backup, or oidc.</p>
            </section>
          ) : null}

          {shouldShowSection('overview') ? (
          <section id="overview" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Overview</h2>
            <p>
              PrintHive is a web app for running a Bambu-centered print farm or personal 3D printing setup.
              It combines cloud print history, local printer telemetry, file management, statistics, backups,
              and admin tools into one dashboard.
            </p>
            <div className="rounded-lg bg-accent/10 p-4 text-sm leading-relaxed text-fg-soft [&>strong]:text-fg">
              <strong>Best fit:</strong> users who want one place to manage Bambu accounts, LAN printers,
              timelapses, model files, maintenance, and team access.
            </div>
          </section>
          ) : null}

          {shouldShowSection('features') ? (
          <section id="features" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Features</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {featureGroups.map((group) => (
                <article key={group.title} className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
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
          ) : null}

          {shouldShowSection('pages') ? (
          <section id="pages" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Pages & workflows</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pageGuide.map(([page, description]) => (
                <article key={page} className="flex flex-col gap-1 rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                  <span className="text-sm font-semibold text-fg">{page}</span>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>
          ) : null}

          {shouldShowSection('docker') ? (
          <section id="docker" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Docker setup</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Quick start</h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-soft [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
                  <li>Pull `tr1ckz/printhive:latest`.</li>
                  <li>Mount persistent volumes for `data`, `library`, and `sessions`.</li>
                  <li>Set `SESSION_SECRET` and `PUBLIC_URL`.</li>
                  <li>Expose port `3000` or your preferred mapped port.</li>
                </ol>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Persistent paths</h3>
                <ul>
                  <li><code>/app/data</code> — database, videos, backups, caches</li>
                  <li><code>/app/library</code> — uploaded local model files</li>
                  <li><code>/app/sessions</code> — authenticated session storage</li>
                </ul>
              </article>
            </div>

            <div className="overflow-hidden rounded-lg bg-black/30 [&>pre]:overflow-x-auto [&>pre]:p-4 [&>pre]:text-xs [&>pre]:leading-relaxed [&>pre]:text-fg-soft">
              <div className="bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">docker run</div>
              <pre>{dockerRunExample}</pre>
            </div>

            <div className="overflow-hidden rounded-lg bg-black/30 [&>pre]:overflow-x-auto [&>pre]:p-4 [&>pre]:text-xs [&>pre]:leading-relaxed [&>pre]:text-fg-soft">
              <div className="bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">docker-compose.yml</div>
              <pre>{dockerComposeExample}</pre>
            </div>

            <div className="rounded-lg bg-warning/10 p-4 text-sm leading-relaxed text-fg-soft [&>strong]:text-warning">
              <strong>Important:</strong> if you update or recreate the container without persistent volumes,
              you will lose the database, uploaded files, and sessions.
            </div>

            <div className="overflow-x-auto rounded-lg bg-card shadow-sm">
              <table className="w-full min-w-[560px] border-collapse text-sm [&_th]:border-b [&_th]:border-line [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted [&_td]:border-b [&_td]:border-line [&_td]:px-4 [&_td]:py-2.5 [&_td]:text-fg-soft [&_tbody_tr:last-child_td]:border-b-0 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
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
          ) : null}

          {shouldShowSection('sso') ? (
          <section id="sso" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>SSO / OIDC setup</h2>
            <p>
              PrintHive supports OpenID Connect providers such as Authentik, Keycloak, Auth0, Okta, and similar systems.
              Configure the provider, then add the values in your container environment or the Settings page.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Provider checklist</h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-soft [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
                  <li>Create a new OIDC application/client for PrintHive.</li>
                  <li>Set the redirect URI to <code>{'${PUBLIC_URL}/auth/callback'}</code>.</li>
                  <li>Enable the `openid`, `profile`, and `email` scopes.</li>
                  <li>Ensure group membership is exposed, usually through the `groups` claim.</li>
                </ol>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Role mapping</h3>
                <ul>
                  <li>Configure in <strong>Settings → OAuth / SSO → Group → Role Mapping</strong>.</li>
                  <li>Groups in <strong>Admin Groups</strong> → <strong>Admin</strong> role.</li>
                  <li>Groups in <strong>User Groups</strong> (or no match) → <strong>User</strong> role.</li>
                  <li>SSO never grants <strong>Super Admin</strong> — that tier is managed locally.</li>
                  <li>Group matching is case-insensitive.</li>
                </ul>
              </article>
            </div>

            <div className="overflow-hidden rounded-lg bg-black/30 [&>pre]:overflow-x-auto [&>pre]:p-4 [&>pre]:text-xs [&>pre]:leading-relaxed [&>pre]:text-fg-soft">
              <div className="bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted">Example OIDC environment</div>
              <pre>{ssoExample}</pre>
            </div>
          </section>
          ) : null}

          {shouldShowSection('printers') ? (
          <section id="printers" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Printer setup</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>1. Bambu cloud account</h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-soft [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
                  <li>Open <strong>Settings → Bambu</strong>.</li>
                  <li>Add one or more Bambu accounts and choose the correct region.</li>
                  <li>Mark the main account as primary if you use several accounts.</li>
                  <li>Run sync from <strong>History</strong> or allow recurring background sync.</li>
                </ol>
              </article>

              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>2. Local / LAN printer</h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-soft [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
                  <li>Open <strong>Settings → Local Printer / FTP</strong>.</li>
                  <li>Enter the printer IP, access code, and serial number from the printer screen.</li>
                  <li>Save the printer so it appears in the <strong>Printers</strong> page and sync jobs.</li>
                  <li>Optional: assign a camera RTSP URL per printer if you use multiple feeds.</li>
                </ol>
              </article>

              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>3. SD card import</h3>
                <p>
                  Use <strong>History → Sync SD Card</strong> to scan `.gcode` and `.3mf` files stored locally on the printer.
                  This is ideal for jobs sliced in OrcaSlicer, PrusaSlicer, or other non-cloud workflows.
                </p>
              </article>

              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>4. Camera / monitoring</h3>
                <p>
                  The <strong>Printers</strong> page shows online state, active job progress, temperatures, AMS trays,
                  and optional camera snapshots when an RTSP URL is configured.
                </p>
              </article>
            </div>

            <div className="rounded-lg bg-accent/10 p-4 text-sm leading-relaxed text-fg-soft [&>strong]:text-fg">
              <strong>Need for LAN setup:</strong> printer IP, access code, serial number, and network reachability between the app and the printer.
            </div>
          </section>
          ) : null}

          {shouldShowSection('mqtt') ? (
          <section id="mqtt" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>MQTT & LAN telemetry</h2>
            <p>
              PrintHive talks directly to each Bambu printer over its built-in secure MQTT endpoint. There is no separate MQTT broker to install,
              no broker URL to configure, and no extra topic mapping to maintain.
            </p>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>How it works</h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-fg-soft [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs">
                  <li>PrintHive opens an <code>mqtts</code> connection to <code>PRINTER_IP:8883</code>.</li>
                  <li>It authenticates with username <code>bblp</code> and the printer&apos;s access code.</li>
                  <li>It subscribes to <code>device/SERIAL_NUMBER/report</code> for live status updates.</li>
                  <li>Right after connect, it sends a <code>pushall</code> request so the printer returns its current state immediately.</li>
                </ol>
              </article>

              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>What you must configure</h3>
                <ul>
                  <li><strong>IP address</strong> of the printer on your LAN.</li>
                  <li><strong>Access code</strong> shown in the printer&apos;s LAN settings.</li>
                  <li><strong>Serial number</strong>, especially important when cloud discovery is unavailable.</li>
                  <li><strong>Network reachability</strong> from the PrintHive host to the printer on port <code>8883</code>.</li>
                </ul>
              </article>

              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>What you do not need</h3>
                <ul>
                  <li>No Mosquitto, EMQX, or other external broker.</li>
                  <li>No <code>MQTT_BROKER</code> environment variable for printer telemetry.</li>
                  <li>No LAN-only mode requirement just to read status.</li>
                  <li>No manual topic or certificate management.</li>
                </ul>
              </article>

              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>What updates to expect</h3>
                <ul>
                  <li><strong>Idle or online state</strong> can still update even when nothing is printing.</li>
                  <li><strong>Detailed telemetry</strong> such as temperatures, fans, or Wi-Fi appears only after the printer publishes those fields.</li>
                  <li><strong>AMS data</strong> is included when the printer sends it in the report payload.</li>
                  <li><strong>Camera data</strong> appears separately from your RTSP configuration and optional printer camera details.</li>
                </ul>
              </article>
            </div>

            <div className="rounded-lg bg-accent/10 p-4 text-sm leading-relaxed text-fg-soft [&>strong]:text-fg">
              <strong>About “Awaiting telemetry”:</strong> it means the printer has not published the specific temp, fan, Wi-Fi, or height fields shown in that panel yet.
              It does not automatically mean MQTT is disconnected.
            </div>
          </section>
          ) : null}

          {shouldShowSection('backups') ? (
          <section id="backups" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Backups, maintenance, and admin tools</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Backups</h3>
                <ul>
                  <li>Schedule local backups in <strong>Settings → System</strong>.</li>
                  <li>Store them under <code>/app/data/backups</code>.</li>
                  <li>Optionally upload backups to SFTP or FTP targets.</li>
                  <li>Restore from backup through the built-in restore UI.</li>
                </ul>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
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
          ) : null}

          {shouldShowSection('integrations') ? (
          <section id="integrations" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Integrations</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Built-in now</h3>
                <ul>
                  <li>Discord notifications / webhooks</li>
                  <li>MQTT-based printer monitoring</li>
                  <li>SFTP / FTP backup destinations</li>
                  <li>OIDC / SSO authentication</li>
                </ul>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
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
          ) : null}

          {shouldShowSection('troubleshooting') ? (
          <section id="troubleshooting" className="scroll-mt-24 space-y-4 [&>h2]:text-lg [&>h2]:font-semibold [&>h2]:tracking-tight [&>h2]:text-fg [&>p]:max-w-prose [&>p]:text-sm [&>p]:leading-relaxed [&>p]:text-fg-soft">
            <h2>Troubleshooting</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Printer not showing up</h3>
                <ul>
                  <li>Confirm it was saved in <strong>Settings → Local Printer / FTP</strong>.</li>
                  <li>Verify IP address, serial number, and access code.</li>
                  <li>Check network connectivity from the app host to the printer.</li>
                  <li>Make sure port <code>8883</code> is reachable from the PrintHive host.</li>
                </ul>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>MQTT connected but telemetry is sparse</h3>
                <ul>
                  <li>Look for overall printer state such as <strong>Online</strong>, <strong>Idle</strong>, or active progress first.</li>
                  <li>Remember that detailed temperatures, fan speeds, and Wi-Fi depend on what the printer publishes.</li>
                  <li>Start or resume a print if you need to confirm richer live telemetry quickly.</li>
                  <li>Re-save the printer with the correct serial number if no live updates arrive at all.</li>
                </ul>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>SSO login not working</h3>
                <ul>
                  <li>Confirm redirect URI exactly matches the provider config.</li>
                  <li>Check the issuer URL and client credentials.</li>
                  <li>Make sure the groups claim is present if you need role mapping.</li>
                </ul>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>Docker issues</h3>
                <ul>
                  <li>Run <code>docker logs printhive</code> first.</li>
                  <li>Verify port mappings and volume permissions.</li>
                  <li>Keep persistent volumes mounted before upgrading.</li>
                </ul>
              </article>
              <article className="rounded-lg bg-card p-4 shadow-sm text-sm leading-relaxed text-fg-soft [&>h3]:mb-2 [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:text-fg [&>ul]:list-disc [&>ul]:space-y-1.5 [&>ul]:pl-5 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:text-fg">
                <h3>History missing local prints</h3>
                <ul>
                  <li>Use <strong>Sync SD Card</strong> for locally sliced jobs.</li>
                  <li>Run cloud sync after adding or updating Bambu accounts.</li>
                  <li>Make sure the printer is reachable for LAN/FTP operations.</li>
                </ul>
              </article>
            </div>
          </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Docs;
