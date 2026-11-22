"""Optimised WebP images (versioned: bump -v1 when an image changes, the site caches them for 30 days) for the reading pages (public/work/), from project outputs already in this repository
and the north-india-renewables map sheets. Needs Pillow with WebP support.

    python -I tools/work/build_images.py [path/to/north-india-renewables]

neugal-risk-*.webp is a still of the Neugal stop in the flight; capture a 1600 x 1000 PNG of the soil-loss stage
and pass it with --neugal path/to/still.png to rebuild it.
"""
import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "work"


def save(img, name, widths, quality=82):
    OUT.mkdir(parents=True, exist_ok=True)
    for w in widths:
        h = round(img.height * w / img.width)
        out = OUT / f"{name}-{w}.webp"
        img.resize((w, h), Image.LANCZOS).save(out, "WEBP", quality=quality, method=6)
        print(f"{out.relative_to(ROOT)}  {w}x{h}  {out.stat().st_size // 1024} KB")


def crop_ratio(img, ratio, y_bias=0.5):
    """Centre crop to width / height = ratio; y_bias moves the window up (0) or down (1)."""
    w, h = img.size
    if w / h > ratio:
        nw = round(h * ratio)
        x = (w - nw) // 2
        return img.crop((x, 0, x + nw, h))
    nh = round(w / ratio)
    y = round((h - nh) * y_bias)
    return img.crop((0, y, w, y + nh))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("renewables", nargs="?", default=str(ROOT.parent / "north-india-renewables"))
    ap.add_argument("--neugal", help="PNG still of the Neugal soil-loss stage from the flight")
    a = ap.parse_args()

    sheet = Path(a.renewables) / "outputs" / "maps" / "00_hero_3d.png"
    if sheet.exists():
        save(Image.open(sheet).convert("RGB"), "ni-hotspots-3d-v1", [800, 1600])
    else:
        print(f"skipped: {sheet} not found")

    # Sentinel-2 mosaic of Himachal Pradesh (from the Himachal stop), cropped to 3:2 around the snow line
    hp = Image.open(ROOT / "public" / "himachal" / "hp-albedo-2k-v1.jpg").convert("RGB")
    save(crop_ratio(hp, 3 / 2, 0.42), "hp-sentinel2-v1", [800, 1600], quality=68)

    for name in ("paper-peaks", "gispost"):
        save(Image.open(ROOT / "public" / "billboards" / f"{name}.webp").convert("RGB"), f"{name}-v1", [800, 1280])

    if a.neugal:
        save(crop_ratio(Image.open(a.neugal).convert("RGB"), 16 / 10), "neugal-risk-v1", [800, 1600])


if __name__ == "__main__":
    main()
