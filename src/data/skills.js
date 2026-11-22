// Skills matrix for /work/. Tiers show how each skill has been used; there are no scores.
// TODO(owner): confirm the tiers. Professional = used in client work; projects = shown on this site.
export const TIERS = {
  pro: { label: "Professional work" },
  proj: { label: "Projects on this site" },
  work: { label: "Working knowledge" },
  explore: { label: "Exploring now" },
};

export const SKILLS = [
  { id: "egis", area: "Enterprise GIS", items: [
    ["ArcGIS Utility Network", "pro"], ["ArcGIS Pro", "pro"], ["ArcGIS Enterprise", "pro"], ["Enterprise geodatabase", "pro"],
    ["GE Smallworld, as a migration source", "pro"], ["Electric and gas (UPDM) data models", "pro"],
    ["Asset packages and network rules", "pro"], ["EAM platform integration", "pro"],
  ] },
  { id: "sdb", area: "Spatial databases", items: [
    ["PostgreSQL", "pro"], ["SQL and spatial SQL", "pro"], ["PostGIS", "pro"], ["Geometry processing", "pro"],
    ["Spatial indexing", "work"], ["Query plans and tuning", "work"],
  ] },
  { id: "auto", area: "GIS automation", items: [
    ["Python", "pro"], ["ArcPy", "pro"], ["FME Workbench", "pro"], ["ETL pipelines", "pro"],
    ["CI/CD for migration runs", "pro"], ["Geoprocessing", "pro"],
  ] },
  { id: "geo", area: "Geospatial analytics", items: [
    ["Power BI", "pro"], ["Remote sensing", "proj"], ["Raster and vector analysis", "proj"], ["DEM and terrain analysis", "proj"],
    ["Spatial modelling: RUSLE, AHP", "proj"], ["Machine learning on imagery", "proj"],
  ] },
  { id: "swe", area: "Software and delivery", items: [
    ["Team management", "pro"], ["Product development", "pro"], ["Git", "proj"], ["Docker", "proj"],
    ["three.js and WebGL", "proj"], ["REST APIs", "work"],
  ] },
  { id: "ai", area: "AI and emerging", items: [
    ["Local LLM pipelines", "proj"], ["AI-assisted development", "work"], ["MCP servers", "explore"],
    ["LLM integration with ArcGIS", "explore"], ["Agents and tool orchestration", "explore"],
  ] },
];
