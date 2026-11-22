# Builds public/lidar/ for the portfolio's LiDAR stop: a block of Wierden (Overijssel) from the 2025 AHN6 airborne
# LiDAR survey, the high-voltage lines over it and the open sewer network beneath it.
#
# Points: AHN6 COPC tiles (Het Waterschapshuis; attribution required), downloaded once into the cache and read for
#   the box: true colour, GPS time, flight line and AHN's classes (1 unclassified, 2 ground, 6 building, 9 water,
#   14 wire conductor, 26 civil structure).
# Ground: a 1 m terrain grid from the ground points, gaps filled from the nearest ground cell, and each point's
#   height above it.
# Power lines: OpenStreetMap's routes and towers (ODbL) give the spans. AHN puts pylons in the conductor class too,
#   so conductor returns round an OSM tower are the tower. Per span the rest split into chains of nearby points
#   that join into wires, each fitted with a parabola: its sag, and the clearance to the nearest trees and roofs.
# Sewers: the municipality's GWSW pipes, pumps and overflow chambers from PDOK (CC0), and the nearest treatment
#   plant from the water boards' data. Gravity pipes lie at their invert levels (NAP); pressure mains carry no
#   levels, so they lie at a nominal depth. Each pipe is turned to run the way its water flows (see orient()). All
#   clipped to the box.
# Export: points thinned on a voxel grid (every wire and tower point kept for desktops) and quantised, in GPS-time
#   order so the stop can replay the scan.
#
# Usage: python -I tools/lidar/build_lidar.py <cache_dir>    (the cache, about 300 MB a tile, stays outside the repo)
# Needs numpy, scipy, laspy[lazrs], requests and pyproj.
#
# Output, little endian:
#   li-points-v1.bin, li-points-sm-v1.bin (phones): N points in GPS-time order as u16 x[N], y[N], z[N] (0..65535
#     across meta.size and meta.z), u8 code[N] (class in bits 0-2, see CLASSES; distance to the nearest fitted wire
#     in bits 3-7, in meta.band steps, 31 = further), u8 r[N], g[N], b[N].
#   li-meta-v1.json: see write_meta(). Positions are metres east and north of the box's south-west corner; heights
#     are metres above NAP.
import datetime
import json
import math
import pathlib
import sys
import time

import laspy
import numpy as np
import requests
from pyproj import Transformer
from scipy import ndimage
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "public/lidar"
V = "v1"
SITE = "Wierden"
BOX = (237200.0, 487450.0, 238200.0, 488200.0)  # RD New (EPSG:28992): west, south, east, north
TAG = "_".join(str(int(v)) for v in BOX)  # cached answers belong to one box
TILE_URL = "https://basisdata.nl/hwh-ahn/AHN6/01_LAZ/AHN6_2025_C_{x}_{y}.COPC.LAZ"
OVERPASS = "https://overpass-api.de/api/interpreter"
PDOK = "https://api.pdok.nl/rioned/beheer-stedelijk-watersystemen-gwsw/ogc/v1/collections/{c}/items"
PDOK_WS = "https://api.pdok.nl/rioned/waterschappen-waterketen-gwsw/ogc/v1/collections/{c}/items"
RD_CRS = "http://www.opengis.net/def/crs/EPSG/0/28992"
UA = {"User-Agent": "portfolio-lidar-build"}
TO_RD = Transformer.from_crs(4326, 28992, always_xy=True)
TO_LL = Transformer.from_crs(28992, 4326, always_xy=True)
GPS_EPOCH = datetime.datetime(1980, 1, 6, tzinfo=datetime.timezone.utc)

CELL = 1.0             # terrain grid, metres
COARSE = 10.0          # terrain grid written to the meta, metres
TALL = 2.5             # unclassified points this high above ground count as trees (or other tall things)
AHN_WIRE = 14          # AHN's class for returns off conductors
CORRIDOR = 24.0        # half-width of a line's corridor, metres
TOWER_R = 12.0         # conductor-class points this close (horizontally) to an OSM tower are the tower itself
TOWER_CLEAR = 25.0     # clearances skip this far round a tower, where cross-arms and insulators meet the wires
CHAIN_R = 2.0          # wire hits closer than this join one chain
SPAN_MAX = 600.0       # consecutive towers further apart than this are not one span
NEAR_TREE = 5.0        # tree points within this distance of a wire are counted
STRAYS = 25            # the nearest tree points ignored by the clearance (insulators, spacers, birds)
BAND = 0.5             # distance-to-wire steps in the point code, metres
FLAT = 0.02            # gravity pipes falling less than this end to end count as flat, metres
PRESSURE_DEPTH = 1.2   # pressure mains carry no levels: drawn this far below the terrain, metres
PUMP_R = 15.0          # pipe ends this close to a pump or overflow chamber belong to it, metres
PRESS_GAP = 10.0       # pressure-main ends this close join (the data breaks mains at their valve chambers), metres
PAD = 300.0            # pipes and pumps are fetched this far beyond the box, so edge networks can be followed
TARGET = 900_000       # points kept for desktops
TARGET_SM = 300_000    # and for phones
CLASSES = {"ground": 0, "building": 1, "tree": 2, "low": 3, "wire": 4, "tower": 5, "water": 6, "civil": 7}
GRAVITY = ("foul", "combined", "storm")
NETWORK = {"foul": "foul", "combined": "foul", "storm": "storm", "pressure": "pressure", "overflow": "overflow"}
PIPE_KIND = {"Vuilwaterriool": "foul", "GemengdRiool": "combined", "Hemelwaterriool": "storm",
             "Infiltratieriool": "storm", "Persleiding": "pressure", "Overstortleiding": "overflow"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def get(url, retries=5, **kw):
    """GET (or POST, given data=) with exponential backoff: public servers answer 429/502/504 under load."""
    method = requests.post if "data" in kw else requests.get
    for attempt in range(retries):
        try:
            r = method(url, timeout=180, headers=UA, **kw)
            if r.ok:
                return r
            log("HTTP", r.status_code, url[:90])
        except requests.RequestException as e:
            log("error", str(e)[:90])
        time.sleep(10 * 2 ** attempt)
    raise RuntimeError(f"{url}: no answer after {retries} tries")


def cached_json(path, fetch):
    if path.exists():
        return json.loads(path.read_text("utf-8"))
    data = fetch()
    path.write_text(json.dumps(data), "utf-8")
    return data


def rel(xy, nd=1):
    return [round(float(xy[0]) - BOX[0], nd), round(float(xy[1]) - BOX[1], nd)]


def inside(xy):
    return BOX[0] <= xy[0] <= BOX[2] and BOX[1] <= xy[1] <= BOX[3]


# ---------------- points ----------------

def download(url, path):
    """Downloads url to path once, resuming a partial file."""
    head = requests.head(url, allow_redirects=True, timeout=60, headers=UA)
    head.raise_for_status()
    size = int(head.headers["content-length"])
    have = path.stat().st_size if path.exists() else 0
    if have == size:
        return
    have = have if have < size else 0  # a file larger than the tile is damaged: start over
    log("downloading", url.rsplit("/", 1)[1], f"{size / 1e6:.0f} MB", f"from {have / 1e6:.0f} MB")
    with requests.get(url, headers={**UA, "Range": f"bytes={have}-"}, stream=True, timeout=300) as r:
        r.raise_for_status()
        # a server that ignores the range sends the whole file, so the partial one is replaced
        with open(path, "ab" if have and r.status_code == 206 else "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    if path.stat().st_size != size:
        raise RuntimeError(f"{path}: incomplete download")


def read_points(cache):
    parts = []
    for tx in range(int(BOX[0] // 1000 * 1000), int(math.ceil(BOX[2] / 1000) * 1000), 1000):
        for ty in range(int(BOX[1] // 1000 * 1000), int(math.ceil(BOX[3] / 1000) * 1000), 1000):
            path = cache / f"AHN6_C_{tx}_{ty}.copc.laz"
            download(TILE_URL.format(x=tx, y=ty), path)
            with laspy.CopcReader.open(str(path)) as r:
                p = r.query(laspy.Bounds(np.array(BOX[:2]), np.array(BOX[2:])))
            parts.append({"x": np.asarray(p.x), "y": np.asarray(p.y), "z": np.asarray(p.z),
                          "cls": np.asarray(p.classification).astype(np.uint8), "t": np.asarray(p.gps_time),
                          "src": np.asarray(p.point_source_id),
                          "rgb": np.stack([np.asarray(p.red), np.asarray(p.green), np.asarray(p.blue)], 1)})
            log(f"tile {tx}_{ty}: {len(p)} points in the box")
    P = {k: np.concatenate([q[k] for q in parts]) for k in parts[0]}
    keep = (P["x"] >= BOX[0]) & (P["x"] < BOX[2]) & (P["y"] >= BOX[1]) & (P["y"] < BOX[3])
    P = {k: v[keep] for k, v in P.items()}
    if P["rgb"].max() > 255:  # 16-bit colour
        P["rgb"] = P["rgb"] >> 8
    return P


def scan_of(P):
    """Flight lines over the box, the minutes spent scanning it (summed per line, as lines may be days apart) and
    the flight dates."""
    lines, secs, dates = np.unique(P["src"]), 0.0, set()
    for s in lines:
        t = P["t"][P["src"] == s]
        secs += float(t.max() - t.min())
        dates.add((GPS_EPOCH + datetime.timedelta(seconds=float(t.min()) + 1e9)).date().isoformat())
    plausible = all("2024" <= d[:4] <= "2026" for d in dates)  # adjusted standard GPS time, as LAS 1.4 requires
    return {"lines": int(len(lines)), "minutes": round(secs / 60, 1), "dates": sorted(dates) if plausible else []}


# ---------------- ground ----------------

def cell_of(x, y, w, h, size):
    ix = np.clip(((x - BOX[0]) / size).astype(int), 0, w - 1)
    iy = np.clip(((BOX[3] - y) / size).astype(int), 0, h - 1)
    return iy * w + ix


def terrain(P):
    """1 m grid (row 0 north) of mean ground height, gaps filled from the nearest ground cell."""
    w, h = int(round((BOX[2] - BOX[0]) / CELL)), int(round((BOX[3] - BOX[1]) / CELL))
    g = P["cls"] == 2
    cell = cell_of(P["x"][g], P["y"][g], w, h, CELL)
    n = np.bincount(cell, minlength=w * h)
    s = np.bincount(cell, weights=P["z"][g], minlength=w * h)
    dtm = np.where(n > 0, s / np.maximum(n, 1), np.nan).reshape(h, w)
    idx = ndimage.distance_transform_edt(np.isnan(dtm), return_distances=False, return_indices=True)
    return dtm[tuple(idx)]


def sample(grid, x, y):
    """Bilinear lookup in a CELL grid whose cell centres sit half a cell in from the box edge (clamped outside)."""
    h, w = grid.shape
    fx, fy = (x - BOX[0]) / CELL - 0.5, (BOX[3] - y) / CELL - 0.5
    ix, iy = np.clip(np.floor(fx).astype(int), 0, w - 2), np.clip(np.floor(fy).astype(int), 0, h - 2)
    tx, ty = np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)
    top = grid[iy, ix] * (1 - tx) + grid[iy, ix + 1] * tx
    bottom = grid[iy + 1, ix] * (1 - tx) + grid[iy + 1, ix + 1] * tx
    return top * (1 - ty) + bottom * ty


def coarse(dtm):
    """The terrain on the COARSE grid (row 0 north)."""
    k = int(round(COARSE / CELL))
    h, w = dtm.shape[0] // k, dtm.shape[1] // k
    return w, h, dtm[: h * k, : w * k].reshape(h, k, w, k).mean(axis=(1, 3))


# ---------------- power lines ----------------

def kv_of(tags):
    v = str(tags.get("voltage", "")).split(";")[0]
    return int(v) // 1000 if v.isdigit() else 0


def osm_line(cache):
    """Power-line ways near the box (OSM), with their towers, in RD metres."""
    (w, s), (e, n) = TO_LL.transform(BOX[0] - 400, BOX[1] - 400), TO_LL.transform(BOX[2] + 400, BOX[3] + 400)
    q = f"[out:json][timeout:120];way[power=line]({s},{w},{n},{e});(._;>;);out body;"
    data = cached_json(cache / f"osm_line_{TAG}.json", lambda: get(OVERPASS, data={"data": q}).json())
    nodes = {el["id"]: el for el in data["elements"] if el["type"] == "node"}
    ways = []
    for el in data["elements"]:
        if el["type"] != "way":
            continue
        xy = np.array([TO_RD.transform(nodes[i]["lon"], nodes[i]["lat"]) for i in el["nodes"]])
        towers = [k for k, i in enumerate(el["nodes"]) if nodes[i].get("tags", {}).get("power") in ("tower", "pole")]
        ways.append({"id": el["id"], "tags": el.get("tags", {}), "xy": xy, "towers": towers, "ids": el["nodes"]})
    return ways


def towers_of(ways):
    """Tower positions (RD) and line voltage, keyed by OSM node id."""
    return {w["ids"][k]: (w["xy"][k], kv_of(w["tags"])) for w in ways for k in w["towers"]}


def tower_distance(P, tower_xy):
    """Each point's horizontal distance to the nearest OSM tower, up to TOWER_CLEAR (inf beyond)."""
    if not tower_xy:
        return np.full(len(P["x"]), np.inf)
    at = np.array([xy for xy, _ in tower_xy.values()])
    return cKDTree(at).query(np.c_[P["x"], P["y"]], distance_upper_bound=TOWER_CLEAR)[0]


def spans(ways):
    """Consecutive tower pairs along each way, once each: (A, B, kV) in RD."""
    out, seen = [], set()
    for w in ways:
        for a, b in zip(w["towers"], w["towers"][1:]):
            key = tuple(sorted((w["ids"][a], w["ids"][b])))
            A, B = w["xy"][a], w["xy"][b]
            if key not in seen and np.hypot(*(B - A)) <= SPAN_MAX:
                seen.add(key)
                out.append((A, B, kv_of(w["tags"])))
    return out


def chains(xyz):
    """Labels of connected chains of points closer than CHAIN_R."""
    n = len(xyz)
    pairs = cKDTree(xyz).query_pairs(CHAIN_R, output_type="ndarray")
    g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n)) if len(pairs) else coo_matrix((n, n))
    return connected_components(g, directed=False)[1]


def fit_span(A, B, pts):
    """Wires across one span. Chains of hits, largest first, join a wire they agree with or, when long enough,
    start one; a wire is a parabola z(s) and a straight offset t(s) along the span."""
    L = float(np.hypot(*(B - A)))
    u = (B - A) / L
    nrm = np.array([-u[1], u[0]])
    s = (pts[:, 0] - A[0]) * u[0] + (pts[:, 1] - A[1]) * u[1]
    t = (pts[:, 0] - A[0]) * nrm[0] + (pts[:, 1] - A[1]) * nrm[1]
    near = (s > 0) & (s < L) & (np.abs(t) < CORRIDOR)
    s, t, z = s[near], t[near], pts[near, 2]
    if len(s) < 20:
        return []
    labels = chains(pts[near])
    order = np.argsort(labels, kind="stable")
    groups = np.split(order, np.flatnonzero(np.diff(labels[order])) + 1)

    def agrees(w, g):
        return (np.median(np.abs(np.polyval(w["pz"], s[g]) - z[g])) < 0.5
                and np.median(np.abs(np.polyval(w["pt"], s[g]) - t[g])) < 0.7)

    wires = []
    for g in sorted((g for g in groups if len(g) >= 3), key=len, reverse=True):
        w = next((w for w in wires if agrees(w, g)), None)
        if w is not None:
            w["idx"] = np.r_[w["idx"], g]
        elif len(g) >= 12 and np.ptp(s[g]) > 0.15 * L:
            w = {"idx": g}
            wires.append(w)
        else:
            continue
        w["pz"], w["pt"] = np.polyfit(s[w["idx"]], z[w["idx"]], 2), np.polyfit(s[w["idx"]], t[w["idx"]], 1)
    out = []
    for w in wires:
        cover = float(np.ptp(s[w["idx"]]) / L)
        if len(w["idx"]) < 30 or cover < 0.35 or w["pz"][0] <= 0:  # too little of it, or not hanging
            continue
        ss = np.linspace(0, L, 25)
        zz, tt = np.polyval(w["pz"], ss), np.polyval(w["pt"], ss)
        chord = zz[0] + (zz[-1] - zz[0]) * ss / L
        xy = A + np.outer(ss, u) + np.outer(tt, nrm)
        out.append({"pts": np.c_[xy, zz], "sag": float(np.max(chord - zz)), "hits": int(len(w["idx"])), "cover": cover})
    return out


def densify(wires, step=0.5):
    """Points every `step` metres along the fitted wires."""
    out = [np.zeros((0, 3))]
    for w in wires:
        p = w["pts"]
        run = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
        q = np.arange(0, run[-1], step)
        out.append(np.stack([np.interp(q, run, p[:, k]) for k in range(3)], 1))
    return np.concatenate(out)


def clearance(dense, P, cls, away):
    """Clearance from the fitted wires to the nearest tree point and roof point (ignoring STRAYS stray points) away
    from the towers, where that tree point is, and the tree points within NEAR_TREE."""
    if not len(dense):
        return {}
    tree, res = cKDTree(dense), {}
    for name in ("tree", "building"):
        m = np.flatnonzero((cls == CLASSES[name]) & away)
        d, _ = tree.query(np.c_[P["x"][m], P["y"][m], P["z"][m]], distance_upper_bound=60)
        order = np.argsort(d)
        d = d[order][np.isfinite(d[order])]
        if len(d) > STRAYS:
            res[name] = round(float(d[STRAYS]), 1)
            log(name, "nearest distances to a wire:", np.round(d[:12], 1).tolist())
            if name == "tree":
                k = m[order[STRAYS]]
                res["treeAt"] = rel((P["x"][k], P["y"][k])) + [round(float(P["z"][k]), 1)]
        if name == "tree":
            res["treePointsNear"] = int((d < NEAR_TREE).sum())
    return res


def tower_tops(P, cls, tower_xy):
    """Towers inside the box: position, top (NAP) and line voltage."""
    out = []
    for (x, y), kv in tower_xy.values():
        if inside((x, y)):
            m = (cls == CLASSES["tower"]) & (np.hypot(P["x"] - x, P["y"] - y) < TOWER_R)
            out.append(rel((x, y)) + [round(float(P["z"][m].max()), 1) if m.any() else None, kv])
    return out


def power_meta(P, cls, ways, tower_xy, fitted, clear):
    towers = tower_tops(P, cls, tower_xy)
    shown = {f["kv"] for f in fitted} | {t[3] for t in towers}
    lines = {}
    for w in ways:
        kv, t = kv_of(w["tags"]), w["tags"]
        if kv in shown:
            lines.setdefault(kv, {"kv": kv, "name": t.get("name", ""), "cables": t.get("cables", ""), "wires": t.get("wires", "")})
    wires = []
    for f in fitted:  # the part over the box; "full": the whole span is over it
        part = max(clip(f["pts"]), key=len, default=None)
        if part is not None:
            wires.append({"kv": f["kv"], "sag": round(f["sag"], 2), "full": bool(inside(f["pts"][0]) and inside(f["pts"][-1])),
                          "pts": [rel(p[:2]) + [round(float(p[2]), 2)] for p in part]})
    return {"lines": sorted(lines.values(), key=lambda l: -l["kv"]), "towers": towers, "wires": wires, "clearance": clear}


# ---------------- sewers ----------------

def pdok(collection, cache, base=PDOK, pad=0.0):
    """All features of a PDOK OGC API collection in the (padded) box, in RD, cached."""
    def fetch():
        url = base.format(c=collection)
        b = (BOX[0] - pad, BOX[1] - pad, BOX[2] + pad, BOX[3] + pad)
        params = {"f": "json", "limit": 1000, "bbox": ",".join(map(str, b)), "bbox-crs": RD_CRS, "crs": RD_CRS}
        feats = []
        while url:
            page = get(url, params=params).json()
            feats += page.get("features", [])
            url, params = next((l["href"] for l in page.get("links", []) if l.get("rel") == "next"), None), None
        return feats
    return cached_json(cache / f"pdok_{collection}_{TAG}_{int(pad)}.json", fetch)


def coords(c):
    """Every position in a GeoJSON coordinate array, as [x, y]."""
    return [c[:2]] if not isinstance(c[0], list) else [p for q in c for p in coords(q)]


def lines_of(geom):
    if not geom:
        return []
    return geom["coordinates"] if geom["type"] == "MultiLineString" else [geom["coordinates"]]


def points_of(feats, *keys):
    """Point features (single or multi) as {xy, kind, **keys}."""
    return [{"xy": coords(f["geometry"]["coordinates"])[0], "kind": str(f["properties"].get("type", "")).rsplit("/", 1)[-1],
             **{k: f["properties"].get(k) for k in keys}} for f in feats if f.get("geometry")]


def pipes(feats, dtm):
    """Pipes as polylines of (x, y, z) with kind and width (mm). Gravity pipes lie at their invert levels; pressure
    mains carry none, so they lie PRESSURE_DEPTH below the terrain."""
    out = []
    for f in feats:
        p = f["properties"]
        kind = PIPE_KIND.get(str(p.get("type", "")).rsplit("/", 1)[-1])
        zb, ze = p.get("bob_beginpunt_leiding"), p.get("bob_eindpunt_leiding")
        nominal = zb is None or ze is None
        if kind is None or (nominal and kind != "pressure"):
            continue
        for line in lines_of(f.get("geometry")):
            xy = np.array([c[:2] for c in line], float)
            if len(xy) < 2:
                continue
            if nominal:
                z = sample(dtm, xy[:, 0], xy[:, 1]) - PRESSURE_DEPTH
            else:
                run = np.r_[0, np.cumsum(np.hypot(*np.diff(xy, axis=0).T))]
                z = zb + (ze - zb) * run / max(run[-1], 1e-6)
            out.append({"k": kind, "d": p.get("breedte_leiding") or 0, "xyz": np.c_[xy, z]})
    return out


def orient(net, pumps, chambers, plant_xy):
    """Turns each pipe to run the way its water flows ("by_network": its direction comes from the network, not its
    own fall). Pipe ends join only within one network (foul with combined, storm, pressure, overflow): the foul and
    storm sewers under a street share manhole positions but not water. Foul water runs along the network to its
    system's pump. A foul system without one, and each storm system, runs down its invert levels, flat pipes along
    the network, to the system's lowest ends. Pressure mains, joined across the gaps at their valve chambers, run
    along the network to their system's loose end nearest the treatment plant. Overflow pipes run away from their
    overflow chamber."""
    index = {}
    ends = np.array([[index.setdefault((NETWORK[p["k"]], *np.round(p["xyz"][i, :2], 2)), len(index)) for i in (0, -1)]
                     for p in net])
    n = len(index)
    xy = np.array([k[1:] for k in index])
    nets = np.array([k[0] for k in index])
    pr = np.flatnonzero(nets == "pressure")
    if len(pr) > 1:
        pairs = pr[cKDTree(xy[pr]).query_pairs(PRESS_GAP, output_type="ndarray")]
        ends = connected_components(coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n)), directed=False)[1][ends]
    length = np.array([np.hypot(*np.diff(p["xyz"][:, :2], axis=0).T).sum() for p in net]) + 1e-3
    kinds = np.array([NETWORK[p["k"]] for p in net])
    zs = np.array([(p["xyz"][0, 2], p["xyz"][-1, 2]) for p in net])
    node_xy = np.zeros((n, 2))
    node_xy[ends.ravel()] = np.array([p["xyz"][i, :2] for p in net for i in (0, -1)])

    def graph(m):
        return coo_matrix((length[m], (ends[m, 0], ends[m, 1])), shape=(n, n))

    def distance(m, sources):
        """Network distance from `sources` over the pipes in mask m."""
        if not len(sources):
            return np.full(n, np.inf)
        return dijkstra(graph(m), directed=False, indices=sorted(sources), min_only=True)

    def near(m, points):
        """Nodes of the pipes in mask m within PUMP_R of any of the points."""
        mine = np.unique(ends[m])
        return {int(mine[j]) for h in cKDTree(node_xy[mine]).query_ball_point(np.array(points, float).reshape(-1, 2), PUMP_R) for j in h} \
            if points and len(mine) else set()

    d = np.full(n, np.inf)
    for kind in ("foul", "storm"):
        m = kinds == kind
        low = np.full(n, np.inf)
        np.minimum.at(low, ends[m].ravel(), zs[m].ravel())
        comp = connected_components(graph(m), directed=False)[1]
        pumped = near(m, [q["xy"] for q in pumps]) if kind == "foul" else set()
        sinks = set(pumped)
        for c in np.unique(comp[np.isfinite(low)]):
            members = np.flatnonzero((comp == c) & np.isfinite(low))
            if not sinks.intersection(members.tolist()):  # no pump: the system drains to its lowest ends
                sinks.update(members[low[members] <= low[members].min() + FLAT].tolist())
        d = np.minimum(d, distance(m, sinks))
        pumped_comps = {comp[i] for i in pumped}
        for i in np.flatnonzero(m):
            a, b = ends[i]
            drop = zs[i, 0] - zs[i, 1]
            net[i]["by_network"] = bool(comp[a] in pumped_comps or abs(drop) < FLAT)
            reverse = d[a] < d[b] if net[i]["by_network"] else drop < 0
            if reverse:
                net[i]["xyz"] = net[i]["xyz"][::-1]
    m = kinds == "pressure"
    deg = np.bincount(ends[m].ravel(), minlength=n)
    comp = connected_components(graph(m), directed=False)[1]
    loose = np.flatnonzero(deg == 1)
    outlets = {loose[comp[loose] == c][np.argmin(np.hypot(*(node_xy[loose[comp[loose] == c]] - plant_xy).T))]
               for c in np.unique(comp[loose])} if plant_xy is not None else set()
    d_pressure = distance(m, outlets)
    d_overflow = distance(kinds == "overflow", near(kinds == "overflow", [q["xy"] for q in chambers]))
    for i in np.flatnonzero(~np.isin(kinds, ("foul", "storm"))):
        a, b = ends[i]
        net[i]["by_network"] = True
        reverse = d_pressure[a] < d_pressure[b] if kinds[i] == "pressure" else d_overflow[a] > d_overflow[b]
        if reverse:
            net[i]["xyz"] = net[i]["xyz"][::-1]
    return net


def clip(xyz):
    """The parts of a polyline inside the box, cut where it crosses the edge (Liang-Barsky per segment)."""
    parts, cur = [], []
    for p, q in zip(xyz[:-1], xyz[1:]):
        d, t0, t1 = q - p, 0.0, 1.0
        for dk, pk, lo, hi in ((d[0], p[0], BOX[0], BOX[2]), (d[1], p[1], BOX[1], BOX[3])):
            if abs(dk) < 1e-12:
                if not lo <= pk <= hi:
                    t0, t1 = 1.0, 0.0
                continue
            a, b = (lo - pk) / dk, (hi - pk) / dk
            t0, t1 = max(t0, min(a, b)), min(t1, max(a, b))
        if t0 >= t1:
            continue
        a, b = p + t0 * d, p + t1 * d
        if cur and np.allclose(cur[-1], a):
            cur.append(b)
        else:
            if len(cur) > 1:
                parts.append(np.array(cur))
            cur = [a, b]
    if len(cur) > 1:
        parts.append(np.array(cur))
    return parts


def shafts(net, dtm):
    """Manholes: gravity pipe ends inside the box, from the terrain down to the lowest invert there."""
    low = {}
    for p in net:
        if p["k"] in GRAVITY:
            for c in (p["xyz"][0], p["xyz"][-1]):
                key = (round(float(c[0]), 2), round(float(c[1]), 2))
                low[key] = min(low.get(key, math.inf), float(c[2]))
    keys = [k for k in low if inside(k)]
    if not keys:
        return []
    ground = sample(dtm, np.array([k[0] for k in keys]), np.array([k[1] for k in keys]))
    return [rel(k) + [round(float(g), 2), round(low[k], 2)] for k, g in zip(keys, ground)]


def nearest_plant(cache):
    """The wastewater treatment plant (water board data) nearest the box: {name, distance (km) and unit bearing from
    the box's centre} and its position (RD), or (None, None)."""
    mid = np.array([(BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2])
    best = None
    for f in pdok("waterschap_rwzi", cache, base=PDOK_WS, pad=30_000):
        if f.get("geometry"):
            xy = np.mean(coords(f["geometry"]["coordinates"]), axis=0)
            if best is None or np.hypot(*(xy - mid)) < np.hypot(*(best[1] - mid)):
                best = (f["properties"], xy)
    if best is None:
        return None, None
    log("plant properties:", {k: v for k, v in best[0].items() if isinstance(v, (str, int, float))})
    v = best[1] - mid
    d = float(np.hypot(*v))
    name = str(best[0].get("naam") or "")
    name = name.split(") ", 1)[-1] if name.startswith("(") else name  # "(NL.WBHCODE.44.Rwzi.3) Almelo-Vissedijk"
    return {"name": name, "km": round(d / 1000, 1), "dir": [round(float(c) / d, 3) for c in v]}, best[1]


def on_edge(xy):
    return min(abs(xy[0] - BOX[0]), abs(xy[0] - BOX[2]), abs(xy[1] - BOX[1]), abs(xy[1] - BOX[3])) < 0.01


def sewer_meta(net, pumps, chambers, plant, plant_xy, dtm):
    out, km, exits = [], {}, []
    for p in net:
        for part in clip(p["xyz"]):
            run = float(np.hypot(*np.diff(part[:, :2], axis=0).T).sum())
            if run < 1.0:
                continue
            km[p["k"]] = km.get(p["k"], 0) + run / 1000
            if p["k"] == "pressure" and on_edge(part[-1]):
                exits.append(part[-1, :2])
            depth = sample(dtm, part[:, 0], part[:, 1]) - part[:, 2]
            out.append({"k": p["k"], "d": p["d"],
                        "pts": [rel(c[:2], 2) + [round(float(c[2]), 2), round(float(dd), 2)] for c, dd in zip(part, depth)]})
    if plant and exits:  # where the main towards the plant leaves the box
        plant = dict(plant, exit=rel(min(exits, key=lambda e: np.hypot(*(e - plant_xy)))))
    return {"pipes": out, "manholes": shafts(net, dtm),
            "pumps": [rel(q["xy"]) + [q["naam"] or "", q["kind"], q["pompcapaciteit1"] or 0] for q in pumps if inside(q["xy"])],
            "outfalls": [rel(q["xy"]) + [q["naam"] or "", q["drempelniveau"]] for q in chambers if inside(q["xy"])],
            "km": {k: round(v, 2) for k, v in km.items()}, "plant": plant}


# ---------------- export ----------------

def classify(P, hag, wire, tower):
    cls = np.full(len(hag), CLASSES["low"], np.uint8)
    cls[(P["cls"] == 1) & (hag >= TALL)] = CLASSES["tree"]
    for ahn, name in ((2, "ground"), (6, "building"), (9, "water"), (26, "civil")):
        cls[P["cls"] == ahn] = CLASSES[name]
    cls[tower] = CLASSES["tower"]
    cls[wire] = CLASSES["wire"]
    return cls


def voxel_keys(xyz, size):
    v = np.floor(xyz / size).astype(np.int64)
    return v[:, 0] + v[:, 1] * 100_000 + v[:, 2] * 10_000_000_000


def thin(P, keep, target, seed=7):
    """One point per voxel, the voxel sized so about `target` remain, plus any `keep` points. GPS-time order."""
    order = np.random.default_rng(seed).permutation(len(P["x"]))
    xyz = np.c_[P["x"][order] - BOX[0], P["y"][order] - BOX[1], P["z"][order] - P["z"].min()]
    lo, hi = 0.05, 5.0
    for _ in range(10):  # bisection in log size: the voxel within 1% of the size that keeps `target`
        size = math.sqrt(lo * hi)
        lo, hi = (size, hi) if len(np.unique(voxel_keys(xyz, size))) > target else (lo, size)
    _, first = np.unique(voxel_keys(xyz, hi), return_index=True)
    chosen = order[first] if keep is None else np.union1d(order[first], np.flatnonzero(keep))
    return chosen[np.argsort(P["t"][chosen], kind="stable")], hi


def codes(P, idx, cls, dense, away):
    """Class (bits 0-2) and distance band to the nearest fitted wire (bits 3-7, away from the towers) of the kept
    points."""
    band = np.full(len(idx), 31)
    if len(dense):
        d, _ = cKDTree(dense).query(np.c_[P["x"][idx], P["y"][idx], P["z"][idx]], distance_upper_bound=31 * BAND)
        band = np.where(away[idx], np.minimum(31, np.floor(d / BAND)), 31).astype(int)
    return (cls[idx].astype(int) | (band << 3)).astype("u1")


def write_points(path, P, idx, code, zr):
    size = (BOX[2] - BOX[0], BOX[3] - BOX[1])
    q = lambda v, lo, span: np.clip(np.round((v - lo) / span * 65535), 0, 65535).astype("<u2")
    parts = [q(P["x"][idx], BOX[0], size[0]), q(P["y"][idx], BOX[1], size[1]), q(P["z"][idx], zr[0], zr[1] - zr[0]),
             code, *(P["rgb"][idx, k].astype("u1") for k in range(3))]
    path.write_bytes(b"".join(p.tobytes() for p in parts))


def write_meta(P, cls, dtm, zr, n, voxel, power, sewers):
    """li-meta: site, box (RD), size [w, h] m, z [lo, hi] (NAP) of the u16 heights, n / nSm points, voxel / voxelSm
    (m, their thinning), band (m), counts per class and points (all points read), density per m², scan {lines,
    minutes, dates}, grid {w, h, cell, ground[]} (row 0 north), power {lines [{kv, name, cables, wires}], towers
    [[x, y, z top, kV]], wires [{kv, sag, full, pts [[x, y, z]]}] (the part over the box; full: the whole span),
    clearance {tree, treeAt [x, y, z], building, treePointsNear}}, sewers {pipes [{k, d (mm), pts [[x, y, z,
    depth]]}] (each running the way its water flows), manholes [[x, y, z ground, z bottom]], pumps [[x, y, name, type,
    m³/h]], outfalls [[x, y, name, crest NAP]], km {kind: length}, plant {name, km, dir, exit [x, y] where the main
    towards it leaves the box}}."""
    w, h, ground = coarse(dtm)
    area = (BOX[2] - BOX[0]) * (BOX[3] - BOX[1])
    meta = {
        "site": SITE, "box": list(BOX), "size": [BOX[2] - BOX[0], BOX[3] - BOX[1]], "z": list(zr), "n": n[0], "nSm": n[1],
        "voxel": round(voxel[0], 2), "voxelSm": round(voxel[1], 2), "band": BAND, "counts": {k: int((cls == v).sum()) for k, v in CLASSES.items()}, "points": int(len(cls)),
        "density": round(len(cls) / area, 1), "scan": scan_of(P),
        "grid": {"w": w, "h": h, "cell": COARSE, "ground": np.round(ground, 2).ravel().tolist()},
        "power": power, "sewers": sewers,
    }
    (OUT / f"li-meta-{V}.json").write_text(json.dumps(meta, separators=(",", ":")), "utf-8")
    log("meta:", json.dumps({k: meta[k] for k in ("n", "nSm", "counts", "density", "scan")}),
        json.dumps({"towers": power["towers"], "wires": len(power["wires"]), "clearance": power["clearance"],
                    "km": sewers["km"], "pumps": sewers["pumps"], "plant": sewers["plant"]}))


def main(cache):
    cache.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    P = read_points(cache)
    log(len(P["x"]), "points,", f"{len(P['x']) / ((BOX[2] - BOX[0]) * (BOX[3] - BOX[1])):.1f} per m²")
    dtm = terrain(P)
    hag = P["z"] - sample(dtm, P["x"], P["y"])

    ways = [w for w in osm_line(cache) if kv_of(w["tags"]) >= 50]
    tower_xy = towers_of(ways)
    td = tower_distance(P, tower_xy)
    tower, away = (P["cls"] == AHN_WIRE) & (td < TOWER_R), ~np.isfinite(td)
    wire = (P["cls"] == AHN_WIRE) & ~tower
    log(int(wire.sum()), "conductor returns,", int(tower.sum()), "tower points,", len(tower_xy), "towers")
    cls = classify(P, hag, wire, tower)
    wpts = np.c_[P["x"][wire], P["y"][wire], P["z"][wire]]
    fitted = [dict(w, kv=kv) for A, B, kv in spans(ways) for w in fit_span(A, B, wpts)]
    log(len(fitted), "wires fitted (kV, sag, hits, cover):",
        [(f["kv"], round(f["sag"], 1), f["hits"], round(f["cover"], 2)) for f in fitted])
    dense = densify(fitted)
    power = power_meta(P, cls, ways, tower_xy, fitted, clearance(dense, P, cls, away))

    pumps = points_of(pdok("beheerpomp", cache, pad=PAD), "naam", "pompcapaciteit1")
    chambers = points_of(pdok("beheerlozing", cache, pad=PAD), "naam", "drempelniveau")
    plant, plant_xy = nearest_plant(cache)
    net = orient(pipes(pdok("beheerleiding", cache, pad=PAD), dtm), pumps, chambers, plant_xy)
    log(len(net), "pipes,", sum(p["by_network"] for p in net), "with directions from the network")
    sewers = sewer_meta(net, pumps, chambers, plant, plant_xy, dtm)

    zr = (float(np.floor(P["z"].min())), float(np.ceil(P["z"].max())))
    keep = (cls == CLASSES["wire"]) | (cls == CLASSES["tower"])
    idx, voxel = thin(P, keep, TARGET)
    idx_sm, voxel_sm = thin(P, None, TARGET_SM, seed=11)
    write_points(OUT / f"li-points-{V}.bin", P, idx, codes(P, idx, cls, dense, away), zr)
    write_points(OUT / f"li-points-sm-{V}.bin", P, idx_sm, codes(P, idx_sm, cls, dense, away), zr)
    log(len(idx), f"points kept, voxel {voxel:.2f} m;", len(idx_sm), f"for phones, voxel {voxel_sm:.2f} m")
    write_meta(P, cls, dtm, zr, (len(idx), len(idx_sm)), (voxel, voxel_sm), power, sewers)


if __name__ == "__main__":
    if len(sys.argv) != 2:  # the cache (about 300 MB a tile) lives outside the repo and its Docker context
        sys.exit("usage: python -I tools/lidar/build_lidar.py <cache_dir>")
    main(pathlib.Path(sys.argv[1]))
