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
  - `neugal.bin`: RUSLE layers extracted from the dissertation maps
  - `osm.json`: rivers, roads and villages, map data © OpenStreetMap contributors (ODbL)

## Deploy

See [DEPLOY.md](DEPLOY.md).
