# Builds the map assets for the research stop (public/research/):
#   context.json       India and Himachal Pradesh outlines, label anchors and zoom boxes on an
#                      orthographic projection centred on the watershed, in Earth radii. At world
#                      scale it reads as a globe; at the watershed it is the local tangent plane.
#   world-land.png     equirectangular land coverage for the globe, 2048x1024
#   hp-relief.jpg      shaded relief around Himachal Pradesh, equirectangular over HP_BOX
#   kangra-relief.jpg  sharper relief of the Kangra valley over KANGRA_BOX, the zoom's step between
#                      Himachal and the watershed
#   neugal-relief.jpg  natural-colour shaded relief of the watershed box (the terrain texture)
#   neugal-mask.png    R stream lines (width by Strahler order), G stream order / 7,
#                      B watershed field (0.5 on the boundary)
#
# Sources: Natural Earth (public domain) 50m land, 10m admin-0 countries from India's point of view
# (ne_10m_admin_0_countries_ind, which follows India's official boundary) and 50m admin-1 states,
# downloaded into tools/research/.cache/. Elevation: AWS Terrain Tiles (Terrarium, SRTM-based) at
# zoom 12 for the watershed, 10 for Kangra and 9 for Himachal. Streams: D8 drainage over the whole
# box with an open boundary (water may leave any edge), on a lightly smoothed DEM at 4x the RUSLE
# grid (about 58 m cells); channels from 1 km² of contributing area, Strahler ordered.
#
# Usage: python -I tools/research/build_maps.py
import heapq
import json
import math
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_dem as dem  # noqa: E402  (shared tile, mosaic and drainage helpers)

OUT = HERE.parents[1] / "public/research"
R_KM = 6371.0
M_PER_DEG = 111320
LAM0, PHI0 = (dem.LON0 + dem.LON1) / 2, (dem.LAT0 + dem.LAT1) / 2
HP_BOX = (74.6, 29.6, 80.0, 34.0)  # lon0, lat0, lon1, lat1 of the Himachal relief
KANGRA_BOX = (75.8, 31.45, 77.2, 32.7)  # the Kangra valley, centred on the watershed
SHED_SNOWLINE = 4400  # m; snow caps only the high Dhauladhar in the Kangra and watershed reliefs
INDIA_TOL_KM, HP_TOL_KM, MIN_ISLAND_KM2 = 0.8, 0.25, 50
SS = 4  # supersampling for anti-aliased rasters
RELIEF_W = 1024
CHANNEL_M2 = 1e6
MIN_ORDER = 2   # first-order rills are left out to keep the network readable
BED_ORDER = 4   # main stems get a wide gravel bed, as Himalayan khads have
STREAM_TEXELS = {1: 1.1, 2: 1.6, 3: 2.2, 4: 3.0, 5: 4.0, 6: 5.0, 7: 5.6}
# Natural colours by elevation (m): valley fields, terraces and tea, pine and broadleaf forest,
# oak and deodar forest, subalpine meadows, alpine scree, bare rock.
ZONES = ((300, (0.50, 0.52, 0.36)), (900, (0.38, 0.45, 0.27)), (1500, (0.21, 0.32, 0.18)),
         (2300, (0.15, 0.26, 0.15)), (3100, (0.30, 0.33, 0.23)), (3700, (0.44, 0.41, 0.35)),
         (4400, (0.52, 0.50, 0.48)))
ROCK, SNOW, GRAVEL = (0.45, 0.42, 0.38), (0.86, 0.90, 0.94), (0.60, 0.59, 0.54)
# Below the treeline the valley is a patchwork: forest on steep ground, fields on gentle ground.
FOREST, FIELD, TEA = (0.19, 0.30, 0.16), (0.50, 0.52, 0.33), (0.32, 0.41, 0.20)
NAVY = np.array((0.10, 0.16, 0.26))  # land colour of the globe, so the relief fades into it


# ---------- geometry ----------

def load(name):
    return json.loads((dem.CACHE / name).read_text(encoding="utf-8"))


def find(name, **props):
    return next(f for f in load(name)["features"] if all(f["properties"].get(k) == v for k, v in props.items()))


def polygons(geom):
    return {"Polygon": [geom["coordinates"]], "MultiPolygon": geom["coordinates"]}.get(geom["type"], [])


def ortho(lon, lat):
    l, p, p0 = np.radians(np.asarray(lon, float) - LAM0), np.radians(np.asarray(lat, float)), math.radians(PHI0)
    return np.cos(p) * np.sin(l), math.cos(p0) * np.sin(p) - math.sin(p0) * np.cos(p) * np.cos(l)


def simplify(pts, tol):
    """Douglas-Peucker on an (n, 2) array, keeping both end points."""
    keep = np.zeros(len(pts), bool)
    keep[[0, -1]] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        seg, d = pts[b] - pts[a], pts[a + 1:b] - pts[a]
        length = math.hypot(*seg)
        dist = np.abs(d[:, 0] * seg[1] - d[:, 1] * seg[0]) / length if length > 0 else np.hypot(d[:, 0], d[:, 1])
        i = int(np.argmax(dist))
        if dist[i] > tol:
            m = a + 1 + i
            keep[m] = True
            stack += [(a, m), (m, b)]
    return pts[keep]


def outline(feature, tol_km, min_km2=0.0):
    rings = []
    for poly in polygons(feature["geometry"]):
        ring = np.asarray(poly[0], float)
        pts = np.stack(ortho(ring[:, 0], ring[:, 1]), 1)
        x, y = pts[:, 0], pts[:, 1]
        km2 = abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))) / 2 * R_KM ** 2
        if km2 >= min_km2:
            rings.append(simplify(pts, tol_km / R_KM))
    return rings


def box_of(rings):
    p = np.vstack(rings)
    (x0, y0), (x1, y1) = p.min(0), p.max(0)
    return [round(float(v), 7) for v in ((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0)]


def point(lon, lat):
    return [round(float(v), 7) for v in ortho(lon, lat)]


def context():
    india = outline(find("ne_10m_admin_0_countries_ind.geojson", ADM0_A3="IND"), INDIA_TOL_KM, MIN_ISLAND_KM2)
    hp_feat = find("ne_50m_admin_1_states_provinces.geojson", iso_3166_2="IN-HP")
    hp = outline(hp_feat, HP_TOL_KM)
    osm = json.loads((OUT / "osm.json").read_text(encoding="utf-8"))
    pal = next(l for l in osm["labels"] if l["n"] == "Palampur")
    pal_lon = dem.LON0 + pal["u"] * (dem.LON1 - dem.LON0)
    pal_lat = dem.LAT1 - pal["v"] * (dem.LAT1 - dem.LAT0)
    ctx = {
        "center": [LAM0, PHI0], "hpBox": list(HP_BOX), "kangraBox": list(KANGRA_BOX),
        "india": [r.round(7).ravel().tolist() for r in india],
        "hp": [r.round(7).ravel().tolist() for r in hp],
        "anchors": {"india": point(79.0, 22.5), "hp": point(77.3, 31.9), "palampur": point(pal_lon, pal_lat)},
        "boxes": {"india": box_of(india), "hp": box_of(hp)},
    }
    (OUT / "context.json").write_text(json.dumps(ctx, separators=(",", ":")), encoding="utf-8")
    print(f"india {len(india)} rings, {sum(len(r) for r in india)} points; hp {sum(len(r) for r in hp)} points")
    return hp_feat


# ---------- rasters ----------

def to8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def box1d(a, r, axis):
    a = np.moveaxis(a, axis, 0)
    p = np.concatenate([np.repeat(a[:1], r + 1, 0), a, np.repeat(a[-1:], r, 0)])
    c = np.cumsum(p, 0)
    return np.moveaxis((c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1), 0, axis)


def blur(a, r, passes=3):
    for _ in range(passes):
        a = box1d(box1d(a, r, 0), r, 1)
    return a


def fbm(h, w, seed, scales):
    """Smooth value noise in about -0.5..0.5; scales are (feature size in px, weight)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    for s, amp in scales:
        g = rng.random((h // s + 2, w // s + 2)).astype(np.float32)
        out += amp * np.asarray(Image.fromarray(g).resize((w, h), Image.BICUBIC))
    return out / sum(a for _, a in scales) - 0.5


def rasterize(rings_lonlat, box, w, h):
    lon0, lat0, lon1, lat1 = box
    img = Image.new("L", (w * SS, h * SS), 0)
    draw = ImageDraw.Draw(img)
    for poly in rings_lonlat:
        for k, ring in enumerate(poly):
            xy = [((lon - lon0) / (lon1 - lon0) * w * SS, (lat1 - lat) / (lat1 - lat0) * h * SS) for lon, lat in ring]
            draw.polygon(xy, fill=0 if k else 255)
    return np.asarray(img.reduce(SS), np.float32) / 255


def world_land():
    polys = [p for f in load("ne_50m_land.geojson")["features"] for p in polygons(f["geometry"])]
    cover = rasterize(polys, (-180, -90, 180, 90), 2048, 1024)
    Image.fromarray(to8(cover)).save(OUT / "world-land.png", optimize=True)


def terrain_colour(elev, cell, zf, snowline, seed, bed=None, patch=False):
    """Natural-colour relief: elevation zones, rock on steep ground, aspect-dependent snow,
    north-west sun and local occlusion. cell = (dx, dy) in metres."""
    h, w = elev.shape
    px = max(cell)
    size = lambda m: max(2, round(m / px))
    gy, gx = np.gradient(elev * zf, cell[1], cell[0])
    nrm = np.sqrt(gx * gx + gy * gy + 1)
    az, alt = math.radians(315), math.radians(42)
    hill = np.clip((-gx * math.sin(az) * math.cos(alt) + gy * math.cos(az) * math.cos(alt) + math.sin(alt)) / nrm, 0, 1)
    slope = np.degrees(np.arctan(np.hypot(gx, gy) / zf))
    north = gy / np.maximum(np.hypot(gx, gy), 1e-6)
    k = math.sqrt(px / 27)
    ao = (1 + 0.16 * np.tanh((elev - blur(elev, max(1, round(110 / px)))) / (35 * k))
          + 0.12 * np.tanh((elev - blur(elev, max(2, round(600 / px)))) / (160 * k)))

    zm, zc = np.array([z for z, _ in ZONES]), np.array([c for _, c in ZONES])
    e = elev + 180 * fbm(h, w, seed, ((size(1700), 1), (size(430), 0.5)))
    alb = np.stack([np.interp(e, zm, zc[:, i]) for i in range(3)], -1)
    if patch:
        c = fbm(h, w, seed + 3, ((size(450), 1), (size(140), 0.7))) + (slope - 16) * 0.025
        forest = smoothstep(0.02, 0.16, c)[..., None]
        field_ = (1 - smoothstep(-0.16, -0.02, c))[..., None]
        cover = np.array(FOREST) * forest + np.array(FIELD) * field_ + np.array(TEA) * (1 - forest - field_)
        low = 0.75 * (1 - smoothstep(1800, 2300, e))[..., None]
        alb = alb * (1 - low) + cover * low
    rock = smoothstep(33, 50, slope)[..., None]
    alb = alb * (1 - rock) + np.array(ROCK) * rock
    if bed is not None:
        alb = alb * (1 - 0.6 * bed[..., None]) + np.array(GRAVEL) * 0.6 * bed[..., None]
    line = snowline - 380 * north + 250 * fbm(h, w, seed + 1, ((size(860), 1), (size(215), 0.5)))
    snow = smoothstep(line - 120, line + 120, elev) * (1 - smoothstep(40, 56, slope))
    alb = alb * (1 - snow[..., None]) + np.array(SNOW) * snow[..., None]
    alb *= 1 + 0.10 * fbm(h, w, seed + 2, ((2, 1), (4, 0.6)))[..., None]  # canopy grain
    col = alb * ((0.30 + 0.80 * hill) * ao)[..., None]
    col += (snow * (1 - hill))[..., None] * np.array((0.0, 0.03, 0.09))  # blue shadows on snow
    return np.clip(col, 0, 1)


def save_jpg(rgb, name):
    Image.fromarray(to8(rgb)).save(OUT / name, quality=86, optimize=True, progressive=True)


def state_relief(hp_feat, box, zoom, name, zf, snowline, seed, patch=False):
    """Equirectangular relief over box, RELIEF_W wide; land outside Himachal Pradesh is muted and
    darkened towards the globe's land colour so the state stands out."""
    lon0, lat0, lon1, lat1 = box
    lat_mid = math.radians((lat0 + lat1) / 2)
    w = RELIEF_W
    h = round(w * (lat1 - lat0) / ((lon1 - lon0) * math.cos(lat_mid)))
    mos, ox, oy = dem.mosaic(box, zoom)
    elev = dem.sample(mos, ox, oy, w, h, box, zoom, sub=2)
    cell = ((lon1 - lon0) * M_PER_DEG * math.cos(lat_mid) / w, (lat1 - lat0) * M_PER_DEG / h)
    col = terrain_colour(elev, cell, zf, snowline, seed, patch=patch)
    inside = rasterize(polygons(hp_feat["geometry"]), box, w, h)[..., None]
    grey = col.mean(-1, keepdims=True)
    outside = (0.25 * col + 0.75 * grey) * 0.3 + NAVY * 0.6
    save_jpg(col * inside + outside * (1 - inside), name)


def hp_relief(hp_feat):
    state_relief(hp_feat, HP_BOX, 9, "hp-relief.jpg", 2.5, 5500, 11)
    # the Kangra step uses the watershed's snowline and patchwork, so the last cross-fade matches
    state_relief(hp_feat, KANGRA_BOX, 10, "kangra-relief.jpg", 2.0, SHED_SNOWLINE, 7, patch=True)


# ---------- watershed ----------

def field(inside, w, h):
    """Smooth 0..1 version of the watershed mask at w x h; 0.5 traces a rounded boundary."""
    img = Image.fromarray(inside.astype(np.uint8) * 255).resize((w, h), Image.BILINEAR)
    return blur(np.asarray(img, np.float32) / 255, max(1, round(0.8 * w / inside.shape[1])))


def open_drainage(elev):
    """D8 over the whole box, draining off any edge, so streams follow the terrain rather than the
    dissertation's boundary: priority-flood from the border, then steepest descent and accumulation."""
    h, w = elev.shape
    filled = elev.astype(np.float64).copy()
    seen = np.zeros((h, w), bool)
    seen[[0, -1], :] = seen[:, [0, -1]] = True
    heap = [(filled[y, x], y, x) for y, x in zip(*np.nonzero(seen))]
    heapq.heapify(heap)
    while heap:
        z, y, x = heapq.heappop(heap)
        for dx, dy in dem.OFFS:
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                seen[ny, nx] = True
                filled[ny, nx] = max(filled[ny, nx], z + 1e-3 * math.hypot(dx, dy))
                heapq.heappush(heap, (filled[ny, nx], ny, nx))
    pad = np.pad(filled, 1, constant_values=np.inf)
    best, d8 = np.zeros((h, w)), np.full((h, w), 8, np.uint8)
    for i, (dx, dy) in enumerate(dem.OFFS):
        s = (pad[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] - filled) / math.hypot(dx, dy)
        d8 = np.where(s < best, i, d8).astype(np.uint8)
        best = np.minimum(best, s)
    ys, xs = np.divmod(np.arange(h * w), w)
    down = np.full(h * w, -1)
    for i, (dx, dy) in enumerate(dem.OFFS):
        sel = d8.ravel() == i
        down[sel] = (ys[sel] + dy) * w + xs[sel] + dx
    acc = np.ones(h * w)
    for c in np.argsort(-filled, axis=None):
        if down[c] >= 0:
            acc[down[c]] += acc[c]
    return d8, acc.reshape(h, w)


def strahler(d8, chan):
    h, w = d8.shape
    cells = np.flatnonzero(chan)
    down = np.full(h * w, -1)
    for c in cells:
        i = d8.flat[c]
        if i < 8:
            dx, dy = dem.OFFS[i]
            down[c] = c + dy * w + dx
    nup = np.zeros(h * w, int)
    for c in cells:
        if down[c] >= 0:
            nup[down[c]] += 1
    indeg, order, top, cnt = nup.copy(), np.zeros(h * w, int), np.zeros(h * w, int), np.zeros(h * w, int)
    queue = [c for c in cells if indeg[c] == 0]
    k = 0
    while k < len(queue):
        c = queue[k]
        k += 1
        order[c] = 1 if nup[c] == 0 else top[c] + (cnt[c] >= 2)
        d = down[c]
        if d < 0:
            continue
        if order[c] > top[d]:
            top[d], cnt[d] = order[c], 1
        elif order[c] == top[d]:
            cnt[d] += 1
        indeg[d] -= 1
        if indeg[d] == 0:
            queue.append(d)
    return order, nup, down


def stream_paths(order, nup, down, chan, w):
    """Polylines from each channel head or confluence down to the next confluence."""
    paths = []
    for s in np.flatnonzero(chan):
        if nup[s] == 1:
            continue
        path, c = [s], down[s]
        while c >= 0:
            path.append(c)
            if nup[c] != 1:
                break
            c = down[c]
        if len(path) > 1:
            paths.append((int(order[s]), [(p % w, p // w) for p in path]))
    return paths


def chaikin(pts, n):
    p = np.asarray(pts, float)
    for _ in range(n):
        if len(p) < 3:
            break
        mid = np.empty((2 * (len(p) - 1), 2))
        mid[0::2], mid[1::2] = p[:-1] * 0.75 + p[1:] * 0.25, p[:-1] * 0.25 + p[1:] * 0.75
        p = np.vstack([p[:1], mid, p[-1:]])
    return p


def stroke(draw, xy, width, fill):
    draw.line(xy, fill=fill, width=max(1, round(width)), joint="curve")
    r = width / 2
    for x, y in (xy[0], xy[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)


def draw_streams(paths, grid, size):
    (gw, gh), (w, h) = grid, size
    sx, sy = w * SS / gw, h * SS / gh
    layers = [Image.new("L", (w * SS, h * SS), 0) for _ in range(3)]
    river, strength, bed = (ImageDraw.Draw(im) for im in layers)
    for order, pts in sorted(paths, key=lambda p: p[0]):
        if order < MIN_ORDER:
            continue
        xy = [((x + 0.5) * sx, (y + 0.5) * sy) for x, y in chaikin(pts, 3)]
        width = STREAM_TEXELS[min(order, 7)] * SS
        stroke(river, xy, width, 255)
        stroke(strength, xy, width, round(255 * min(order, 7) / 7))
        if order >= BED_ORDER:
            stroke(bed, xy, width * 2.4, 255)
    return [np.asarray(im.reduce(SS), np.float32) / 255 for im in layers]


def watershed():
    wl, hl, layers = dem.read_layers()
    inside = layers[0] > 0
    mos, ox, oy = dem.mosaic()
    width_m = (dem.LON1 - dem.LON0) * M_PER_DEG * math.cos(math.radians(PHI0))
    height_m = (dem.LAT1 - dem.LAT0) * M_PER_DEG
    rw = RELIEF_W
    rh = round(rw * height_m / width_m)

    gw, gh = wl * 4, hl * 4
    d8, acc = open_drainage(blur(dem.sample(mos, ox, oy, gw, gh), 1, passes=2))
    chan = acc * (width_m / gw) * (height_m / gh) >= CHANNEL_M2
    order, nup, down = strahler(d8, chan)
    paths = stream_paths(order, nup, down, chan, gw)
    per = np.bincount([o for o, _ in paths])
    print("stream segments by Strahler order:", {o: int(n) for o, n in enumerate(per) if n})
    river, strength, bed = draw_streams(paths, (gw, gh), (rw, rh))

    elev = dem.sample(mos, ox, oy, rw, rh, sub=1)
    save_jpg(terrain_colour(elev, (width_m / rw, height_m / rh), 1.4, SHED_SNOWLINE, 7, bed, patch=True), "neugal-relief.jpg")
    rgb = np.stack([river, strength, field(inside, rw, rh)], -1)
    Image.fromarray(to8(rgb)).save(OUT / "neugal-mask.png", optimize=True)


def main():
    hp_feat = context()
    world_land()
    hp_relief(hp_feat)
    watershed()
    for name in ("context.json", "world-land.png", "hp-relief.jpg", "kangra-relief.jpg", "neugal-relief.jpg", "neugal-mask.png"):
        print(f"{name}: {(OUT / name).stat().st_size} bytes")


if __name__ == "__main__":
    main()
