// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: "https://alrightansh.com",
  trailingSlash: "always",
  // security-headers.conf only allows same-origin scripts and styles, so nothing may be inlined into the HTML.
  build: { inlineStylesheets: "never" },
  vite: { build: { assetsInlineLimit: 0 } },
});
