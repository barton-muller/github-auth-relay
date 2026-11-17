// A fake backend with the same interface as createClient() in ghstore.js. Files live in localStorage, nothing leaves the
// browser. Use it for demos, local development and tests, then swap in createClient() with the same calls.
//
//   const gh = createDemoClient({ seed: { 'hello.txt': 'Hi' } });   // same options as createClient(): folder, name
// seed: files to start with, { path: text }, added to the first demo repo the first time the demo is used.
// reset() deletes all demo files and repos.
import { Conflict } from './ghstore.js';

export function createDemoClient({ name = 'gh-store', folder = '', seed = {} } = {}) {
  const DATA = `${name}:demo:data`; // { repos: [{ full, branch }], files: { [repo]: { [path]: { text, sha } } } }
  const SIGNED = `${name}:demo:signed-in`;
  const FIRST = 'demo/my-data';
  const at = (path) => [folder.replace(/^\/+|\/+$/g, ''), path.replace(/^\/+|\/+$/g, '')].filter(Boolean).join('/');
  const load = () => { try { return JSON.parse(localStorage.getItem(DATA)); } catch { return null; } };
  const save = (d) => localStorage.setItem(DATA, JSON.stringify(d));
  const sha = () => Math.random().toString(16).slice(2, 12).padEnd(10, '0');
  const state = () => ({ login: 'demo-user', access: 'demo', expiresAt: Date.now() + 8 * 3600e3, refresh: null, refreshExpiresAt: null });
  const files = (d, repo) => (d.files[repo] ??= {});

  return {
    auth: async () => (localStorage.getItem(SIGNED) ? state() : null),
    signedIn: async () => !!localStorage.getItem(SIGNED),
    login: async () => (localStorage.getItem(SIGNED) ? 'demo-user' : null),
    signOut: async () => localStorage.removeItem(SIGNED),
    signIn: async () => {
      if (!load()) {
        save({ repos: [{ full: FIRST, branch: 'main' }], files: { [FIRST]: Object.fromEntries(Object.entries(seed).map(([p, text]) => [at(p), { text, sha: sha() }])) } });
      }
      localStorage.setItem(SIGNED, '1');
      location.reload();
    },
    reset: async () => localStorage.removeItem(DATA),
    handleReturn: async () => null,
    token: async () => (localStorage.getItem(SIGNED) ? 'demo' : null),
    installUrl: () => '#',
    repos: async () => load()?.repos ?? [],

    async createRepo(repoName, { description = '' } = {}) {
      const d = load();
      const full = `demo-user/${repoName}`;
      if (d.repos.some((r) => r.full === full)) throw new Error(`A repo called ${repoName} already exists, or the name is not allowed.`);
      d.repos.push({ full, branch: 'main' });
      files(d, full)[at('README.md')] = { text: `# ${repoName}\n\n${description}\n`, sha: sha() };
      save(d);
      return { full, branch: 'main' };
    },

    async read(repo, path, _branch, etag) {
      const f = files(load(), repo)[at(path)];
      if (!f) return null;
      if (etag && etag === `"${f.sha}"`) return { notModified: true, etag };
      return { text: f.text, sha: f.sha, etag: `"${f.sha}"` };
    },

    async list(repo, dir = '') {
      const base = at(dir);
      const prefix = base ? `${base}/` : '';
      const seen = new Map();
      for (const [p, f] of Object.entries(files(load(), repo))) {
        if (!p.startsWith(prefix)) continue;
        const [head, ...tail] = p.slice(prefix.length).split('/');
        if (tail.length) seen.set(head, { name: head, path: prefix + head, type: 'dir', sha: sha(), size: 0 });
        else seen.set(head, { name: head, path: p, type: 'file', sha: f.sha, size: f.text.length });
      }
      return [...seen.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    },

    async write(repo, path, text, current) {
      const d = load();
      const f = files(d, repo);
      const key = at(path);
      if (f[key] ? f[key].sha !== current : current) throw new Conflict();
      const next = sha();
      f[key] = { text, sha: next };
      save(d);
      return next;
    },

    async remove(repo, path, current) {
      const d = load();
      const f = files(d, repo);
      const key = at(path);
      if (!f[key]) return false;
      if (f[key].sha !== current) throw new Conflict();
      delete f[key];
      save(d);
      return true;
    },
  };
}
