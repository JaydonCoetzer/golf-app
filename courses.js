'use strict';
/* South African course directory and scorecards from OpenStreetMap (free, no account).
   - The list of every mapped golf course in South Africa is downloaded once and cached for 30 days.
   - Picking a course loads its holes: par, stroke index (OSM "handicap" tag), hole length,
     and the tee / green / bunker / water positions so the GPS map works straight away.
   - Anything missing can be filled in by hand once; it's saved on the phone for next time. */

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const SA_KEY = 'gs.saCourses';
const CD = { list: (load(SA_KEY, null) || {}).list || null, loading: false, hits: [] };

async function overpass(q) {
  let last;
  for (const u of OVERPASS) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (r.ok) return await r.json();
      last = new Error('HTTP ' + r.status);
    } catch (e) { last = e; }
  }
  throw last || new Error('offline');
}

async function loadSACourses(force) {
  const cached = load(SA_KEY, null);
  if (!force && cached && cached.list && Date.now() - cached.at < 30 * 864e5) return (CD.list = cached.list);
  if (CD.loading) return CD.list;
  CD.loading = true;
  try {
    const j = await overpass('[out:json][timeout:90];area["ISO3166-1"="ZA"][admin_level=2]->.za;nwr["leisure"="golf_course"]["name"](area.za);out tags center;');
    const seen = new Map();
    for (const e of j.elements) {
      const lat = e.center ? e.center.lat : e.lat, lon = e.center ? e.center.lon : e.lon;
      if (lat == null || !e.tags || !e.tags.name) continue;
      const name = e.tags.name.trim(), k = name.toLowerCase();
      const town = e.tags['addr:city'] || e.tags['addr:suburb'] || e.tags['is_in:city'] || '';
      if (!seen.has(k)) seen.set(k, { name, lat, lon, town });
    }
    CD.list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    save(SA_KEY, { at: Date.now(), list: CD.list });
  } catch (e) { /* offline: keep whatever we had */ }
  CD.loading = false;
  return CD.list;
}

/* Search box (home + new round): saved courses first, then the South African directory. */
function courseSearch(q, sel) {
  const el = $(sel); if (!el) return;
  const query = q.trim().toLowerCase();
  if (!query) { el.innerHTML = ''; return; }
  const words = query.split(/\s+/);
  const match = n => words.every(w => n.toLowerCase().includes(w));
  const hits = [];
  const seen = new Set();
  for (const c of allCourses()) if (match(c.name) && !seen.has(c.name.toLowerCase())) { seen.add(c.name.toLowerCase()); hits.push({ name: c.name, saved: true, holes: c.pars.length, center: c.center }); }
  if (CD.list) for (const c of CD.list) if ((match(c.name) || (c.town && match(c.name + ' ' + c.town))) && !seen.has(c.name.toLowerCase())) { seen.add(c.name.toLowerCase()); hits.push({ name: c.name, town: c.town, center: [c.lat, c.lon] }); }
  CD.hits = hits.slice(0, 8);
  const titled = query.replace(/\b\w/g, c => c.toUpperCase());
  el.innerHTML = `<div class="h-results">${CD.hits.map((h, i) => `<button data-act="pickHit" data-v="${i}"><span class="hr-n"><b>${esc(h.name)}</b><small>${h.saved ? `Saved · ${h.holes} holes` : esc(h.town || 'South Africa')}</small></span><span>Play ›</span></button>`).join('')}
    ${!CD.list ? `<div class="hr-msg">${CD.loading ? 'Loading South African courses…' : 'Connect to the internet to search all South African courses.'}</div>` : ''}
    ${CD.hits.some(h => h.name.toLowerCase() === query) ? '' : `<button data-act="pickNew" data-v="${esc(titled)}"><span class="hr-n"><b>+ New course: “${esc(titled)}”</b><small>Enter pars yourself</small></span><span>Set up ›</span></button>`}</div>`;
  if (!CD.list && !CD.loading) loadSACourses().then(() => { const i = document.querySelector(`${sel === '#homeResults' ? '.h-search input' : '#dCourse'}`); if (i && i.value.trim()) courseSearch(i.value, sel); });
}

/* Download one course's holes + layout. Returns { holes: n, found: {par, si, len} } and stores the course. */
async function fetchCourseCard(name, center) {
  const [lat, lon] = center;
  const A = `(around:2500,${lat},${lon})`;
  const j = await overpass(`[out:json][timeout:60];(way["golf"="hole"]${A};way["golf"="green"]${A};way["golf"="bunker"]${A};way["natural"="water"]${A};way["golf"~"water_hazard|lateral_water_hazard"]${A};);out geom;`);
  const els = j.elements.filter(e => e.tags && e.geometry && e.geometry.length > 1);
  const lineLen = g => { let d = 0; for (let i = 1; i < g.length; i++) d += dist([g[i - 1].lat, g[i - 1].lon], [g[i].lat, g[i].lon]); return d; };
  // pick, for each hole number, the hole line closest to the course centre (clubs with 27/36 holes reuse numbers)
  const byN = {};
  for (const e of els) {
    if (e.tags.golf !== 'hole') continue;
    const n = parseInt(e.tags.ref, 10); if (!(n >= 1 && n <= 18)) continue;
    const mid = e.geometry[Math.floor(e.geometry.length / 2)];
    const dc = dist([mid.lat, mid.lon], center);
    if (byN[n] && byN[n].dc <= dc) continue;
    const distTag = parseFloat(String(e.tags.dist || '').replace(',', '.'));
    byN[n] = { dc, e, par: parseInt(e.tags.par, 10) || null, si: parseInt(e.tags.handicap, 10) || null,
      len: isFinite(distTag) && distTag > 40 ? distTag : Math.round(lineLen(e.geometry)) };
  }
  const nums = Object.keys(byN).map(Number);
  const count = nums.length >= 10 ? 18 : nums.length ? 9 : 0;
  const greens = els.filter(e => e.tags.golf === 'green' && e.geometry.length > 2).map(e => { const poly = e.geometry.map(p => [p.lat, p.lon]); return { poly, c: centroid(poly) }; });
  const hazards = els.filter(e => e.geometry.length > 2 && (e.tags.golf === 'bunker' || e.tags.natural === 'water' || /water_hazard/.test(e.tags.golf || '')))
    .map(e => ({ t: e.tags.golf === 'bunker' ? 'bunker' : 'water', poly: e.geometry.map(p => [p.lat, p.lon]) })).slice(0, 400);

  // GPS layout for the map, saved under the course name
  const key = name.trim().toLowerCase();
  const geo = (S.geo[key] = S.geo[key] || { holes: {}, greens: [] });
  geo.center = center; geo.greens = greens; geo.hazards = hazards; geo.tried = true; geo.hz = true;
  for (const n of nums) {
    if (geo.holes[n] && geo.holes[n].manual) continue;
    const g = byN[n].e.geometry, end = [g[g.length - 1].lat, g[g.length - 1].lon];
    let best = null, bd = 1e9;
    for (const gr of greens) { const d = inPoly(end, gr.poly) ? 0 : dist(end, gr.c); if (d < bd) { bd = d; best = gr; } }
    geo.holes[n] = Object.assign(best && bd < 60 ? { c: best.c, poly: best.poly } : { c: end }, { tee: [g[0].lat, g[0].lon] });
  }
  saveGeo();

  if (!count) return { holes: 0 };
  const existing = S.courses.find(c => sameCourse(c.name, name)) || BUILTIN_COURSES.find(c => sameCourse(c.name, name));
  const pars = [], si = [], len = [];
  let fp = 0, fs = 0;
  for (let n = 1; n <= count; n++) {
    const h = byN[n];
    const ep = existing && existing.pars[n - 1], es = existing && existing.si && existing.si[n - 1];
    pars.push(ep || (h && h.par) || (h && h.len ? (h.len < 230 ? 3 : h.len > 430 ? 5 : 4) : STD_PARS[n - 1]));
    si.push(es || (h && h.si) || null);
    len.push(h ? h.len : null);
    if (h && h.par) fp++; if (h && h.si) fs++;
  }
  const course = { name, pars, si: si.every(Boolean) ? si : null, len, center, tees: existing ? existing.tees || '' : '', cr: existing && existing.cr, slope: existing && existing.slope };
  const i = S.courses.findIndex(c => sameCourse(c.name, name));
  if (i >= 0) S.courses.splice(i, 1);
  S.courses.unshift(course);
  persist();
  return { holes: count, found: { par: fp, si: fs, len: nums.length }, course };
}

async function chooseCourse(name, center) {
  S.view = 'play'; S.activeId = null;
  const existing = S.courses.find(c => sameCourse(c.name, name)) || BUILTIN_COURSES.find(c => sameCourse(c.name, name));
  S.draft = draftFrom(existing || null, { date: localDate(), hcp: S.settings.hcp ?? '' });
  S.draft.course = name;
  if (!center) { render(); return; }
  S.draft.status = { busy: true, msg: 'Loading the scorecard and course map…' };
  render();
  try {
    const res = await fetchCourseCard(name, center);
    if (!S.draft || !sameCourse(S.draft.course, name)) return;
    if (!res.holes) {
      S.draft.status = { msg: `No hole data for ${name} on the map yet. Check the pars below (tap to change). They're saved after your round. GPS works once you set each green.`, warn: true };
    } else {
      const keep = { date: S.draft.date, hcp: S.draft.hcp };
      S.draft = draftFrom(res.course, keep);
      const f = res.found;
      const missing = [];
      if (f.par < res.holes) missing.push('some pars (guessed from length)');
      if (f.si < res.holes) missing.push('stroke index');
      S.draft.status = { msg: `Loaded ${res.holes} holes${f.len ? ' with lengths and greens for GPS' : ''}.${missing.length ? ` Missing: ${missing.join(', ')}. Check the card and tap a hole to fix the par.` : ''}`, ok: !missing.length };
    }
  } catch (e) {
    if (S.draft) S.draft.status = { msg: 'Couldn\'t reach the course database (no signal?). Enter the pars yourself, or try again with signal.', warn: true, retry: true, center };
  }
  render();
}

Object.assign(ACTIONS, {
  pickHit(v) { const h = CD.hits[Number(v)]; if (h) chooseCourse(h.name, h.center); },
  pickNew(v) { chooseCourse(v, null); },
  retryCourse() { const d = S.draft; if (d && d.status && d.status.center) chooseCourse(d.course, d.status.center); },
});

// warm the directory in the background so search is instant
if (navigator.onLine !== false) setTimeout(() => loadSACourses(), 1500);
