'use strict';
/* Hole-up map for the round GPS screen (written for this app; Leaflet has no built-in rotation).
   The Leaflet map lives in a square, larger than the screen, that is CSS-rotated so the line from you (or the tee)
   to the pin points straight up. Panning, pinch-zoom, taps and dragging the aim point are handled here and converted
   back through the rotation. Labels and icons are counter-rotated so text stays upright. */

const ROT = { b: 0, W: 0, H: 0, D: 0, ptrs: new Map(), mode: null, start: null, last: null, pinch: null, lastTap: 0 };

/* keep text upright: tooltips and div icons get a counter-rotated wrapper */
(function patchLeafletForRotation() {
  const once = () => {
    if (!window.L || L.__rotPatched) return !!(window.L && L.__rotPatched);
    L.__rotPatched = true;
    const bt = L.Layer.prototype.bindTooltip;
    L.Layer.prototype.bindTooltip = function (c, o) { return bt.call(this, typeof c === 'string' ? `<span class="ur">${c}</span>` : c, o); };
    const ci = L.DivIcon.prototype.createIcon;
    L.DivIcon.prototype.createIcon = function (old) {
      const el = ci.call(this, old), a = this.options.iconAnchor || [0, 0];
      el.innerHTML = `<div class="ur ur-box" style="transform-origin:${a[0]}px ${a[1]}px">${el.innerHTML}</div>`;
      return el;
    };
    return true;
  };
  const t = setInterval(() => { if (once()) clearInterval(t); }, 200);
})();

function rotPrepare() {
  const outer = $('#mapRot'), inner = $('#map'); if (!outer || !inner) return;
  ROT.W = outer.clientWidth; ROT.H = outer.clientHeight; ROT.D = Math.ceil(Math.hypot(ROT.W, ROT.H)) + 4;
  Object.assign(inner.style, { width: ROT.D + 'px', height: ROT.D + 'px', left: (ROT.W - ROT.D) / 2 + 'px', top: (ROT.H - ROT.D) / 2 + 'px', right: 'auto', bottom: 'auto' });
  if (!outer.dataset.rot) { outer.dataset.rot = '1'; bindRotGestures(outer); }
  applyBearing(ROT.b);
}
function applyBearing(b) {
  ROT.b = b;
  const inner = $('#map'), wrap = $('#mapWrap');
  if (inner) inner.style.transform = `rotate(${-b}deg)`;
  if (wrap) wrap.style.setProperty('--brg', `${b}deg`);
}
const rad = d => d * Math.PI / 180;
/* screen delta -> map (container) delta */
function unrot(dx, dy) { const a = rad(ROT.b); return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]; }
function clientToLatLng(cx, cy) {
  const r = $('#mapRot').getBoundingClientRect(), [vx, vy] = unrot(cx - r.left - ROT.W / 2, cy - r.top - ROT.H / 2);
  return M.map.containerPointToLatLng(L.point(vx + ROT.D / 2, vy + ROT.D / 2));
}

function bindRotGestures(el) {
  el.addEventListener('pointerdown', e => {
    if (!M.map) return;
    el.setPointerCapture(e.pointerId);
    ROT.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ROT.ptrs.size === 2) {
      const [a, b] = [...ROT.ptrs.values()];
      ROT.pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: M.map.getZoom() }; ROT.mode = 'pinch';
    } else {
      ROT.mode = e.target.closest && e.target.closest('.aim-ico') ? 'aim' : 'pan';
      ROT.start = [e.clientX, e.clientY, Date.now()]; ROT.last = [e.clientX, e.clientY]; ROT.moved = false;
    }
    e.preventDefault();
  }, { passive: false });
  el.addEventListener('pointermove', e => {
    if (!M.map || !ROT.ptrs.has(e.pointerId)) return;
    ROT.ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ROT.mode === 'pinch' && ROT.ptrs.size >= 2) {
      const [a, b] = [...ROT.ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      ROT.follow = false; M.map.setZoom(Math.max(13, Math.min(20.5, ROT.pinch.z0 + Math.log2(d / ROT.pinch.d0))), { animate: false });
      return;
    }
    const dx = e.clientX - ROT.last[0], dy = e.clientY - ROT.last[1];
    if (Math.hypot(e.clientX - ROT.start[0], e.clientY - ROT.start[1]) > 6) ROT.moved = true;
    ROT.last = [e.clientX, e.clientY];
    if (ROT.mode === 'aim') { const ll = clientToLatLng(e.clientX, e.clientY); M.aim = [ll.lat, ll.lng]; drawAimLight(); }
    else if (ROT.mode === 'pan' && ROT.moved) { ROT.follow = false; const [vx, vy] = unrot(dx, dy); M.map.panBy([-vx, -vy], { animate: false }); }
  });
  const end = e => {
    if (!ROT.ptrs.has(e.pointerId)) return;
    ROT.ptrs.delete(e.pointerId);
    if (ROT.mode === 'pinch') { if (!ROT.ptrs.size) ROT.mode = null; return; }
    const mode = ROT.mode; ROT.mode = null;
    if (mode === 'aim') { if (ROT.moved) { mapOverlays(); drawAim(); } return; }
    if (!ROT.moved && ROT.start && Date.now() - ROT.start[2] < 450) {
      const now = Date.now();
      if (now - ROT.lastTap < 300) { ROT.lastTap = 0; M.map.setZoom(Math.min(20.5, M.map.getZoom() + 1), { animate: false }); return; }
      ROT.lastTap = now;
      const ll = clientToLatLng(e.clientX, e.clientY);
      onMapClick({ latlng: ll });
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', e => { ROT.ptrs.delete(e.pointerId); ROT.mode = null; });
  el.addEventListener('wheel', e => { if (!M.map) return; e.preventDefault(); M.map.setZoom(Math.max(13, Math.min(20.5, M.map.getZoom() - e.deltaY / 300)), { animate: false }); }, { passive: false });
}
addEventListener('resize', () => { if (M.map && $('#mapRot')) { rotPrepare(); M.map.invalidateSize({ animate: false }); fitHole(); } });

/* Auto-follow: the view re-frames itself (bearing + zoom) as GPS settles or you walk,
   until you pan or zoom by hand. ⌖ turns following back on. */
ROT.follow = true;
function rotFollow() {
  if (!M.map || !ROT.follow || ROT.mode) return;
  const O = originPt(), h = curHole(); if (!O) return;
  const moved = !ROT.fitO || dist(O, ROT.fitO) > 12, better = ROT.fitAcc != null && M.acc != null && M.acc < ROT.fitAcc * 0.6;
  if (moved || better || ROT.fitHoleN !== h.n) fitHole();
}
/* Hole-up framing: origin (you, or the tee) at the bottom centre, the pin near the top, whole hole in view. */
function fitHole() {
  if (!M.map) return;
  const h = curHole(), g = holeGeo(h.n), O = originPt(), P = pinPt(h.n);
  if (!g || !O || !P || dist(O, P) < 15) {
    applyBearing(0);
    if (g) M.map.setView(g.c, 18, { animate: false });
    else if (O) M.map.setView(O, 17, { animate: false });
    else if (courseGeo().center) M.map.setView(courseGeo().center, 16, { animate: false });
    return;
  }
  applyBearing(bearing(O, P));
  ROT.fitO = O; ROT.fitAcc = M.acc; ROT.fitHoleN = h.n;
  const H = ROT.H || innerHeight, yO = H - 190, yG = Math.min(150, H * 0.2), hv = Math.max(120, yO - yG);
  const Lm = dist(O, P) + (g.poly ? Math.max(...g.poly.map(p => dist(P, p))) : 15);
  const z = Math.log2((156543.03 * Math.cos(rad(O[0])) * hv) / Lm);
  const t = (yO - H / 2) / (yO - yG + (g.poly ? 0 : 0));
  const c = [O[0] + (P[0] - O[0]) * t, O[1] + (P[1] - O[1]) * t];
  M.map.setView(c, Math.max(14, Math.min(19.5, z)), { animate: false });
}
/* distance-ring labels sit just left of the line to the pin, so they don't cover it */
function ringLabelPt(O, P, m) {
  const E = enu(O), V = E.to(P), Lv = Math.hypot(V[0], V[1]) || 1, a = -rad(14);
  const ux = V[0] / Lv, uy = V[1] / Lv, rx = ux * Math.cos(a) - uy * Math.sin(a), ry = ux * Math.sin(a) + uy * Math.cos(a);
  return E.from([rx * m, ry * m]);
}
