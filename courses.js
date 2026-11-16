'use strict';
/* Course search, nearby courses and scorecards.
   - Nearby: your GPS position + OpenStreetMap golf courses within 40 km (free, no account).
   - Search: OpenStreetMap place search, plus GolfCourseAPI when you've added a free key in More.
   - GolfCourseAPI gives the full scorecard per tee: par, stroke index, yardage, course rating and slope.
   - OpenStreetMap gives the hole layout (greens, tees, bunkers, water) for the GPS map, and par / SI / length when mapped.
   Everything you load is saved on the phone, so it works without signal next time. */

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const GCA = 'https://api.golfcourseapi.com/v1';
const CD = { hits: [], nearby: load('gs.nearby', null), nearbyBusy: false, timer: null, q: '' };

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


/* ---------- bundled course database (data/za, built yearly from OpenStreetMap) ---------- */
let DBP = null;
function loadDB() {
  if (!DBP) DBP = fetch('data/za/index.json').then(r => r.json()).then(j => (CD.db = (j && j.courses) || [])).catch(() => { DBP = null; return CD.db || []; });
  return DBP;
}
async function loadCourseFile(id) {
  const r = await fetch('data/za/' + encodeURIComponent(id) + '.json'); if (!r.ok) throw new Error('missing');
  return r.json();
}
/* Turn a database file into a saved course + GPS layout. */
function courseFromFile(f, name) {
  const key = name.trim().toLowerCase();
  const geo = (S.geo[key] = S.geo[key] || { holes: {}, greens: [] });
  geo.center = f.center; geo.greens = f.greens || []; geo.hazards = f.hazards || []; geo.tried = true; geo.hz = true;
  for (const h of f.holes) if (!(geo.holes[h.n] && geo.holes[h.n].manual)) geo.holes[h.n] = Object.assign({}, h.green, { tee: h.tee });
  saveGeo();
  const byN = Object.fromEntries(f.holes.map(h => [h.n, h]));
  const count = f.holes.length >= 10 || f.holes.some(h => h.n > 9) ? 18 : f.holes.length ? 9 : 0;
  if (!count) return { holes: 0 };
  const existing = S.courses.find(c => sameCourse(c.name, name)) || BUILTIN_COURSES.find(c => sameCourse(c.name, name));
  const pars = [], si = [], len = []; let fp = 0, fs = 0;
  for (let n = 1; n <= count; n++) {
    const h = byN[n], ep = existing && existing.pars[n - 1], es = existing && existing.si && existing.si[n - 1];
    pars.push((h && h.par) || ep || (h && h.len ? (h.len < 230 ? 3 : h.len > 430 ? 5 : 4) : STD_PARS[n - 1]));
    si.push((h && h.si) || es || null); len.push(h ? h.len : null);
    if (h && h.par) fp++; if (h && h.si) fs++;
  }
  const course = Object.assign({}, existing || {}, { name, pars, si: si.every(Boolean) ? si : (existing && existing.si) || null, len, center: f.center });
  const i = S.courses.findIndex(c => sameCourse(c.name, name)); if (i >= 0) S.courses.splice(i, 1);
  S.courses.unshift(course); persist();
  return { holes: count, found: { par: fp, si: fs, len: f.holes.length }, course };
}

/* ---------- GolfCourseAPI (optional free key) ---------- */
async function gcaFetch(path) {
  const key = (S.settings.gcaKey || '').trim(); if (!key) return null;
  const r = await fetch(GCA + path, { headers: { Authorization: 'Key ' + key } });
  if (r.status === 401 || r.status === 403) throw new Error('key');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function gcaName(c) {
  const club = (c.club_name || '').trim(), course = (c.course_name || '').trim();
  return !course || club.toLowerCase().includes(course.toLowerCase()) ? club || course : course.toLowerCase().includes(club.toLowerCase()) ? course : `${club} – ${course}`;
}
function gcaCenter(c) { const l = c.location || {}; return l.latitude != null && l.longitude != null ? [Number(l.latitude), Number(l.longitude)] : null; }
function gcaTeeSets(c) {
  const out = [];
  for (const [g, list] of [['M', (c.tees || {}).male || []], ['L', (c.tees || {}).female || []]]) for (const t of list) {
    const holes = t.holes || []; if (!holes.length) continue;
    out.push({ name: t.tee_name || 'Tee', g, cr: t.course_rating || null, slope: t.slope_rating || null,
      pars: holes.map(h => h.par || 4), si: holes.every(h => h.handicap) ? holes.map(h => h.handicap) : null,
      len: holes.map(h => (h.yardage ? Math.round(h.yardage * 0.9144) : null)) });
  }
  return out;
}
async function gcaSearch(q) {
  try { const j = await gcaFetch('/search?search_query=' + encodeURIComponent(q)); return (j && j.courses) || []; }
  catch (e) { if (e.message === 'key') toast('Course database key not accepted. Check it in Settings'); return []; }
}

/* ---------- nearby (GPS + OpenStreetMap) ---------- */
function here() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no gps'));
    navigator.geolocation.getCurrentPosition(p => res([p.coords.latitude, p.coords.longitude]), rej, { enableHighAccuracy: false, maximumAge: 10 * 60000, timeout: 15000 });
  });
}
async function loadNearby(force) {
  if (CD.nearbyBusy) return;
  CD.nearbyBusy = true; paintNearby();
  try {
    const me = await here();
    const fresh = CD.nearby && Date.now() - CD.nearby.at < 864e5 && dist(me, CD.nearby.me) < 5000;
    const db = await loadDB();
    if (db.length) { CD.nearby = { at: Date.now(), me, list: db.map(c => ({ name: c.name, id: c.id, center: c.c, h: c.h })) }; }
    else if (force || !fresh) {
      const j = await overpass(`[out:json][timeout:25];nwr["leisure"="golf_course"]["name"](around:40000,${me[0]},${me[1]});out tags center;`);
      const seen = new Set(), list = [];
      for (const e of j.elements) {
        const lat = e.center ? e.center.lat : e.lat, lon = e.center ? e.center.lon : e.lon, n = e.tags && e.tags.name && e.tags.name.trim();
        if (!n || lat == null || seen.has(n.toLowerCase())) continue;
        seen.add(n.toLowerCase()); list.push({ name: n, center: [lat, lon] });
      }
      CD.nearby = { at: Date.now(), me, list }; save('gs.nearby', CD.nearby);
    }
    CD.nearby.me = me;
  } catch (e) { CD.nearbyErr = e && e.code === 1 ? 'Allow location to see courses near you.' : 'Couldn\'t load nearby courses (no signal?).'; }
  CD.nearbyBusy = false; paintNearby();
}
function paintNearby() {
  const el = $('#nearby'); if (!el) return;
  const N = CD.nearby;
  if (!N || !N.list) { el.innerHTML = `<div class="nb-card"><div class="nb-h">Courses near you</div><div class="hr-msg">${CD.nearbyBusy ? '<span class="spin"></span> Finding courses near you…' : esc(CD.nearbyErr || '')} ${CD.nearbyBusy ? '' : '<button class="chipbtn" data-act="nearbyRefresh">Find nearby</button>'}</div></div>`; return; }
  const list = N.list.map(c => ({ ...c, km: dist(N.me, c.center) / 1000 })).sort((a, b) => a.km - b.km).slice(0, $('#homeResults') ? 2 : 6);
  CD.nearHits = list;
  el.innerHTML = `<div class="nb-card"><div class="nb-h">Closest to you ${CD.nearbyBusy ? '<span class="spin"></span>' : '<button class="nb-r" data-act="nearbyRefresh" aria-label="Refresh">↻</button>'}</div>
    ${list.length ? list.map((c, i) => `<button class="nb-row" data-act="pickNear" data-v="${i}"><span class="hr-n"><b>${esc(c.name)}</b>${c.h ? `<small>${c.h} holes mapped</small>` : ''}</span><span>${c.km < 1 ? 'here' : c.km.toFixed(c.km < 10 ? 1 : 0) + ' km'} ›</span></button>`).join('') : '<div class="hr-msg">No golf courses found within 40 km.</div>'}</div>`;
}

/* ---------- search ---------- */
function courseSearch(q, sel) {
  const el = $(sel); if (!el) return;
  CD.q = q.trim(); CD.sel = sel;
  if (!CD.q) { el.innerHTML = ''; return; }
  if (!CD.db) loadDB().then(() => { if (CD.q) paintSearch(sel, true); });
  paintSearch(sel, true);
  clearTimeout(CD.timer);
  CD.timer = setTimeout(() => remoteSearch(CD.q, sel), 450);
}
function localHits(q) {
  const words = q.toLowerCase().split(/\s+/), match = n => words.every(w => n.toLowerCase().includes(w));
  const saved = allCourses().filter(c => match(c.name)).map(c => ({ name: c.name, saved: true, holes: c.pars.length, center: c.center || null, rated: !!(c.teeSets && c.teeSets.some(t => t.slope)) || !!c.slope }));
  const me = CD.nearby && CD.nearby.me;
  const db = (CD.db || []).filter(c => match(c.name + ' ' + (c.town || '')) && !saved.some(x => sameCourse(x.name, c.name)))
    .map(c => ({ name: c.name, id: c.id, center: c.c, town: c.town, mapped: c.h, km: me ? dist(me, c.c) / 1000 : null }))
    .sort((a, b) => (b.mapped >= 9) - (a.mapped >= 9) || (a.km ?? 1e9) - (b.km ?? 1e9));
  return [...saved, ...db];
}
async function remoteSearch(q, sel) {
  const [osm, gca] = await Promise.all([
    fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=za&limit=10&q=${encodeURIComponent(q + ' golf')}`).then(r => r.json()).catch(() => []),
    gcaSearch(q),
  ]);
  if (CD.q !== q) return;
  const me = CD.nearby && CD.nearby.me;
  const hits = [];
  for (const c of gca) hits.push({ name: gcaName(c), center: gcaCenter(c), gca: c, town: [c.location && c.location.city, c.location && c.location.country].filter(Boolean).join(', '), rated: gcaTeeSets(c).some(t => t.slope) });
  for (const p of osm) {
    if (!(p.type === 'golf_course' || /golf/i.test(p.name || p.display_name))) continue;
    const name = (p.name || p.display_name.split(',')[0]).trim(), center = [Number(p.lat), Number(p.lon)];
    if (hits.some(h => h.center && dist(h.center, center) < 3000) || hits.some(h => h.name.toLowerCase() === name.toLowerCase())) continue;
    hits.push({ name, center, town: p.display_name.split(',').slice(1, 3).join(',').trim() });
  }
  if (me) hits.forEach(h => { h.km = h.center ? dist(me, h.center) / 1000 : null; });
  hits.sort((a, b) => (b.rated ? 1 : 0) - (a.rated ? 1 : 0) || (a.km ?? 1e9) - (b.km ?? 1e9));
  CD.remote = { q, hits };
  paintSearch(sel, false);
}
function paintSearch(sel, busy) {
  const el = $(sel); if (!el) return;
  const local = localHits(CD.q);
  const remote = CD.remote && CD.remote.q === CD.q ? CD.remote.hits.filter(h => !local.some(l => l.name.toLowerCase() === h.name.toLowerCase())) : [];
  CD.hits = [...local, ...remote].slice(0, 10);
  const titled = CD.q.replace(/\b\w/g, c => c.toUpperCase());
  el.innerHTML = `<div class="h-results">${CD.hits.map((h, i) => `<button data-act="pickHit" data-v="${i}"><span class="hr-n"><b>${esc(h.name)}</b><small>${h.saved ? `Saved · ${h.holes} holes` : esc(h.town || 'South Africa')}${h.mapped ? ` · ${h.mapped} holes mapped` : ''}${h.rated ? ' · rating & slope' : ''}${h.km != null ? ` · ${h.km.toFixed(h.km < 10 ? 1 : 0)} km` : ''}</small></span><span>Play ›</span></button>`).join('')}
    ${busy ? '<div class="hr-msg"><span class="spin"></span> Searching courses…</div>' : !CD.hits.length ? '<div class="hr-msg">No course found with that name. Try fewer words, e.g. "Royal Cape".</div>' : ''}
    <button data-act="pickNew" data-v="${esc(titled)}"><span class="hr-n"><b>+ Create “${esc(titled)}” myself</b><small>Only if it isn't listed</small></span><span>›</span></button></div>`;
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


/* ---------- choosing a course + tees ---------- */
function applyTee(d, t) {
  d.pars = [...t.pars, ...STD_PARS.slice(t.pars.length)]; d.count = t.pars.length >= 18 ? 18 : t.pars.length;
  if (t.si) d.si = [...t.si];
  if (t.len && t.len.some(Boolean)) d.len = [...t.len];
  d.cr = t.cr || ''; d.slope = t.slope || ''; d.tees = t.name + (t.g === 'L' ? ' (ladies)' : '');
}
function teeChooser(d) {
  if (!d.teeSets || !d.teeSets.length) return '';
  return `<div><div class="field-title"><span>Your tees</span><span class="muted">sets par, SI, distance, rating & slope</span></div>
    <div class="chips">${d.teeSets.map((t, i) => `<button data-act="pickTee" data-v="${i}" class="${d.teeIdx === i ? 'on' : ''}">${esc(t.name)}${t.g === 'L' ? ' (L)' : ''}${t.cr ? ` · ${t.cr}/${t.slope}` : ''}</button>`).join('')}</div></div>`;
}
async function chooseCourse(hit) {
  const name = hit.name, center = hit.center;
  S.view = 'play'; S.activeId = null;
  const existing = S.courses.find(c => sameCourse(c.name, name)) || BUILTIN_COURSES.find(c => sameCourse(c.name, name));
  S.draft = draftFrom(existing || null, { date: localDate(), hcp: S.settings.hcp ?? '' });
  S.draft.course = name;
  if (existing && existing.teeSets) { S.draft.teeSets = existing.teeSets; S.draft.teeIdx = existing.teeIdx ?? 0; applyTee(S.draft, existing.teeSets[S.draft.teeIdx]); }
  S.draft.status = { busy: true, msg: 'Loading the scorecard and course map…' };
  render();

  // 1) scorecard with rating & slope (GolfCourseAPI, if a key is set)
  let gc = hit.gca || null;
  if (!gc && S.settings.gcaKey) {
    const res = await gcaSearch(name.replace(/golf (club|course|estate)/i, '').trim() || name);
    const words = n => (n || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(golf|club|course|estate|country|the|and)$/.test(w));
    const want = words(name);
    const sameName = c => { const w = words(gcaName(c) + ' ' + (c.club_name || '')); return want.length ? want.some(x => w.includes(x)) : true; };
    gc = res.filter(sameName).map(c => ({ c, d: center && gcaCenter(c) ? dist(center, gcaCenter(c)) : 0 })).filter(x => x.d < 8000).sort((a, b) => a.d - b.d).map(x => x.c)[0] || null;
  }
  const teeSets = gc ? gcaTeeSets(gc) : [];
  // 2) layout for GPS (+ par/SI/length if the card had none)
  let osm = null;
  let id = hit.id;
  if (!id) { const db = await loadDB(); const m = db.find(c => sameCourse(c.name, name) || (center && dist(c.c, center) < 1500 && c.h)); if (m) id = m.id; }
  if (id) { try { osm = courseFromFile(await loadCourseFile(id), name); } catch (e) {} }
  if ((!osm || !osm.holes) && center) { try { osm = await fetchCourseCard(name, center); } catch (e) {} }
  if (!S.draft || !sameCourse(S.draft.course, name)) return;

  const keep = { date: S.draft.date, hcp: S.draft.hcp };
  if (teeSets.length) {
    const prevIdx = existing && existing.teeIdx != null && existing.teeSets && existing.teeSets[existing.teeIdx] ? teeSets.findIndex(t => t.name === existing.teeSets[existing.teeIdx].name && t.g === existing.teeSets[existing.teeIdx].g) : -1;
    const idx = prevIdx >= 0 ? prevIdx : Math.max(0, teeSets.findIndex(t => t.g === 'M'));
    S.draft = draftFrom(osm && osm.course || existing || null, keep); S.draft.course = name;
    S.draft.teeSets = teeSets; S.draft.teeIdx = idx; applyTee(S.draft, teeSets[idx]);
    if (!S.draft.si && osm && osm.course && osm.course.si) S.draft.si = [...osm.course.si];
    S.draft.status = { ok: true, msg: `Scorecard loaded: ${teeSets.length} tee${teeSets.length > 1 ? 's' : ''} with rating & slope. Pick your tees below.${osm && osm.holes ? ' GPS greens loaded too.' : ''}` };
    rememberCourse(S.draft);
  } else if (osm && osm.holes) {
    S.draft = draftFrom(osm.course, keep); S.draft.course = name;
    const f = osm.found, miss = [];
    if (f.par < osm.holes && !existing) miss.push('some pars (guessed from length)');
    if (!S.draft.si) miss.push('stroke index');
    miss.push('rating & slope');
    S.draft.status = { msg: `Loaded ${osm.holes} holes with GPS greens. Missing: ${miss.join(', ')}.${S.settings.gcaKey ? '' : ' Add a free course-database key in Settings to get rating & slope automatically.'}`, warn: true };
  } else if (existing) {
    S.draft.status = { msg: 'Using your saved card for this course.', ok: true };
  } else {
    S.draft.status = { msg: center ? `${name} isn't fully mapped yet. Check the pars below (tap to change). They're saved after your round.` : 'Enter the pars below. They\'re saved for next time.', warn: true, retry: !center ? false : true, center };
  }
  render();
}
function rememberCourse(d) {
  const i = S.courses.findIndex(c => sameCourse(c.name, d.course));
  const prev = i >= 0 ? S.courses[i] : {};
  const c = Object.assign({}, prev, { name: d.course, pars: d.pars.slice(0, d.count), si: d.si ? d.si.slice(0, d.count) : prev.si || null, len: d.len ? d.len.slice(0, d.count) : prev.len || null,
    teeSets: d.teeSets || prev.teeSets, teeIdx: d.teeIdx ?? prev.teeIdx, cr: d.cr || prev.cr || null, slope: d.slope || prev.slope || null, tees: d.tees || prev.tees || '' });
  if (i >= 0) S.courses.splice(i, 1);
  S.courses.unshift(c); persist();
}

function gcaCard() {
  return `<div class="card stack"><h2>Course database</h2>
    <div class="sub">Add a free key from <b>golfcourseapi.com</b> (sign up, then copy your API key here). Courses then load with every tee's <b>course rating, slope</b>, par, stroke index and distance. Without it, courses still load from the free map (pars, SI and lengths where mapped).</div>
    <input type="text" data-bind="gcaKey" value="${esc(S.settings.gcaKey || '')}" placeholder="Paste your API key" autocomplete="off" autocapitalize="off" spellcheck="false">
    ${S.settings.gcaKey ? '<button class="btn sm" data-act="gcaTest">Test key</button>' : ''}</div>`;
}

Object.assign(ACTIONS, {
  pickHit(v) { const h = CD.hits[Number(v)]; if (h) chooseCourse(h); },
  pickNear(v) { const h = (CD.nearHits || [])[Number(v)]; if (h) chooseCourse(h); },
  pickNew(v) { S.view = 'play'; S.activeId = null; S.draft = draftFrom(null, { date: localDate(), hcp: S.settings.hcp ?? '' }); S.draft.course = v; S.draft.status = { msg: 'Enter the pars below (tap a hole to change it). Saved for next time.' }; },
  pickTee(v) { const d = S.draft; d.teeIdx = Number(v); applyTee(d, d.teeSets[d.teeIdx]); rememberCourse(d); },
  retryCourse() { const d = S.draft; if (d && d.status && d.status.center) chooseCourse({ name: d.course, center: d.status.center }); },
  nearbyRefresh() { loadNearby(true); },
  async gcaTest() { const r = await gcaSearch('royal cape'); toast(r.length ? `Key works ✓ (${r.length} results)` : 'No results. Check the key'); },
});
