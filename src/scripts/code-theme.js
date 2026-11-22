// Build time only: a Shiki theme in the site's palette, and a transformer that turns Shiki's inline colours into
// classes (page.css .tk-*), because the CSP forbids style attributes.
const C = {
  fg: "#c9d6e3", comment: "#6f7d8c", keyword: "#8fd3ff", string: "#9fe3c9",
  number: "#ffd27a", fn: "#ffffff", type: "#c08cff", punct: "#a9b6c4",
};

export const codeTheme = {
  name: "alrightansh",
  type: "dark",
  colors: { "editor.background": "#0a0e16", "editor.foreground": C.fg },
  settings: [
    { settings: { foreground: C.fg, background: "#0a0e16" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: C.comment } },
    { scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.other", "keyword.control"], settings: { foreground: C.keyword } },
    { scope: ["string", "punctuation.definition.string", "string.quoted"], settings: { foreground: C.string } },
    { scope: ["constant.numeric", "constant.language", "constant.character", "support.constant"], settings: { foreground: C.number } },
    { scope: ["entity.name.function", "support.function", "meta.function-call.generic", "support.function.builtin"], settings: { foreground: C.fn } },
    { scope: ["entity.name.type", "support.type", "storage.type.sql", "support.class", "entity.name.class"], settings: { foreground: C.type } },
    { scope: ["keyword.operator", "punctuation", "meta.brace"], settings: { foreground: C.punct } },
  ],
};

const CLASS = {
  [C.comment]: "tk-c", [C.keyword]: "tk-k", [C.string]: "tk-s", [C.number]: "tk-n",
  [C.fn]: "tk-f", [C.type]: "tk-t", [C.punct]: "tk-p",
};

export const styleToClass = {
  name: "alrightansh:style-to-class",
  pre(node) {
    delete node.properties.style;
    node.properties.class = "astro-code code";
  },
  span(node) {
    const m = /color:\s*(#[0-9a-f]{6})/i.exec(String(node.properties.style || ""));
    delete node.properties.style;
    const cls = m && CLASS[m[1].toLowerCase()];
    if (cls) node.properties.class = cls;
  },
};
