'use strict';
/* Course preview: browse any loaded course from home: scorecard + satellite flyover of every hole.
   Distances are measured from the tee (or tap the map to measure to/from any spot). */

const P = { map: null, layer: null, target: null };

function pvCourse() { const n = S.pv && S.pv.name; return n ? (S.courses.find(c => sameCourse(c.name, n)) || BUILTIN_COURSES.find(c => sameCourse(c.name, n))) : null; }
function pvGeo() { return (S.pv && S.geo[S.pv.name.trim().toLowerCase()]) || { holes: {}, hazards: [] }; }

function viewPreview() {
  const c = pvCourse();
  if (!c) { S.view = 'home'; return viewHome(); }
  const i = S.pv.i, n = i + 1, geo = pvGeo(), hg = geo.holes[n] || {};
  const par = c.pars[i], si = c.si && c.si[i], len = (c.len && c.len[i]) || (hg.tee && hg.c ? dist(hg.tee, hg.c) : null);
  setTitle(c.name, `<button class="tbtn" data-act="pvClose">Done</button>`);
  const u = S.settings.unit;
  const fromTee = hg.tee && hg.c;
  const ds = fromTee && hg.poly ? hg.poly.map(p => dist(hg.tee, p)) : null;
  const hz = fromTee ? hazardsBetween(hg.tee, hg.c, geo.hazards || [], 4) : [];
  const tot = (a, from, to) => a ? sum(a.slice(from, to).map(x => Number(x) || 0)) : 0;
  const T = c.teeSets && c.teeSets[c.teeIdx ?? 0];
  const card = (from, to, label) => `<tr class="pv-sub"><td>${label}</td>${c.pars.slice(from, to).map((p, k) => `<td class="${from + k === i ? 'cur' : ''}" data-act="pvHole" data-v="${from + k}">${from + k + 1}</td>`).join('')}<td></td></tr>
    <tr><td>Par</td>${c.pars.slice(from, to).map((p, k) => `<td class="${from + k === i ? 'cur' : ''}">${p}</td>`).join('')}<td><b>${tot(c.pars, from, to)}</b></td></tr>
    ${c.si ? `<tr><td>SI</td>${c.si.slice(from, to).map((p, k) => `<td class="${from + k === i ? 'cur' : ''}">${p || ''}</td>`).join('')}<td></td></tr>` : ''}
    ${c.len && c.len.some(Boolean) ? `<tr><td>${u}</td>${c.len.slice(from, to).map((l, k) => `<td class="${from + k === i ? 'cur' : ''}">${l ? fd(l) : ''}</td>`).join('')}<td>${fd(tot(c.len, from, to))}</td></tr>` : ''}`;
  const holes = c.pars.length;
  return `
  <div id="pvWrap"><div id="pvMap"><div class="empty" style="color:#ccc">Loading map…</div></div>
    <div class="pv-top"><div><small>Hole</small><b>${n}</b></div><div><small>Par</small><b>${par}</b></div>${si ? `<div><small>SI</small><b>${si}</b></div>` : ''}<div><small>${u}</small><b>${len ? fd(len) : '–'}</b></div></div>
    ${P.target && fromTee ? `<div class="pv-target">Tee → target <b>${fd(dist(hg.tee, P.target))}</b> · target → green <b>${fd(dist(P.target, hg.c))}</b> <button class="mt-x" data-act="pvClear">✕</button></div>` : ''}
    <button class="pv-nav l" data-act="pvHole" data-v="${i - 1}" ${i === 0 ? 'disabled' : ''}>‹</button>
    <button class="pv-nav r" data-act="pvHole" data-v="${i + 1}" ${i >= holes - 1 ? 'disabled' : ''}>›</button>
  </div>
  <div class="card">
    ${fromTee ? `<div class="pv-d">
      ${ds ? `<div><small>Front</small><b>${fd(Math.min(...ds))}</b></div>` : ''}<div class="mid"><small>Tee to green</small><b>${fd(dist(hg.tee, hg.c))}</b></div>${ds ? `<div><small>Back</small><b>${fd(Math.max(...ds))}</b></div>` : ''}</div>
      ${hz.length ? hz.map(z => `<div class="shot"><span class="n">${z.t === 'water' ? '💧' : '⛱'}</span><b>${z.t === 'water' ? 'Water' : 'Bunker'} ${z.side}</b><span class="sub" style="margin-left:auto">${fd(z.near)} reach · <b>${fd(z.far)}</b> carry</span></div>`).join('') : '<div class="sub">No bunkers or water mapped along this hole.</div>'}
      <div class="sub" style="margin-top:6px">Tap the map to measure a lay-up spot.</div>`
    : hg.c ? '<div class="sub">The green is mapped but not the tee, so only the green shows. Tap the map to measure from any spot.</div>' : '<div class="sub">This hole isn\'t mapped yet. You can set its green on the GPS screen during a round.</div>'}
    ${((geo.notes || {})[n]) ? `<div class="mchip" style="margin-top:8px;background:var(--surface-2);color:var(--text);box-shadow:none">📝 ${esc(geo.notes[n])}</div>` : ''}
  </div>
  <div class="card scroll-x"><h2>Scorecard ${T && T.cr ? `<span class="sub">${esc(T.name)} · ${T.cr} / ${T.slope}</span>` : c.cr ? `<span class="sub">${c.cr} / ${c.slope}</span>` : ''}</h2>
    <table class="tbl pv-card">${card(0, Math.min(9, holes), 'Out')}${holes > 9 ? card(9, holes, 'In') : ''}</table>
    <div class="sub" style="margin-top:6px">Par ${sum(c.pars)} · tap a hole number to jump to it.</div>
  </div>
  <button class="btn primary block" style="margin-bottom:12px" data-act="pvPlay">⛳ Play this course</button>`;
}

function pvDraw() {
  if (!$('#pvMap')) return;
  const go = () => {
    if (!P.map) {
      $('#pvMap').innerHTML = '';
      P.map = L.map('pvMap', { zoomControl: false }).setView([-33.9, 18.6], 15);
      L.tileLayer(ESRI, { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Course © OpenStreetMap' }).addTo(P.map);
      P.layer = L.layerGroup().addTo(P.map);
      P.map.on('click', e => { P.target = [e.latlng.lat, e.latlng.lng]; render(); });
    }
    const geo = pvGeo(), n = S.pv.i + 1, hg = geo.holes[n] || {};
    P.layer.clearLayers();
    for (const z of geo.hazards || []) if (!hg.c || dist(z.poly[0], hg.c) < 600) L.polygon(z.poly, { color: z.t === 'water' ? '#4aa8ff' : '#f3dfa2', weight: 1, fillOpacity: 0.15, interactive: false }).addTo(P.layer);
    if (hg.poly) L.polygon(hg.poly, { color: '#fff', weight: 2, fillOpacity: 0.12, interactive: false }).addTo(P.layer);
    if (hg.tee && hg.c) {
      L.polyline([hg.tee, hg.c], { color: '#fff', weight: 2, dashArray: '6 6', opacity: 0.85, interactive: false }).addTo(P.layer);
      const step = S.settings.unit === 'yd' ? 0.9144 : 1, total = dist(hg.tee, hg.c);
      for (const r of [100, 150, 200, 250]) {
        const rm = r * step; if (rm > total - 20) break;
        L.circle(hg.tee, { radius: rm, color: '#fff', weight: 1, opacity: 0.4, fill: false, dashArray: '3 6', interactive: false }).addTo(P.layer);
      }
      L.circleMarker(hg.tee, { radius: 7, color: '#fff', weight: 2, fillColor: '#2d5cc0', fillOpacity: 1, interactive: false }).bindTooltip('Tee', { permanent: true, direction: 'bottom', className: 'arclbl' }).addTo(P.layer);
    }
    if (hg.c) L.circleMarker(hg.c, { radius: 9, color: '#fff', weight: 3, fillColor: '#e3a62a', fillOpacity: 1, interactive: false }).addTo(P.layer);
    if (P.target) {
      L.polyline([hg.tee, P.target, hg.c].filter(Boolean), { color: '#fff', weight: 2, interactive: false }).addTo(P.layer);
      L.circleMarker(P.target, { radius: 10, color: '#fff', weight: 3, fill: false, interactive: false }).addTo(P.layer);
    }
    if (!P.fitted) {
      P.fitted = true;
      const pts = [hg.tee, hg.c].filter(Boolean);
      if (pts.length === 2) P.map.fitBounds(pts, { padding: [60, 50], maxZoom: 18, animate: false });
      else if (pts.length === 1) P.map.setView(pts[0], 17, { animate: false });
      else if (geo.center) P.map.setView(geo.center, 15, { animate: false });
    }
  };
  // the map container is rebuilt on each render; recreate Leaflet on it
  if (P.map && P.map.getContainer() !== $('#pvMap')) { try { P.map.remove(); } catch (e) {} P.map = null; }
  loadLeaflet().then(go).catch(() => { $('#pvMap').innerHTML = '<div class="empty" style="color:#ccc">The satellite map needs internet.</div>'; });
}
function stopPreview() { if (P.map) { try { P.map.remove(); } catch (e) {} P.map = null; } }

Object.assign(ACTIONS, {
  pvOpen(v) { S.pv = { name: v || (S.draft && S.draft.course), i: 0 }; P.target = null; P.fitted = false; S.pvFrom = S.view; S.view = 'preview'; window.scrollTo(0, 0); },
  pvHole(v) { const c = pvCourse(); const i = Number(v); if (c && i >= 0 && i < c.pars.length) { S.pv.i = i; P.target = null; P.fitted = false; } },
  pvClear() { P.target = null; },
  pvClose() { S.view = S.pvFrom && S.pvFrom !== 'preview' ? S.pvFrom : 'home'; },
  pvPlay() { const c = pvCourse(); S.view = 'play'; S.activeId = null; S.draft = draftFrom(c, { date: localDate(), hcp: S.settings.hcp ?? '' }); if (c.teeSets) applyTee(S.draft, c.teeSets[c.teeIdx ?? 0]); },
});
