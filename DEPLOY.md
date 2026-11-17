# Deploying alrightansh.com

Hardened compose plus a Cloudflare tunnel; no ports are published to the internet.

- `web`: static Astro build served by `nginx-unprivileged` on 8080 as a non-root user,
  read-only filesystem, all capabilities dropped, security headers from `security-headers.conf`.
- `tunnel`: `cloudflared`, routes alrightansh.com and www to `http://web:8080` (`state/cloudflared/config.yml`).

## Secrets

Kept in `secrets/`, which is gitignored. Never commit them.

- `secrets/tunnel_credentials.json`: tunnel credentials, mounted as a Docker secret.
- `secrets/cloudflared/cert.pem`: account login cert, only needed to create tunnels or DNS routes.

## Local test

```powershell
docker compose -f compose.yaml -f compose.debug.yaml up -d --build web
```

Site at http://localhost:8091. Stop with `docker compose down`.

## Deploy

```powershell
docker compose --profile tunnel up -d --build
```

## New machine setup

1. `cloudflared tunnel login`, then `cloudflared tunnel create <name>`
2. Copy the credentials json to `secrets/tunnel_credentials.json`
3. Put the tunnel id in `state/cloudflared/config.yml`
4. `cloudflared tunnel route dns <name> alrightansh.com` (delete any existing apex A record first)
5. Deploy as above

MakeMeDizzy is a separate compose project with its own tunnel; this stack does not touch it.
