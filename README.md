# portfolio

Source for [alrightansh.com](https://alrightansh.com): a scroll-driven 3D flight through a particle terrain,
built with Astro and three.js.

## Develop

```powershell
npm install
npx astro dev
```

## Layout

- `src/pages/index.astro`: page, HUD markup and styles
- `src/scripts/`: scene, stations, research stop, UI and audio
- `src/scripts/content.js`: all portfolio copy
- `public/research/`: Neugal watershed data
  - `neugal-dem.bin`: SRTM-based DEM, D8 drainage and the RUSLE layers extracted from the dissertation maps.
    Rebuild with `python -I tools/research/build_dem.py` (needs numpy and Pillow; tiles are cached in `tools/research/.cache/`).
  - `osm.json`: rivers, roads and villages, map data © OpenStreetMap contributors (ODbL)
  - `context.json`, `world-land.png`, `hp-relief.jpg`, `kangra-relief.jpg`: the zoom from the globe through India and
    Himachal Pradesh (boundaries: Natural Earth, public domain)
  - `neugal-relief.jpg`, `neugal-mask.png`: the watershed's natural-colour relief and its Strahler-ordered streams.
    Rebuild these with `python -I tools/research/build_maps.py` after `build_dem.py` (same requirements and tile cache).
    It does not download the boundaries: put Natural Earth's `ne_50m_land.geojson`,
    `ne_10m_admin_0_countries_ind.geojson` and `ne_50m_admin_1_states_provinces.geojson` in `tools/research/.cache/` first.

## Deploy

See [DEPLOY.md](DEPLOY.md).
