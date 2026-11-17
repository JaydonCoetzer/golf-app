'use strict';
/* Round detail: Recap (scorecard, rating, slope, differential), Replay (your tracked shots on the satellite map), Stats.
   In Replay you can also place or fix shots after the round: tap Edit, pick a club, tap the map. */

const RP = { map: null, layer: null, i: 0, edit: false, club: 'Dr', fitted: false };
const rpGeo = r => S.geo[(r.course || 'unnamed').trim().toLowerCase()] || { holes: {}, hazards: [] };

function detailTabs() {
  const t = S.detailTab || 'recap';
  return `<div class="chips dtabs">${[['recap', 'Recap'], ['replay', 'Replay'], ['stats', 'Stats']].map(([k, l]) => `<button data-act="detailTab" data-v="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

/* ---------- recap ---------- */
function recapHtml(r) {
  const { A, tp } = roundSummary(r), hc = hasHcp(r), NT = netTotals(r), diff = roundDiff(r);
  const half = S.cardHalf || 'front', n = r.holes.length;
  const played = h => h.done && h.score != null;
  const cell = h => played(h) ? `<span class="sc ${scoreClass(h.score - h.par)}">${h.score}</span>` : '–';
  const tot = (hs, f) => sum(hs.filter(played).map(f));
  let table;
  if (half === 'totals' || n <= 9) {
    const parts = n > 9 ? [['Out', r.holes.slice(0, 9)], ['In', r.holes.slice(9)], ['Total', r.holes]] : [['Total', r.holes]];
    table = `<tr><th></th>${parts.map(p => `<th>${p[0]}</th>`).join('')}</tr>
      <tr><td>Par</td>${parts.map(p => `<td>${sum(p[1].map(h => h.par))}</td>`).join('')}</tr>
      <tr><td>Score</td>${parts.map(p => `<td><b>${tot(p[1], h => h.score) || '–'}</b></td>`).join('')}</tr>
      ${hc ? `<tr><td>Net</td>${parts.map(p => `<td>${tot(p[1], h => h.score - shotsGiven(r.hcp, h.si)) || '–'}</td>`).join('')}</tr>
      <tr><td>Points</td>${parts.map(p => `<td>${tot(p[1], h => points(r, h))}</td>`).join('')}</tr>` : ''}
      <tr><td>Putts</td>${parts.map(p => `<td>${tot(p[1], h => h.putts || 0)}</td>`).join('')}</tr>
      <tr><td>Penalties</td>${parts.map(p => `<td>${tot(p[1], h => (h.ob || 0) + (h.water || 0) + (h.pen || 0))}</td>`).join('')}</tr>
      ${(r.players || []).map(pl => `<tr><td>${esc(pl.name)}</td>${parts.map(p => `<td>${sum(p[1].map(h => pScore(h, pl.id) || 0)) || '–'}</td>`).join('')}</tr>`).join('')}`;
  } else {
    const hs = half === 'back' ? r.holes.slice(9) : r.holes.slice(0, 9);
    const row = (label, f, total) => `<tr><td>${label}</td>${hs.map(h => `<td>${f(h)}</td>`).join('')}<td><b>${total ?? ''}</b></td></tr>`;
    table = `<tr><th>Hole</th>${hs.map(h => `<th>${h.n}</th>`).join('')}<th>Tot</th></tr>
      ${row('Par', h => h.par, sum(hs.map(h => h.par)))}
      ${hs.some(h => h.si) ? row('SI', h => h.si || '') : ''}
      ${row('Score', cell, tot(hs, h => h.score) || '–')}
      ${hc ? row('Net', h => played(h) ? h.score - shotsGiven(r.hcp, h.si) : '–', tot(hs, h => h.score - shotsGiven(r.hcp, h.si)) || '–') : ''}
      ${hc ? row('Pts', h => played(h) ? points(r, h) : '–', tot(hs, h => points(r, h))) : ''}
      ${row('Putts', h => played(h) ? h.putts ?? '–' : '–', tot(hs, h => h.putts || 0))}
      ${(r.players || []).map(pl => row(esc(pl.name), h => { const v = pScore(h, pl.id); return v == null ? '–' : `<span class="sc ${scoreClass(v - h.par)}">${v}</span>`; }, sum(hs.map(h => pScore(h, pl.id) || 0)) || '–')).join('')}`;
  }
  return `
  <div class="rc-hero">
    <div class="rc-top"><div><span class="rc-score">${A.strokes || '–'}</span><sup>${A.holes ? toPar(tp) : ''}</sup></div>
      <div class="rc-tees">${r.tees ? esc(r.tees) + ' tees' : fmtDate(r.date)}${hc && A.holes ? `<small>${NT.pts} pts · net ${NT.net}</small>` : ''}</div></div>
    <div class="rc-trio"><div><b>${r.slope || '–'}</b><span>Slope</span></div><div><b>${r.cr || '–'}</b><span>Rating</span></div><div><b>${diff != null ? diff.toFixed(1) : '–'}</b><span>Differential</span></div></div>
  </div>
  <div class="card">
    ${n > 9 ? `<div class="seg ins-tabs">${[['front', 'Front 9'], ['back', 'Back 9'], ['totals', 'Totals']].map(([k, l]) => `<button data-act="cardHalf" data-v="${k}" class="${half === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}
    <div class="scroll-x"><table class="tbl rc-card">${table}</table></div>
    ${!r.cr || !r.slope ? '<div class="sub" style="margin-top:8px">Add the course rating and slope when you start a round to get a differential.</div>' : ''}
  </div>
  ${gameCard(r)}
  <button class="btn primary block" style="margin-bottom:10px" data-act="shareRound" data-v="${r.id}">📤 Share scorecard</button>
  <div class="card">
    <label class="f" for="rNotes">Notes</label>
    <textarea id="rNotes" data-bind="notes" data-v="${r.id}" placeholder="Wind, what worked, what to practise…">${esc(r.notes || '')}</textarea>
  </div>
  <div class="grid2" style="margin-bottom:12px">
    <button class="btn" data-act="editRound" data-v="${r.id}">Edit holes</button>
    <button class="btn danger" data-act="deleteRound" data-v="${r.id}">Delete</button>
  </div>`;
}

/* ---------- replay ---------- */
function rpRound() { return S.rounds.find(x => x.id === S.detailId); }
function replayHtml(r) {
  if (RP.i >= r.holes.length) RP.i = 0;
  const h = r.holes[RP.i], shots = h.shots || [], u = S.settings.unit, g = rpGeo(r).holes[h.n];
  const trackedHoles = r.holes.filter(x => (x.shots || []).length).length;
  const pens = (h.ob || 0) + (h.water || 0) + (h.pen || 0);
  const rows = shots.map((s, i) => {
    const d = shotDist(h, i) ?? (i === shots.length - 1 && g && s.club !== 'Pt' ? dist([s.lat, s.lng], g.c) : null);
    return `<div class="shot"><span class="n">${i + 1}</span><b>${esc(CLUB_NAME[s.club] || s.club)}</b>
      <span class="sub">${d != null ? fd(d) + ' ' + u : ''}${s.lie ? ' · from ' + LIE_NAME[s.lie].toLowerCase() : ''}${s.bad && s.bad !== 'good' ? ' · ' + s.bad : ''}</span>
      ${s.pen ? `<span class="rp-pen">${PEN_NAME[s.pen]}</span>` : ''}
      ${RP.edit ? `<button class="x" data-act="rpDel" data-v="${i}" aria-label="Delete shot">✕</button>` : ''}</div>`;
  }).join('');
  return `
  <div id="rpWrap"><div id="rpMap"><div class="empty" style="color:#ccc">Loading map…</div></div>
    <div class="rp-hole">Hole ${h.n}</div>
    <button class="pv-nav l" data-act="rpHole" data-v="${RP.i - 1}" ${RP.i === 0 ? 'disabled' : ''}>‹</button>
    <button class="pv-nav r" data-act="rpHole" data-v="${RP.i + 1}" ${RP.i >= r.holes.length - 1 ? 'disabled' : ''}>›</button>
    <div class="rp-foot">Par ${h.par}${h.done && h.score != null ? ` · Score ${h.score} · ${h.putts ?? 0} putt${h.putts === 1 ? '' : 's'}` : ' · not played'}${pens ? ` · ${pens} penalt${pens > 1 ? 'ies' : 'y'}` : ''}</div>
  </div>
  <div class="card">
    <h2>Shots on hole ${h.n} <button class="btn sm ${RP.edit ? 'primary' : ''}" data-act="rpEdit">${RP.edit ? 'Done' : 'Edit'}</button></h2>
    ${RP.edit ? `<div class="sub" style="margin-bottom:8px">Pick the club, then tap the map where you hit each shot from, in order.</div>
      <div class="clubs">${bagList().map(([k]) => `<button data-act="rpClub" data-v="${k}" class="${RP.club === k ? 'on' : ''}">${k}</button>`).join('')}</div>
      ${shots.length ? `<div class="field-title" style="margin-top:10px"><span>Shot ${shots.length}: penalty?</span></div>
      <div class="chips">${PENS.map(([k, l]) => `<button data-act="rpPen" data-v="${k}" class="${shots[shots.length - 1].pen === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}` : ''}
    ${rows || `<div class="sub">${RP.edit ? 'No shots yet. Tap the map to add the first one (your tee shot).' : 'No shots were tracked on this hole. During a round, tap 📍 Mark before each shot. Or tap Edit to place them now.'}</div>`}
    <div class="legend" style="margin-top:10px"><span><i style="background:#3ddc84"></i>Good</span><span><i style="background:#f5a524"></i>Mishit</span><span><i style="background:#e5484d"></i>Penalty</span></div>
    <div class="sub" style="margin-top:6px">${trackedHoles} of ${r.holes.length} holes have tracked shots.</div>
  </div>`;
}
function rpDraw() {
  const r = rpRound(); if (!r || !$('#rpMap')) return;
  if (RP.map && RP.map.getContainer() !== $('#rpMap')) { try { RP.map.remove(); } catch (e) {} RP.map = null; }
  loadLeaflet().then(() => {
    if (!$('#rpMap')) return;
    if (!RP.map) {
      $('#rpMap').innerHTML = '';
      RP.map = L.map('rpMap', { zoomControl: false }).setView([-33.9, 18.6], 15);
      L.tileLayer(ESRI, { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(RP.map);
      RP.layer = L.layerGroup().addTo(RP.map);
      RP.map.on('click', e => {
        if (!RP.edit) return;
        const rr = rpRound(), h = rr.holes[RP.i]; h.shots = h.shots || [];
        h.shots.push({ lat: e.latlng.lat, lng: e.latlng.lng, club: RP.club, acc: 0, bad: null, lie: h.shots.length ? (RP.club === 'Pt' ? 'green' : null) : 'tee', pen: null, placed: true });
        if (RP.club === 'Dr' || RP.club === '3W') RP.club = '7i';
        persist(); render();
      });
    }
    const geo = rpGeo(r), h = r.holes[RP.i], g = geo.holes[h.n] || {}, shots = h.shots || [], u = S.settings.unit;
    RP.layer.clearLayers();
    for (const z of geo.hazards || []) if (g.c && dist(z.poly[0], g.c) < 600) L.polygon(z.poly, { color: z.t === 'water' ? '#4aa8ff' : '#f3dfa2', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(RP.layer);
    if (g.poly) L.polygon(g.poly, { color: '#fff', weight: 2, fillOpacity: 0.1, interactive: false }).addTo(RP.layer);
    if (g.c) L.marker(g.c, { interactive: false, icon: L.divIcon({ className: '', html: '<span class="rp-flag">⛳</span>', iconSize: [26, 26], iconAnchor: [8, 24] }) }).addTo(RP.layer);
    shots.forEach((s, i) => {
      const a = [s.lat, s.lng], nx = shots[i + 1], b = nx ? [nx.lat, nx.lng] : (g.c && s.club !== 'Pt' ? g.c : null);
      const col = s.pen ? '#e5484d' : s.bad && s.bad !== 'good' ? '#f5a524' : '#3ddc84';
      if (b && dist(a, b) > 3) {
        L.polyline([a, b], { color: '#0b1a12', weight: 7, opacity: 0.45, interactive: false }).addTo(RP.layer);
        L.polyline([a, b], { color: col, weight: 4, interactive: false, dashArray: nx ? null : '2 8' }).addTo(RP.layer);
        if (dist(a, b) > 25) L.circleMarker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { radius: 0, opacity: 0, interactive: false })
          .bindTooltip(`${fd(dist(a, b))} ${u}${s.pen ? ' · ' + PEN_NAME[s.pen] : ''}`, { permanent: true, direction: 'center', className: 'rp-dist' + (s.pen ? ' pen' : '') }).addTo(RP.layer);
      } else if (s.pen) {
        L.circleMarker(a, { radius: 0, opacity: 0, interactive: false }).bindTooltip(PEN_NAME[s.pen], { permanent: true, direction: 'top', offset: [0, -14], className: 'rp-dist pen' }).addTo(RP.layer);
      }
    });
    shots.forEach(s => L.marker([s.lat, s.lng], { interactive: false, icon: L.divIcon({ className: '', html: `<span class="rp-club ${s.pen ? 'pen' : ''}">${esc(s.club)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).addTo(RP.layer));
    if (!RP.fitted) {
      RP.fitted = true;
      const pts = shots.map(s => [s.lat, s.lng]); if (g.c) pts.push(g.c); if (g.tee) pts.push(g.tee);
      if (pts.length > 1) RP.map.fitBounds(pts, { padding: [55, 45], maxZoom: 18, animate: false });
      else if (pts.length === 1) RP.map.setView(pts[0], 17, { animate: false });
      else if (geo.center) RP.map.setView(geo.center, 15, { animate: false });
    }
  }).catch(() => { if ($('#rpMap')) $('#rpMap').innerHTML = '<div class="empty" style="color:#ccc">The satellite map needs internet.</div>'; });
}
function stopReplay() { if (RP.map) { try { RP.map.remove(); } catch (e) {} RP.map = null; } }

Object.assign(ACTIONS, {
  detailTab(v) { S.detailTab = v; RP.fitted = false; RP.edit = false; },
  cardHalf(v) { S.cardHalf = v; },
  rpHole(v) { const r = rpRound(), i = Number(v); if (r && i >= 0 && i < r.holes.length) { RP.i = i; RP.fitted = false; RP.club = 'Dr'; } },
  rpEdit() { RP.edit = !RP.edit; },
  rpClub(v) { RP.club = v; },
  rpDel(v) { const h = rpRound().holes[RP.i]; h.shots.splice(Number(v), 1); syncPens(h); },
  rpPen(v) { const h = rpRound().holes[RP.i], x = h.shots[h.shots.length - 1]; x.pen = x.pen === v ? null : v; syncPens(h, true); },
});
