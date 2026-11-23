# Build the static site with Node, serve only the output with nginx running as non-root.
# Pattern mirrors MakeMeDizzy: pinned bases, no root, minimal writable surface.
FROM node:22-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY astro.config.mjs tsconfig.json ./
COPY tools/check-csp.mjs tools/check-csp.mjs
COPY src src
COPY public public
# dist/_headers and dist/_redirects are for Cloudflare; nginx has the same rules (security-headers.conf, nginx.conf).
RUN npm run build && rm dist/_headers dist/_redirects

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /build/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
