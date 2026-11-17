# github-auth-relay

A tiny Cloudflare Worker that lets static sites offer **Sign in with GitHub**.

A site on GitHub Pages cannot hold a secret, and GitHub's token endpoint cannot be called from a web page. So the one step that needs the app's client secret runs here. Everything else happens in the browser. The relay keeps nothing: no database, no copy of any token, no logs of them.

Used by [Go Find Yourself](https://github.com/barton-muller/find-your-self). One relay serves any number of sites.

## How it works

1. The site sends the person to github.com to approve (with PKCE).
2. GitHub sends them back to the site with a one-time code.
3. The site sends the code to this relay. The relay adds the client secret and asks GitHub for the person's access token, then hands it back.
4. The site keeps the token and calls `api.github.com` directly. About every 8 hours it asks the relay to renew the token.

## API

Both routes take a `POST` with a JSON body and answer JSON. Only sites listed in `ALLOWED_ORIGINS` are served. Every other caller gets `403`.

| Route | Body | Answer |
|---|---|---|
| `/token` | `{ "code", "redirect_uri", "code_verifier" }` | `{ access_token, expires_in, refresh_token, refresh_token_expires_in }` |
| `/refresh` | `{ "refresh_token" }` | the same fields |

`redirect_uri` must be on an allowed origin. `code_verifier` is the PKCE verifier and is passed to GitHub. Errors look like `{ "error": "bad_verification_code" }`.

## Set it up (about 20 minutes)

You need a GitHub account and a free [Cloudflare](https://www.cloudflare.com/) account. Everything below can be done from a phone browser.

### 1. Make a GitHub App

Use a **GitHub App**, not an OAuth App. An OAuth App can only ask for access to all of someone's private repos. A GitHub App is installed on the repos the person picks and has only the permission you give it.

On github.com open *Settings, Developer settings, GitHub Apps, New GitHub App*.

| Field | Value |
|---|---|
| GitHub App name | A unique name. It becomes the slug in `github.com/apps/<slug>`. Note the slug. |
| Homepage URL | One of your sites |
| Callback URL | The address of each site that will use the relay, with the trailing `/`. You can add several. For all pages of one GitHub Pages account, add `https://<you>.github.io/` and turn on wildcard matching for it. Wildcard matching lets any page under that address receive sign-in codes, so use it only when you control every page there. |
| Expire user authorization tokens | Ticked |
| Request user authorization (OAuth) during installation | Ticked |
| Webhook, Active | Unticked |
| Repository permissions, Contents | **Read and write** |
| Where can this GitHub App be installed | *Only on this account*, or *Any account* if other people should use it |

Create it. On the app's page copy the **Client ID** (public), and generate a **client secret** (shown once). The secret goes only into Cloudflare. You do not need a private key, so skip the JWT pages.

### 2. Deploy the Worker

**From the Cloudflare dashboard, connected to this repo (Workers Builds):**
1. *Workers & Pages, Create, Import a repository*. Choose your fork of this repo.
2. The Worker name must match `name` in `wrangler.toml` (`github-auth-relay`). Leave the root directory empty. Build command empty. Deploy command `npx wrangler deploy`.
3. Edit `wrangler.toml` in your fork: set `GITHUB_CLIENT_ID` and `ALLOWED_ORIGINS`. Plain values set only in the dashboard are replaced by `wrangler.toml` on each deploy, so keep them in the file. Both are public.
4. In the Worker's *Settings, Variables and Secrets* add a **Secret** named `GITHUB_CLIENT_SECRET` with your client secret. Secrets survive deploys.

**Or from a computer:**
```
npm install
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy
```

The deploy gives you the relay's address, such as `https://github-auth-relay.<you>.workers.dev`. Open it in a browser. `{"error":"method_not_allowed"}` means it is running.

### 3. Point a site at it

The site needs three public values: the GitHub App's Client ID, the relay's address, and the app slug. Go Find Yourself reads them from the build variables `VITE_GH_CLIENT_ID`, `VITE_GH_RELAY` and `VITE_GH_APP_SLUG`. Other sites can use any names. See [how Go Find Yourself does it](https://github.com/barton-muller/find-your-self/blob/main/docs/GITHUB-SIGN-IN.md).

### Adding another site
1. Add its origin to `ALLOWED_ORIGINS` (`https://<you>.github.io` already covers every page under it) and redeploy.
2. Add its address as another Callback URL on the GitHub App, unless wildcard matching already covers it.
3. Give the site the same three values.

## Security notes

- The client secret exists only as a Cloudflare secret. Never put it in a repo or a website.
- The relay refuses any origin not in `ALLOWED_ORIGINS` and any `redirect_uri` outside those origins. It answers `Cache-Control: no-store`.
- Tokens pass through the relay once, in memory. If you change the code, do not log or store them.
- To cut everyone off at once, generate a new client secret in the GitHub App and update `GITHUB_CLIENT_SECRET`.
- Keep the client secret and the GitHub App's other keys out of chat, issues and logs.

## Test

`npm test` (or `node test.mjs`) runs 16 checks with a pretend GitHub. It needs Node 18 or newer and no network.

## Licence

[MIT](LICENSE).
