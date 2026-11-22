// Illustrative code for the utility network case study. Generic table and column names, placeholder paths,
// no credentials: valid SQL (PostgreSQL + PostGIS) and Python (ArcPy, psycopg 3), not copied from client work.

export const MILEAGE_SQL = `
-- Overhead and underground miles per subnetwork.
-- Lengths assume a projected coordinate system in metres.
-- placement_map holds the business mapping from asset group to placement.
SELECT s.subnetwork,
       COALESCE(m.placement, 'Other') AS placement,
       ROUND((SUM(ST_Length(ST_Intersection(l.geom, s.geom))) / 1000 * 0.62)::numeric, 2) AS miles
FROM subnet_line AS s
JOIN electric_line AS l ON ST_Intersects(l.geom, s.geom)
LEFT JOIN placement_map AS m ON m.asset_group = l.asset_group
GROUP BY 1, 2
ORDER BY 1, 2;`;

export const SQL_TABS = [
  { label: "Counts", lang: "sql", code: `
-- Features per asset group, with each group's share
SELECT asset_group,
       COUNT(*) AS features,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS pct
FROM electric_device
GROUP BY asset_group
ORDER BY features DESC;` },
  { label: "Quality", lang: "sql", code: `
-- Missing values and broken geometry in one pass
SELECT COUNT(*) FILTER (WHERE asset_group IS NULL)   AS no_group,
       COUNT(*) FILTER (WHERE NOT ST_IsValid(geom))  AS invalid,
       COUNT(*) FILTER (WHERE ST_IsEmpty(geom))      AS empty,
       COUNT(*) FILTER (WHERE ST_Length(geom) < 0.1) AS stubs
FROM electric_line;

-- Exact duplicate geometries
SELECT a.objectid, b.objectid
FROM electric_line AS a
JOIN electric_line AS b
  ON a.objectid < b.objectid
 AND a.geom && b.geom
 AND ST_Equals(a.geom, b.geom);` },
  { label: "Overlay", lang: "sql", code: `
-- Devices per service area: a spatial join
SELECT a.name,
       COUNT(d.objectid) AS devices
FROM service_area AS a
LEFT JOIN electric_device AS d
  ON ST_Intersects(d.geom, a.geom)
GROUP BY a.name
ORDER BY devices DESC;` },
  { label: "Index", lang: "sql", code: `
-- A spatial index, then fresh statistics for the planner
CREATE INDEX IF NOT EXISTS electric_line_geom_idx
  ON electric_line USING GIST (geom);

ANALYZE electric_line;` },
  { label: "Plan", lang: "sql", code: `
-- Check the plan: expect an index scan on electric_line_geom_idx
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*)
FROM electric_line AS l
JOIN service_area AS a
  ON ST_Intersects(l.geom, a.geom)
WHERE a.name = 'North';` },
];

export const PY_TABS = [
  { label: "Inventory", lang: "python", code: `
import os
import arcpy

arcpy.env.workspace = r"C:\\gis\\network.gdb"  # placeholder path

# Feature classes at the root and in every feature dataset, with counts
for ds in [""] + (arcpy.ListDatasets(feature_type="Feature") or []):
    for fc in arcpy.ListFeatureClasses(feature_dataset=ds) or []:
        path = os.path.join(arcpy.env.workspace, ds, fc)
        count = int(arcpy.management.GetCount(path)[0])
        print(f"{ds or '(root)'}/{fc}: {count:,}")` },
  { label: "Fields", lang: "python", code: `
import arcpy

fc = r"C:\\gis\\network.gdb\\network\\lines"  # placeholder path

for f in arcpy.ListFields(fc):
    kind = "required" if f.required else ("nullable" if f.isNullable else "not null")
    print(f"{f.name:<32} {f.type:<12} {f.length:>5}  {kind}")` },
  { label: "Geometry", lang: "python", code: `
from collections import Counter
import arcpy

fc = r"C:\\gis\\network.gdb\\network\\lines"  # placeholder path

# Check Geometry writes one row per problem: count them by kind
table = arcpy.management.CheckGeometry(fc, r"memory\\geometry_check")[0]
problems = Counter(row[0] for row in arcpy.da.SearchCursor(table, ["PROBLEM"]))

for problem, n in problems.most_common():
    print(f"{problem:<28} {n:>8,}")` },
  { label: "Batch", lang: "python", code: `
import zipfile
from pathlib import Path
import arcpy

inbox, staging = Path(r"D:\\deliveries"), Path(r"D:\\staging")  # placeholders
gdb = staging / "load.gdb"
if not arcpy.Exists(str(gdb)):
    arcpy.management.CreateFileGDB(str(staging), gdb.name)

# Unzip each delivery and load every shapefile into one geodatabase
for archive in sorted(inbox.glob("*.zip")):
    folder = staging / archive.stem
    with zipfile.ZipFile(archive) as z:
        z.extractall(folder)
    for shp in folder.rglob("*.shp"):
        name = arcpy.ValidateTableName(f"{archive.stem}_{shp.stem}", str(gdb))
        arcpy.conversion.ExportFeatures(str(shp), str(gdb / name))` },
  { label: "PostGIS", lang: "python", code: `
import csv
import os
import psycopg

QUERY = """
    SELECT subnetwork, placement, miles
    FROM reporting.line_miles  -- a reporting view
    ORDER BY subnetwork, placement
"""

# Connection details come from the environment, never from code
with psycopg.connect(os.environ["PG_DSN"]) as conn, open("line_miles.csv", "w", newline="") as out:
    cur = conn.execute(QUERY)
    writer = csv.writer(out)
    writer.writerow([col.name for col in cur.description])
    writer.writerows(cur)` },
];
