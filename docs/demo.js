// A fake backend with the same interface as createClient() in ghstore.js. Files live in localStorage, nothing leaves the
// browser. Use it for demos, local development and tests, then swap in createClient() with the same calls.
//
//   const gh = createDemoClient({ seed: { 'hello.txt': 'Hi' } });   // same options as createClient(): folder, name
// seed: files to start with, { path: text }, added to the first demo repo the first time the demo is used.
// reset() deletes all demo files and repos.
import { Conflict } from './ghstore.js';

export function createDemoClient({ name = 'gh-store', folder = '', seed = {} } = {}) {
  const DATA = `${name}:demo:data`; // { repos: [{ full, branch }], files: { [repo]: { [path]: { text, sha } } }, log: { [repo]: [{ sha, message, date, files: { [path]: { status, text } } }] } }
  const SIGNED = `${name}:demo:signed-in`;
  const FIRST = 'demo/my-data';
  const norm = (p) => p.replace(/^\/+|\/+$/g, '');
  const at = (path) => [norm(folder), norm(path)].filter(Boolean).join('/');
  const load = () => { try { return JSON.parse(localStorage.getItem(DATA)); } catch { return null; } };
  const save = (d) => localStorage.setItem(DATA, JSON.stringify(d));
  const rnd = () => Math.random().toString(16).slice(2, 12).padEnd(10, '0');
  const state = () => ({ login: 'demo-user', access: 'demo', expiresAt: Date.now() + 8 * 3600e3, refresh: null, refreshExpiresAt: null });
  const files = (d, repo) => (d.files[repo] ??= {});
  const log = (d, repo) => (d.log[repo] ??= []);
  const headOf = (d, repo) => log(d, repo).at(-1)?.sha ?? 'init';

  // Applies { path: text | null } (already prefixed with the folder) as one commit.
  const commit = (d, repo, changes, message) => {
    const f = files(d, repo);
    const entry = { sha: rnd(), message, date: new Date().toISOString(), files: {} };
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) {
        if (f[path]) { delete f[path]; entry.files[path] = { status: 'removed', text: null }; }
      } else {
        entry.files[path] = { status: f[path] ? 'modified' : 'added', text };
        f[path] = { text, sha: rnd() };
      }
    }
    log(d, repo).push(entry);
    return entry.sha;
  };
  // Files as they were after a commit.
  const snapshot = (d, repo, sha) => {
    const out = {};
    for (const e of log(d, repo)) {
      for (const [p, c] of Object.entries(e.files)) { if (c.text === null) delete out[p]; else out[p] = c.text; }
      if (e.sha === sha) break;
    }
    return out;
  };

  return {
    auth: async () => (localStorage.getItem(SIGNED) ? state() : null),
    signedIn: async () => !!localStorage.getItem(SIGNED),
    login: async () => (localStorage.getItem(SIGNED) ? 'demo-user' : null),
    signOut: async () => localStorage.removeItem(SIGNED),
    signIn: async () => {
      if (!load()) {
        const d = { repos: [{ full: FIRST, branch: 'main' }], files: {}, log: {} };
        commit(d, FIRST, Object.fromEntries(Object.entries(seed).map(([p, text]) => [at(p), text])), 'Initial files');
        save(d);
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
      commit(d, full, { [at('README.md')]: `# ${repoName}\n\n${description}\n` }, 'Initial commit');
      save(d);
      return { full, branch: 'main' };
    },
    async createRepoFromTemplate(template, repoName, options = {}) {
      return this.createRepo(repoName, { description: `From template ${template}. ${options.description ?? ''}`.trim() });
    },

    async read(repo, path, ref, etag) {
      const d = load();
      let f = files(d, repo)[at(path)];
      if (ref && log(d, repo).some((e) => e.sha === ref)) { // a commit: the file as it was then
        const text = snapshot(d, repo, ref)[at(path)];
        return text === undefined ? null : { text, sha: `at-${ref}`, etag: null };
      }
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
        if (tail.length) seen.set(head, { name: head, path: prefix + head, type: 'dir', sha: rnd(), size: 0 });
        else seen.set(head, { name: head, path: p, type: 'file', sha: f.sha, size: f.text.length });
      }
      return [...seen.values()].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    },

    async write(repo, path, text, current, _branch, message = 'Update') {
      const d = load();
      const f = files(d, repo)[at(path)];
      if (f ? f.sha !== current : current) throw new Conflict();
      commit(d, repo, { [at(path)]: text }, message);
      save(d);
      return files(d, repo)[at(path)].sha;
    },

    async remove(repo, path, current, _branch, message = 'Delete') {
      const d = load();
      const f = files(d, repo)[at(path)];
      if (!f) return false;
      if (f.sha !== current) throw new Conflict();
      commit(d, repo, { [at(path)]: null }, message);
      save(d);
      return true;
    },

    async writeMany(repo, changes, { message = 'Update', base } = {}) {
      const d = load();
      if (base && base !== headOf(d, repo)) throw new Conflict();
      const sha = commit(d, repo, Object.fromEntries(Object.entries(changes).map(([p, t]) => [at(p), t])), message);
      save(d);
      return { commit: sha };
    },

    async history(repo, path, { limit = 30 } = {}) {
      return log(load(), repo).filter((e) => at(path) in e.files).reverse().slice(0, limit)
        .map((e) => ({ sha: e.sha, message: e.message, author: 'demo-user', date: e.date }));
    },

    async head(repo, _branch, etag) {
      const sha = headOf(load(), repo);
      return etag === `"${sha}"` ? { notModified: true, etag } : { sha, etag: `"${sha}"` };
    },

    async changes(repo, since) {
      const d = load();
      const entries = log(d, repo);
      if (since !== 'init' && !entries.some((e) => e.sha === since)) throw new Error('That commit is not on the branch any more. Read everything again.');
      const before = since === 'init' ? {} : snapshot(d, repo, since);
      const after = snapshot(d, repo, headOf(d, repo));
      const pre = at('') ? `${at('')}/` : '';
      const out = [];
      for (const p of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (!p.startsWith(pre)) continue;
        const status = !(p in before) ? 'added' : !(p in after) ? 'removed' : before[p] !== after[p] ? 'modified' : null;
        if (status) out.push({ path: p.slice(pre.length), status });
      }
      return { head: headOf(d, repo), files: out, truncated: false };
    },
  };
}
