// Thin Supabase REST wrapper. Every call uses the service key from env,
// which bypasses RLS — matches calendar/api/calendar.js:23-27. Relies on
// the caller having already passed requireAuth().

const sbHeaders = () => ({
  apikey:          process.env.SUPABASE_KEY,
  Authorization:   `Bearer ${process.env.SUPABASE_KEY}`,
  'Content-Type':  'application/json',
});

export async function sbGet(path) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, { headers: sbHeaders() });
  if (!r.ok) throw new SbError('read', r.status, await r.text());
  return r.json();
}

// Insert with optional conflict resolution.
//   onConflict: 'merge'  → UPSERT (overwrite all columns on conflict)
//   onConflict: 'ignore' → INSERT...DO NOTHING (preserves existing rows)
//   undefined            → plain INSERT (errors on conflict, default)
// `upsert: true` is kept as a convenience alias for { onConflict: 'merge' }.
export async function sbPost(path, body, opts = {}) {
  const { upsert = false, onConflict, returning = 'representation' } = opts;
  const resolution = onConflict === 'ignore' ? 'ignore-duplicates'
    : (onConflict === 'merge' || upsert) ? 'merge-duplicates'
    : null;
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const prefer = [
    resolution ? `resolution=${resolution}` : null,
    `return=${returning}`,
  ].filter(Boolean).join(',');
  const r = await fetch(url, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: prefer },
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new SbError('write', r.status, await r.text());
  return returning === 'minimal' ? null : r.json();
}

export async function sbPatch(path, body) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, {
    method:  'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=representation' },
    body:    JSON.stringify(body),
  });
  if (!r.ok) throw new SbError('patch', r.status, await r.text());
  return r.json();
}

export async function sbDelete(path) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
  if (!r.ok) throw new SbError('delete', r.status, await r.text());
}

class SbError extends Error {
  constructor(op, status, details) {
    super(`Supabase ${op} failed (${status})`);
    this.name    = 'SbError';
    this.status  = status;
    this.details = details;
  }
}

export function sbErrorResponse(res, e) {
  if (e instanceof SbError) {
    return res.status(502).json({ error: e.message, details: e.details });
  }
  return res.status(500).json({ error: 'Server error', message: e.message });
}
