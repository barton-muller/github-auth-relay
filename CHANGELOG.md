# Changelog

Versions follow [semver](https://semver.org/). `package.json` holds the version, and the Worker reports it at `GET /`.
While the version is 0.x, a minor bump may change the client API. Pin a tag or commit in your app.

## 0.1.0

First tagged release.

- **Relay:** `POST /token` and `POST /refresh` swap codes and refresh tokens for GitHub App user tokens (PKCE). `GET /return` sends people back to the site that started an app install. `GET /` reports the version. Allowed origins only. Keeps nothing.
- **Client (`pages-storage/client`):** sign-in with PKCE, token renewal, `repos`, `read` (with ETag), `list`, `write`, `remove`, a folder per app, pluggable token storage, TypeScript types.
- **`createRepo(name)`:** creates a private repo for the signed-in person. Needs the optional *Repository creation* permission on the GitHub App.
- **Demo backend (`pages-storage/client/demo`):** the same interface over `localStorage`, for demos and tests.
- **Example page:** sign in or use the demo, browse a repo, open, create, edit and delete text files, and create a private test repo with sample files.
- **Deploy to Cloudflare button:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and `ALLOWED_ORIGINS` are asked for at deploy time.
