// Portfolio copy, one entry per station along the flight path.
// glyph: particles rise out of the terrain to form it. glass: image shown on a glass tile wall.
// id: deep link into the flight (/#id). href + linkText: a link under the caption.
export const STATIONS = [
  {
    id: "utility-networks", glyph: "UN", title: "Utility networks", sup: "(PwC)",
    caption: "Geospatial data scientist on the first Esri Platinum team. I have delivered multiple iterations of bulk utility migrations, and I keep enhancing Esri Utility Network systems and how they are deployed across enterprise asset management (EAM) platforms.",
    href: "/work/utility-network/", linkText: "Read the case study →",
  },
  {
    id: "toolkit", glyph: "</>", title: "Toolkit", sup: "(skills)",
    caption: "Automation end to end: Python, FME and CI/CD pipelines that turn months of migration work into repeatable runs. Electric and gas UPDM models, asset packages and rule bases. Team management and product development, from first prototype to production.",
    href: "/work/#skills", linkText: "See the full toolkit →",
  },
  {
    id: "remote-sensing", glyph: "AI", title: "Remote sensing", sup: "(ISRO)",
    caption: "Reading the planet from orbit. I build machine learning models on satellite imagery for land use and land cover, change detection and terrain analysis, then turn them into decisions: advanced hazard and risk mapping, urban risk management and master plan formulation. ISRO–IIRS advanced certifications.",
    href: "/work/earth-observation/", linkText: "Read the research →",
  },
  // Research stop: rendered by research.js with its own HUD instead of a label.
  { id: "neugal", research: true, title: "Neugal watershed" },
  // Energy stop: rendered by energy.js with its own HUD instead of a label.
  { id: "sun-and-wind", energy: true, title: "Sun and wind" },
  {
    id: "himachal", glyph: "HP", title: "Himachal", sup: "(→PwC)",
    caption: "Advanced degrees in Geography and Remote Sensing. A special knack for planet Earth: curious about how large systems work, and how they ripple down to shape smaller systems and the people who live within them.",
  },
  // Himachal stop: rendered by himachal.js with its own HUD instead of a label.
  { id: "himachal-from-orbit", himachal: true, title: "Himachal from orbit" },
  {
    id: "dog", glyph: "🐕", glyphHeight: 2.4, pre: "Top companion", title: "My dog",
    caption: "And yes, I love my dog.",
  },
  {
    id: "gispost", glass: "/billboards/gispost.webp", pre: "Top project №3", title: "gispost",
    post: "a local-LLM pipeline that reads GIS research every morning",
  },
  {
    id: "paper-peaks", glass: "/billboards/paper-peaks.webp", pre: "Top project №2", title: "Paper Peaks",
    post: "vintage survey sheets raised into 3D terrain: old paper, new mountains",
  },
  {
    id: "makemedizzy", glass: "dizzy", pre: "Top project №1", title: "MakeMeDizzy",
    post: "a self-governing quant desk: regime detection, walk-forward tests, risk gates",
    href: "https://makemedizzy.alrightansh.com/", linkText: "Visit the desk ↗",
  },
];

export const OUTRO = { phase1: "You've seen the work", phase2: "Now let's map something" };
