'use strict';
/* GPS map, distances to the green, and shot tracking.
   Satellite imagery: Esri World Imagery. Green outlines: OpenStreetMap (Overpass API), when the course is mapped.
   Greens you place yourself are saved per course on this phone. */

const CLUBS = [
  ['Dr', 'Driver'], ['3W', '3 wood'], ['5W', '5 wood'], ['Hy', 'Hybrid'], ['4i', '4 iron'], ['5i', '5 iron'], ['6i', '6 iron'],
  ['7i', '7 iron'], ['8i', '8 iron'], ['9i', '9 iron'], ['PW', 'Pitching wedge'], ['GW', 'Gap wedge'], ['SW', 'Sand wedge'],
  ['LW', 'Lob wedge'], ['Pt', 'Putter'],
];
const CLUB_NAME = Object.fromEntries(CLUBS);
const MISHITS = [['good', 'Good'], ['topped', 'Topped'], ['fat', 'Fat'], ['thin', 'Thin'], ['shank', 'Shank'], ['slice', 'Slice / push'], ['hook', 'Hook / pull']];
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

S.geo = load('gs.geo', {});
const saveGeo = () => save('gs.geo', S.geo);
const M = { map: null, layer: null, me: null, acc: null, watch: null, target: null, setFlag: false, club: 'Dr', wake: null, fittedMe: false, finding: false, lastShot: null };

/* ---------- geo maths ---------- */
function dist(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const centroid = poly => [sum(poly.map(p => p[0])) / poly.length, sum(poly.map(p => p[1])) / poly.length];
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > p[0]) !== (yj > p[0]) && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const toUnit = m => (S.settings.unit === 'yd' ? m / 0.9144 : m);
const fd = m => (m == null ? '–' : String(Math.round(toUnit(m))));
const zoneMetres = () => (S.settings.unit === 'yd' ? S.settings.zone * 0.9144 : S.settings.zone);

/* ---------- course geo store ---------- */
function geoKey() { const r = activeRound(); return ((r && r.course) || 'unnamed').trim().toLowerCase(); }
function courseGeo() { const k = geoKey(); return (S.geo[k] = S.geo[k] || { holes: {}, greens: [] }); }
function holeGeo(n) { return courseGeo().holes[n] || null; }
function greenDistances(n) {
  const g = holeGeo(n); if (!g || !M.me) return null;
  const c = dist(M.me, g.c);
  if (!g.poly) return { c };
  const ds = g.poly.map(p => dist(M.me, p));
  return { c, f: Math.min(...ds), b: Math.max(...ds) };
}

/* ---------- shots ---------- */
function shotDist(h, i) { const s = h.shots || []; return s[i + 1] ? dist([s[i].lat, s[i].lng], [s[i + 1].lat, s[i + 1].lng]) : null; }

function markShot() {
  if (!M.me) { toast('Waiting for GPS…'); return; }
  const h = curHole();
  h.shots = h.shots || [];
  const pos = [M.me[0], M.me[1]];
  h.shots.push({ lat: pos[0], lng: pos[1], club: M.club, acc: Math.round(M.acc || 0), bad: null });
  M.lastShot = h.shots.length - 1;
  // Scoring zone: the first time a marked ball is inside the zone, the shots taken so far = shots to reach the zone.
  const g = holeGeo(h.n);
  if (g && h.szir == null) {
    const idx = h.shots.length - 1;
    const firstIn = h.shots.findIndex(s => dist([s.lat, s.lng], g.c) <= zoneMetres());
    if (firstIn === idx) { h.szir = idx <= h.par - 2; toast(h.szir ? 'In the scoring zone in regulation ✓' : `In the zone in ${idx} shots`); }
  }
  if (M.club === 'Dr' || M.club === '3W') M.club = '7i';
  if (M.club === 'Pt') M.club = 'Pt';
  if (M.acc > 25) toast(`GPS is rough (±${fd(M.acc)}). Shot saved anyway`);
}

/* ---------- plays-like: wind + elevation (Open-Meteo, free, no key) ---------- */
const WX = { wind: null, at: 0, busy: false, meEl: null, meElPos: null, elBusy: false };
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
async function refreshWeather() {
  if (!M.me || WX.busy || Date.now() - WX.at < 10 * 60000) return;
  WX.busy = true;
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${M.me[0].toFixed(4)}&longitude=${M.me[1].toFixed(4)}&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kmh`)).json();
    if (j.current) { WX.wind = { kmh: j.current.wind_speed_10m, gust: j.current.wind_gusts_10m, from: j.current.wind_direction_10m }; WX.at = Date.now(); }
  } catch (e) {}
  WX.busy = false; if (S.view === 'map') mapTop();
}
async function refreshElevation() {
  const g = holeGeo(curHole().n);
  if (!M.me || !g || WX.elBusy) return;
  const needMe = !WX.meElPos || dist(WX.meElPos, M.me) > 25;
  const needG = g.el == null;
  if (!needMe && !needG) return;
  WX.elBusy = true;
  try {
    const pts = [M.me, g.c];
    const j = await (await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${pts.map(p => p[0].toFixed(5)).join(',')}&longitude=${pts.map(p => p[1].toFixed(5)).join(',')}`)).json();
    if (j.elevation && j.elevation.length === 2) { WX.meEl = j.elevation[0]; WX.meElPos = [...M.me]; g.el = j.elevation[1]; saveGeo(); }
  } catch (e) {}
  WX.elBusy = false; if (S.view === 'map') mapTop();
}
/* Rule of thumb: ~1% longer per mph of headwind, ~0.5% shorter per mph of tailwind, plus 1 m per m of rise. */
function playsLike(from, to) {
  const d = dist(from, to);
  let adj = d, parts = [];
  const g = holeGeo(curHole().n);
  if (WX.wind && WX.wind.kmh > 3) {
    const head = (WX.wind.kmh / 1.609) * Math.cos(((WX.wind.from - bearing(from, to)) * Math.PI) / 180);
    adj += d * (head > 0 ? 0.01 : 0.005) * head;
  }
  if (WX.meEl != null && g && g.el != null && to === g.c) { const rise = g.el - WX.meEl; adj += rise; if (Math.abs(rise) >= 2) parts.push(`${rise > 0 ? 'up' : 'down'}hill ${fd(Math.abs(rise))}`); }
  return { d: adj, parts };
}
function windText(to) {
  if (!WX.wind || !M.me) return '';
  const rel = ((WX.wind.from - bearing(M.me, to)) + 360) % 360;
  const dir = rel < 30 || rel > 330 ? 'into you' : rel > 150 && rel < 210 ? 'behind you' : rel < 180 ? 'from the right' : 'from the left';
  return `Wind ${Math.round(WX.wind.kmh)} km/h ${WX.wind.kmh > 3 ? dir : ''}`;
}

/* ---------- my club distances (tracked shots, else what I typed in More) ---------- */
function bagDistances() {
  const { by } = clubStats(S.rounds);
  const out = [];
  for (const [k] of CLUBS) {
    if (k === 'Pt') continue;
    const b = by[k], set = b && (b.good.length >= 3 ? b.good : null);
    let d = null;
    if (set) { const srt = [...set].sort((x, y) => x - y); d = srt[Math.floor(srt.length / 2)]; }
    else if (S.settings.bag && Number(S.settings.bag[k]) > 0) d = S.settings.unit === 'yd' ? Number(S.settings.bag[k]) * 0.9144 : Number(S.settings.bag[k]);
    if (d) out.push({ k, d });
  }
  return out.sort((a, b) => a.d - b.d);
}
function recommendClub(m) {
  const bag = bagDistances(); if (!bag.length || m < 15) return null;
  return bag.find(c => c.d >= m * 0.97) || bag[bag.length - 1];
}

/* ---------- hazards ahead (from OpenStreetMap bunkers / water) ---------- */
function hazardsAhead() {
  const h = curHole(), g = holeGeo(h.n), hz = courseGeo().hazards || [];
  if (!M.me || !g || !hz.length) return [];
  const lat0 = M.me[0], k = Math.cos(lat0 * Math.PI / 180) * 111320;
  const xy = p => [(p[1] - M.me[1]) * k, (p[0] - lat0) * 110540];
  const G = xy(g.c), L = Math.hypot(G[0], G[1]); if (L < 30) return [];
  const ux = G[0] / L, uy = G[1] / L;
  const out = [];
  for (const z of hz) {
    let near = 1e9, far = -1e9, side = 0, hit = false;
    for (const p of z.poly) {
      const [x, y] = xy(p); const along = x * ux + y * uy, cross = x * uy - y * ux;
      if (along > 0 && along < L + 15 && Math.abs(cross) < 40) { hit = true; near = Math.min(near, along); far = Math.max(far, along); side += cross; }
    }
    if (hit && far - near > 2) out.push({ t: z.t, near, far, side: Math.abs(side) < 5 * z.poly.length ? 'middle' : side > 0 ? 'right' : 'left' });
  }
  return out.sort((a, b) => a.near - b.near).slice(0, 3);
}

/* ---------- Leaflet loading ---------- */
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    const css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = 'vendor/leaflet/leaflet.css'; document.head.appendChild(css);
    const s = document.createElement('script'); s.src = 'vendor/leaflet/leaflet.js';
    s.onload = res; s.onerror = () => { leafletP = null; rej(new Error('offline')); }; document.head.appendChild(s);
  });
  return leafletP;
}

/* ---------- lifecycle ---------- */
function renderMap() {
  const r = activeRound();
  if (!r) { S.view = 'play'; return render(); }
  const h = curHole();
  setTitle(`Hole ${h.n} · Par ${h.par}${h.si ? ' · SI ' + h.si : ''}`, `<button class="tbtn" data-act="closeMap">Scorecard</button>`);
  if (!$('#mapWrap')) {
    $('#main').innerHTML = `<div id="mapWrap"><div id="map"><div class="empty" style="color:#ccc">Loading map…</div></div><div id="mapTop"></div>
      <div id="mapCtl"><button data-act="recenter" aria-label="Centre">⌖</button><button data-act="toggleFlag" id="flagBtn">Set green</button></div></div>
      <div id="mapPanel"></div>`;
    initMap();
  }
  $('#flagBtn').classList.toggle('on', M.setFlag);
  $('#mapPanel').innerHTML = mapPanel();
  mapTop(); drawMap(); refreshElevation();
}
function initMap() {
  M.fittedMe = false;
  startGps();
  keepAwake();
  loadLeaflet().then(() => {
    if (S.view !== 'map' || !$('#map')) return;
    $('#map').innerHTML = '';
    M.map = L.map('map', { zoomControl: false, tap: true }).setView([-33.9, 18.6], 15);
    L.tileLayer(ESRI, { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Greens © OpenStreetMap' }).addTo(M.map);
    M.layer = L.layerGroup().addTo(M.map);
    M.map.on('click', onMapClick);
    fitHole();
    drawMap();
    autoFind();
  }).catch(() => { $('#map').innerHTML = '<div class="empty" style="color:#ccc">The map needs internet. Shot marking still works.</div>'; });
}
function stopMap() {
  if (M.watch != null) { navigator.geolocation.clearWatch(M.watch); M.watch = null; }
  if (M.wake) { M.wake.release().catch(() => {}); M.wake = null; }
  if (M.map) { M.map.remove(); M.map = null; M.layer = null; }
  M.target = null; M.setFlag = false;
}
function startGps() {
  if (!navigator.geolocation) { toast('This phone has no GPS access in the browser'); return; }
  if (M.watch != null) return;
  M.watch = navigator.geolocation.watchPosition(p => {
    M.me = [p.coords.latitude, p.coords.longitude]; M.acc = p.coords.accuracy;
    if (S.view !== 'map') return;
    if (!M.fittedMe) { M.fittedMe = true; fitHole(); autoFind(); }
    refreshWeather(); refreshElevation();
    mapTop(); drawMap();
  }, err => {
    toast(err.code === 1 ? 'Allow location access to see distances' : 'No GPS signal yet');
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
async function keepAwake() {
  try { if ('wakeLock' in navigator && !M.wake) M.wake = await navigator.wakeLock.request('screen'); } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view === 'map') { M.wake = null; keepAwake(); } });

function fitHole() {
  if (!M.map) return;
  const h = curHole(), g = holeGeo(h.n);
  const pts = [];
  if (g) { pts.push(g.c); if (g.tee) pts.push(g.tee); }
  if (M.me && (!g || dist(M.me, g.c) < 700)) pts.push(M.me);
  if (pts.length > 1) M.map.fitBounds(pts, { padding: [70, 40], maxZoom: 19 });
  else if (pts.length === 1) M.map.setView(pts[0], g ? 18 : 17);
  else if (courseGeo().center) M.map.setView(courseGeo().center, 16);
}

/* ---------- drawing ---------- */
function drawMap() {
  if (!M.map || !M.layer) return;
  const h = curHole(), g = holeGeo(h.n), geo = courseGeo();
  M.layer.clearLayers();
  if (M.setFlag) for (const gr of geo.greens) L.polygon(gr.poly, { color: '#ffd54a', weight: 2, fillOpacity: 0.15 }).addTo(M.layer);
  for (const z of geo.hazards || []) if (!g || dist(z.poly[0], g.c) < 600) L.polygon(z.poly, { color: z.t === 'water' ? '#4aa8ff' : '#f3dfa2', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(M.layer);
  if (g && g.poly) L.polygon(g.poly, { color: '#fff', weight: 2, fillOpacity: 0.1 }).addTo(M.layer);
  if (M.me && !M.setFlag) {
    const toG = g ? dist(M.me, g.c) : 280;
    const step = S.settings.unit === 'yd' ? 0.9144 : 1;
    for (const r of [50, 100, 150, 200, 250]) {
      const rm = r * step; if (rm > toG + 10) break;
      L.circle(M.me, { radius: rm, color: '#fff', weight: 1, opacity: 0.45, fill: false, dashArray: '3 6', interactive: false }).addTo(M.layer);
      L.circleMarker([M.me[0] + rm / 110540, M.me[1]], { radius: 0, opacity: 0, interactive: false })
        .bindTooltip(String(r), { permanent: true, direction: 'center', className: 'arclbl' }).addTo(M.layer);
    }
  }
  if (g) L.circleMarker(g.c, { radius: 9, color: '#fff', weight: 3, fillColor: '#e2a521', fillOpacity: 1 }).addTo(M.layer);
  (h.shots || []).forEach((s, i, arr) => {
    const p = [s.lat, s.lng];
    if (arr[i + 1]) L.polyline([p, [arr[i + 1].lat, arr[i + 1].lng]], { color: '#fff', weight: 2, opacity: 0.8 }).addTo(M.layer);
    L.circleMarker(p, { radius: 7, color: '#0e5a3a', weight: 2, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(String(i + 1), { permanent: true, direction: 'center', className: 'shotnum' }).addTo(M.layer);
  });
  if (M.target) {
    const line = [M.me, M.target, g && g.c].filter(Boolean);
    L.polyline(line, { color: '#fff', weight: 2, dashArray: '6 6' }).addTo(M.layer);
    L.circleMarker(M.target, { radius: 10, color: '#fff', weight: 3, fill: false }).addTo(M.layer);
  } else if (M.me && g) {
    L.polyline([M.me, g.c], { color: '#fff', weight: 1.5, dashArray: '4 6', opacity: 0.7 }).addTo(M.layer);
  }
  if (M.me) {
    if (M.acc && M.acc < 80) L.circle(M.me, { radius: M.acc, color: '#3d8bfd', weight: 1, fillOpacity: 0.12 }).addTo(M.layer);
    L.circleMarker(M.me, { radius: 8, color: '#fff', weight: 3, fillColor: '#3d8bfd', fillOpacity: 1 }).addTo(M.layer);
  }
}
function mapTop() {
  const el = $('#mapTop'); if (!el) return;
  const h = curHole(), g = holeGeo(h.n), u = S.settings.unit;
  const d = greenDistances(h.n);
  let html;
  if (M.setFlag) html = `<div class="mt-msg">Tap the middle of the green for hole ${h.n}${courseGeo().greens.length ? ' (or tap a yellow outline)' : ''}.</div>`;
  else if (!g) html = `<div class="mt-msg">No green saved for hole ${h.n} yet. Tap <b>Set green</b>, then tap the green on the map. It's saved for next time.</div>`;
  else if (!M.me) html = `<div class="mt-msg">Finding your GPS position…</div>`;
  else html = `<div class="mt-d">
      ${d.f != null ? `<div><small>Front</small><b>${fd(d.f)}</b></div>` : ''}
      <div class="mid"><small>To green</small><b>${fd(d.c)}</b></div>
      ${d.b != null ? `<div><small>Back</small><b>${fd(d.b)}</b></div>` : ''}
    </div>`;
  if (g && M.me && !M.setFlag && !M.target) {
    const pl = playsLike(M.me, g.c), rec = recommendClub(pl.d), wt = windText(g.c);
    const showPl = Math.abs(pl.d - d.c) >= 2;
    const lines = [];
    if (showPl || rec) lines.push(`${showPl ? `Plays like <b>${fd(pl.d)}</b>${pl.parts.length ? ' (' + pl.parts.join(', ') + ')' : ''}` : ''}${showPl && rec ? ' · ' : ''}${rec ? `<b>${esc(CLUB_NAME[rec.k])}</b>` : ''}`);
    if (wt) lines.push(wt);
    for (const z of hazardsAhead()) lines.push(`${z.t === 'water' ? 'Water' : 'Bunker'} ${z.side}: <b>${fd(z.near)}</b> reach · <b>${fd(z.far)}</b> carry`);
    const note = (courseGeo().notes || {})[h.n];
    if (note) lines.push('📝 ' + esc(note));
    if (lines.length) html += `<div class="mt-msg mt-sm">${lines.join('<br>')}</div>`;
  }
  if (M.target && !M.setFlag) {
    html += `<div class="mt-msg">Target: <b>${M.me ? fd(dist(M.me, M.target)) + ' ' + u : '–'}</b> from you${g ? ` · <b>${fd(dist(M.target, g.c))} ${u}</b> to green` : ''}
      ${(() => { const t = playsLike(M.me || M.target, M.target), rec = M.me && recommendClub(t.d); return rec ? ` · <b>${esc(CLUB_NAME[rec.k])}</b>` : ''; })()}
      <button class="mt-x" data-act="clearTarget">✕</button></div>`;
  }
  html += M.me ? `<div class="mt-acc">GPS ±${fd(M.acc)} ${u}</div>` : '';
  el.innerHTML = html;
}
function onMapClick(e) {
  const p = [e.latlng.lat, e.latlng.lng];
  if (M.setFlag) {
    const geo = courseGeo(), n = curHole().n;
    const gr = geo.greens.find(x => inPoly(p, x.poly));
    geo.holes[n] = Object.assign({}, geo.holes[n] && { tee: geo.holes[n].tee }, gr ? { c: gr.c, poly: gr.poly } : { c: p }, { manual: true });
    M.setFlag = false; saveGeo(); toast(`Green saved for hole ${n}`);
  } else {
    M.target = p;
  }
  render();
}

/* ---------- auto-find greens from OpenStreetMap ---------- */
async function geocodeCourse() {
  const geo = courseGeo(); if (geo.center) return geo.center;
  const r = activeRound(); if (!r || !r.course) return null;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(r.course));
    const j = await res.json();
    if (j[0]) { geo.center = [Number(j[0].lat), Number(j[0].lon)]; saveGeo(); return geo.center; }
  } catch (e) {}
  return null;
}
async function autoFind(force) {
  const geo = courseGeo();
  if (M.finding || (!force && geo.tried && geo.hz)) return;
  const center = (M.me && (!geo.center || dist(M.me, geo.center) < 3000)) ? M.me : await geocodeCourse();
  if (!center) { if (force) toast('Could not find the course. Set greens by hand.'); return; }
  M.finding = true;
  if (M.map && !Object.keys(geo.holes).length) M.map.setView(center, 16);
  try {
    const q = `[out:json][timeout:25];(way["golf"="green"](around:2500,${center[0]},${center[1]});way["golf"="hole"](around:2500,${center[0]},${center[1]});way["golf"="bunker"](around:2500,${center[0]},${center[1]});way["natural"="water"](around:2500,${center[0]},${center[1]});way["golf"~"water_hazard|lateral_water_hazard"](around:2500,${center[0]},${center[1]}););out geom;`;
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = await res.json();
    const greens = j.elements.filter(e => e.tags && e.tags.golf === 'green' && e.geometry && e.geometry.length > 2)
      .map(e => { const poly = e.geometry.map(p => [p.lat, p.lon]); return { poly, c: centroid(poly) }; });
    geo.greens = greens;
    geo.hazards = j.elements.filter(e => e.tags && e.geometry && e.geometry.length > 2 && (e.tags.golf === 'bunker' || e.tags.natural === 'water' || /water_hazard/.test(e.tags.golf || '')))
      .map(e => ({ t: e.tags.golf === 'bunker' ? 'bunker' : 'water', poly: e.geometry.map(p => [p.lat, p.lon]) })).slice(0, 400);
    geo.hz = true;
    let n = 0;
    for (const e of j.elements) {
      if (!e.tags || e.tags.golf !== 'hole' || !e.geometry || e.geometry.length < 2) continue;
      const num = parseInt(e.tags.ref, 10); if (!num) continue;
      if (geo.holes[num] && geo.holes[num].manual) continue;
      const end = [e.geometry[e.geometry.length - 1].lat, e.geometry[e.geometry.length - 1].lon];
      let best = null, bd = 1e9;
      for (const g of greens) { const d = inPoly(end, g.poly) ? 0 : dist(end, g.c); if (d < bd) { bd = d; best = g; } }
      geo.holes[num] = Object.assign(best && bd < 60 ? { c: best.c, poly: best.poly } : { c: end }, { tee: [e.geometry[0].lat, e.geometry[0].lon] });
      n++;
    }
    geo.tried = true; saveGeo();
    if (n) toast(`Found ${n} holes from map data`);
    else if (greens.length) toast(`Found ${greens.length} greens. Tap Set green to assign them`);
    else if (force) toast('No map data for this course. Set greens by hand');
    if (S.view === 'map') { fitHole(); render(); }
  } catch (e) { if (force) toast('Could not reach map data. Try again with signal'); }
  M.finding = false;
}

/* ---------- panel ---------- */
function mapPanel() {
  const r = activeRound(), h = curHole(), shots = h.shots || [], u = S.settings.unit;
  const last = shots.length ? shots.length - 1 : null;
  const list = shots.map((s, i) => {
    const d = shotDist(h, i);
    return `<div class="shot"><span class="n">${i + 1}</span><b>${esc(CLUB_NAME[s.club] || s.club)}</b>
      <span class="sub">${d != null ? fd(d) + ' ' + u : i === last ? 'mark next ball to measure' : ''}${s.bad && s.bad !== 'good' ? ' · ' + s.bad : ''}</span>
      <button class="x" data-act="delShot" data-v="${i}" aria-label="Delete shot">✕</button></div>`;
  }).join('');
  return `
  <div class="card">
    <div class="field-title"><span>Club for this shot</span></div>
    <div class="clubs">${CLUBS.map(([k]) => `<button data-act="pickClub" data-v="${k}" class="${M.club === k ? 'on' : ''}">${k}</button>`).join('')}</div>
    <button class="btn primary block" style="margin-top:10px" data-act="markShot" ${M.me ? '' : 'disabled'}>📍 Mark ball here · ${esc(CLUB_NAME[M.club])}</button>
    <div class="sub" style="margin-top:6px">Stand at your ball and tap before each shot. On the green, mark with Putter so your approach distance is measured too.</div>
    ${last != null ? `<div class="field-title" style="margin-top:12px"><span>How was shot ${last + 1}?</span></div>
      <div class="chips">${MISHITS.map(([k, l]) => `<button data-act="badShot" data-v="${k}" class="${shots[last].bad === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
  </div>
  ${shots.length ? `<div class="card"><h2>Shots this hole <span class="sub">${shots.length}</span></h2>${list}</div>` : ''}
  <div class="navbar" style="position:static;margin-bottom:12px">
    <button class="btn" data-act="mapPrev" ${S.hole === 0 ? 'disabled' : ''}>‹ Hole ${h.n - 1 || ''}</button>
    ${S.hole < r.holes.length - 1 ? `<button class="btn" data-act="mapNext">Hole ${h.n + 1} ›</button>` : `<button class="btn" data-act="closeMap">Scorecard</button>`}
  </div>
  <div class="card">
    <button class="btn block sm" data-act="findGreens">${M.finding ? 'Searching…' : 'Find greens from map data'}</button>
    ${holeGeo(h.n) ? `<button class="btn block sm danger" style="margin-top:8px" data-act="clearGreen">Remove saved green for hole ${h.n}</button>` : ''}
  </div>`;
}

/* ---------- club stats ---------- */
function clubStats(rounds) {
  const by = {};
  const bad = {};
  for (const r of rounds) for (const h of r.holes) {
    const s = h.shots || [];
    s.forEach((x, i) => {
      if (x.bad && x.bad !== 'good') bad[x.bad] = (bad[x.bad] || 0) + 1;
      if (x.club === 'Pt') return;
      const d = shotDist(h, i); if (d == null || d < 5) return;
      const b = (by[x.club] = by[x.club] || { all: [], good: [], bad: 0 });
      b.all.push(d); if (x.bad && x.bad !== 'good') b.bad++; else b.good.push(d);
    });
  }
  return { by, bad };
}
function clubCard(rounds) {
  const { by, bad } = clubStats(rounds);
  const keys = CLUBS.map(c => c[0]).filter(k => by[k]);
  if (!keys.length) return '';
  const u = S.settings.unit;
  const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const badTotal = sum(Object.values(bad));
  return `<div class="card"><h2>My club distances <span class="sub">${u}</span></h2>
    <table class="tbl"><thead><tr><th>Club</th><th>Shots</th><th>Typical</th><th>Longest</th><th>Mishits</th></tr></thead><tbody>
    ${keys.map(k => { const b = by[k], typ = med(b.good.length ? b.good : b.all);
      return `<tr><td><b>${esc(CLUB_NAME[k])}</b></td><td>${b.all.length}</td><td><b>${fd(typ)}</b></td><td>${fd(Math.max(...b.all))}</td><td>${b.bad ? fmtPct(b.bad, b.all.length) : '–'}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="sub" style="margin-top:6px">Typical = middle distance of your good shots, so one great or topped shot doesn't skew it.</div>
    ${badTotal ? `<h3>Mishits</h3><div class="legend" style="font-size:13px">${MISHITS.filter(m => bad[m[0]]).map(([k, l]) => `<span><b>${l}</b> ${bad[k]}</span>`).join('')}</div>` : ''}
  </div>`;
}

/* ---------- actions ---------- */
Object.assign(ACTIONS, {
  openMap() { S.view = 'map'; window.scrollTo(0, 0); },
  closeMap() { S.view = 'play'; },
  pickClub(v) { M.club = v; },
  markShot() { markShot(); },
  badShot(v) { const s = curHole().shots; if (s && s.length) { const x = s[s.length - 1]; x.bad = x.bad === v ? null : v; } },
  delShot(v) { if (confirm('Delete this shot?')) curHole().shots.splice(Number(v), 1); },
  toggleFlag() { M.setFlag = !M.setFlag; M.target = null; },
  clearTarget() { M.target = null; },
  recenter() { fitHole(); },
  mapPrev() { S.hole = Math.max(0, S.hole - 1); M.target = null; M.club = 'Dr'; setTimeout(fitHole, 0); },
  mapNext() { const h = curHole(); if (!h.done && h.score != null) h.done = true; S.hole = Math.min(activeRound().holes.length - 1, S.hole + 1); M.target = null; M.club = 'Dr'; setTimeout(fitHole, 0); },
  findGreens() { autoFind(true); },
  clearGreen() { delete courseGeo().holes[curHole().n]; saveGeo(); },
});
