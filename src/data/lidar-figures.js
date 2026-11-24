// Figures, chart rows and copy for the Utilities in 3D case study (src/pages/work/utilities-in-3d.astro). Every
// number is read from src/data/lidar-stats.json (tools/lidar/analyse_lidar.py, from the same AHN6, GWSW and
// OpenStreetMap cache as the stop in the flight), so text, charts and tables cannot drift apart. The two flows quote
// the stop's own copy (src/scripts/lidar.js) and tools/lidar/build_lidar.py.
import S from "./lidar-stats.json";

export const { survey, power, sewers } = S;
export const n = (v, d = 0) => v.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
export const m = (v, d = 1) => `${n(v, d)} m`;
export const km = (v) => `${n(v, 2)} km`;
export const pc = (v) => `${n(v, v >= 1 ? 1 : 2)}%`;
export const word = (v) => ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][v] ?? n(v);
const range = (vs, d = 1, unit = " m") => `${n(Math.min(...vs), d)}–${n(Math.max(...vs), d)}${unit}`; // tables
export const between = (vs, d = 1, unit = " m") => `${n(Math.min(...vs), d)} to ${n(Math.max(...vs), d)}${unit}`; // prose
const sum = (vs) => vs.reduce((a, b) => a + b, 0);
export const count = (v) => n(v);
const KV = { 380: { name: "380 kV", cls: "s-yellow" }, 110: { name: "110 kV", cls: "s-blue" } };
const kv = (v) => KV[v];
export const CREDIT = "Point cloud: AHN6, Het Waterschapshuis. Power lines © OpenStreetMap contributors.";
export const SEWER_CREDIT = "Sewers and pumping stations: GWSW via PDOK (CC0). Point cloud: AHN6, Het Waterschapshuis.";

// ---- the survey ----
export const share = (c) => (c / survey.points) * 100;
const CLASS_NAMES = [
  ["ground", "Ground"], ["tree", "Trees, 2.5 m and up"], ["low", "Other, under 2.5 m"], ["building", "Buildings"],
  ["wire", "Wires"], ["water", "Water"], ["tower", "Pylons"], ["civil", "Civil structures"],
];
const classes = CLASS_NAMES.map(([k, label]) => ({ label, count: survey.classes[k] })).sort((a, b) => b.count - a.count);
export const classRows = classes.map((c) => [c.label, n(c.count), pc(share(c.count))]);
export const classBars = classes.map((c) => ({
  label: c.label, value: c.count, text: pc(share(c.count)),
  tip: { h: c.label, r: [[n(c.count), "returns", "s-blue"], [pc(share(c.count)), "of the cloud", ""]] },
  aria: `${c.label}: ${n(c.count)} returns, ${pc(share(c.count))}`,
}));
export const classNote = `Share of all ${n(survey.points)} returns.`;
export const lineReturns = survey.classes.wire + survey.classes.tower;
export const flown = new Date(`${survey.scan.dates[0]}T00:00:00Z`)
  .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
export const passes = survey.scan.lines === 1 ? "once" : survey.scan.lines === 2 ? "twice" : `${word(survey.scan.lines)} times`;
export const passNoun = survey.scan.lines === 1 ? "one pass" : `${word(survey.scan.lines)} passes`;
export const seconds = n(survey.scan.minutes * 60);

// ---- the wires ----
const spans = [...power.spans].sort((a, b) => b.kv - a.kv || b.length - a.length);
const wiresOf = (k, whole = false) => spans.filter((s) => s.kv === k && (!whole || s.full)).flatMap((s) => s.wires);
export const pylons = (k) => power.pylons.filter((p) => p.kv === k).map((p) => p.height);
export const lowest = (k) => Math.min(...wiresOf(k).map((w) => w.low));
export const tension = (k) => between(wiresOf(k, true).map((w) => w.c), 0);
export const spanSags = spans.filter((s) => s.kv === 380 && s.full).sort((a, b) => a.length - b.length)
  .map((s, i) => `${i ? "; the" : "The"} ${n(s.length)} m span sags ${between(s.wires.map((w) => w.sag))}`).join("");
export const sagKeys = [{ label: KV[380].name, cls: KV[380].cls, dot: true }, { label: KV[110].name, cls: KV[110].cls, dot: true }];
export const sagRows = spans.map((s) => ({
  label: m(s.length), sub: s.full ? kv(s.kv).name : `${kv(s.kv).name} · ${n(s.over * 100)}% in the block`,
  dots: s.wires.map((w) => ({
    v: w.sag, cls: kv(s.kv).cls,
    tip: { h: `${m(s.length)} span, ${kv(s.kv).name}`,
      r: [[m(w.sag, 2), "sag", kv(s.kv).cls], [m(w.low), "lowest above the ground", ""], [n(w.hits), "returns fitted", ""]] },
    aria: `${kv(s.kv).name}, ${m(s.length)} span: sag ${m(w.sag, 2)}, lowest ${m(w.low)} above the ground`,
  })),
}));
export const wireHead = ["Span", "Line", "Sag", "Lowest above ground", "Span² ÷ 8 sag", "Returns"];
export const wireRows = spans.flatMap((s) => s.wires.map((w) => [m(s.length), kv(s.kv).name, m(w.sag, 2), m(w.low), m(w.c, 0), n(w.hits)]));
export const spanHead = ["Span", "Line", "In the block", "Wires", "Sag", "Lowest above ground", "Span² ÷ 8 sag"];
export const spanRows = spans.map((s) => [m(s.length), kv(s.kv).name, s.full ? "All" : `${n(s.over * 100)}%`, s.wires.length,
  range(s.wires.map((w) => w.sag), 2), range(s.wires.map((w) => w.low)), range(s.wires.map((w) => w.c), 0)]);
export const spanCaption = `The ${word(spans.length)} spans`;
export const SAG_TERMS = [
  { key: "span", show: "L²", def: "The span between two pylons, squared, in square metres." },
  { key: "sag", show: "8 s", op: "÷", def: "Eight times the sag: how far the wire hangs below the straight line between its ends." },
];

// ---- trees by the wires: both lines together, the first 5 m ----
export const clr = power.clearance;
const STEP = clr.hist.step, BINS = Math.round(5 / STEP);
const near110 = clr.hist.kv["110"].slice(0, BINS), near380 = clr.hist.kv["380"].slice(0, BINS);
const nearAll = near110.map((v, i) => v + near380[i]);
const binName = (i) => `${n(i * STEP, 1)}–${n((i + 1) * STEP, 1)} m`;
export const nearCats = nearAll.map((_, i) => binName(i));
export const nearSeries = [{ name: "tree returns", cls: "s-blue", values: nearAll }];
export const nearTicks = [0, 1, 2, 3, 4, 5].map((v) => ({ at: v / 5, label: v === 5 ? "5 m" : String(v) }));
export const nearHead = ["Distance", "Tree returns", "110 kV", "380 kV"];
export const nearRows = nearAll.map((v, i) => [binName(i), n(v), n(near110[i]), n(near380[i])]);
export const nearNote = `Distance to the nearest wire in ${n(STEP * 100)} cm steps, both lines together.`;
export const clearFrom = nearAll.findIndex((v) => v > 0) * STEP;
export const inPatches = sum(power.patches.map((p) => p.returns));
const patchLines = [...new Set(power.patches.map((p) => p.kv))];
export const patchCaption = patchLines.length === 1
  ? `The ${word(power.patches.length)} patches, all by the ${kv(patchLines[0]).name} line` : `The ${word(power.patches.length)} patches`;
export const patchHead = ["Patch", "Tree returns", "Nearest a wire", "Across"];
export const patchRows = power.patches.map((p, i) => [String(i + 1), n(p.returns), m(p.nearest), m(p.spread)]);
export const treesAlt = `The 110 kV span between its ${n(sum(pylons(110)) / pylons(110).length)} m pylons over trees in green, the tree returns nearest its wires in orange and labelled ${m(clr.tree)} from a wire, and a 380 kV pylon in the foreground.`;

// ---- sewers ----
const NET = { storm: "Storm drains", foul: "Foul sewers", pressure: "Pressure mains", combined: "Combined sewers", overflow: "Overflow pipes" };
const OTHER = "Combined and overflow";
const years = sewers.years.km;
const yearOf = (i) => sewers.years.from + i * sewers.years.step;
const YEARS = years.storm.map((_, i) => yearOf(i));
const other = years.combined.map((v, i) => Math.round((v + years.overflow[i]) * 100) / 100);
const yearTotal = YEARS.map((_, i) => years.storm[i] + years.foul[i] + years.pressure[i] + other[i]);
const busiest = YEARS.map((y, i) => ({ y, t: yearTotal[i] })).sort((a, b) => b.t - a.t).map((b) => b.y);
const both = (ys) => [...ys].sort((a, b) => a - b).join(" and ");
export const busiestYears = both(busiest.slice(0, 2)), nextYears = both(busiest.slice(2, 4));
export const kmText = (v) => (v < 1 ? `${n(v * 1000)} m` : `${n(v, 1)} km`);
export const combinedSince = yearOf(years.combined.findIndex((v) => v > 0));
const totalKm = sum(Object.values(sewers.km));
export const sewerKm = n(totalKm, 1);
export const concrete = n((sewers.material.Beton / totalKm) * 100);
export const egg = n((sewers.shape.Eivormig / totalKm) * 100);
export const mainSize = (k) => n(Number(Object.entries(sewers.width[k]).sort((a, b) => b[1] - a[1])[0][0]));
const laid = (k) => {
  const ys = YEARS.filter((_, i) => years[k][i] > 0);
  return ys.length ? (ys[0] === ys[ys.length - 1] ? String(ys[0]) : `${ys[0]}–${ys[ys.length - 1]}`) : "Unknown";
};
const nets = Object.keys(NET).sort((a, b) => sewers.km[b] - sewers.km[a]);
export const netHead = ["Network", "Length", "Pipes", "Main size", "Laid"];
export const netRows = nets.map((k) => [NET[k], km(sewers.km[k]), n(sewers.pipes[k]), `${mainSize(k)} mm`, laid(k)]);
export const pump = sewers.pumps[0];
export const weirs = sewers.overflows;
export const sewersAlt = `The sewer network beneath the block, each kind of pipe in its own colour, with pumping station ${pump.name} labelled.`;
export const yearTitle = `Sewer laid each year, ${YEARS[0]} to ${YEARS[YEARS.length - 1]}`;
export const yearKeys = [{ label: NET.storm, cls: "s-blue" }, { label: NET.foul, cls: "s-orange" }, { label: NET.pressure, cls: "s-aqua" },
  { label: OTHER, cls: "s-gray" }];
export const yearSeries = [ // bottom up
  { name: OTHER, cls: "s-gray", values: other },
  { name: NET.storm, cls: "s-blue", values: years.storm },
  { name: NET.foul, cls: "s-orange", values: years.foul },
  { name: NET.pressure, cls: "s-aqua", values: years.pressure },
];
export const yearCats = YEARS.map(String);
export const yearTicks = [1990, 1995, 2000, 2005].map((y) => ({ at: (YEARS.indexOf(y) + 0.5) / YEARS.length, label: String(y) }));
export const kmTick = (v) => `${v} km`;
export const kmOrDash = (v) => (v ? km(v) : "–");
export const yearHead = ["Year", NET.storm, NET.foul, NET.pressure, OTHER, "Total"];
export const yearRows = YEARS.flatMap((y, i) => (yearTotal[i] > 0
  ? [[String(y), ...[years.storm[i], years.foul[i], years.pressure[i], other[i]].map(kmOrDash), km(yearTotal[i])]] : []));
export const depth = sewers.depth;
const DEPTH_TOP = depth.count.length * depth.step;
const depthName = (i) => `${n(i * depth.step, 2)}–${n((i + 1) * depth.step, 2)} m`;
export const depthCats = depth.count.map((_, i) => depthName(i));
export const depthSeries = [{ name: "manholes", cls: "s-blue", values: depth.count }];
export const depthTicks = [0, 1, 2, 3].map((v) => ({ at: v / DEPTH_TOP, label: v === 3 ? "3 m" : String(v) }));
export const depthMarker = { at: depth.median / DEPTH_TOP, label: `Median ${m(depth.median, 2)}` };
export const depthRows = depth.count.flatMap((v, i) => (v ? [[depthName(i), n(v)]] : []));
export const depthNote = `Ground to the lowest pipe, in ${n(depth.step * 100)} cm steps.`;

// ---- where the foul water goes: the stop's own copy (src/scripts/lidar.js, "Where the water goes") ----
export const WATER = [
  { name: "Foul sewers", text: `${kmText(sewers.km.foul)} of foul sewer under the block, all of it draining to one pumping station.` },
  { name: "Mains in", text: "Two pressure mains bring more: 4.8 km of main from the water board's Hoge Hexel station to the north-west, and a chain of pump pits from the west." },
  { name: pump.name, text: `The block's pumping station: ${n(pump.m3h, 1)} m³ an hour.` },
  { name: "Main out", text: `${pump.name} pumps it all 1.1 km south-east, into the main from the water board's Wierden pumping station.` },
  { name: "Treatment plant", text: "That main runs north-east toward the Almelo-Vissedijk treatment plant, 3.4 km east of the block." },
];

// ---- from laser to browser: tools/lidar/build_lidar.py ----
export const PIPELINE = [
  { name: "AHN6 tiles", text: "The block's COPC tiles from AHN6, the Dutch national survey by Het Waterschapshuis, read for the box: position, true colour, GPS time, flight line and AHN's class for every return." },
  { name: "Ground", text: "A 1 m terrain grid from the ground returns, gaps filled from the nearest ground cell, and every return's height above it. Unclassified returns 2.5 m or more up count as trees." },
  { name: "Pylons and spans", text: "OpenStreetMap's power routes and towers give the spans. AHN puts pylons in the wire class too, so wire returns round an OSM tower become the tower." },
  { name: "Wires", text: "Per span the other wire returns split into chains of nearby points that join into wires, each fitted with a hanging parabola: its sag, its lowest point and its clearance to trees and roofs." },
  { name: "Sewers", text: "The municipality's GWSW pipes, pumps and overflow chambers from PDOK: gravity pipes at their recorded invert levels above NAP, pressure mains at a nominal depth, each pipe turned to run the way its water flows." },
  { name: "Export", text: "Returns thinned on a voxel grid, with every wire and pylon return kept for desktops, then quantised to 16 bits and written in GPS-time order so the stop can replay the scan. Phones get a lighter file." },
  { name: "The stop", text: "three.js draws it all in the flight on the home page: the scan replayed as it was flown, the classes, the wires, the trees near them and the sewers below the street." },
];
