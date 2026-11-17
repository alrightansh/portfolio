# Builds public/research/neugal-dem.bin: a real DEM plus D8 drainage for the Neugal watershed,
# alongside the RUSLE layers extracted from the dissertation maps.
#
# Elevation: AWS Terrain Tiles (Terrarium PNG, SRTM-based), zoom 12, box-averaged onto the grid.
# Drainage: priority-flood over the watershed mask from its outlet, then D8 steepest descent and
# flow accumulation, so every cell drains to the outlet.
#
# Usage: python -I tools/research/build_dem.py [tile_cache_dir]
#
# Output layout (little endian):
#   u16 Wd, Hd, Wl, Hl
#   u16 elevation in metres, Wd*Hd
#   u8  D8 direction, Wd*Hd (0..7 = neighbour index, 8 = outlet, 255 = outside the watershed)
#   u8  risk, R, K, LS, C, P, A at Wl*Hl (risk 0 = outside, 1..4 = low..critical)
import heapq, io, math, pathlib, sys, urllib.request
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "tools/research/rusle_layers.bin"
OUT = ROOT / "public/research/neugal-dem.bin"
CACHE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "tools/research/.cache"
# Watershed bounding box, read off the dissertation's K-factor graticule.
LON0, LON1, LAT0, LAT1 = 76.34844, 76.64199, 31.89087, 32.25436
ZOOM = 12
SCALE = 2  # DEM cells per RUSLE cell along each axis
TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OFFS = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]


def read_layers():
    buf = SRC.read_bytes()
    w, h = int.from_bytes(buf[0:2], "little"), int.from_bytes(buf[2:4], "little")
    planes = np.frombuffer(buf, np.uint8, offset=4).reshape(8, h, w)
    risk, _pdf_elev, *rest = planes  # the PDF elevation plane is replaced by the real DEM
    return w, h, np.stack([risk, *rest])


def tile_xy(lon, lat):
    n = 2 ** ZOOM
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch(x, y):
    path = CACHE / f"{ZOOM}_{x}_{y}.png"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(TILE_URL.format(z=ZOOM, x=x, y=y), headers={"User-Agent": "dem-build/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            path.write_bytes(r.read())
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def mosaic():
    x0, y0 = tile_xy(LON0, LAT1)
    x1, y1 = tile_xy(LON1, LAT0)
    tx = range(int(x0), int(x1) + 1)
    ty = range(int(y0), int(y1) + 1)
    rows = [np.hstack([fetch(x, y) for x in tx]) for y in ty]
    return np.vstack(rows), tx.start, ty.start


def sample(dem, ox, oy, wd, hd):
    # box average: 4x4 bilinear samples per grid cell, in global tile-pixel coordinates
    sub = 4
    fu = (np.arange(wd * sub) + 0.5) / (wd * sub)
    fv = (np.arange(hd * sub) + 0.5) / (hd * sub)
    lon = LON0 + fu * (LON1 - LON0)
    lat = LAT1 - fv * (LAT1 - LAT0)
    px = np.array([tile_xy(l, LAT0)[0] for l in lon]) * 256 - ox * 256 - 0.5
    py = np.array([tile_xy(LON0, l)[1] for l in lat]) * 256 - oy * 256 - 0.5
    gx, gy = np.meshgrid(px, py)
    x0, y0 = np.floor(gx).astype(int), np.floor(gy).astype(int)
    fx, fy = gx - x0, gy - y0
    g = lambda yy, xx: dem[np.clip(yy, 0, dem.shape[0] - 1), np.clip(xx, 0, dem.shape[1] - 1)]
    v = (g(y0, x0) * (1 - fx) * (1 - fy) + g(y0, x0 + 1) * fx * (1 - fy)
         + g(y0 + 1, x0) * (1 - fx) * fy + g(y0 + 1, x0 + 1) * fx * fy)
    return v.reshape(hd, sub, wd, sub).mean(axis=(1, 3))


def drainage(elev, mask):
    hd, wd = elev.shape
    border = mask & ~(np.roll(mask, 1, 0) & np.roll(mask, -1, 0) & np.roll(mask, 1, 1) & np.roll(mask, -1, 1))
    cand = np.where(border, elev, np.inf)
    outlet = np.unravel_index(np.argmin(cand), cand.shape)
    filled = elev.astype(np.float64).copy()
    seen = np.zeros_like(mask)
    seen[outlet] = True
    heap = [(filled[outlet], outlet)]
    while heap:
        z, (y, x) = heapq.heappop(heap)
        for dx, dy in OFFS:
            ny, nx = y + dy, x + dx
            if 0 <= ny < hd and 0 <= nx < wd and mask[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                filled[ny, nx] = max(filled[ny, nx], z + 1e-3 * math.hypot(dx, dy))
                heapq.heappush(heap, (filled[ny, nx], (ny, nx)))
    d8 = np.full((hd, wd), 255, np.uint8)
    for y, x in zip(*np.nonzero(mask)):
        if (y, x) == outlet:
            d8[y, x] = 8
            continue
        best, bi = 0.0, 255
        for i, (dx, dy) in enumerate(OFFS):
            ny, nx = y + dy, x + dx
            if 0 <= ny < hd and 0 <= nx < wd and mask[ny, nx]:
                s = (filled[ny, nx] - filled[y, x]) / math.hypot(dx, dy)
                if s < best:
                    best, bi = s, i
        d8[y, x] = bi
    assert not np.any(mask & (d8 == 255)), "a watershed cell has no downhill neighbour"
    acc = np.where(mask, 1, 0).astype(np.int64)
    order = np.argsort(-filled[mask])
    ys, xs = np.nonzero(mask)
    for k in order:
        y, x = ys[k], xs[k]
        i = d8[y, x]
        if i < 8:
            dx, dy = OFFS[i]
            acc[y + dy, x + dx] += acc[y, x]
    return d8, acc, outlet


def main():
    wl, hl, layers = read_layers()
    wd, hd = wl * SCALE, hl * SCALE
    dem, ox, oy = mosaic()
    elev = sample(dem, ox, oy, wd, hd)
    mask = np.repeat(np.repeat(layers[0] > 0, SCALE, 0), SCALE, 1)
    d8, acc, outlet = drainage(elev, mask)
    inside = elev[mask]
    print(f"grid {wd}x{hd}, inside {mask.sum()} cells, elevation {inside.min():.0f} to {inside.max():.0f} m")
    print(f"outlet uv ({(outlet[1] + 0.5) / wd:.3f}, {(outlet[0] + 0.5) / hd:.3f}), max accumulation {acc.max()}")
    head = np.array([wd, hd, wl, hl], "<u2").tobytes()
    body = np.clip(np.round(elev), 0, 65535).astype("<u2").tobytes() + d8.tobytes() + layers.astype(np.uint8).tobytes()
    OUT.write_bytes(head + body)
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
