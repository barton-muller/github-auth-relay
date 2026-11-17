# Guide

This guide explains what pages-storage is for, how it works, and every setting you fill in. For the short version, see the [README](../README.md).

- [What problem this solves](#what-problem-this-solves)
- [How it works](#how-it-works)
- [Set up](#set-up): [1. GitHub App](#1-make-a-github-app), [2. Relay](#2-deploy-the-relay), [3. Your app](#3-add-it-to-your-app)
- [Several sites and domains](#several-sites-and-domains)
- [Working with the data](#working-with-the-data)
- [Limits](#limits)
- [Security](#security)
- [Updating and versions](#updating-and-versions)
- [When something fails](#when-something-fails)

## What problem this solves

A static site, such as one on GitHub Pages, has no backend. The usual ways to keep a person's data all cost something:

- **Browser storage** lives on one device, and a browser can clear it. iOS does.
- **Your own backend** needs hosting, a database, accounts, and a privacy policy. You carry the risk of holding other people's data.
- **A hosted backend service** needs its own sign-up for you and for your users, and locks the data in.

pages-storage uses something every developer, and a growing number of other people, already has: a GitHub account. The data goes in a repo the person owns. You never hold it, and neither does the relay.

What you get:
- **No server and no database to run.** The relay is a function of about 110 lines on Cloudflare's free tier. It holds one secret and no data.
- **Identity for free.** "Sign in with GitHub" and no passwords.
- **The person owns the data.** It is files in their repo, with history, diffs and revert. They can read it, edit it, or take it elsewhere.
- **Several interfaces on one set of data.** A phone app, a dashboard, a script and an AI agent can all read and edit the same files. The agent just needs the repo.
- **Sharing.** Give someone else access to the repo and they see the same data.
- **Works offline-first.** Keep a local copy and sync when online. Conflicts are detected for you.

It suits personal tools, planners, notes, trackers, small-team data, and content editors for a static site.

It does not suit:
- **Large or binary data.** Files are limited to about 1 MB through this route.
- **Many writes per second.** Every save is a commit.
- **Anonymous visitors.** People need a GitHub account.
- **Fine-grained access between strangers**, or logic that must run on a server.

For a comparison with the [remoteStorage](https://remotestorage.io/) protocol: that is a real standard with many compatible servers, and this is not one. It trades portability for a provider almost everyone already has, plus history and AI-editable files.

## How it works

Three parties: the **site** (static, in the browser), **GitHub**, and the **relay** (a Cloudflare Worker).

**Why a relay at all.** GitHub's token endpoint needs the app's *client secret*, and a web page cannot keep a secret. It also does not allow calls from a web page (no CORS). So the one step that needs the secret runs on the relay. Everything else the site does itself.

**Sign-in**
1. The site makes a random *verifier*, sends its hash (the *challenge*) to GitHub, and sends the person to `github.com/login/oauth/authorize`. This is PKCE: only the browser that holds the verifier can finish the sign-in.
2. The person approves. GitHub redirects to the site's address with a one-time `code`.
3. The site posts `code`, the verifier and the redirect address to the relay's `/token`. The relay adds the client secret, calls GitHub, and returns an access token (valid 8 hours) and a refresh token (about 6 months).
4. The site keeps both in the browser and uses the access token to call `api.github.com` directly.
5. Before the access token runs out, the client asks the relay's `/refresh` for a new one. Nothing else goes through the relay.

**Which repos.** The GitHub App has the *Contents* permission. A person installs the app on the repos they choose, and the token can touch only those. `gh.repos()` lists them. `gh.installUrl()` opens GitHub's page to change the choice, and the relay's `/return` brings the person back to your site afterwards.

**Reading and writing.** GitHub's Contents API is a small key-value store: the path is the key, the file is the value. Every read returns a `sha`. A write sends that `sha` back, and if the file changed in between, GitHub refuses with a conflict. The client turns that into a `Conflict` error.

**What the relay sees.** The code and the verifier at sign-in, and the refresh token at renewal. It passes them on and stores none of it. It refuses callers whose origin is not in `ALLOWED_ORIGINS`, and redirect addresses outside those origins.

## Set up

You need a GitHub account and a free [Cloudflare](https://www.cloudflare.com/) account. All of it can be done from a phone browser.

### 1. Make a GitHub App

Use a **GitHub App**, not an OAuth App. An OAuth App can only ask for access to all of someone's private repos. A GitHub App is installed on the repos the person picks and has only the permission you give it.

On github.com open *Settings, Developer settings, GitHub Apps, New GitHub App*.

| Field | Value |
|---|---|
| GitHub App name | A unique name. It becomes the slug in `github.com/apps/<slug>`. Note the slug. |
| Homepage URL | One of your sites. |
| Callback URL | The address of each site that will sign people in, with the trailing `/`. You can add several. For every page of one GitHub Pages account, add `https://<you>.github.io/` and turn on wildcard matching for it. Wildcard matching lets any page under that address receive sign-in codes, so use it only when you control every page there. |
| Expire user authorization tokens | Ticked. |
| Request user authorization (OAuth) during installation | **Unticked.** If ticked, GitHub sends people to the *first* callback URL after installing, which may not be the site they came from. |
| Enable Device Flow | Unticked. |
| Setup URL | Leave empty for now. After step 2, set it to `<relay address>/return`. |
| Redirect on update | Ticked, so adding or removing repos also returns people to the site. |
| Webhook, Active | Unticked. |
| Repository permissions, Contents | **Read and write.** Nothing else. |
| Where can this GitHub App be installed | *Only on this account*, or *Any account* if other people should use it. |

Create it. On the app's page copy the **Client ID**, which is public, and generate a **client secret**, which is shown once. You do not need a private key, so skip the JWT pages.

### 2. Deploy the relay

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/barton-muller/pages-storage)

The button copies this repo into your GitHub account, deploys it with Cloudflare's Workers Builds, and shows a form for the settings:

| Setting | Value |
|---|---|
| `GITHUB_CLIENT_ID` | The Client ID from step 1. It starts with `Iv`. Check it character by character: `l` and `1`, `I` and `l` look alike on a phone. |
| `GITHUB_CLIENT_SECRET` | The client secret from step 1. Paste only the secret, with no spaces or quotes. |
| `ALLOWED_ORIGINS` | The sites that may use the relay, comma-separated, each as scheme and host with no path and no trailing slash: `https://you.github.io,https://example.com`. One entry covers every page under it. |

Nothing personal is stored in the repo copy. Later pushes to your copy redeploy it and the settings stay. Change a setting in the Worker's *Settings, Variables and Secrets*, and it applies at once.

The deploy gives you the relay's address, such as `https://pages-storage.<you>.workers.dev`. Open it. You should see `{"name":"pages-storage","version":"0.1.0","configured":true}`. `configured: false` means a setting is missing.

Now go back to the GitHub App and set **Setup URL** to `<relay address>/return`.

**Without the button.** Clone the repo and run:
```
npm install
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ALLOWED_ORIGINS
npx wrangler deploy
```
Or in the dashboard: *Workers & Pages, Create, Import a repository*, deploy command `npx wrangler deploy`, then add the three settings under *Settings, Variables and Secrets*.

**Check it from a computer:**
```
curl -X POST <relay address>/token -H 'Origin: https://you.github.io' -H 'Content-Type: application/json' -d '{}'
```
`{"error":"bad_request"}` is the right answer.

### 3. Add it to your app

Three values go into the app, and all are public: the Client ID, the relay address and the app slug.

```
npm install git+https://github.com/barton-muller/pages-storage.git#v0.1.0
```
```js
import { createClient, Conflict } from 'pages-storage/client';

const gh = createClient({
  clientId: 'Iv…',
  relay: 'https://pages-storage.<you>.workers.dev',
  appSlug: 'my-app-slug',
  folder: 'my-app',
});

await gh.handleReturn();                        // every page load; finishes a sign-in and tidies the URL
if (!(await gh.signedIn())) gh.signIn();        // redirects to github.com and back

const repos = await gh.repos();                 // [{ full: 'you/data', branch: 'main' }]
if (!repos.length) location.href = gh.installUrl();   // person picks repos, then returns here

const file = await gh.read('you/data', 'data.json');        // { text, sha, etag } or null
const sha = await gh.write('you/data', 'data.json', JSON.stringify(data), file?.sha);
```

| Call | What it does |
|---|---|
| `signIn()`, `handleReturn()`, `signOut()` | The sign-in flow. `handleReturn()` returns the new sign-in, or `null`. |
| `signedIn()`, `login()`, `auth()`, `token()` | Current state. `token()` renews the access token when it is about to expire. |
| `repos()`, `installUrl()` | Repos the app is installed on, and GitHub's page to change that. |
| `read(repo, path, branch?, etag?)` | `{ text, sha, etag }`, or `null` if missing. With the `etag` of an earlier read you get `{ notModified: true }` for an unchanged file, which GitHub does not count against the rate limit. |
| `list(repo, dir?, branch?)` | The entries of a folder: `{ name, path, type, sha, size }`. |
| `write(repo, path, text, sha?, branch?, message?)` | Creates or replaces a file and returns its new `sha`. Pass the `sha` of the version you read. A stale one throws `Conflict`. |
| `remove(repo, path, sha, branch?)` | Deletes a file. The old content stays in git history. |

Options of `createClient`:

| Option | Meaning |
|---|---|
| `clientId`, `relay`, `appSlug` | The three public values. |
| `folder` | Keeps every path under this folder, so several apps can share one repo. A convention only: the app's access covers the whole repo. |
| `name` | Prefix for what the client stores in the browser. Use one name per app when apps share an origin. |
| `storage` | `{ get, set, del }`, each async, to keep the sign-in somewhere other than `localStorage`, such as IndexedDB. Sites that point at the same storage share a sign-in. |
| `cleanUrl` | The address to show after sign-in returns. Default: the page's own path and hash. |

**No build step:** copy [`client/ghstore.js`](../client/ghstore.js). It has no dependencies. TypeScript types are in `ghstore.d.ts`.

**Build or test without GitHub:** `createDemoClient()` from `pages-storage/client/demo` has the same calls and keeps files in `localStorage`. Swap it for `createClient()` when you go live. Pass `seed: { 'hello.txt': 'Hi' }` to start with some files, and call `reset()` to restore them. The [example page](index.html) does this with a "Try the demo" button.

**Merging is your job.** The storage layer tells you the file changed. When two devices edit one file, read again, merge your changes into the new version, and write again. Keeping each record separate, with an `updatedAt`, and taking the newest per record works well. Go Find Yourself does this.

## Several sites and domains

- **Same GitHub Pages account.** One origin, `https://<you>.github.io`, covers every project page. The browser shares storage between them, so with the same `name` and `storage` a person signs in once for all.
- **Another domain.** Add its origin to `ALLOWED_ORIGINS` in the Worker's settings (no redeploy needed), add its address as another Callback URL on the GitHub App, and have the site add `state=<its address>` to the install link, which `gh.installUrl()` does. The browser stores the sign-in per origin, so a person signs in once on each domain. GitHub remembers the approval, so it is one tap.
- **Several interfaces, one dataset.** Point them at the same repo and use a shared `folder`, or different folders for different apps. A dashboard and an editor can both use `my-data/`.
- **Someone else's site.** They can use your relay if you add their origin, but then they sign people in through your GitHub App, under your app's name. Most people should deploy their own.

## Working with the data

- **It is plain files in a repo.** Open them on github.com, clone the repo, or let an AI agent edit them. The app picks the changes up on the next read.
- **Every save is a commit**, with the message you pass to `write`. You get history for free. Save when something changes, not on every keystroke.
- **Private by default.** Keep the data repo private. The app token reaches only the repos the person chose.
- **Branches.** Pass `branch` to read and write on another branch, for example one per person.

## Limits

- Around 1 MB per file through the Contents API. Keep data as a few JSON or text files.
- One request per file. No transactions across files.
- 5,000 requests an hour per user. Plenty for one person, and conditional reads (`etag`) cost nothing.
- Reads can lag a few seconds behind a write because of GitHub's caching.
- People need a GitHub account.
- Access tokens last 8 hours and the client renews them. After about 6 months without use the person signs in again.

## Security

- The client secret exists only as a Cloudflare secret. Never put it in a repo, a website, a chat or a log.
- The relay refuses any origin not in `ALLOWED_ORIGINS` and any redirect address outside those origins. Answers are `Cache-Control: no-store`.
- Tokens pass through the relay in memory only. If you change the code, do not log or store them.
- PKCE ties each code to the browser that asked for it, so a stolen code is useless.
- **Tell people what a site can do.** An app installed on a repo can read and write every file in it, and so can the site that holds the token. The example page says so before sign-in. Do the same, and suggest a separate repo for the data.
- The token lives in the browser's storage. Treat the site like any page that holds a login: no third-party scripts you do not trust.
- To cut everyone off at once, generate a new client secret in the GitHub App and update `GITHUB_CLIENT_SECRET`.
- Wildcard callback URLs let any page under that address receive codes. Use them only for addresses you fully control.

## Updating and versions

- The repo follows [semver](https://semver.org/) with tags (`v0.1.0`) and a [changelog](../CHANGELOG.md). Before 1.0, a minor version may change the client API, so pin a tag or commit in your app.
- **Client:** change the tag in `package.json` and run `npm install`. Read the changelog first.
- **Relay:** your copy of the repo is separate. To update, pull the new code into it (on GitHub, *Sync* if it is a fork, or copy files) and push. Workers Builds redeploys, and `GET /` on the relay shows the new version.
- The relay and the client are meant to be compatible within one minor version. A newer client against an older relay works unless the changelog says otherwise.

## When something fails

| What you see | Cause and fix |
|---|---|
| `origin_not_allowed` | The site's origin is not in `ALLOWED_ORIGINS`. Check scheme and host, no path, no trailing slash. |
| `redirect_not_allowed` | The sign-in redirect address is on an origin that is not in `ALLOWED_ORIGINS`. |
| `relay_not_configured`, or `configured: false` at `GET /` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` or `ALLOWED_ORIGINS` is missing in the Worker. |
| `incorrect_client_credentials` | The Client ID and secret in the Worker do not match the GitHub App. Re-enter both, paste the secret alone, and generate a new secret if unsure. |
| `bad_verification_code` | The code was used twice or expired. Start the sign-in again. |
| `redirect_uri_mismatch` (from GitHub) | The site's address is not in the app's Callback URLs. Add it with the trailing `/`, or turn on wildcard matching. |
| 404 after installing the app on a repo | The Setup URL is wrong. Set it to `<relay address>/return`. |
| After installing, you land on the app page, not your site | The install link lacks `state`, or the site's origin is not in `ALLOWED_ORIGINS`. Use `gh.installUrl()`. |
| `repos()` returns an empty list | The app is not installed on any repo yet. Send the person to `gh.installUrl()`. |
| `Conflict` on write | The file changed since it was read. Read again, merge, write again. |
| `Sign-in was not started in this browser` | The return came back in a different browser or after the tab's storage was cleared. Try again in one browser. |
| Signed in on one device, not on another | Sign-in is stored per browser and origin. Sign in on each device. |
| Another site's sign-in does not carry over | Sign-in is stored per origin. Pages under one origin can share it. Other domains sign in once each. |
