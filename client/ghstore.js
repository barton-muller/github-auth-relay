// Browser client for "GitHub as storage": sign in through the relay, then read and write files in the
// repos the person installed your GitHub App on. No dependencies. Needs a browser (fetch, crypto, localStorage).
//
//   const gh = createClient({ clientId, relay, appSlug });
//   await gh.handleReturn();                  // call on every page load
//   if (!gh.signedIn()) gh.signIn();          // redirects to github.com and back
//   const repos = await gh.repos();           // [{ full, branch }], repos the app is installed on
//   const f = await gh.read(repo, 'notes.json');          // { text, sha } or null
//   await gh.write(repo, 'notes.json', text, f?.sha);     // returns the new sha; throws Conflict on a stale sha
//   await gh.remove(repo, 'notes.json', f.sha);           // true, or false if already gone

export class Conflict extends Error {
  constructor() { super('The file changed on GitHub since it was read.'); this.name = 'Conflict'; }
}

const API = 'https://api.github.com';
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const url64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = (n) => url64(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => url64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const SKEW = 5 * 60e3;

export function createClient({ clientId, relay, appSlug, name = 'gh-store', fetchImpl = (...a) => fetch(...a) }) {
  const AUTH = `${name}:auth`;
  const PENDING = `${name}:pending`;
  const here = () => location.origin + location.pathname;
  const load = () => { try { return JSON.parse(localStorage.getItem(AUTH)); } catch { return null; } };
  const save = (a) => localStorage.setItem(AUTH, JSON.stringify(a));
  const gh = (token, path, init = {}) =>
    fetchImpl(`${API}${path}`, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...init.headers } });

  async function viaRelay(path, body) {
    const r = await fetchImpl(`${relay.replace(/\/+$/, '')}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Sign-in failed: ${j.error || r.status}`);
    const now = Date.now();
    return {
      access: j.access_token,
      expiresAt: now + (j.expires_in ?? 365 * 86400) * 1000,
      refresh: j.refresh_token ?? null,
      refreshExpiresAt: j.refresh_token_expires_in ? now + j.refresh_token_expires_in * 1000 : null,
    };
  }

  const api = {
    signedIn: () => !!load(),
    login: () => load()?.login ?? null,
    signOut: () => localStorage.removeItem(AUTH),

    // Opens GitHub. PKCE ties the returned code to this browser.
    async signIn() {
      const verifier = rand(48), state = rand(16);
      sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, redirect: here() }));
      const q = new URLSearchParams({ client_id: clientId, redirect_uri: here(), state, code_challenge: await sha256(verifier), code_challenge_method: 'S256' });
      location.assign(`https://github.com/login/oauth/authorize?${q}`);
    },

    // Call on every load. Finishes a sign-in when the URL holds ?code, and cleans the URL. Returns true if it signed in.
    async handleReturn() {
      const q = new URLSearchParams(location.search);
      const clean = () => history.replaceState(null, '', location.pathname + location.hash);
      if (q.has('installation_id')) { clean(); return false; }
      if (!q.has('code') && !q.has('error')) return false;
      const raw = sessionStorage.getItem(PENDING);
      sessionStorage.removeItem(PENDING);
      const pending = raw ? JSON.parse(raw) : null;
      clean();
      if (q.has('error')) throw new Error(`GitHub: ${q.get('error_description') || q.get('error')}`);
      if (!pending || pending.state !== q.get('state')) throw new Error('Sign-in was not started in this browser. Try again.');
      const t = await viaRelay('/token', { code: q.get('code'), redirect_uri: pending.redirect, code_verifier: pending.verifier });
      const u = await gh(t.access, '/user');
      save({ ...t, login: u.ok ? (await u.json()).login : 'GitHub user' });
      return true;
    },

    // A valid access token, renewed through the relay shortly before it expires. Null when signed out.
    async token() {
      const a = load();
      if (!a) return null;
      if (a.expiresAt - SKEW > Date.now()) return a.access;
      if (!a.refresh || (a.refreshExpiresAt && a.refreshExpiresAt < Date.now())) { api.signOut(); return null; }
      try {
        const n = { ...(await viaRelay('/refresh', { refresh_token: a.refresh })), login: a.login };
        save(n);
        return n.access;
      } catch { return null; }
    },

    // GitHub's page for choosing repos. state brings the person back to this page through the relay's /return route.
    installUrl: () => `https://github.com/apps/${appSlug}/installations/new?state=${encodeURIComponent(here())}`,

    async repos() {
      const t = await api.token();
      if (!t) throw new Error('Not signed in');
      const i = await gh(t, '/user/installations?per_page=100');
      if (!i.ok) throw new Error(`GitHub ${i.status}`);
      const out = [];
      for (const { id } of (await i.json()).installations) {
        const r = await gh(t, `/user/installations/${id}/repositories?per_page=100`);
        if (r.ok) for (const x of (await r.json()).repositories) out.push({ full: x.full_name, branch: x.default_branch });
      }
      return out;
    },

    // { text, sha } or null when the file does not exist.
    async read(repo, path, branch) {
      const t = await api.token();
      const r = await gh(t, `/repos/${repo}/contents/${path}${branch ? `?ref=${encodeURIComponent(branch)}` : ''}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      const j = await r.json();
      return { text: unb64(j.content), sha: j.sha };
    },

    // Creates or replaces the file. Pass the sha from read() when it exists; a stale one throws Conflict.
    async write(repo, path, text, sha, branch, message = 'Update') {
      const t = await api.token();
      const r = await gh(t, `/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content: b64(text), ...(sha ? { sha } : {}), ...(branch ? { branch } : {}) }),
      });
      if (r.status === 409 || r.status === 422) throw new Conflict();
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      return (await r.json()).content.sha;
    },

    // Deletes the file. Needs the current sha; a stale one throws Conflict. Returns false if it was already gone.
    async remove(repo, path, sha, branch, message = 'Delete') {
      const t = await api.token();
      const r = await gh(t, `/repos/${repo}/contents/${path}`, {
        method: 'DELETE',
        body: JSON.stringify({ message, sha, ...(branch ? { branch } : {}) }),
      });
      if (r.status === 404) return false;
      if (r.status === 409 || r.status === 422) throw new Conflict();
      if (!r.ok) throw new Error(`GitHub ${r.status}`);
      return true;
    },
  };
  return api;
}
