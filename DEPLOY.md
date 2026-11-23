# Deploying alrightansh.com

The site is hosted by Cloudflare (Workers static assets) and deployed from GitHub: a push to `main` goes live in
about a minute, whether or not the PC is on. The Docker stack further down is for local testing and as a fallback.

## How it works

- Cloudflare Workers Builds watches `alrightansh/portfolio`. On every push it installs dependencies, runs
  `npm run build` (Astro, then `tools/check-csp.mjs`) and `npx wrangler deploy`, which uploads `dist/` as set in
  `wrangler.jsonc`.
- A failed build deploys nothing, so the last good version stays live. The CSP check fails the build when a page has
  an inline style or script that the CSP would block.
- Other branches build too and get a preview URL, shown on the commit in GitHub and in the dashboard. Merge to `main`
  to publish.
- Headers (CSP, HSTS, caching) come from `public/_headers`, the Cloudflare twin of `security-headers.conf` and the
  cache rules in `nginx.conf`. Redirects go in `public/_redirects` (Cloudflare) and `nginx.conf` (Docker). Keep each
  pair in step.
- No secrets are involved: Cloudflare's GitHub app reads the repo, and nothing in the repo grants access to anything.

## One-time setup (Cloudflare dashboard, works on a phone)

1. Workers & Pages > Create application > Import a repository. Connect GitHub and pick `alrightansh/portfolio`.
2. Settings:
   - Project name: `portfolio` (must match `name` in `wrangler.jsonc`)
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Builds for non-production branches: on, with `npx wrangler versions upload`
3. Create and deploy. When the build finishes, open the `*.workers.dev` link it shows and check the site.
4. Settings > Domains & Routes > Add > Custom domain: `alrightansh.com`, then again for `www.alrightansh.com`.
   If Cloudflare says a DNS record already exists, delete the two old tunnel records first (DNS > Records: the CNAMEs
   for `alrightansh.com` and `www` that point to `...cfargotunnel.com`), then add the domains again.
5. On the PC, whenever convenient: `docker compose --profile tunnel down` (the tunnel no longer serves the site).

Optional: the map data (`*.bin`) is served uncompressed by default. Rules > Compression Rules > Create rule,
"URI Path ends with .bin", enable compression: about 15 to 60% smaller per file, as nginx's gzip did.

## Day to day

- Publish: merge or push to `main`.
- Roll back: the Worker's Deployments tab > an earlier version > Deploy, or `git revert` and push.
- Test locally with Cloudflare's runtime and headers:

  ```powershell
  npm ci
  npm run build
  npx wrangler dev        # http://localhost:8787
  ```

## Docker (local test, fallback host)

Hardened compose: `web` is the static build on `nginx-unprivileged` (port 8080, non-root, read-only, no
capabilities, headers from `security-headers.conf`). `tunnel` is `cloudflared`, routing alrightansh.com and www to
`http://web:8080` (`state/cloudflared/config.yml`); no ports are published to the internet.

```powershell
docker compose -f compose.yaml -f compose.debug.yaml up -d --build web   # http://localhost:8091
docker compose down
```

To serve the site from the PC again instead of Cloudflare: remove the Worker's custom domains, then
`docker compose --profile tunnel up -d --build` and `cloudflared tunnel route dns <name> alrightansh.com`.

Secrets live in `secrets/`, which is gitignored. Never commit them.

- `secrets/tunnel_credentials.json`: tunnel credentials, mounted as a Docker secret.
- `secrets/cloudflared/cert.pem`: account login cert, only needed to create tunnels or DNS routes.

New machine: `cloudflared tunnel login`, `cloudflared tunnel create <name>`, copy the credentials JSON to
`secrets/tunnel_credentials.json` and put the tunnel id in `state/cloudflared/config.yml`.

MakeMeDizzy is a separate compose project with its own tunnel; this stack does not touch it.
