// Site-wide facts and navigation for the reading pages. Only verified details belong here.
export const PERSON = {
  name: "Anshuman Choudhary",
  headline: "Geospatial engineer",
  role: "Geospatial data scientist", // the title used on the flight
  employer: "PwC",
  team: "the first Esri Platinum team",
  from: "Himachal Pradesh",
  // TODO(owner): add employment dates and any earlier GIS roles here once confirmed; nothing is shown until then.
  // TODO(owner): add a resume file to public/ and set resume: "/resume.pdf" to show a CV action.
  resume: null,
};

export const LINKS = {
  linkedin: "https://www.linkedin.com/in/alrightansh/",
  github: "https://github.com/alrightansh", // public profile; the project repositories are private
  makemedizzy: "https://makemedizzy.alrightansh.com/",
};

export const SITE = {
  url: "https://alrightansh.com",
  name: "alrightansh",
  og: "/og.jpg",
};

// Menu order. `flight` paths deep-link into the 3D flight on the home page.
export const NAV = [
  { href: "/", label: "The flight", note: "A 3D flight through the work" },
  { href: "/work/", label: "Work", note: "Overview, experience and skills" },
  { href: "/work/utility-network/", label: "Utility networks", note: "Enterprise GIS case study" },
  { href: "/work/ai/", label: "AI meets GIS", note: "MCP for ArcGIS" },
  { href: "/work/research/", label: "Research", note: "Utilities, soil, energy and hazards" },
];

// Status vocabulary for work that is not finished. Order = maturity.
export const STATUS = {
  implemented: { label: "Implemented", cls: "st-done" },
  prototype: { label: "Prototype", cls: "st-proto" },
  development: { label: "In development", cls: "st-dev" },
  planned: { label: "Planned concept", cls: "st-plan" },
};
