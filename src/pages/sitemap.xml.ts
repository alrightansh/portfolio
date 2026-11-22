import type { APIRoute } from "astro";

// Every public page. Add new routes here.
const ROUTES = ["/", "/work/", "/work/utility-network/", "/work/ai/", "/work/earth-observation/"];

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://alrightansh.com");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    ROUTES.map((r) => `  <url><loc>${new URL(r, base).href}</loc></url>\n`).join("") +
    `</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
