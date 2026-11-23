// Research case studies, in the order of the flight's map stops. Every number comes from the stops' copy
// (src/scripts/lidar.js, research.js, energy.js, himachal.js), src/data/lidar-stats.json (tools/lidar/analyse_lidar.py)
// or the north-india-renewables README. `fly` deep-links to the stop in the 3D flight.
export const PROJECTS = [
  {
    id: "utilities-in-3d", kind: "Independent project",
    title: "Utilities in 3D", sub: "Power lines, trees and sewers from airborne LiDAR", place: "Wierden, the Netherlands",
    fly: "/#utilities-in-3d",
    img: { src: "/work/li-wires-v1", w: 1600, h: 1000, alt: "The 380 kV line over a block of Wierden in 3D: its fitted wires hang between pylons 47 m and 43 m tall above the grey point cloud of houses and trees, the deepest sagging 11.5 m.",
      caption: "The 380 kV line's 414 m span, its wires fitted through their laser returns: a still from the stop in the flight.",
      credit: "Point cloud: AHN6, Het Waterschapshuis. Power lines © OpenStreetMap contributors." },
    stats: [
      { num: "22.1", unit: "million laser returns over 0.75 km²" },
      { num: "2.6", unit: "m from a 110 kV wire to the trees beneath it" },
      { num: "12.7", unit: "km of sewer mapped beneath the block" },
    ],
    facts: [
      ["Problem", "How close do trees grow to the power lines over a Dutch residential block, and how does the sewer network beneath it run?"],
      ["Scope", "0.75 km² of Wierden in Overijssel, the Netherlands, crossed by a 380 kV and a 110 kV line."],
      ["Data", "AHN6 airborne LiDAR from 9 February 2025, the municipality's GWSW sewer data and the water boards' pumping stations via PDOK, and OpenStreetMap power lines."],
      ["Method", "AHN's classes, with unclassified returns 2.5 m or more above the terrain taken as trees. One hanging parabola fitted to each wire along each span, then the distance from every tree and roof return to the nearest wire, leaving out 25 m round each pylon. Sewers placed at their recorded levels and turned to run the way the water flows."],
      ["Results", "42 wires, with 61.5% of the wire returns within 25 cm of a fitted wire. 4,682 tree returns within 5 m of a wire, nearly all under the 110 kV line, the nearest 2.2 m away. 12.7 km of sewer with 292 manholes, all its foul water draining to one pumping station."],
      ["Limits", "A February scan, with the leaves down, so the summer canopy comes closer. Sag changes with temperature and load, so the fit holds for the day of the scan. Pressure mains carry no levels, so they are placed 1.2 m down."],
      ["Use", "Vegetation management along the lines, clearance checks, and planning digs around buried pipes."],
      ["Tools", "AHN6 LiDAR · Python (laspy, numpy, scipy, pyproj) · GWSW · OpenStreetMap · three.js"],
    ],
  },
  {
    id: "neugal", kind: "Research · Dissertation",
    title: "Neugal watershed", sub: "Soil erosion risk with RUSLE, AHP and GIS", place: "Palampur, Himachal Pradesh",
    fly: "/#neugal",
    img: { src: "/work/neugal-risk-v1", w: 1600, h: 1000, alt: "The Neugal watershed in 3D, coloured by soil erosion risk from low to critical, with streams and the watershed edge." ,
      caption: "Soil loss from low (deep blue) to critical (coral), with soil moving down the streams: a still from the 3D stop in the flight.",
      credit: "Elevation: Terrain Tiles (SRTM). Map data © OpenStreetMap contributors." },
    stats: [
      { num: "573.6", unit: "km² of Himalayan slopes" },
      { num: "1,047.66", unit: "t/ha a year of soil lost on average" },
      { num: "82", unit: "villages on or beside high-risk ground" },
    ],
    facts: [
      ["Problem", "Where does a Himalayan watershed lose the most soil, and which villages and roads sit on that ground?"],
      ["Scope", "The Neugal watershed beside Palampur, Himachal Pradesh: 573.6 km², from 562 m to 4,749 m."],
      ["Data", "SRTM elevation, Sentinel-2 imagery for plant cover, rainfall and soil inputs, OpenStreetMap villages, roads and streams."],
      ["Method", "Streams traced from the DEM with D8 flow directions. RUSLE (A = R × K × LS × C × P) for annual soil loss, with risk ranked from low to critical using AHP and GIS. Plant cover mapped from Sentinel-2 at 98% accuracy."],
      ["Results", "1,047.66 t/ha a year on average. 82 villages on or beside high-risk ground and 201 km of road across it."],
      ["Limits", "RUSLE estimates long-term sheet and rill erosion; gullies and landslides are outside it, and each factor's inputs cap the accuracy."],
      ["Use", "Shows planners where soil conservation should start. The method works for any valley."],
      ["Tools", "SRTM DEM · Sentinel-2 · RUSLE · AHP · D8 drainage · OpenStreetMap · Python · three.js"],
    ],
  },
  {
    id: "energy", kind: "Independent project",
    title: "Sun and wind", sub: "Solar and wind hotspots in North India",
    fly: "/#sun-and-wind",
    img: { src: "/work/ni-hotspots-3d-v1", w: 1600, h: 1213, alt: "Oblique 3D map of North India from the south: suitability from low to high, solar, wind and hybrid hotspots in western Rajasthan, and the 400 kV and 765 kV grid.",
      caption: "Hotspots, suitability and the 220 kV+ grid, seen from the south.",
      credit: "Global Solar Atlas 2.0 and Global Wind Atlas 3 (World Bank/ESMAP, CC BY 4.0), ESA WorldCover 2021, SRTM via AWS Terrain Tiles, OpenStreetMap contributors (ODbL), MNRE, CEA." },
    stats: [
      { num: "297", unit: "GW of solar in 36 hotspots" },
      { num: "72", unit: "GW of wind in 13 hotspots" },
      { num: "99%", unit: "of the solar within 10 km of a 220 kV+ line" },
    ],
    facts: [
      ["Problem", "Where in India's Northern grid region do sunshine or wind, open flat land and the 220 kV+ grid line up for utility-scale plants?"],
      ["Scope", "Ten states and union territories, 898,496 km², on a 1 km analysis grid."],
      ["Data", "Global Solar Atlas, Global Wind Atlas, ESA WorldCover, SRTM, OpenStreetMap, the WRI Global Power Plant Database, GeoNames, Natural Earth and MNRE."],
      ["Method", "Available land from land cover, slope, elevation and protected areas; AHP-weighted suitability (consistency ratios 0.013 and 0.015); hotspots from top-scoring clusters, split at saddles of the smoothed score."],
      ["Results", "36 solar hotspots (297 GW) and 13 wind hotspots (72 GW). 9 sites suit both, for hybrid parks on one grid connection."],
      ["Limits", "Technical potential is not economic potential, distance to a line says nothing about its spare capacity, and OpenStreetMap misses many plants."],
      ["Use", "Screening for solar, wind and hybrid parks; agrivoltaics, canal-top and rooftop solar where open land is scarce."],
      ["Tools", "Python (numpy, tifffile) · AHP · raster processing · OpenStreetMap · cartography · three.js"],
    ],
  },
  {
    id: "himachal", kind: "Independent project",
    title: "Himachal from orbit", sub: "Forests, snow, floods and landslides from satellite data", place: "Himachal Pradesh",
    fly: "/#himachal-from-orbit",
    img: { src: "/work/hp-sentinel2-v1", w: 1600, h: 1066, alt: "Sentinel-2 natural colour image of Himachal Pradesh: snow on the high Himalaya in the north-east, forested ranges and valleys, and the plains to the south-west.",
      caption: "Sentinel-2 imagery of Himachal Pradesh, 9 November 2025.",
      credit: "Contains modified Copernicus Sentinel data 2025." },
    stats: [
      { num: "62.6", unit: "km² of forest lost since 2000" },
      { num: "17.2", unit: "km² of floodwater on 22 August 2023" },
      { num: "0.78", unit: "AUC on 2025's landslides, unseen in training" },
    ],
    facts: [
      ["Problem", "How are Himachal Pradesh's forests, snow, rivers and slopes changing, and where is the risk?"],
      ["Scope", "Himachal Pradesh, 55,673 km², from about 300 m to peaks over 6,500 m."],
      ["Data", "Copernicus Sentinel-1 and Sentinel-2, Copernicus GLO-30, Hansen Global Forest Change, MODIS snow cover, RGI 7.0 glaciers, JRC Global Surface Water, ESA WorldCover, CHIRPS and OpenStreetMap."],
      ["Method", "Forest loss by district and slope; a monthly MODIS snow climatology with Mann-Kendall tests and Sen's slope; Sentinel-1 flood mapping with an Otsu threshold; a random forest on 15 factors for landslide susceptibility."],
      ["Results", "0.46% of 2000's forest lost by 2025. No significant basin-wide snow trend, except the Parbati in late summer. 20.3 km of road under water on 22 August 2023."],
      ["Limits", "Radar and optical flood extents agree only moderately (kappa 0.52). Susceptibility ranks where slopes may fail, not when."],
      ["Use", "Flood outlines, flooded roads and counts written out for PostGIS, for planners and relief teams; slope risk for planning."],
      ["Tools", "Sentinel-1 SAR · Sentinel-2 · MODIS · random forest · Mann-Kendall · PostGIS · three.js"],
    ],
  },
];

export const ALSO = [
  { title: "Paper Peaks", h: 974, text: "Vintage survey sheets raised into 3D terrain: old paper, new mountains.", img: "/work/paper-peaks-v1",
    alt: "A 1:250,000 survey sheet of Simla, its relief raised into 3D so the paper map casts shadows.", href: "/#paper-peaks", link: "See it in the flight" },
];

// Datasets and the projects that used them (only associations the project material supports).
export const DATASETS = [
  ["AHN6", "Utilities in 3D"],
  ["GWSW (PDOK)", "Utilities in 3D"],
  ["SRTM", "Neugal · Sun and wind"],
  ["Copernicus Sentinel-2", "Neugal · Himachal"],
  ["Copernicus Sentinel-1", "Himachal"],
  ["Copernicus GLO-30", "Himachal"],
  ["ESA WorldCover", "Sun and wind · Himachal"],
  ["MODIS", "Himachal"],
  ["CHIRPS", "Himachal"],
  ["Global Solar Atlas", "Sun and wind"],
  ["Global Wind Atlas", "Sun and wind"],
  ["OpenStreetMap", "All four"],
];
