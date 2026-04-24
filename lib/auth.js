// Bearer-token check against STUDIO_PASSWORD. Returns true when the request is
// authorized; otherwise writes the 401/500 response and returns false.
// Modeled on calendar/api/calendar.js:17-21 in the Mini Pottery Studio sub-repo.

export function requireAuth(req, res) {
  const { STUDIO_PASSWORD, SUPABASE_URL, SUPABASE_KEY } = process.env;

  if (!STUDIO_PASSWORD || !SUPABASE_URL || !SUPABASE_KEY) {
    res.status(500).json({ error: 'Server misconfigured — missing env vars' });
    return false;
  }

  const header = req.headers.authorization || '';
  const token  = header.replace(/^Bearer\s+/i, '').trim();
  if (token !== STUDIO_PASSWORD) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}
