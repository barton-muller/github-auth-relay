# Client

`ghstore.js` is the browser side of the relay: sign in with GitHub, then read and write files in the repos the person chose. About 120 lines, no dependencies, no build step. Copy it into your site.

`example.html` is a complete page that stores one piece of text as `example.txt` in a repo you pick. Put both files on a site whose origin is in the relay's `ALLOWED_ORIGINS`, fill in the three public values at the top of the script, and open it.

## Use

```js
import { createClient, Conflict } from './ghstore.js';

const gh = createClient({ clientId, relay, appSlug });
await gh.handleReturn();                       // every page load
if (!gh.signedIn()) gh.signIn();               // redirect to github.com and back

const [repo] = await gh.repos();               // repos the app is installed on: [{ full, branch }]
const f = await gh.read(repo.full, 'data.json');            // { text, sha } or null
await gh.write(repo.full, 'data.json', text, f?.sha);       // returns the new sha
await gh.remove(repo.full, 'data.json', f.sha);             // delete
```

If someone else wrote the file in between, `write` throws `Conflict`. Read again, merge, write again. If `repos()` is empty, send the person to `gh.installUrl()`.

The token is kept in `localStorage` under `<name>:auth` (`name` defaults to `gh-store`). Change `name` per app if several apps share an origin, or pass your own storage if you want the token in IndexedDB.

## What it is

Thin. GitHub's Contents API already is a key-value store with versioning: `GET /repos/{repo}/contents/{path}` returns the file and its `sha`, `PUT` with that `sha` replaces it, and `DELETE` with it removes it. The `sha` is a compare-and-swap token, so lost updates become a `409`. The client wraps that, plus the sign-in, and nothing else. There is no SDK to learn.

Limits that shape what you store:
- Deleting removes the file from the branch but keeps it in git history, so it is not erasure.
- One request per file. No transactions across files, no listing by prefix beyond fetching a folder.
- About 1 MB per file through this route. Keep data as a few JSON files, not many small ones.
- Rate limits are per user (5,000 requests an hour), which is plenty for one person.
- Every save is a commit. That gives free history, but also commit noise. Batch saves.
- Reads can lag a few seconds behind a write. `read` sends `no-store`, but GitHub's own cache may still serve the old file briefly.

Go Find Yourself uses the same calls and adds per-record merging on top, because two devices can edit one plan. That merge is the application's job. The storage layer only tells you the file changed.
