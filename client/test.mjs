// Run: node client/test.mjs   (Node 18+; GitHub and the relay are mocked)
import { createClient, Conflict } from './ghstore.js';

const store = new Map();
const mem = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.localStorage = mem;
globalThis.sessionStorage = { ...mem, getItem: (k) => store.get('s' + k) ?? null, setItem: (k, v) => store.set('s' + k, v), removeItem: (k) => store.delete('s' + k) };
let loc = 'https://me.github.io/app/';
const L = { origin: 'https://me.github.io', pathname: '/app/', hash: '', get search() { return new URL(loc).search; }, assign: (u) => { L.went = u; } };
globalThis.location = L;
globalThis.history = { replaceState: (_, __, u) => { loc = 'https://me.github.io' + u; } };

const file = { text: 'héllo', sha: 'sha1' };
const calls = [];
const fetchImpl = async (url, init = {}) => {
  calls.push({ url, init });
  const ok = (b, status = 200) => new Response(JSON.stringify(b), { status });
  if (url.endsWith('/token')) return ok({ access_token: 'ghu_1', expires_in: 28800, refresh_token: 'ghr_1', refresh_token_expires_in: 1e7 });
  if (url.endsWith('/refresh')) return ok({ access_token: 'ghu_2', expires_in: 28800, refresh_token: 'ghr_2', refresh_token_expires_in: 1e7 });
  if (url.endsWith('/user')) return ok({ login: 'me' });
  if (url.includes('/user/installations?')) return ok({ installations: [{ id: 5 }] });
  if (url.includes('/installations/5/repositories')) return ok({ repositories: [{ full_name: 'me/data', default_branch: 'main' }] });
  if (url.includes('/contents/') && init.method === 'PUT') {
    const b = JSON.parse(init.body);
    if (b.sha !== file.sha && file.sha) return ok({}, 409);
    file.text = new TextDecoder().decode(Uint8Array.from(atob(b.content), (c) => c.charCodeAt(0)));
    file.sha = 'sha' + (Number(file.sha.slice(3)) + 1);
    return ok({ content: { sha: file.sha } });
  }
  if (url.includes('/contents/') && init.method === 'DELETE') return JSON.parse(init.body).sha === file.sha ? ok({}) : ok({}, 409);
  if (url.includes('/contents/missing')) return ok({}, 404);
  if (url.includes('/contents/')) return ok({ sha: file.sha, content: btoa(String.fromCharCode(...new TextEncoder().encode(file.text))) });
  return ok({}, 500);
};

let fails = 0;
const check = (n, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); if (!ok) fails++; };
const gh = createClient({ clientId: 'Iv1.x', relay: 'https://relay.example/', appSlug: 'my-app', fetchImpl });

await gh.signIn();
const q = new URL(L.went).searchParams;
check('signIn: PKCE challenge and client id', q.get('code_challenge_method') === 'S256' && q.get('client_id') === 'Iv1.x' && q.get('code_challenge').length === 43);
const state = q.get('state');
loc = `https://me.github.io/app/?code=abc&state=${state}`;
check('handleReturn: signs in', (await gh.handleReturn()) && gh.signedIn() && gh.login() === 'me' && loc === 'https://me.github.io/app/');
check('handleReturn: verifier sent to relay', JSON.parse(calls.find((c) => c.url.endsWith('/token')).init.body).code_verifier.length === 64);
loc = 'https://me.github.io/app/?code=abc&state=wrong';
sessionStorage.setItem('gh-store:pending', JSON.stringify({ verifier: 'v', state: 'right', redirect: 'x' }));
await gh.handleReturn().then(() => check('wrong state refused', false), () => check('wrong state refused', true));
check('installUrl carries state', gh.installUrl() === 'https://github.com/apps/my-app/installations/new?state=' + encodeURIComponent('https://me.github.io/app/'));
check('repos', JSON.stringify(await gh.repos()) === '[{"full":"me/data","branch":"main"}]');
const f = await gh.read('me/data', 'a.txt');
check('read: utf-8 and sha', f.text === 'héllo' && f.sha === 'sha1');
check('read: missing is null', (await gh.read('me/data', 'missing.txt')) === null);
const s2 = await gh.write('me/data', 'a.txt', 'wörld', f.sha);
check('write: new sha, text stored', s2 === 'sha2' && file.text === 'wörld');
await gh.write('me/data', 'a.txt', 'x', f.sha).then(() => check('stale sha throws Conflict', false), (e) => check('stale sha throws Conflict', e instanceof Conflict));
await gh.remove('me/data', 'a.txt', 'old').then(() => check('remove: stale sha throws Conflict', false), (e) => check('remove: stale sha throws Conflict', e instanceof Conflict));
check('remove: ok', (await gh.remove('me/data', 'a.txt', s2)) === true);
const a = JSON.parse(store.get('gh-store:auth'));
a.expiresAt = Date.now() + 1000;
store.set('gh-store:auth', JSON.stringify(a));
check('token: refreshed near expiry', (await gh.token()) === 'ghu_2');
gh.signOut();
check('signOut', !gh.signedIn() && (await gh.token()) === null);

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
