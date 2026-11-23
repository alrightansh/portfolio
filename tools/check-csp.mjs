// Runs after `astro build` (npm run build): fails the build when a page would break the same-origin CSP in
// public/_headers and security-headers.conf, so a broken page never replaces the live site. Allowed: <script src>,
// JSON-LD data blocks, and styles set from JS. Not allowed: <style> elements, style="" attributes, other inline scripts.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pages = readdirSync("dist", { recursive: true }).filter((f) => f.endsWith(".html"));
const problems = [];
for (const page of pages) {
  const html = readFileSync(join("dist", page), "utf8");
  if (/<style[\s>]/i.test(html)) problems.push(`${page}: <style> element`);
  if (/<[a-z][^>]*\sstyle\s*=/i.test(html)) problems.push(`${page}: style attribute`);
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\ssrc\s*=/i.test(tag) && !/\stype\s*=\s*["']?application\/ld\+json/i.test(tag)) problems.push(`${page}: inline ${tag}`);
  }
}
if (problems.length) {
  console.error(`CSP check failed (see PROJECT.md, "Hard constraint"):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`CSP check: ${pages.length} pages, no inline styles or scripts`);
