# portfolio

Source for [alrightansh.com](https://alrightansh.com): a scroll-driven 3D flight through a particle terrain,
built with Astro and three.js, plus reading pages under `/work/` (overview, the utility network case study, AI meets
GIS and Earth observation) that share the flight's type and motion. See [PROJECT.md](PROJECT.md) for the working
notes: structure, CSP rules, the motion inventory and the content rules.

## Develop

```powershell
npm install
npx astro dev
```

## Layout

- `src/pages/index.astro`: page, HUD markup and styles
- `src/scripts/`: scene, stations, the three map stops (research.js, energy.js, himachal.js; shared camera rig, lighting
  and helpers in stop-kit.js), UI and audio
- `src/scripts/content.js`: all portfolio copy
- `public/research/`: Neugal watershed data
  - `neugal-dem.bin`: SRTM-based DEM, D8 drainage and the RUSLE layers extracted from the dissertation maps.
    Rebuild with `python -I tools/research/build_dem.py` (needs numpy and Pillow; tiles are cached in `tools/research/.cache/`).
  - `osm.json`: rivers, roads and villages, map data © OpenStreetMap contributors (ODbL)
  - `context.json`, `world-land.png`, `hp-relief.jpg`, `kangra-relief.jpg`: the zoom from the globe through India and
    Himachal Pradesh (boundaries: Natural Earth, public domain)
  - `neugal-albedo-v2.jpg`, `neugal-normal-v2.jpg`, `neugal-mask.png`: the watershed's unlit natural colour, its
    terrain normals and sky view (the browser lights them by a moving sun) and its Strahler-ordered streams.
    Rebuild these with `python -I tools/research/build_maps.py` after `build_dem.py` (same requirements and tile cache).
    It does not download the boundaries: put Natural Earth's `ne_50m_land.geojson`,
    `ne_10m_admin_0_countries_ind.geojson` and `ne_50m_admin_1_states_provinces.geojson` in `tools/research/.cache/` first.
- `public/energy/`: the North India solar and wind hotspot stop (`ni-*-v2.*`), exported by `pipeline/export_web.py` in the
  separate north-india-renewables project. Sources: Global Solar Atlas, Global Wind Atlas, ESA WorldCover, SRTM,
  OpenStreetMap (ODbL) and MNRE. Bump the version in the file names when the data changes (the site caches them for 30 days).
- `public/himachal/`: the Himachal from orbit stop (`hp-*-v1.*`): landslide susceptibility, the August 2023 Beas flood,
  snow cover trends and forest loss, exported by `pipeline/export_web.py` in the separate himachal-remote-sensing project.
  Sources: Copernicus Sentinel-1 and Sentinel-2, Copernicus GLO-30, Hansen Global Forest Change, MODIS (NSIDC), RGI 7.0,
  JRC Global Surface Water, ESA WorldCover, CHIRPS and OpenStreetMap (ODbL). Same versioning rule.

- `src/pages/work/`, `src/layouts/Page.astro`, `src/components/`: the reading pages; their copy lives in `src/data/`,
  their scripts in `src/scripts/page*.js` (built on `ui.js`), their styles in `src/styles/`.
- `public/work/`: WebP images for the reading pages, rebuilt with `python -I tools/work/build_images.py` (needs Pillow;
  reads the north-india-renewables map sheets from a sibling checkout). Same versioning rule as the map stops.

## Deploy

See [DEPLOY.md](DEPLOY.md).
