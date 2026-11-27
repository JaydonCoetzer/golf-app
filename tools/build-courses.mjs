// Builds data/za/index.json and data/za/<id>.json from OpenStreetMap (Overpass API).
// Run by .github/workflows/courses.yml (yearly + on demand). Node 20+, no dependencies.
import { writeFileSync, mkdirSync, readdirSync, unlinkSync, readFileSync } from 'node:fs';
let CARDS = {}; try { CARDS = JSON.parse(readFileSync('data/scorecards.json', 'utf8')); } catch (e) {}

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const AREA = 'area["ISO3166-1"="ZA"][admin_level=2]->.za;';
const OUT = 'data/za';

async function overpass(q) {
  let err;
  for (let attempt = 0; attempt < 3; attempt++) for (const u of ENDPOINTS) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'golf-stats-course-builder' } });
      if (r.ok) return await r.json();
      err = new Error(`${u} HTTP ${r.status}`);
    } catch (e) { err = e; }
    await new Promise(r => setTimeout(r, 15000));
  }
  throw err;
}
const R = x => Math.round(x * 1e5) / 1e5;
const pt = p => [R(p.lat), R(p.lon)];
function dist(a, b) {
  const k = Math.PI / 180, x = Math.sin((b[0] - a[0]) * k / 2) ** 2 + Math.cos(a[0] * k) * Math.cos(b[0] * k) * Math.sin((b[1] - a[1]) * k / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}
const lineLen = g => g.slice(1).reduce((d, p, i) => d + dist([g[i].lat, g[i].lon], [p.lat, p.lon]), 0);
const centroid = poly => [R(poly.reduce((s, p) => s + p[0], 0) / poly.length), R(poly.reduce((s, p) => s + p[1], 0) / poly.length)];
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

console.log('Fetching courses…');
const cj = await overpass(`[out:json][timeout:300];${AREA}(way["leisure"="golf_course"](area.za);relation["leisure"="golf_course"](area.za););out tags bb;`);
console.log('course elements:', cj.elements.length);
const courses = [];
for (const e of cj.elements) {
  if (!e.bounds) continue;
  const b = e.bounds, pad = 0.0015;
  courses.push({ osm: `${e.type[0]}${e.id}`, name: ((e.tags && e.tags.name) || '').trim(), tags: e.tags || {}, center: [R((b.minlat + b.maxlat) / 2), R((b.minlon + b.maxlon) / 2)],
    bb: [b.minlat - pad, b.minlon - pad, b.maxlat + pad, b.maxlon + pad], area: (b.maxlat - b.minlat) * (b.maxlon - b.minlon), holes: [], greens: [], hazards: [] });
}
// courses mapped only as a single point: give them a ~1.3 km box so nearby holes and greens still attach
const nj = await overpass(`[out:json][timeout:300];${AREA}node["leisure"="golf_course"](area.za);out tags;`).catch(() => ({ elements: [] }));
for (const e of nj.elements) {
  const p = [R(e.lat), R(e.lon)];
  if (courses.some(c => p[0] >= c.bb[0] && p[0] <= c.bb[2] && p[1] >= c.bb[1] && p[1] <= c.bb[3])) continue;
  courses.push({ osm: `n${e.id}`, name: ((e.tags && e.tags.name) || '').trim(), tags: e.tags || {}, center: p, bb: [p[0] - 0.012, p[1] - 0.014, p[0] + 0.012, p[1] + 0.014], area: 1, holes: [], greens: [], hazards: [] });
}
console.log(courses.length, 'courses');

console.log('Fetching golf features…');
const fj = await overpass(`[out:json][timeout:600];${AREA}(way["golf"~"^(hole|green|bunker|water_hazard|lateral_water_hazard)$"](area.za););out geom;`);
console.log('golf features:', fj.elements.length);
console.log('Fetching water inside courses…');
const wj = await overpass(`[out:json][timeout:300];${AREA}way["leisure"="golf_course"](area.za)->.gc;.gc map_to_area->.ga;way["natural"="water"](area.ga);out geom;`)
  .catch(e => { console.warn('water query failed:', e.message); return { elements: [] }; });

const owner = p => {
  let best = null;
  for (const c of courses) if (p[0] >= c.bb[0] && p[0] <= c.bb[2] && p[1] >= c.bb[1] && p[1] <= c.bb[3] && (!best || c.area < best.area)) best = c;
  return best;
};
for (const e of [...fj.elements, ...wj.elements]) {
  if (!e.geometry || e.geometry.length < 2) continue;
  const g = e.geometry, c = owner(pt(g[Math.floor(g.length / 2)]));
  if (!c) continue;
  const t = e.tags || {};
  if (t.golf === 'hole') {
    const n = parseInt(t.ref, 10); if (!(n >= 1 && n <= 27)) continue;
    const dt = parseFloat(String(t.dist || '').replace(',', '.'));
    c.holes.push({ n, par: parseInt(t.par, 10) || null, si: parseInt(t.handicap, 10) || null,
      len: Math.round(isFinite(dt) && dt > 40 ? dt : lineLen(g)), tee: pt(g[0]), end: pt(g[g.length - 1]), mid: pt(g[Math.floor(g.length / 2)]) });
  } else if (t.golf === 'green' && g.length > 2) {
    const poly = g.map(pt); c.greens.push({ poly, c: centroid(poly) });
  } else if (g.length > 2) {
    c.hazards.push({ t: t.golf === 'bunker' ? 'bunker' : 'water', poly: g.map(pt) });
  }
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(`${OUT}/${f}`);
const index = [], used = new Set();
for (const c of courses) {
  if (!c.name && !c.holes.length) continue;
  const name = c.name || 'Unnamed golf course';
  let id = slug(name) || c.osm; if (used.has(id)) id = `${id}-${c.osm}`; used.add(id);
  // one line per hole number (closest to the course centre when a club reuses numbers)
  const byN = {};
  for (const h of c.holes) { const d = dist(h.mid, c.center); if (!byN[h.n] || d < byN[h.n].d) byN[h.n] = { ...h, d }; }
  const holes = Object.values(byN).sort((a, b) => a.n - b.n).map(h => {
    let best = null, bd = 1e9;
    for (const gr of c.greens) { const d = inPoly(h.end, gr.poly) ? 0 : dist(h.end, gr.c); if (d < bd) { bd = d; best = gr; } }
    return { n: h.n, par: h.par, si: h.si, len: h.len, tee: h.tee, green: best && bd < 60 ? { c: best.c, poly: best.poly } : { c: h.end } };
  });
  const card = CARDS[id];
  if (card) for (const x of card.holes) { const h = holes.find(y => y.n === x.n); if (h) { h.par = h.par || x.par; h.si = h.si || x.si; h.len = h.len || x.len; } else holes.push({ n: x.n, par: x.par, si: x.si, len: x.len, ...(x.tee ? { tee: x.tee } : {}), ...(x.green ? { green: x.green } : {}) }); }
  holes.sort((a, b) => a.n - b.n);
  const t = c.tags;
  const town = t['addr:city'] || t['addr:suburb'] || t['addr:town'] || t['is_in:city'] || '';
  const full = { id, name, town, center: c.center, osm: c.osm, website: t.website || t['contact:website'] || '', phone: t.phone || t['contact:phone'] || '',
    holes, greens: c.greens, hazards: c.hazards.slice(0, 500) };
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(full));
  index.push({ id, name, town, c: c.center, h: holes.length, p: holes.filter(h => h.par).length, s: holes.filter(h => h.si).length });
}
index.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(`${OUT}/index.json`, JSON.stringify({ built: new Date().toISOString(), source: 'OpenStreetMap contributors (ODbL)', courses: index }));
console.log(`Wrote ${index.length} courses; ${index.filter(c => c.h >= 9).length} with 9+ mapped holes.`);
for (const c of index.filter(c => /parow|devon/i.test(c.name))) console.log('Parow check:', JSON.stringify(c));
