import type { APIRoute } from "astro";

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://maps.alrightansh.com");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url><loc>${new URL("/", base).href}</loc></url>\n` +
    `</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
