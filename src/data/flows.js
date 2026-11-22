// Steps for the pipeline and architecture diagrams. Generic lifecycles: no client systems, names or data.

export const MIGRATION = [
  { name: "Smallworld source", text: "Discovery: inventory the legacy object classes, attributes, joins and network topology, and agree what has to survive the move." },
  { name: "Extraction", text: "Pull features, attributes and relationships out in a way that can be re-run and reconciled, so every load traces back to source counts." },
  { name: "Data assessment", text: "Profile before mapping: completeness, duplicates, invalid geometry, orphaned records and connectivity gaps, and where the source model differs from the target." },
  { name: "Schema mapping", text: "Map each source class and field to the Utility Network model: asset groups and types, domains, terminals and network roles. The mapping is the migration's contract." },
  { name: "Transformation", text: "Translate attributes and domain values, then transform geometry: coordinate systems, snapping, splitting lines at devices, removing duplicate vertices." },
  { name: "Esri geodatabase", text: "Load feature classes into the enterprise geodatabase and rebuild source relationships as associations: containment, structural attachment and connectivity." },
  { name: "Network validation", text: "Enable the network topology, validate, and work through errors and dirty areas until every subnetwork updates and traces from its controller." },
  { name: "Target GIS", text: "Verify after loading: reconcile counts, lengths and traces against the source, then hand the network to ArcGIS Enterprise and the systems that consume it." },
];

export const FME = [
  { name: "Source data", text: "Legacy exports, delivery folders and ZIP archives, picked up in batches." },
  { name: "Reader", text: "Format readers bring features in with their schema; one workspace iterates over every file and archive." },
  { name: "Attribute mapping", text: "Rename, recode and translate values to the target schema, driven by mapping tables rather than hand edits." },
  { name: "SQLExecutor / PythonCaller", text: "SQLExecutor pushes lookups, joins and aggregates down to PostgreSQL; PythonCaller handles logic that transformers express poorly." },
  { name: "Geometry processing", text: "Reproject, snap, split, dissolve and clean geometry, including spatial overlays between layers." },
  { name: "Validation", text: "Test attributes and geometry; failures route to a review output instead of silently dropping out." },
  { name: "Writer", text: "Write to PostgreSQL and PostGIS or to the enterprise geodatabase, in transactions sized for the load." },
  { name: "PostgreSQL / Esri", text: "Tables and feature classes, ready for network loading, validation and reporting." },
];

export const REPORTING = [
  { name: "Enterprise GIS", text: "The network of record, edited in ArcGIS and validated as a Utility Network." },
  { name: "PostgreSQL", text: "The geodatabase's own database, read for reporting and never edited around ArcGIS." },
  { name: "SQL views", text: "A reporting layer: current state only, lengths measured in the database, classes such as transmission, distribution and secondary, overhead and underground." },
  { name: "Power BI", text: "A model over the views, with dynamic filters by circuit, voltage class and placement." },
  { name: "Operational insight", text: "Mileage, asset counts and data quality, on a known refresh schedule." },
];

export const MCP = [
  { name: "You", text: "Ask in plain language: which devices sit on this feeder, or what lies downstream of this switch." },
  { name: "AI assistant", text: "The language model decides which tools to call and with which parameters. It never reaches the database directly." },
  { name: "MCP client", text: "Part of the assistant's host: it discovers the server's tools and passes each call over the Model Context Protocol." },
  { name: "GIS MCP server", text: "A custom server that exposes typed GIS tools and checks every parameter before anything runs." },
  { name: "ArcGIS APIs and tools", text: "The server works through ArcGIS: its Python API, geoprocessing tools and services." },
  { name: "Utility Network", text: "Queries, network properties and supported traces run against the network itself." },
  { name: "Structured result", text: "Feature IDs, layers and counts come back as structured data the assistant can cite instead of guess." },
];
