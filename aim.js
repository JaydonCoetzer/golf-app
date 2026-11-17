'use strict';
/* Aim assist on the round map.
   - Origin: your GPS position when you're on the hole, otherwise the tee (so it also works when previewing at home).
   - Pin: set today's pin position per hole (tap ⚑ Pin, then the green); distances go to the pin, not the green centre.
   - Aim point: a draggable marker. Default = the pin if a club in your bag reaches it, otherwise a lay-up at the
     recommended club's distance along the line to the pin. Tap the map or drag the marker to move it.
   - Club: picked automatically for the plays-like distance to the aim point; tap it to choose another club.
   - Dispersion: the chosen club's oval (yours after 8 tracked shots, otherwise typical for your handicap and hand)
     is drawn around the aim point, along the shot line.
   - AIM button: searches nearby aim points and picks the one where your oval keeps the most shots on the green
     (or in play for a lay-up) and away from water and bunkers. */

const AIM = { layer: null, marker: null };

function pinPt(n) {
  const r = activeRound(), g = holeGeo(n);
  return (r && r.pins && r.pins[n]) || (g && g.c) || null;
}
function originPt() {
  const h = curHole(), g = holeGeo(h.n);
  // you're "on" the hole when you're no further from the green than the hole is long (plus a little)
  const holeLen = g && g.tee ? dist(g.tee, g.c) : (h.len || 400);
  if (M.me && (!g || dist(M.me, g.c) <= holeLen * 1.15 + 40)) return M.me;
  return (g && g.tee) || M.me || null;
}
const usingGps = () => { const o = originPt(); return !!(o && M.me && o === M.me); };

/* local metres around a reference point */
function enu(ref) {
  const kx = Math.cos(ref[0] * Math.PI / 180) * 111320, ky = 110540;
  return { to: p => [(p[1] - ref[1]) * kx, (p[0] - ref[0]) * ky], from: ([x, y]) => [ref[0] + y / ky, ref[1] + x / kx] };
}
function alongLine(a, b, m) {
  const E = enu(a), B = E.to(b), L = Math.hypot(B[0], B[1]) || 1;
  return E.from([B[0] / L * m, B[1] / L * m]);
}
function longestClub() { const b = bagDistances(); return b.length ? b[b.length - 1] : null; }

function autoAim() {
  const o = originPt(), pin = pinPt(curHole().n); if (!o || !pin) return null;
  const top = longestClub(), d = playsLike(o, pin).d;
  if (!top || d <= top.d * 1.04) return pin;
  return alongLine(o, pin, top.d);
}
function aimPt() { return M.aim || autoAim(); }
function aimClub() {
  if (M.aimClub) { const [mk, mp] = M.aimClub.split('@'); const b = bagDistances().find(c => c.k === mk && (c.pct || '') == (mp || '')); return b || { k: mk, d: clubDist(mk).d }; }
  const o = originPt(), a = aimPt(); if (!o || !a) return null;
  return recommendClub(playsLike(o, a).d);
}
function clubEllipse(k) {
  const pts = typeof dispShots === 'function' ? dispShots(k) : [];
  return pts.length >= 8 ? fitEllipse(pts) : defaultEllipse(k);
}
/* ellipse outline (lat/lng) around `aim`, oriented along origin -> aim */
function ellipseLatLngs(o, aim, E, n = 48) {
  const L = enu(aim), A = L.to(o), len = Math.hypot(A[0], A[1]) || 1, f = [-A[0] / len, -A[1] / len], rt = [f[1], -f[0]];
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI, ex = E.rx * Math.cos(t), ey = E.ry * Math.sin(t);
    const x = E.cx + ex * Math.cos(E.ang) - ey * Math.sin(E.ang), y = E.cy + ex * Math.sin(E.ang) + ey * Math.cos(E.ang);
    out.push(L.from([rt[0] * x + f[0] * y, rt[1] * x + f[1] * y]));
  }
  return out;
}
/* deterministic sample points inside the ellipse */
function ellipseSamples(o, aim, E) {
  const L = enu(aim), A = L.to(o), len = Math.hypot(A[0], A[1]) || 1, f = [-A[0] / len, -A[1] / len], rt = [f[1], -f[0]];
  const out = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const u = i / 3.2, v = j / 3.2; if (u * u + v * v > 1) continue;
    const ex = E.rx * u * 0.75, ey = E.ry * v * 0.75; // ~1.5 sigma body of the oval
    const x = E.cx + ex * Math.cos(E.ang) - ey * Math.sin(E.ang), y = E.cy + ex * Math.sin(E.ang) + ey * Math.cos(E.ang);
    out.push(L.from([rt[0] * x + f[0] * y, rt[1] * x + f[1] * y]));
  }
  return out;
}
function scoreAim(o, aim, E, pin, green, hz, layup) {
  const sm = ellipseSamples(o, aim, E); let s = 0;
  for (const p of sm) {
    if (!layup) { if (green && green.poly ? inPoly(p, green.poly) : dist(p, pin) < 12) s += 1; }
    for (const z of hz) if (inPoly(p, z.poly)) { s -= z.t === 'water' ? 2.5 : 0.7; break; }
  }
  s /= sm.length;
  return s - (layup ? dist(aim, pin) * 0.0025 : dist(aim, pin) * 0.004);
}
function optimiseAim() {
  const o = originPt(), h = curHole(), pin = pinPt(h.n), g = holeGeo(h.n); if (!o || !pin) return;
  const club = aimClub(); if (!club) { toast('Add club distances in your Golf bag first'); return; }
  const E = clubEllipse(club.k), hz = (courseGeo().hazards || []).filter(z => dist(z.poly[0], pin) < 500);
  const layup = club.d < playsLike(o, pin).d * 0.96;
  const cands = [];
  if (!layup) {
    const P = enu(pin);
    for (let x = -24; x <= 24; x += 3) for (let y = -24; y <= 24; y += 3) cands.push(P.from([x, y]));
  } else {
    const Ln = enu(o), Pn = Ln.to(pin), base = Math.atan2(Pn[1], Pn[0]);
    for (let a = -24; a <= 24; a += 2) { const t = base + a * Math.PI / 180; cands.push(Ln.from([Math.cos(t) * club.d, Math.sin(t) * club.d])); }
  }
  let best = null, bs = -1e9;
  for (const c of cands) { const sc = scoreAim(o, c, E, pin, g, hz, layup); if (sc > bs) { bs = sc; best = c; } }
  if (best) { M.aim = best; toast(`Aim set for ${clubLabel(club)}${hz.length ? ', away from trouble' : ''}`); }
}

/* ---------- drawing ---------- */
function drawAim() {
  if (!M.map) return;
  if (!AIM.layer || !M.map.hasLayer(AIM.layer)) AIM.layer = L.layerGroup().addTo(M.map);
  AIM.layer.clearLayers();
  if (M.setPin || M.setTee || M.setFlag) { if (AIM.marker) { AIM.marker.remove(); AIM.marker = null; } return; }
  const o = originPt(), a = aimPt(), h = curHole(), pin = pinPt(h.n);
  if (!o || !a) { if (AIM.marker) { AIM.marker.remove(); AIM.marker = null; } return; }
  const club = aimClub();
  if (club) {
    const E = clubEllipse(club.k), sc = club.pct ? club.pct / 100 : 1; if (sc < 1) { E.rx *= sc; E.ry *= sc; }
    L.polygon(ellipseLatLngs(o, a, E), { color: '#4f8dff', weight: 3, fillColor: '#4f8dff', fillOpacity: 0.16, interactive: false }).addTo(AIM.layer);
  }
  L.polyline([o, a], { color: '#fff', weight: 2.5, interactive: false }).addTo(AIM.layer);
  if (pin && dist(a, pin) > 3) L.polyline([a, pin], { color: '#fff', weight: 2, dashArray: '6 6', interactive: false }).addTo(AIM.layer);
  const lbl = (p, q, cls) => L.circleMarker([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { radius: 0, opacity: 0, interactive: false })
    .bindTooltip(fd(dist(p, q)) + S.settings.unit, { permanent: true, direction: 'center', className: cls }).addTo(AIM.layer);
  if (pin && dist(a, pin) > 45) L.circleMarker([a[0] + (pin[0] - a[0]) * 0.62, a[1] + (pin[1] - a[1]) * 0.62], { radius: 0, opacity: 0, interactive: false })
    .bindTooltip(fd(dist(a, pin)) + S.settings.unit, { permanent: true, direction: 'center', className: 'midlbl' }).addTo(AIM.layer);
  const pl = playsLike(o, a);
  const html = `<div class="aim-box"><b>${fd(dist(o, a))}</b>${Math.abs(pl.d - dist(o, a)) >= 2 ? `<span class="${pl.d > dist(o, a) ? 'up' : 'dn'}">${pl.d > dist(o, a) ? '▲' : '▼'} ${fd(pl.d)}</span>` : ''}</div>`;
  const icon = L.divIcon({ className: 'aim-ico', html: `<span class="aim-dot"></span>${html}`, iconSize: [24, 24], iconAnchor: [12, 12] });
  if (AIM.marker && M.map.hasLayer(AIM.marker)) { AIM.marker.setLatLng(a); AIM.marker.setIcon(icon); }
  else {
    AIM.marker = L.marker(a, { icon, draggable: false, zIndexOffset: 1000 }).addTo(M.map);
    AIM.marker.on('drag', e => { const p = e.target.getLatLng(); M.aim = [p.lat, p.lng]; drawAimLight(); });
    AIM.marker.on('dragend', () => { mapOverlays(); drawAim(); });
  }
  if (pin && activeRound().pins && activeRound().pins[h.n]) L.marker(pin, { interactive: false, icon: L.divIcon({ className: '', html: '<span class="pin-flag">⛳</span>', iconSize: [26, 26], iconAnchor: [6, 24] }) }).addTo(AIM.layer);
}
let aimRaf = 0;
function drawAimLight() { cancelAnimationFrame(aimRaf); aimRaf = requestAnimationFrame(() => { drawAim(); const c = $('#aimCard'); if (c) c.innerHTML = aimCardHtml(); }); }

function aimCardHtml() {
  const o = originPt(), a = aimPt(); if (!o || !a || M.setPin || M.setTee || M.setFlag) return '';
  const club = aimClub(), pl = playsLike(o, a), cd = club ? clubDist(club.k).d : null;
  const gap = club && cd ? cd - pl.d : null;
  return `<button class="ac-aim" data-act="aimOpt" aria-label="Optimal aim">⌖ AIM</button>
    <button class="ac-club" data-act="sheet" data-v="aimclub">${club ? `<b>${esc(clubLabel(club))}</b>${gap != null && Math.abs(gap) >= 3 ? `<small class="${gap > 0 ? 'pos' : 'neg'}">${gap > 0 ? '+' : ''}${fd(gap)}</small>` : ''}` : '<b>Pick club</b>'}${M.aimClub ? '<i>manual</i>' : '<i>auto</i>'} ▾</button>
    ${M.aim || M.aimClub ? '<button class="ac-reset" data-act="aimReset" aria-label="Reset aim">↺</button>' : ''}`;
}
function aimClubSheet() {
  const o = originPt(), a = aimPt(), need = o && a ? playsLike(o, a).d : null, auto = need ? recommendClub(need) : null, u = S.settings.unit;
  return `<div class="sheet-h"><b>Club for this shot</b><button class="mt-x dark" data-act="sheet" data-v="">✕</button></div>
    ${need ? `<div class="sub" style="margin-bottom:8px">Aim point plays like <b>${fd(need)} ${u}</b>.${auto ? ` Suggested: <b>${esc(clubLabel(auto))}</b>.` : ''}</div>` : ''}
    <button class="clubrow2" data-act="aimClub" data-v=""><span class="cb-badge">A</span><span class="cb-n"><b>Automatic</b><small>best club for the distance</small></span>${!M.aimClub ? '<span class="cb-d"><b>✓</b></span>' : ''}</button>
    ${bagDistances().slice().reverse().map(c => { const id = c.pct ? `${c.k}@${c.pct}` : c.k, d = c.d, isAuto = auto && auto.k === c.k && (auto.pct || 0) === (c.pct || 0); return `<button class="clubrow2" data-act="aimClub" data-v="${id}"><span class="cb-badge">${esc(c.k)}</span><span class="cb-n"><b>${esc(clubLabel(c))}</b><small>${fd(d)} ${u}${clubDist(c.k).src === 'est' && !c.pct ? ' (est.)' : ''}${need ? ` · ${d - need >= 0 ? '+' : ''}${fd(d - need)}` : ''}</small></span>${M.aimClub === id ? '<span class="cb-d"><b>✓</b></span>' : isAuto ? '<span class="cb-d"><small>suggested</small></span>' : ''}</button>`; }).join('')}`;
}
function placeFabsLeft() {
  const fl = $('#mapFabL'), ml = $('#mapLeft'); if (!fl || !ml) return;
  const top = ml.getBoundingClientRect().bottom + 10, room = innerHeight - 150 - top;
  fl.classList.toggle('row', room < 3 * 60);
  fl.style.top = top + 'px';
}
function aimFabsLeft() {
  return `<button class="fab sm ${M.setPin ? 'on' : ''} t-pin" data-act="setPinMode" aria-label="Set pin">⚑<small>Pin</small></button>
    <button class="fab sm ${M.setTee ? 'on' : ''} t-tee" data-act="setTeeMode" aria-label="Set tee">⊥<small>Tee</small></button>
    <button class="fab sm trk ${S.settings.track !== false ? 'on' : ''}" data-act="trackToggle" aria-label="Shot tracking">◎<small>Track</small></button>`;
}

/* ---------- guided tour ---------- */
const TOUR = [
  ['#mapRight', 'Distances', 'Back, middle and front of the green from where you are, plus plays-like, wind and elevation. If you set the pin, the big number is to the pin.'],
  ['.aim-dot', 'Aim point', 'Drag the aim point, or tap anywhere on the map. The lines show the distance to it and from it to the pin. The box shows plays-like distance.'],
  ['#aimCard .ac-club', 'Club & aim', 'Your club is picked automatically from your distances. Tap to choose a different club. The oval is that club\'s dispersion.'],
  ['#aimCard .ac-aim', 'AIM', 'Finds the best aim point for this shot, keeping your dispersion on the green and away from water and bunkers.'],
  ['.t-pin', 'Set the pin', 'Tap, then tap where the hole is cut today, so distances are to the pin, not the middle of the green.'],
  ['.t-tee', 'Set the tee', 'Move the tee to where you are actually hitting from. Used when your GPS is not on the hole.'],
  ['.trk', 'Track shots', 'Turn shot tracking on to mark every shot (📍 Mark) and get club stats and strokes gained.'],
  ['.mb-score', 'Enter score', 'Score, putts, tee shot and scoring zone for the hole, then Finish hole.'],
  ['#mapLeft', 'Hole info', 'Hole, par, length and stroke index. Shots, Insights and Hazards open from here.'],
  ['.mb-menu', 'Round menu', 'Scorecard, set green, pause, end or delete the round. You can replay this tour from here.'],
];
function tourHtml() {
  if (M.tour == null) return '';
  const [sel, title, text] = TOUR[M.tour], el = document.querySelector(sel);
  const r = el ? el.getBoundingClientRect() : null, vh = innerHeight;
  const ring = r ? `<div class="tour-ring" style="left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px"></div>` : '';
  const below = r && r.top + r.height / 2 < vh / 2;
  const cardPos = r ? (below ? `top:${Math.min(vh - 230, r.bottom + 14)}px` : `bottom:${Math.min(vh - 230, vh - r.top + 14)}px`) : 'top:30%';
  return `<div class="tour-bg"></div>${ring}<div class="tour-card" style="${cardPos}"><small>${M.tour + 1} / ${TOUR.length}</small><b>${title}</b><p>${text}</p>
    <div class="tour-btns"><button data-act="tourSkip">Skip</button><span></span>${M.tour ? '<button data-act="tourBack">Back</button>' : ''}<button class="go" data-act="tourNext">${M.tour === TOUR.length - 1 ? 'Done' : 'Next'}</button></div></div>`;
}
function paintTour() { const t = $('#mapTour'); if (t) { t.innerHTML = tourHtml(); t.className = M.tour == null ? '' : 'on'; } }

Object.assign(ACTIONS, {
  aimOpt() { optimiseAim(); },
  aimReset() { M.aim = null; M.aimClub = null; },
  aimClub(v) {
    M.aimClub = v || null; M.sheet = null;
    const o = originPt(), pin = pinPt(curHole().n);
    if (v && o && pin) { const [vk, vp] = v.split('@'), d = vp ? partialDist(vk, Number(vp)) : clubDist(vk).d; if (d && d < playsLike(o, pin).d * 0.96) M.aim = alongLine(o, M.aim || pin, d); else if (d) M.aim = null; }
  },
  setPinMode() { M.setPin = !M.setPin; M.setTee = false; M.setFlag = false; },
  setTeeMode() { M.setTee = !M.setTee; M.setPin = false; M.setFlag = false; },
  clearPin() { const r = activeRound(); if (r.pins) delete r.pins[curHole().n]; M.setPin = false; },
  trackToggle() { S.settings.track = S.settings.track === false; toast(S.settings.track === false ? 'Shot tracking off' : 'Shot tracking on: tap 📍 Mark before each shot'); },
  tourStart() { M.sheet = null; M.tour = 0; },
  tourNext() { M.tour = M.tour >= TOUR.length - 1 ? null : M.tour + 1; if (M.tour == null) S.settings.mapTour = 1; },
  tourBack() { M.tour = Math.max(0, M.tour - 1); },
  tourSkip() { M.tour = null; S.settings.mapTour = 1; },
});
