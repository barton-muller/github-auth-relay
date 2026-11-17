// Run: node client/demo.test.mjs   (Node 18+)
import { createDemoClient } from './demo.js';
import { Conflict } from './ghstore.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.location = { reload() {} };

let fails = 0;
const check = (n, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); if (!ok) fails++; };

const gh = createDemoClient({ folder: 'app' });
check('starts signed out', !(await gh.signedIn()) && (await gh.token()) === null);
await gh.signIn();
check('signIn signs in', (await gh.signedIn()) && (await gh.login()) === 'demo-user');
const [repo] = await gh.repos();
check('one demo repo', repo.full === 'demo/my-data');
check('missing file is null', (await gh.read(repo.full, 'a.txt')) === null);
const s1 = await gh.write(repo.full, 'a.txt', 'one');
const f = await gh.read(repo.full, 'a.txt');
check('write then read', f.text === 'one' && f.sha === s1 && f.etag === `"${s1}"`);
check('etag gives notModified', (await gh.read(repo.full, 'a.txt', undefined, f.etag)).notModified === true);
await gh.write(repo.full, 'a.txt', 'two').then(() => check('creating over an existing file conflicts', false), (e) => check('creating over an existing file conflicts', e instanceof Conflict));
const s2 = await gh.write(repo.full, 'a.txt', 'two', s1);
await gh.write(repo.full, 'a.txt', 'x', s1).then(() => check('stale sha conflicts', false), (e) => check('stale sha conflicts', e instanceof Conflict));
await gh.write(repo.full, 'sub/b.txt', 'b');
const list = await gh.list(repo.full, '');
check('list: folder first, then files', JSON.stringify(list.map((x) => [x.name, x.type])) === '[["sub","dir"],["a.txt","file"]]');
check('list: inside a folder', (await gh.list(repo.full, 'sub')).map((x) => x.path).join() === 'app/sub/b.txt');
check('list: unseen folder is empty', (await gh.list(repo.full, 'nope')).length === 0);
await gh.remove(repo.full, 'a.txt', s1).then(() => check('remove: stale sha conflicts', false), (e) => check('remove: stale sha conflicts', e instanceof Conflict));
check('remove', (await gh.remove(repo.full, 'a.txt', s2)) === true && (await gh.read(repo.full, 'a.txt')) === null);
check('remove: already gone', (await gh.remove(repo.full, 'a.txt', s2)) === false);
check('stored under the folder', Object.keys(JSON.parse(store.get('gh-store:demo:files'))).every((k) => k.startsWith('app/')));
await gh.signOut();
check('signOut', !(await gh.signedIn()));

console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
