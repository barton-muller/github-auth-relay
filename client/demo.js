// A fake backend with the same interface as createClient() in ghstore.js. Files live in localStorage, nothing leaves the
// browser. Use it for demos, local development and tests, then swap in createClient() with the same calls.
//
//   const gh = createDemoClient();   // same options as createClient(): folder, name; the rest are ignored
import { Conflict } from './ghstore.js';

export function createDemoClient({ name = 'gh-store', folder = '' } = {}) {
  const FILES = `${name}:demo:files`;
  const SIGNED = `${name}:demo:signed-in`;
  const REPO = 'demo/my-data';
  const at = (path) => [folder.replace(/^\/+|\/+$/g, ''), path.replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/');
  const load = () => { try { return JSON.parse(localStorage.getItem(FILES)) ?? {}; } catch { return {}; } };
  const save = (f) => localStorage.setItem(FILES, JSON.stringify(f));
  const sha = () => Math.random().toString(16).slice(2, 12).padEnd(10, '0');
  const state = () => ({ login: 'demo-user', access: 'demo', expiresAt: Date.now() + 8 * 3600e3, refresh: null, refreshExpiresAt: null });

  return {
    auth: async () => (localStorage.getItem(SIGNED) ? state() : null),
    signedIn: async () => !!localStorage.getItem(SIGNED),
    login: async () => (localStorage.getItem(SIGNED) ? 'demo-user' : null),
    signOut: async () => localStorage.removeItem(SIGNED),
    signIn: async () => { localStorage.setItem(SIGNED, '1'); location.reload(); },
    handleReturn: async () => null,
    token: async () => (localStorage.getItem(SIGNED) ? 'demo' : null),
    installUrl: () => '#',
    repos: async () => [{ full: REPO, branch: 'main' }],

    async read(_repo, path, _branch, etag) {
      const f = load()[at(path)];
      if (!f) return null;
      if (etag && etag === `"${f.sha}"`) return { notModified: true, etag };
      return { text: f.text, sha: f.sha, etag: `"${f.sha}"` };
    },

    async list(_repo, dir = '') {
      const base = at(dir);
      const prefix = base ? `${base}/` : '';
      const seen = new Map();
      for (const [p, f] of Object.entries(load())) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const [head, ...tail] = rest.split('/');
        if (tail.length) seen.set(head, { name: head, path: prefix + head, type: 'dir', sha: sha(), size: 0 });
        else seen.set(head, { name: head, path: p, type: 'file', sha: f.sha, size: f.text.length });
      }
      return [...seen.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    },

    async write(_repo, path, text, current) {
      const files = load();
      const key = at(path);
      if (files[key] ? files[key].sha !== current : current) throw new Conflict();
      const next = sha();
      files[key] = { text, sha: next };
      save(files);
      return next;
    },

    async remove(_repo, path, current) {
      const files = load();
      const key = at(path);
      if (!files[key]) return false;
      if (files[key].sha !== current) throw new Conflict();
      delete files[key];
      save(files);
      return true;
    },
  };
}
