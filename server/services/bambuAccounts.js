// Pure helpers for reasoning about Bambu Cloud account rows: token expiry and
// de-duplication of rows that represent the same account. Kept dependency-free
// so they can be unit-tested without booting the server or touching the DB.

// A Bambu access token is a JWT; treat it as expired (with 60s skew) so we never
// fire a doomed request or surface a stale "reconnect" prompt for a token that is
// about to die. Malformed / non-JWT tokens are treated as NOT expired so we don't
// invent failures for tokens we can't parse.
function isBambuTokenExpired(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp) return false;
    return payload.exp * 1000 <= Date.now() + 60000;
  } catch {
    return false;
  }
}

// Identity key for an account. Two rows are the "same account" when they share an
// email (case-insensitive) and region; region NULL is treated as 'global' so a
// NULL vs 'global' mismatch never splits one account into two.
function bambuAccountKey(account) {
  return `${String(account.email || '').trim().toLowerCase()}::${account.region || 'global'}`;
}

// Score a row so the best one per account wins during de-duplication: a valid
// (non-expired) token beats an expired one, then a primary row beats a
// non-primary one, then the most recently updated / highest id wins.
function bambuAccountRank(account) {
  const valid = isBambuTokenExpired(account.token) ? 0 : 1;
  const primary = account.is_primary ? 1 : 0;
  const updated = account.updated_at ? new Date(account.updated_at).getTime() || 0 : 0;
  const id = Number(account.id) || 0;
  return { valid, primary, updated, id };
}

// Collapse rows to a single best row per account. A user can legitimately have
// the same email in two regions (global/china), so those stay separate.
function dedupeBambuAccounts(rows) {
  const best = new Map();
  for (const row of rows) {
    const key = bambuAccountKey(row);
    const current = best.get(key);
    if (!current) { best.set(key, row); continue; }
    const a = bambuAccountRank(row);
    const b = bambuAccountRank(current);
    const wins = a.valid !== b.valid ? a.valid > b.valid
      : a.primary !== b.primary ? a.primary > b.primary
      : a.updated !== b.updated ? a.updated > b.updated
      : a.id > b.id;
    if (wins) best.set(key, row);
  }
  return Array.from(best.values());
}

module.exports = {
  isBambuTokenExpired,
  bambuAccountKey,
  bambuAccountRank,
  dedupeBambuAccounts,
};
