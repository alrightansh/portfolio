// AI + GIS: what the MCP server is meant to do, with an honest status for each part.
// TODO(owner): update statuses as parts ship. Allowed: implemented, prototype, development, planned (see site.js STATUS).
export const PROJECT_STATUS = "development";

export const CAPABILITIES = [
  { name: "Query utility assets", text: "Find features by type, area or attribute filter.", status: "development" },
  { name: "Retrieve feature attributes", text: "Read a feature's fields and domain descriptions.", status: "development" },
  { name: "Inspect feature geometry", text: "Length, extent, vertices and coordinate system.", status: "development" },
  { name: "Run spatial queries", text: "Within, intersects and near, against any layer.", status: "development" },
  { name: "Inspect network properties", text: "Domain networks, tiers, terminals and associations.", status: "development" },
  { name: "Return structured results", text: "Typed output with IDs and layers, ready to cite.", status: "development" },
  { name: "Execute supported traces", text: "Upstream, downstream and subnetwork traces from a starting point.", status: "planned" },
  { name: "Validate network data", text: "Report dirty areas and topology errors for an extent.", status: "planned" },
  { name: "Automate repetitive tasks", text: "Chain checks and exports into one request.", status: "planned" },
];

export const PRINCIPLES = [
  { name: "Typed tools, not free text", text: "The model picks from a fixed set of operations with validated parameters, so a prompt never becomes an arbitrary query." },
  { name: "Read before write", text: "Queries and traces first. Any edit belongs in a versioned workflow, with a person approving it." },
  { name: "Answers with receipts", text: "Every result carries feature IDs and the layer it came from, so each claim can be checked on the map." },
  { name: "The caller's own permissions", text: "Calls run under the user's ArcGIS identity, never a shared account with more rights than they have." },
];
