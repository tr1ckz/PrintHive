import { useEffect, useMemo, useState } from 'react';
import { API_ENDPOINTS } from '../config/api';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { FILAMENT_UPDATE_EVENT } from '../stores/usePrinterStore';

interface FilamentSpool {
  id: number;
  tray_uuid: string | null;
  brand: string | null;
  material: string | null;
  color_name: string | null;
  color_hex: string | null;
  filament_code: string | null;
  remain_percent: number | null;
  capacity_g: number | null;
  remaining_g: number | null;
  source: 'ams' | 'manual';
  last_dev_id: string | null;
}

interface FilamentGroup {
  label: string;
  brand: string;
  material: string;
  count: number;
  totalRemainingG: number;
  spareCount?: number;
  spools: FilamentSpool[];
}

interface FilamentSpare {
  id: number;
  brand: string | null;
  material: string | null;
  color_name: string | null;
  color_hex: string | null;
  filament_code: string | null;
  spare_count: number;
  unit_weight_g: number | null;
  is_refill: number;
}

interface InventoryResponse {
  groups: FilamentGroup[];
  archived?: FilamentSpool[];
  spares?: FilamentSpare[];
  totals: { spools: number; remainingG: number; spares?: number };
}

interface ParsedLine {
  brand: string;
  material: string;
  colorName: string | null;
  code: string | null;
  kind: 'refill' | 'spool';
  isRefill: boolean;
  unitWeightG: number;
  quantity: number;
  color_hex: string | null;
}

interface FilamentProps {
  userRole?: string;
}

const EMPTY_FORM = {
  brand: 'Bambu Lab',
  material: 'PLA',
  color_name: '',
  color_hex: '#000000',
  filament_code: '',
  capacity_g: 1000,
  remaining_g: 1000,
};

function pct(spool: FilamentSpool): number {
  if (spool.remain_percent != null) return Math.max(0, Math.min(100, spool.remain_percent));
  if (spool.capacity_g && spool.remaining_g != null) {
    return Math.max(0, Math.min(100, Math.round((spool.remaining_g / spool.capacity_g) * 100)));
  }
  return 0;
}

// Green when full, amber as it runs low, red near empty — matches the reference.
function barColor(p: number): string {
  if (p <= 10) return '#ef4444';
  if (p <= 30) return '#f59e0b';
  return '#22c55e';
}

function Filament({ userRole }: FilamentProps) {
  const isAdmin = userRole === 'admin' || userRole === 'superadmin';
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FilamentSpool | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    try {
      const res = await fetchWithRetry(API_ENDPOINTS.FILAMENT.LIST, { credentials: 'include' });
      setData(await res.json());
      setError(null);
    } catch {
      setError('Failed to load filament inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  // Live updates: the backend pushes the fresh inventory over the realtime
  // socket whenever an AMS spool changes, so the manager reflects it instantly.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<InventoryResponse | undefined>).detail;
      // Don't clobber the modal a user is editing mid-change.
      if (editing || adding || importing) return;
      if (detail && Array.isArray(detail.groups)) {
        setData(detail);
        setLoading(false);
      } else {
        void load();
      }
    };
    window.addEventListener(FILAMENT_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(FILAMENT_UPDATE_EVENT, onUpdate);
  }, [editing, adding, importing]);

  // Adjust a spare count (+1 / -1), or delete when it hits zero via the API.
  const adjustSpare = async (id: number, delta: number) => {
    const res = await fetchWithRetry(API_ENDPOINTS.FILAMENT.SPARE_ITEM(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ delta }),
    });
    try {
      const body = await res.json();
      if (body?.inventory) setData(body.inventory);
      else void load();
    } catch { void load(); }
  };

  const filteredGroups = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.groups;
    return data.groups
      .map((g) => ({
        ...g,
        spools: g.spools.filter((s) =>
          [g.label, s.color_name, s.filament_code, s.color_hex]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))
        ),
      }))
      .filter((g) => g.spools.length > 0);
  }, [data, search]);

  const remove = async (id: number) => {
    if (!window.confirm('Remove this spool from your inventory?')) return;
    await fetchWithRetry(API_ENDPOINTS.FILAMENT.ITEM(id), { method: 'DELETE', credentials: 'include' });
    void load();
  };

  const patchSpool = async (id: number, body: Record<string, unknown>) => {
    await fetchWithRetry(API_ENDPOINTS.FILAMENT.ITEM(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    void load();
  };

  const archivedSpools = data?.archived ?? [];

  if (loading) return <div className="p-6 text-sm text-muted">Loading filament inventory…</div>;
  if (error) return <div className="rounded-md bg-danger/10 p-4 text-sm text-danger">{error}</div>;

  const totalKg = data ? (data.totals.remainingG / 1000).toFixed(2) : '0';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span>{data?.totals.spools ?? 0} spools</span>
          <span>{totalKg} kg remaining</span>
          {(data?.totals.spares ?? 0) > 0 && <span>{data?.totals.spares} spare refills</span>}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search filament"
            className="min-h-9 rounded-md bg-white/5 px-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
          />
          <button
            onClick={() => void load()}
            className="inline-flex min-h-9 items-center gap-2 rounded-md bg-white/5 px-3 text-xs font-semibold text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
          >
            Refresh
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setImporting(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-white/5 px-3 text-sm font-semibold text-fg-soft transition-colors hover:bg-white/10 hover:text-fg"
              >
                Import order
              </button>
              <button
                onClick={() => setAdding(true)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-semibold text-accent-contrast transition-colors hover:bg-accent-strong"
              >
                + Add Filament
              </button>
            </>
          )}
        </div>
      </div>

      {(!data || data.groups.length === 0) && (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">
          No filament tracked yet. Genuine Bambu spools loaded in an AMS appear here automatically
          {isAdmin ? ', or add one manually.' : '.'}
        </div>
      )}

      {/* Groups */}
      <div className="space-y-3">
        {filteredGroups.map((group) => (
          <div key={group.label} className="overflow-hidden rounded-lg bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 bg-white/[0.03] px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                <span>{group.label}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-muted">{group.count}</span>
                {(group.spareCount ?? 0) > 0 && (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent" title="Spare refills on hand">
                    +{group.spareCount} spare
                  </span>
                )}
              </div>
              <span className="text-xs tabular-nums text-muted">{group.totalRemainingG} g</span>
            </div>
            <div className="divide-y divide-line/60">
              {group.spools.map((spool) => {
                const p = pct(spool);
                return (
                  <div key={spool.id} className="flex items-center gap-4 px-4 py-3">
                    <span
                      className="size-9 shrink-0 rounded-md ring-1 ring-inset ring-white/10"
                      style={{ background: spool.color_hex || 'var(--text-disabled)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{group.label}</div>
                      <div
                        className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted"
                        title={[spool.color_name, spool.filament_code, spool.color_hex].filter(Boolean).join('  ·  ')}
                      >
                        <span className="inline-flex items-center gap-1">
                          <span className="size-2 rounded-full" style={{ background: spool.color_hex || 'transparent' }} />
                          {spool.color_name || spool.color_hex || 'Unknown colour'}
                        </span>
                        {spool.source === 'manual' && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide">manual</span>}
                      </div>
                    </div>
                    <div className="w-40 shrink-0">
                      <div className="mb-1 flex items-baseline justify-between text-xs tabular-nums">
                        <strong className="text-fg-soft">{spool.remaining_g ?? 0} g</strong>
                        <span className="text-muted">/ {spool.capacity_g ?? 1000} g</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full" style={{ width: `${p}%`, background: barColor(p) }} />
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() => setEditing(spool)}
                          className="rounded p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-fg"
                          title="Edit"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                        <button
                          onClick={() => void remove(spool.id)}
                          className="rounded p-1.5 text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                          title="Delete"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Empty / replaced rolls */}
      {archivedSpools.length > 0 && (
        <details className="rounded-lg bg-card shadow-sm">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-fg-soft">
            Empty / replaced rolls
            <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-muted">{archivedSpools.length}</span>
          </summary>
          <div className="divide-y divide-line/60 border-t border-line/60">
            {archivedSpools.map((spool) => (
              <div key={spool.id} className="flex items-center gap-4 px-4 py-2.5">
                <span className="size-7 shrink-0 rounded-md opacity-60 ring-1 ring-inset ring-white/10" style={{ background: spool.color_hex || 'var(--text-disabled)' }} />
                <div className="min-w-0 flex-1 text-sm text-muted">
                  <span className="text-fg-soft">{spool.brand} {spool.material}</span>
                  {spool.color_name ? ` · ${spool.color_name}` : ''} · {spool.remaining_g ?? 0} g
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-1.5 text-xs">
                    <button onClick={() => void patchSpool(spool.id, { refill: true })} className="rounded bg-white/5 px-2 py-1 font-semibold text-fg-soft hover:bg-white/10" title="Reset to a full roll">Refill</button>
                    <button onClick={() => void patchSpool(spool.id, { archived: false })} className="rounded bg-white/5 px-2 py-1 font-semibold text-fg-soft hover:bg-white/10">Restore</button>
                    <button onClick={() => void remove(spool.id)} className="rounded px-2 py-1 text-muted hover:bg-danger/10 hover:text-danger">Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Spare / unopened refills */}
      {(data?.spares?.length ?? 0) > 0 && (
        <div className="rounded-lg bg-card shadow-sm">
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-fg-soft">
            Spare refills
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">{data?.totals.spares ?? 0}</span>
          </div>
          <div className="divide-y divide-line/60 border-t border-line/60">
            {(data?.spares ?? []).map((sp) => (
              <div key={sp.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="size-7 shrink-0 rounded-md ring-1 ring-inset ring-white/10" style={{ background: sp.color_hex || 'var(--text-disabled)' }} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate text-fg-soft">{sp.brand} {sp.material}</div>
                  <div className="text-xs text-muted">{sp.color_name || sp.color_hex || 'Unknown colour'} · {Math.round((sp.unit_weight_g ?? 1000) / 1000 * 100) / 100} kg each</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="min-w-8 text-center text-sm font-semibold tabular-nums text-fg">{sp.spare_count}</span>
                  {isAdmin && (
                    <>
                      <button onClick={() => void adjustSpare(sp.id, -1)} className="size-7 rounded bg-white/5 text-fg-soft hover:bg-white/10" title="Use / remove one">−</button>
                      <button onClick={() => void adjustSpare(sp.id, 1)} className="size-7 rounded bg-white/5 text-fg-soft hover:bg-white/10" title="Add one">+</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(adding || editing) && (
        <SpoolModal
          spool={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); void load(); }}
        />
      )}

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onImported={(inv) => { setImporting(false); if (inv) setData(inv); else void load(); }}
        />
      )}
    </div>
  );
}

// Import a Bambu order: paste the confirmation text or upload a screenshot, review
// the parsed lines, then add them as spare refills.
function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (inv: InventoryResponse | null) => void }) {
  const [text, setText] = useState('');
  const [lines, setLines] = useState<ParsedLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [parsed, setParsed] = useState(false);

  const parseText = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetchWithRetry(API_ENDPOINTS.FILAMENT.IMPORT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Parse failed');
      setLines(body.items || []); setParsed(true);
      if (!body.items?.length) setErr('No filament lines found in that text.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Parse failed'); }
    finally { setBusy(false); }
  };

  const parseImage = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetchWithRetry(API_ENDPOINTS.FILAMENT.IMPORT_IMAGE, {
        method: 'POST', credentials: 'include', body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not read image');
      setLines(body.items || []); setParsed(true);
      if (body.text) setText(body.text);
      if (!body.items?.length) setErr('No filament lines detected — try pasting the order text.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read image'); }
    finally { setBusy(false); }
  };

  const setQty = (i: number, q: number) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, quantity: Math.max(0, q) } : l)));
  };

  const confirm = async () => {
    const items = lines.filter((l) => l.quantity > 0);
    if (!items.length) { setErr('Nothing to add.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetchWithRetry(API_ENDPOINTS.FILAMENT.SPARES, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ items }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Failed to add');
      onImported(body.inventory || null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to add'); setBusy(false); }
  };

  const totalRolls = lines.reduce((s, l) => s + (l.quantity || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-fg">Import Bambu order</h2>
        <p className="mt-1 text-xs text-muted">Paste the order confirmation text, or upload a screenshot. Review the lines, then add them as spare refills.</p>

        {!parsed ? (
          <div className="mt-4 space-y-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={7}
              placeholder={'Paste order text, e.g.\nPETG Basic x 1\nYellow(30402) / Refill / 1kg'}
              className="w-full rounded-md bg-white/5 p-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent/40"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => void parseText()} disabled={busy || !text.trim()} className="min-h-9 rounded-md bg-accent px-3 text-sm font-semibold text-accent-contrast hover:bg-accent-strong disabled:opacity-50">
                {busy ? 'Parsing…' : 'Parse text'}
              </button>
              <label className="min-h-9 cursor-pointer rounded-md bg-white/5 px-3 py-2 text-sm font-semibold text-fg-soft hover:bg-white/10">
                Upload screenshot
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void parseImage(f); }} />
              </label>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {lines.length === 0 && <div className="text-sm text-muted">No lines parsed.</div>}
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-3 rounded-md bg-white/[0.03] px-3 py-2">
                <span className="size-6 shrink-0 rounded ring-1 ring-inset ring-white/10" style={{ background: l.color_hex || 'var(--text-disabled)' }} />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate text-fg-soft">{l.brand} {l.material}</div>
                  <div className="text-xs text-muted">{l.colorName || l.color_hex || '—'} · {l.isRefill ? 'Refill' : 'With spool'} · {Math.round(l.unitWeightG / 1000 * 100) / 100} kg</div>
                </div>
                <input type="number" min={0} value={l.quantity} onChange={(e) => setQty(i, parseInt(e.target.value, 10) || 0)} className="w-16 rounded bg-white/5 px-2 py-1 text-right text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent/40" />
              </div>
            ))}
          </div>
        )}

        {err && <div className="mt-3 rounded-md bg-danger/10 p-2 text-xs text-danger">{err}</div>}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button onClick={onClose} className="min-h-9 rounded-md bg-white/5 px-3 text-sm font-semibold text-fg-soft hover:bg-white/10">Cancel</button>
          <div className="flex items-center gap-2">
            {parsed && <button onClick={() => { setParsed(false); setLines([]); setErr(null); }} className="min-h-9 rounded-md bg-white/5 px-3 text-sm font-semibold text-fg-soft hover:bg-white/10">Back</button>}
            {parsed && (
              <button onClick={() => void confirm()} disabled={busy || totalRolls === 0} className="min-h-9 rounded-md bg-accent px-3 text-sm font-semibold text-accent-contrast hover:bg-accent-strong disabled:opacity-50">
                {busy ? 'Adding…' : `Add ${totalRolls} refill${totalRolls === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SpoolModal({ spool, onClose, onSaved }: { spool: FilamentSpool | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = Boolean(spool);
  const [form, setForm] = useState({
    brand: spool?.brand ?? EMPTY_FORM.brand,
    material: spool?.material ?? EMPTY_FORM.material,
    color_name: spool?.color_name ?? EMPTY_FORM.color_name,
    color_hex: spool?.color_hex ?? EMPTY_FORM.color_hex,
    filament_code: spool?.filament_code ?? EMPTY_FORM.filament_code,
    capacity_g: spool?.capacity_g ?? EMPTY_FORM.capacity_g,
    remaining_g: spool?.remaining_g ?? EMPTY_FORM.remaining_g,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      if (isEdit && spool) {
        await fetchWithRetry(API_ENDPOINTS.FILAMENT.ITEM(spool.id), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(form),
        });
      } else {
        await fetchWithRetry(API_ENDPOINTS.FILAMENT.ADD, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(form),
        });
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const isAms = spool?.source === 'ams';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-elevated p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-base font-semibold text-fg">{isEdit ? 'Edit spool' : 'Add filament'}</h3>
        <div className="grid grid-cols-2 gap-3 text-sm [&_label]:mb-1 [&_label]:block [&_label]:text-xs [&_label]:text-muted [&_input]:w-full [&_input]:rounded-md [&_input]:bg-white/5 [&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-fg">
          <div className="col-span-1">
            <label>Brand</label>
            <input value={form.brand} onChange={(e) => set('brand', e.target.value)} disabled={isAms} />
          </div>
          <div className="col-span-1">
            <label>Material</label>
            <input value={form.material} onChange={(e) => set('material', e.target.value)} disabled={isAms} />
          </div>
          <div className="col-span-1">
            <label>Color name</label>
            <input value={form.color_name} onChange={(e) => set('color_name', e.target.value)} disabled={isAms} />
          </div>
          <div className="col-span-1">
            <label>Color</label>
            <input type="color" value={form.color_hex || '#000000'} onChange={(e) => set('color_hex', e.target.value)} disabled={isAms} className="h-9 !p-1" />
          </div>
          <div className="col-span-1">
            <label>Remaining (g)</label>
            <input type="number" value={form.remaining_g} onChange={(e) => set('remaining_g', Number(e.target.value))} />
          </div>
          <div className="col-span-1">
            <label>Capacity (g)</label>
            <input type="number" value={form.capacity_g} onChange={(e) => set('capacity_g', Number(e.target.value))} />
          </div>
          {!isAms && (
            <div className="col-span-2">
              <label>Filament code</label>
              <input value={form.filament_code} onChange={(e) => set('filament_code', e.target.value)} />
            </div>
          )}
        </div>
        {isAms && (
          <p className="mt-3 text-xs text-muted">
            This spool is auto-synced from the AMS, so brand/color are read-only. You can still correct the weight and capacity.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="min-h-9 rounded-md bg-white/5 px-3 text-sm font-medium text-fg-soft hover:bg-white/10">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="min-h-9 rounded-md bg-accent px-3 text-sm font-semibold text-accent-contrast hover:bg-accent-strong disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Filament;
