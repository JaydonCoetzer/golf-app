'use strict';
/* Course preview: browse any loaded course from home: scorecard + satellite flyover of every hole.
   Distances are measured from the tee (or tap the map to measure to/from any spot). */

const P = { map: null, layer: null, target: null, mode: null, trace: null };

function pvCourse() { const n = S.pv && S.pv.name; return n ? (S.courses.find(c => sameCourse(c.name, n)) || BUILTIN_COURSES.find(c => sameCourse(c.name, n))) : null; }
function pvGeo() { if (!S.pv) return { holes: {}, hazards: [] }; const k = S.pv.name.trim().toLowerCase(); return (S.geo[k] = S.geo[k] || { holes: {}, greens: [] }); }

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
  ${pvMapCard(n, hg)}
  <button class="btn primary block" style="margin-bottom:12px" data-act="pvPlay">⛳ Play this course</button>`;
}

function pvDraw() {
  if (!$('#pvMap')) return;
  const go = () => {
    if (!P.map) {
      $('#pvMap').innerHTML = '';
      P.map = L.map('pvMap', { zoomControl: false }).setView(P.view && P.fitted ? P.view.c : [-33.9, 18.6], P.view && P.fitted ? P.view.z : 15);
      L.tileLayer(ESRI, { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics · Course © OpenStreetMap' }).addTo(P.map);
      P.layer = L.layerGroup().addTo(P.map);
      P.map.on('click', e => {
        const p = [e.latlng.lat, e.latlng.lng];
        if (P.mode === 'trace') { // light update: no page rebuild while tracing
          P.trace.push(p); pvDraw();
          const st = $('.map-card .cstatus'); if (st) st.innerHTML = `Tap around the <b>edge of the green</b> (6–10 taps), then Finish. ${P.trace.length} points.`;
          const fin = $('[data-act=pvTraceDone]'), und = $('[data-act=pvTraceUndo]'); if (fin) fin.disabled = P.trace.length < 3; if (und) und.disabled = false;
          return;
        }
        if (P.mode) pvMapTap(p); else P.target = p; render();
      });
    }
    if (P.mode) P.map.doubleClickZoom.disable(); else P.map.doubleClickZoom.enable();
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
    if (P.trace && P.trace.length) { L.polyline(P.trace.concat(P.trace.length > 2 ? [P.trace[0]] : []), { color: '#ffd54a', weight: 3, dashArray: '5 5', interactive: false }).addTo(P.layer); P.trace.forEach(t => L.circleMarker(t, { radius: 5, color: '#fff', weight: 2, fillColor: '#ffd54a', fillOpacity: 1, interactive: false }).addTo(P.layer)); }
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
      else if (geo.center || (pvCourse() || {}).center) P.map.setView(geo.center || pvCourse().center, 16, { animate: false });
    }
  };
  // the map container is rebuilt on each render; recreate Leaflet on it
  if (P.map && P.map.getContainer() !== $('#pvMap')) { try { const c = P.map.getCenter(); P.view = { c: [c.lat, c.lng], z: P.map.getZoom() }; P.map.remove(); } catch (e) {} P.map = null; }
  loadLeaflet().then(go).catch(() => { $('#pvMap').innerHTML = '<div class="empty" style="color:#ccc">The satellite map needs internet.</div>'; });
}
function stopPreview() { if (P.map) { try { P.map.remove(); } catch (e) {} P.map = null; } }

Object.assign(ACTIONS, {
  pvOpen(v) { S.pv = { name: v || (S.draft && S.draft.course), i: 0 }; P.target = null; P.fitted = false; S.pvFrom = S.view; S.view = 'preview'; window.scrollTo(0, 0); },
  pvHole(v) { const c = pvCourse(); const i = Number(v); if (c && i >= 0 && i < c.pars.length) { S.pv.i = i; P.target = null; P.fitted = false; P.mode = null; P.trace = null; } },
  pvClear() { P.target = null; },
  pvClose() { S.view = S.pvFrom && S.pvFrom !== 'preview' ? S.pvFrom : 'home'; },
  pvPlay() { const c = pvCourse(); S.view = 'play'; S.activeId = null; S.draft = draftFrom(c, { date: localDate(), hcp: S.settings.hcp ?? '' }); if (c.teeSets) applyTee(S.draft, c.teeSets[c.teeIdx ?? 0]); },
});

/* ---------- map this course (tees + greens, drawn once on the satellite photo) ---------- */
function pvMapCard(n, hg) {
  const c = pvCourse(), geo = pvGeo(), done = Array.from({ length: c.pars.length }, (_, i) => geo.holes[i + 1] || {}).filter(x => x.tee && x.c).length;
  const step = P.mode === 'tee' ? `Tap where the <b>tee</b> is on hole ${n}.` : P.mode === 'green' ? `Tap the <b>middle of the green</b> on hole ${n}.` : P.mode === 'trace' ? `Tap around the <b>edge of the green</b> (6–10 taps), then Finish. ${P.trace.length} point${P.trace.length === 1 ? '' : 's'}.` : '';
  return `<div class="card map-card"><h2>Map this course <span class="sub">${done}/${c.pars.length} holes</span></h2>
    ${P.mode ? `<div class="cstatus ok" style="margin-bottom:10px">${step}</div>` : `<div class="sub" style="margin-bottom:10px">No green or tee data for a hole? Draw it once here on the satellite photo. GPS distances then work every time you play. It's saved on this phone.</div>`}
    <div class="map-steps">
      <button class="${P.mode === 'tee' ? 'on' : hg.tee ? 'ok' : ''}" data-act="pvMode" data-v="tee">${hg.tee ? '✓ ' : ''}Tee</button>
      <button class="${P.mode === 'green' ? 'on' : hg.c ? 'ok' : ''}" data-act="pvMode" data-v="green">${hg.c ? '✓ ' : ''}Green</button>
      <button class="${P.mode === 'trace' ? 'on' : hg.poly ? 'ok' : ''}" data-act="pvMode" data-v="trace">${hg.poly ? '✓ ' : ''}Green edge</button>
    </div>
    ${P.mode === 'trace' ? `<div class="grid2" style="margin-top:8px"><button class="btn sm" data-act="pvTraceUndo" ${P.trace.length ? '' : 'disabled'}>Undo point</button><button class="btn sm primary" data-act="pvTraceDone" ${P.trace.length >= 3 ? '' : 'disabled'}>Finish edge</button></div>` : ''}
    ${hg.tee && hg.c && !P.mode && S.pv.i < c.pars.length - 1 ? `<button class="btn block sm primary" style="margin-top:8px" data-act="pvHole" data-v="${S.pv.i + 1}">Next hole: ${n + 1} ›</button>` : ''}
    ${done ? `<button class="btn block sm" style="margin-top:8px" data-act="pvShareMap">📤 Send course map (so I can add it for everyone)</button>` : ''}
  </div>`;
}
function pvMapTap(p) {
  const geo = pvGeo(), n = S.pv.i + 1, hg = (geo.holes[n] = geo.holes[n] || {}), c = pvCourse();
  if (P.mode === 'tee') { hg.tee = p; hg.manualTee = true; P.mode = hg.c ? null : 'green'; }
  else if (P.mode === 'green') {
    const gr = (geo.greens || []).find(x => inPoly(p, x.poly));
    if (gr) { hg.c = gr.c; hg.poly = gr.poly; } else { hg.c = p; delete hg.poly; }
    hg.manual = true; P.mode = null;
  } else if (P.mode === 'trace') { P.trace.push(p); return; }
  if (hg.tee && hg.c && c.len && !c.len[S.pv.i]) c.len[S.pv.i] = Math.round(dist(hg.tee, hg.c));
  P.fitted = false; saveGeo(); persist();
}
Object.assign(ACTIONS, {
  pvMode(v) { P.mode = P.mode === v ? null : v; P.trace = v === 'trace' ? [] : null; P.target = null; if (P.mode) window.scrollTo({ top: 0, behavior: 'smooth' }); },
  pvTraceUndo() { P.trace.pop(); },
  pvTraceDone() {
    const geo = pvGeo(), n = S.pv.i + 1, hg = (geo.holes[n] = geo.holes[n] || {});
    hg.poly = P.trace.slice(); hg.c = centroid(hg.poly); hg.manual = true; P.mode = null; P.trace = null; saveGeo(); toast('Green edge saved: front & back distances on');
  },
  async pvShareMap() {
    const c = pvCourse(), geo = pvGeo(), R = x => Math.round(x * 1e5) / 1e5;
    const holes = Object.entries(geo.holes).filter(([, h]) => h.c).map(([n, h]) => ({ n: Number(n), tee: h.tee && h.tee.map(R), c: h.c.map(R), poly: h.poly && h.poly.map(q => q.map(R)) }));
    const text = JSON.stringify({ course: c.name, pars: c.pars, si: c.si, holes });
    const f = new File([text], c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-map.json', { type: 'application/json' });
    try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: c.name + ' course map' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    download(f.name, text, 'application/json');
  },
});
