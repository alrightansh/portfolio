# Figures for the Utilities in 3D section of the research page (src/data/lidar-stats.json), worked out from the
# same cache, steps and constants as build_lidar.py, so they agree with the stop in the flight.
#
# Usage: python -I tools/lidar/analyse_lidar.py <cache_dir>    (the cache build_lidar.py filled)
#
# Output: survey {points, density, scan, classes, treeHeight}, power {returns, pylons, spans (each with its fitted
# wires), fit, clearance (with a histogram of tree returns by distance to the nearest wire), patches}, sewers {km,
# pipes, width, material, shape, years, depth, gradient, pumps, overflows}. Lengths in km, distances in metres.
import json
import pathlib
import sys

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # build_lidar.py beside this file (-I drops it)
import build_lidar as B  # noqa: E402

OUT = B.ROOT / "src/data/lidar-stats.json"
HIST_STEP, HIST_MAX = 0.5, 15.0  # tree returns by distance to the nearest wire, metres
FINE = 0.05                      # densify step for the distances of wire returns to their fitted wires, metres
PATCH_R = 1.5                    # tree returns within NEAR_TREE of a wire and this close together form one patch
PATCH_MIN = 50                   # patches with fewer returns are left out
DEPTH_STEP = 0.25                # manholes by depth, terrain to the lowest invert, metres
YEAR_STEP = 1                    # sewer length by the year it was laid


def length2d(xyz):
    return float(np.hypot(*np.diff(xyz[:, :2], axis=0).T).sum())


def r(v, nd=1):
    return round(float(v), nd)


def survey(P, cls, hag):
    area = (B.BOX[2] - B.BOX[0]) * (B.BOX[3] - B.BOX[1])
    tree = hag[cls == B.CLASSES["tree"]]
    return {"points": int(len(cls)), "areaKm2": area / 1e6, "density": r(len(cls) / area), "scan": B.scan_of(P),
            "classes": {k: int((cls == v).sum()) for k, v in B.CLASSES.items()},
            "treeHeight": {"p50": r(np.percentile(tree, 50)), "p90": r(np.percentile(tree, 90))}}


def lowest_above_ground(pts, dtm):
    """The lowest point of a fitted wire above the terrain, over the part inside the box."""
    run = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    q = np.arange(0, run[-1], 0.5)
    p = np.stack([np.interp(q, run, pts[:, k]) for k in range(3)], 1)
    p = p[(p[:, 0] >= B.BOX[0]) & (p[:, 0] <= B.BOX[2]) & (p[:, 1] >= B.BOX[1]) & (p[:, 1] <= B.BOX[3])]
    return r(np.min(p[:, 2] - B.sample(dtm, p[:, 0], p[:, 1]))) if len(p) else None


def spans_of(ways, wpts, dtm):
    """Every span with its fitted wires: length, the share over the box, and per wire sag, hits, cover, the lowest
    point above the terrain and the catenary constant L² / 8 sag (horizontal tension over weight per metre)."""
    out, fitted = [], []
    for A, Bt, kv in B.spans(ways):
        L = float(np.hypot(*(Bt - A)))
        over = sum(length2d(p) for p in B.clip(np.array([[*A, 0.0], [*Bt, 0.0]]))) / L
        wires = [dict(w, kv=kv) for w in B.fit_span(A, Bt, wpts)]
        fitted += wires
        if wires:
            out.append({"kv": kv, "length": r(L), "over": r(over, 2), "full": bool(B.inside(A) and B.inside(Bt)),
                        "wires": [{"sag": r(w["sag"], 2), "hits": w["hits"], "cover": r(w["cover"], 2),
                                   "low": lowest_above_ground(w["pts"], dtm), "c": int(round(L * L / (8 * w["sag"])))}
                                  for w in sorted(wires, key=lambda w: w["sag"])]})
    return out, fitted


def fit_quality(P, wire_away, fitted):
    """How far the wire returns (away from the pylons) lie from the nearest fitted wire."""
    d = cKDTree(B.densify(fitted, FINE)).query(np.c_[P["x"][wire_away], P["y"][wire_away], P["z"][wire_away]])[0]
    near = d[d < 1.0]
    return {"returns": int(len(d)), "within25cm": r((d < 0.25).mean() * 100), "within50cm": r((d < 0.5).mean() * 100),
            "median": r(np.median(near), 2), "p95": r(np.percentile(near, 95), 2)}


def tree_distances(P, cls, away, fitted):
    """Tree returns away from the pylons: distance to the nearest fitted wire (0.5 m samples, as the build) and that
    wire's voltage, for those within HIST_MAX."""
    dense = [B.densify([f]) for f in fitted]
    kv = np.concatenate([np.full(len(p), f["kv"]) for p, f in zip(dense, fitted)])
    m = np.flatnonzero((cls == B.CLASSES["tree"]) & away)
    d, j = cKDTree(np.concatenate(dense)).query(np.c_[P["x"][m], P["y"][m], P["z"][m]], distance_upper_bound=HIST_MAX)
    ok = np.isfinite(d)
    return m[ok], d[ok], kv[j[ok]]


def clearance(d, kv, built):
    bins = np.arange(0, HIST_MAX + HIST_STEP / 2, HIST_STEP)
    lines = sorted(set(kv.tolist()))
    near = d < B.NEAR_TREE
    return {"tree": built.get("tree"), "closest": r(np.min(d)), "strays": B.STRAYS, "within5": int(near.sum()),
            "within5ByKv": {str(v): int((near & (kv == v)).sum()) for v in lines}, "building": built.get("building"),
            "hist": {"step": HIST_STEP, "max": HIST_MAX, "kv": {str(v): np.histogram(d[kv == v], bins)[0].tolist() for v in lines}}}


def patches(P, idx, d, kv):
    """Clusters of the tree returns within NEAR_TREE of a wire: size, nearest distance, the wire's voltage, centre
    (metres east and north of the box's south-west corner) and spread."""
    m = d < B.NEAR_TREE
    xyz = np.c_[P["x"][idx[m]], P["y"][idx[m]], P["z"][idx[m]]]
    pairs = cKDTree(xyz).query_pairs(PATCH_R, output_type="ndarray")
    n = len(xyz)
    lab = connected_components(coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n)), directed=False)[1]
    out = []
    for c in np.unique(lab):
        k = lab == c
        if k.sum() >= PATCH_MIN:
            out.append({"returns": int(k.sum()), "nearest": r(d[m][k].min()), "kv": int(np.bincount(kv[m][k]).argmax()),
                        "at": B.rel(xyz[k, :2].mean(axis=0)), "spread": r(np.hypot(*np.ptp(xyz[k, :2], axis=0)))})
    return sorted(out, key=lambda p: -p["returns"])


def pylons(P, cls, tower_xy, dtm):
    out = []
    for x, y, top, kv in B.tower_tops(P, cls, tower_xy):
        if top is not None:
            ground = float(B.sample(dtm, np.array([x + B.BOX[0]]), np.array([y + B.BOX[1]]))[0])
            out.append({"kv": kv, "top": top, "height": r(top - ground)})
    return sorted(out, key=lambda t: (-t["kv"], t["height"]))


def power(P, cls, dtm, cache):
    ways = [w for w in B.osm_line(cache) if B.kv_of(w["tags"]) >= 50]
    tower_xy = B.towers_of(ways)
    away = ~np.isfinite(B.tower_distance(P, tower_xy))
    wire = cls == B.CLASSES["wire"]
    spans, fitted = spans_of(ways, np.c_[P["x"][wire], P["y"][wire], P["z"][wire]], dtm)
    built = B.clearance(B.densify(fitted), P, cls, away)
    idx, d, kv = tree_distances(P, cls, away, fitted)
    return {"returns": {"wire": int(wire.sum()), "tower": int((cls == B.CLASSES["tower"]).sum())},
            "pylons": pylons(P, cls, tower_xy, dtm), "spans": spans, "wires": len(fitted),
            "fit": fit_quality(P, wire & away, fitted), "clearance": clearance(d, kv, built), "patches": patches(P, idx, d, kv)}


def pipe_rows(feats, dtm):
    """Each sewer pipe over the box, with the stop's own filter and levels (build_lidar.pipes) and its GWSW
    properties: kind, width (mm), material, shape, year laid, length over the box (m) and fall end to end (per
    mille, gravity pipes)."""
    rows = []
    for f in feats:
        props = f["properties"]
        year = str(props.get("begindatum") or "")[:4]
        for p in B.pipes([f], dtm):
            fall = abs(p["xyz"][0, 2] - p["xyz"][-1, 2]) / max(length2d(p["xyz"]), 1e-6) * 1000
            for part in B.clip(p["xyz"]):
                run = length2d(part)
                if run < 1.0:  # as sewer_meta
                    continue
                rows.append({"k": p["k"], "d": int(p["d"] or 0), "length": run, "year": int(year) if year.isdigit() else None,
                             "material": str(props.get("materiaal_leiding") or "").rsplit("/", 1)[-1] or "unknown",
                             "shape": str(props.get("vorm_leiding") or "").rsplit("/", 1)[-1] or "unknown",
                             "fall": fall if p["k"] in B.GRAVITY else None})
    return rows


def km_by(rows, key):
    out = {}
    for row in rows:
        out[str(row[key])] = out.get(str(row[key]), 0.0) + row["length"] / 1000
    return {k: r(v, 2) for k, v in sorted(out.items(), key=lambda kv: -kv[1])}


def weighted_median(values, weights):
    o = np.argsort(values)
    c = np.cumsum(np.asarray(weights, float)[o])
    return float(np.asarray(values, float)[o][np.searchsorted(c, c[-1] / 2)])


def years_of(rows, kinds):
    dated = [row for row in rows if row["year"]]
    y0 = min(row["year"] for row in dated) // YEAR_STEP * YEAR_STEP
    y1 = max(row["year"] for row in dated) // YEAR_STEP * YEAR_STEP + YEAR_STEP
    km = {k: [r(sum(row["length"] for row in dated if row["k"] == k and b <= row["year"] < b + YEAR_STEP) / 1000, 2)
              for b in range(y0, y1, YEAR_STEP)] for k in kinds}
    return {"from": y0, "step": YEAR_STEP, "km": km, "unknownKm": r(sum(row["length"] for row in rows if not row["year"]) / 1000, 2),
            "median": int(weighted_median([row["year"] for row in dated], [row["length"] for row in dated]))}


def depths_of(feats, dtm):
    """The stop's manholes (build_lidar.shafts) by depth, terrain to the lowest invert."""
    d = np.array([s[2] - s[3] for s in B.shafts(B.pipes(feats, dtm), dtm)])
    bins = np.arange(0, np.ceil(d.max() / DEPTH_STEP) * DEPTH_STEP + DEPTH_STEP / 2, DEPTH_STEP)
    return {"step": DEPTH_STEP, "manholes": int(len(d)), "count": np.histogram(d, bins)[0].tolist(),
            "median": r(np.median(d), 2), "max": r(d.max(), 2)}


def sewers(cache, dtm):
    feats = B.pdok("beheerleiding", cache, pad=B.PAD)
    rows = pipe_rows(feats, dtm)
    kinds = sorted({row["k"] for row in rows})
    grav = [row for row in rows if row["k"] in B.GRAVITY]
    glen = [row["length"] for row in grav]
    pumps = [q for q in B.points_of(B.pdok("beheerpomp", cache, pad=B.PAD), "naam", "pompcapaciteit1") if B.inside(q["xy"])]
    chambers = [q for q in B.points_of(B.pdok("beheerlozing", cache, pad=B.PAD), "naam", "drempelniveau") if B.inside(q["xy"])]
    return {"km": km_by(rows, "k"), "pipes": {k: sum(row["k"] == k for row in rows) for k in kinds},
            "width": {k: km_by([row for row in rows if row["k"] == k], "d") for k in kinds},
            "material": km_by(rows, "material"), "shape": km_by(rows, "shape"), "years": years_of(rows, kinds),
            "depth": depths_of(feats, dtm),
            "gradient": {"median": r(weighted_median([row["fall"] for row in grav], glen), 2),
                         "under1": r(sum(row["length"] for row in grav if row["fall"] < 1) / sum(glen) * 100)},
            "pumps": [{"name": q["naam"], "m3h": r(q["pompcapaciteit1"] or 0)} for q in pumps],
            "overflows": sorted(r(q["drempelniveau"], 2) for q in chambers if q["drempelniveau"] is not None)}


def main(cache):
    P = B.read_points(cache)
    dtm = B.terrain(P)
    hag = P["z"] - B.sample(dtm, P["x"], P["y"])
    ways = [w for w in B.osm_line(cache) if B.kv_of(w["tags"]) >= 50]
    td = B.tower_distance(P, B.towers_of(ways))
    tower = (P["cls"] == B.AHN_WIRE) & (td < B.TOWER_R)
    cls = B.classify(P, hag, (P["cls"] == B.AHN_WIRE) & ~tower, tower)
    stats = {"survey": survey(P, cls, hag), "power": power(P, cls, dtm, cache), "sewers": sewers(cache, dtm)}
    OUT.write_text(json.dumps(stats, indent=1), "utf-8")
    B.log("wrote", OUT.relative_to(B.ROOT))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -I tools/lidar/analyse_lidar.py <cache_dir>")
    main(pathlib.Path(sys.argv[1]))
