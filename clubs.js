'use strict';
/* Golf bag + per-club stats.
   - Edit the bag: add/remove clubs from a full catalogue, name each club's model.
   - Each club: True Distance (from your better recent strikes, mishits/outliers excluded) vs Manual distance,
     a toggle for which one the caddie uses, strokes gained per shot, accuracy and a dispersion oval.
   - Dispersion: each tracked shot's end point relative to the aim line (start -> green). The oval is fitted to your
     shots (2 sigma). Until there are enough shots it shows a typical oval for your handicap, slanted for your
     dominant hand (right-handers: long-left to short-right; left-handers mirrored). */

/* ---------- catalogue ---------- */
(function extendCatalogue() {
  const full = [
    ['Dr', 'Driver'], ['3W', '3 wood'], ['5W', '5 wood'], ['7W', '7 wood'],
    ['Hy', 'Hybrid'], ['2H', '2 hybrid'], ['3H', '3 hybrid'], ['4H', '4 hybrid'], ['5H', '5 hybrid'],
    ['2i', '2 iron'], ['3i', '3 iron'], ['4i', '4 iron'], ['5i', '5 iron'], ['6i', '6 iron'], ['7i', '7 iron'], ['8i', '8 iron'], ['9i', '9 iron'],
    ['PW', 'Pitching wedge'], ['GW', 'Gap wedge'], ['SW', 'Sand wedge'], ['LW', 'Lob wedge'], ['Pt', 'Putter'],
  ];
  CLUBS.splice(0, CLUBS.length, ...full);
  for (const [k, n] of full) CLUB_NAME[k] = n;
})();
const DEFAULT_BAG = ['Dr', '3W', '5W', 'Hy', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW', 'Pt'];
const TRUE_MIN = 5; // good shots needed before True Distance is used

function bagKeys() { return S.settings.bagKeys && S.settings.bagKeys.length ? S.settings.bagKeys : DEFAULT_BAG; }
function bagList() { const ks = new Set(bagKeys()); return CLUBS.filter(([k]) => ks.has(k)); }
const isRight = () => (S.settings.hand || 'R') === 'R';

/* ---------- distances ---------- */
function trueDist(k) {
  const good = clubShots(k).filter(o => !o.out).slice(0, 10).map(o => o.d).sort((a, b) => a - b);
  if (good.length < TRUE_MIN) return { d: null, n: good.length };
  const cut = Math.floor(good.length * 0.15), mid = good.slice(cut, good.length - cut);
  return { d: sum(mid) / mid.length, n: good.length };
}
function manualDist(k) {
  const v = Number((S.settings.bag || {})[k]);
  return v > 0 ? (S.settings.unit === 'yd' ? v * 0.9144 : v) : null;
}
function usesTrue(k) { return S.settings.useTrue !== false && !(S.settings.manualOnly || {})[k]; }
function clubDist(k) {
  const t = trueDist(k), m = manualDist(k);
  if (t.d && usesTrue(k)) return { d: t.d, src: 'true' };
  if (m) return { d: m, src: 'manual' };
  if (t.d) return { d: t.d, src: 'true' };
  return { d: null, src: null };
}
// replaces the earlier version: the caddie / club suggestions use these
function bagDistances() {
  return bagList().filter(([k]) => k !== 'Pt').map(([k]) => ({ k, d: clubDist(k).d })).filter(c => c.d).sort((a, b) => a.d - b.d);
}

/* ---------- dispersion ---------- */
function dispShots(k) {
  const typ = clubDist(k).d || trueDist(k).d;
  const out = [];
  for (const r of S.rounds) {
    const geo = S.geo[(r.course || 'unnamed').trim().toLowerCase()] || { holes: {} };
    for (const h of r.holes) {
      const g = geo.holes[h.n], sh = h.shots || [];
      if (!g || !g.c) continue;
      sh.forEach((s, i) => {
        if (s.club !== k || k === 'Pt') return;
        const nx = sh[i + 1]; if (!nx) return;
        const a = [s.lat, s.lng], e = [nx.lat, nx.lng], gc = g.c;
        const kx = Math.cos(a[0] * Math.PI / 180) * 111320, xy = p => [(p[1] - a[1]) * kx, (p[0] - a[0]) * 110540];
        const G = xy(gc), L = Math.hypot(G[0], G[1]); if (L < 20) return;
        const ux = G[0] / L, uy = G[1] / L, E = xy(e);
        const along = E[0] * ux + E[1] * uy, cross = E[0] * uy - E[1] * ux; // cross > 0 = right of target
        const intended = typ && L > typ * 1.15 ? typ : L; // laying up / driving: club distance; otherwise the green
        out.push({ x: cross, y: along - intended, d: Math.hypot(E[0], E[1]), pen: !!s.pen, bad: s.bad && s.bad !== 'good', tee: i === 0, h, r });
      });
    }
  }
  return out;
}
function fitEllipse(pts) {
  const n = pts.length, mx = sum(pts.map(p => p.x)) / n, my = sum(pts.map(p => p.y)) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
  sxx /= n; syy /= n; sxy /= n;
  const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const ang = Math.atan2(l1 - sxx, sxy || 1e-9); // direction of the major axis (x right, y long)
  return { cx: mx, cy: my, rx: 2 * Math.sqrt(Math.max(l1, 1)), ry: 2 * Math.sqrt(Math.max(l2, 1)), ang };
}
function defaultEllipse(k) {
  const d = clubDist(k).d || 150, hc = Math.max(0, Math.min(36, Number(S.settings.hcp) || S.settings.target || 18));
  const wide = d * (0.07 + hc * 0.0028), deep = d * (0.045 + hc * 0.0016);
  // major axis runs long-left to short-right for right-handers (tilt ~20°), mirrored for left-handers
  const tilt = (isRight() ? -1 : 1) * 20 * Math.PI / 180;
  return { cx: 0, cy: -d * 0.02, rx: wide, ry: deep, ang: tilt, typical: true };
}
function dispersionSvg(k, pts, E, accR) {
  const reach = Math.max(10, accR || 0, ...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))), E.rx + Math.hypot(E.cx, E.cy), E.ry);
  const step = reach > 45 ? 20 : 10, rings = Math.max(3, Math.ceil(reach / step)), R = 140, sc = R / (rings * step);
  const X = x => 160 + x * sc, Y = y => 160 - y * sc, u = S.settings.unit;
  const deg = -E.ang * 180 / Math.PI;
  return `<svg class="disp" viewBox="0 0 320 320" role="img" aria-label="Dispersion for ${esc(CLUB_NAME[k])}">
    <line x1="10" y1="160" x2="310" y2="160" class="ax"/><line x1="160" y1="10" x2="160" y2="310" class="ax"/>
    ${Array.from({ length: rings }, (_, i) => `<circle cx="160" cy="160" r="${((i + 1) * step * sc).toFixed(1)}" class="rg"/><text x="164" y="${(160 - (i + 1) * step * sc + 12).toFixed(1)}" class="rl">${fd((i + 1) * step)} ${u}</text>`).join('')}
    ${accR ? `<circle cx="160" cy="160" r="${(accR * sc).toFixed(1)}" class="accz"/>` : ''}
    <ellipse cx="${X(E.cx).toFixed(1)}" cy="${Y(E.cy).toFixed(1)}" rx="${(E.rx * sc).toFixed(1)}" ry="${(E.ry * sc).toFixed(1)}" transform="rotate(${deg.toFixed(1)} ${X(E.cx).toFixed(1)} ${Y(E.cy).toFixed(1)})" class="el ${E.typical ? 'typ' : ''}"/>
    ${pts.map(p => `<circle cx="${X(Math.max(-reach, Math.min(reach, p.x))).toFixed(1)}" cy="${Y(Math.max(-reach, Math.min(reach, p.y))).toFixed(1)}" r="5" class="pt ${p.acc === false ? 'miss' : ''}"/>`).join('')}
    <circle cx="160" cy="160" r="5" class="tg"/>
    <text x="160" y="22" text-anchor="middle" class="cap">Long</text><text x="160" y="306" text-anchor="middle" class="cap">Short</text>
    <text x="14" y="156" class="cap">Left</text><text x="306" y="156" text-anchor="end" class="cap">Right</text></svg>`;
}

/* ---------- strokes gained per club ---------- */
function clubSG(k) {
  let v = 0, n = 0;
  for (const r of S.rounds) for (const h of r.holes) { const x = sgHole(r, h); if (!x || !x.shots) continue; for (const s of x.shots) if (s.club === k) { v += s.v; n++; } }
  return n ? { v: v / n, n } : null;
}

/* ---------- club icons (simple line drawings by club type) ---------- */
function clubIcon(k) {
  const type = k === 'Pt' ? 'putter' : /^(Dr|\dW)$/.test(k) ? 'wood' : /H$|^Hy$/.test(k) ? 'hybrid' : /^(PW|GW|SW|LW)$/.test(k) ? 'wedge' : 'iron';
  const head = {
    wood: '<path d="M30 52c-10 0-18-6-18-14 0-6 6-10 14-10 12 0 22 6 22 14 0 6-8 10-18 10z" class="ci-h"/><path d="M14 40c6 3 18 4 30 1" class="ci-l"/>',
    hybrid: '<path d="M32 52c-9 0-16-5-16-12 0-5 5-8 12-8 10 0 18 5 18 11 0 6-6 9-14 9z" class="ci-h"/><path d="M18 42c5 2 15 3 25 0" class="ci-l"/>',
    iron: '<path d="M22 54l-4-14c-1-4 2-7 6-7h16l6 12c1 3-1 6-4 7z" class="ci-h"/><path d="M22 44h20M23 49h19" class="ci-l"/>',
    wedge: '<path d="M20 54l-5-17c-1-4 2-6 6-6h14l12 13c2 3 0 7-4 8z" class="ci-h"/><path d="M20 42h22M21 47h22" class="ci-l"/>',
    putter: '<rect x="12" y="44" width="30" height="10" rx="3" class="ci-h"/>',
  }[type];
  const shaft = type === 'putter' ? 'M40 6L36 44' : 'M44 4L38 34';
  return `<svg class="club-ico" viewBox="0 0 60 60" aria-hidden="true"><path d="${shaft}" class="ci-s"/>${head}</svg>`;
}

/* ---------- views ---------- */
function clubRow(k, n, extra = '') {
  const cd = clubDist(k), model = (S.settings.clubModels || {})[k];
  return `<button class="clubrow2" data-act="openClub" data-v="${k}"><span class="cb-badge">${esc(k)}</span>
    <span class="cb-n"><b>${esc(n)}</b><small>${model ? esc(model) : clubShots(k).length + ' tracked shots'}</small></span>
    ${extra}<span class="cb-d">${cd.d ? `<b>${fd(cd.d)}</b><small>${cd.src === 'true' ? 'True' : 'Manual'}</small>` : '<b>–</b><small>set distance</small>'}</span><span class="hp-chev">›</span></button>`;
}
function viewBag() {
  setTitle('Golf bag', `<button class="tbtn" data-act="${S.bagEdit ? 'bagEdit' : 'goHome'}">${S.bagEdit ? 'Done' : '‹ Home'}</button>`);
  const inBag = new Set(bagKeys()), count = bagList().length;
  if (S.bagEdit) {
    return `<div class="card"><h2>Edit bag <span class="sub ${count > 14 ? 'warnt' : ''}">${count} club${count === 1 ? '' : 's'}${count > 14 ? ' · rules allow 14' : ''}</span></h2>
      <div class="sub" style="margin-bottom:8px">Tap to add or remove. Shots you already tracked with a removed club are kept.</div>
      ${[['Woods', /W$|^Dr$/], ['Hybrids', /H$|^Hy$/], ['Irons', /i$/], ['Wedges', /^(PW|GW|SW|LW)$/], ['Putter', /^Pt$/]].map(([t, re]) =>
        `<h3>${t}</h3><div class="chips">${CLUBS.filter(([k]) => re.test(k)).map(([k, n]) => `<button data-act="toggleClub" data-v="${k}" class="${inBag.has(k) ? 'on' : ''}">${inBag.has(k) ? '✓ ' : '+ '}${esc(n)}</button>`).join('')}</div>`).join('')}
    </div>`;
  }
  return `<div class="card"><h2>In my bag <button class="btn sm" data-act="bagEdit">Edit bag</button></h2>
    ${bagList().map(([k, n]) => clubRow(k, n)).join('')}</div>
    <div class="card stack"><h2>Distances</h2>
      <div class="row between"><span><b>Use True Distance for all clubs</b><div class="sub">From your better recent shots once a club has ${TRUE_MIN}+. Otherwise your manual distance is used.</div></span>${toggle('trueAll', S.settings.useTrue !== false)}</div>
      <div><div class="field-title"><span>I play</span></div>${seg('hand', [['R', 'Right-handed'], ['L', 'Left-handed']], S.settings.hand || 'R')}</div></div>`;
}
function accRadius(k) {
  const v = Number((S.settings.accR || {})[k]);
  if (v > 0) return S.settings.unit === 'yd' ? v * 0.9144 : v;
  const d = clubDist(k).d || 150; return d >= 200 ? 25 : d >= 150 ? 20 : d >= 100 ? 15 : 10;
}
function toggle(act, on, v = '') { return `<button class="tgl ${on ? 'on' : ''}" data-act="${act}" data-v="${v}" role="switch" aria-checked="${on}"><i></i></button>`; }

function viewClub() {
  const k = S.clubSel, n = CLUB_NAME[k] || k, u = S.settings.unit;
  setTitle(n, `<button class="tbtn" data-act="closeClub">‹ Back</button>`);
  const t = trueDist(k), m = manualDist(k), shots = clubShots(k), model = (S.settings.clubModels || {})[k] || '';
  const sg = clubSG(k), pts = k === 'Pt' ? [] : dispShots(k), mine = pts.length >= 8;
  const E = mine ? fitEllipse(pts) : defaultEllipse(k);
  const P = a => (pts.length ? Math.round((a / pts.length) * 100) : 0);
  const typ = clubDist(k).d || 150;
  const accR = accRadius(k), isAcc = p => Math.hypot(p.x, p.y) <= accR;
  pts.forEach(p => { p.acc = isAcc(p); });
  const onT = pts.filter(isAcc).length;
  const L = pts.filter(p => p.x < -Math.max(5, typ * 0.04)).length, Rr = pts.filter(p => p.x > Math.max(5, typ * 0.04)).length;
  const Lg = pts.filter(p => p.y > Math.max(5, typ * 0.05)).length, Sh = pts.filter(p => p.y < -Math.max(5, typ * 0.05)).length;
  const tee = pts.filter(p => p.tee && p.h.par > 3), fw = tee.filter(p => p.h.fw === 'hit').length;
  const avgLat = pts.length ? sum(pts.map(p => Math.abs(p.x))) / pts.length : null;
  const editing = S.distEdit === k;
  return `
  <div class="cl-head">${clubIcon(k)}<div class="cl-title"><b>${esc(n)}</b>
    <input class="cl-model" data-bind="clubModel" data-v="${k}" value="${esc(model)}" placeholder="Add brand / model" aria-label="Club model"></div></div>
  <div class="card"><h2>Distance <button class="btn sm dark" data-act="distEdit" data-v="${k}">${editing ? 'Done' : 'Update distance'}</button></h2>
    <div class="dd"><div><small>True distance</small><b>${t.d ? fd(t.d) + ' ' + u : '–'}</b></div>
      <div><small>Manual</small>${editing ? `<input type="number" inputmode="numeric" data-bind="bag" data-v="${k}" value="${esc((S.settings.bag || {})[k] ?? '')}" placeholder="${u}" autofocus>` : `<b>${m ? fd(m) + ' ' + u : '–'}</b>`}</div></div>
    <div class="sub">True Distance is from your last 10 good shots. Mishits, penalty shots and outliers are left out.</div>
    ${t.d ? '' : `<div class="warnt" style="margin-top:6px">Hit ${TRUE_MIN - t.n} more good shot${TRUE_MIN - t.n === 1 ? '' : 's'} to use your True Distance</div>`}
    <hr><div class="row between"><b>Use True Distance</b>${toggle('trueClub', usesTrue(k), k)}</div>
    <div class="row between" style="margin-top:10px"><b>Use true distances for all clubs</b>${toggle('trueAll', S.settings.useTrue !== false)}</div></div>
  <div class="card"><h2>Avg strokes gained <span class="${sg ? (sg.v < 0 ? 'neg' : 'pos') : ''} sgv">${sg ? (sg.v > 0 ? '+' : '') + sg.v.toFixed(2) : '–'}</span></h2>
    <div class="sub">${sg ? `Per shot, against a tour-level player, from ${sg.n} shot${sg.n > 1 ? 's' : ''} on fully tracked holes.` : 'No fully tracked holes with this club yet.'}</div></div>
  ${k === 'Pt' ? '' : `<div class="card"><h2>Shot accuracy <span class="sub">${pts.length} shot${pts.length === 1 ? '' : 's'}</span></h2>
    ${mine ? '' : `<div class="warnt">Hit ${8 - pts.length} more ${esc(n.toLowerCase())} shot${8 - pts.length === 1 ? '' : 's'} for your own dispersion. Showing a typical ${isRight() ? 'right' : 'left'}-handed pattern for your handicap.</div>`}
    <div class="acc-row"><span><i style="background:#2d5cc0"></i>Accurate: within</span>
      <select data-bind="accR" data-v="${k}" aria-label="Accuracy radius">${[5, 10, 15, 20, 25, 30].map(v => `<option value="${v}" ${Math.round(toUnit(accR)) === v ? 'selected' : ''}>${v} ${u}</option>`).join('')}</select>
      <span style="margin-left:auto"><i style="background:#e5484d"></i>Not</span></div>
    ${pts.length ? `<div class="acc-big"><b>${P(onT)}%</b> of shots within ${fd(accR)} ${u} of the aim point</div>` : ''}
    ${dispersionSvg(k, pts, E, accR)}
    <div class="legend" style="justify-content:center"><span><i style="background:rgba(45,92,192,.25)"></i>${mine ? 'Your dispersion (≈86% of shots)' : 'Typical dispersion'}</span></div>
    ${pts.length ? `<div class="tiles" style="margin-top:12px">
      ${tile('Accurate', P(onT) + '%', `within ${fd(accR)} ${u}`)}
      ${tile('Dispersion', mine ? `${fd(E.rx * 2)} × ${fd(E.ry * 2)} ${u}` : '–', mine ? 'oval width × depth' : 'needs 8 shots')}
      ${tile('Left / right', `${P(L)}% / ${P(Rr)}%`, avgLat != null ? `avg ${fd(avgLat)} ${u} offline` : '')}
      ${tile('Long / short', `${P(Lg)}% / ${P(Sh)}%`, '')}
      ${tee.length ? tile('Fairways off the tee', fmtPct(fw, tee.length), `${fw}/${tee.length}`) : ''}
      ${tile('Mishits', fmtPct(shots.filter(o => o.s.bad && o.s.bad !== 'good').length, shots.length), '')}</div>` : '<div class="sub" style="margin-top:8px">Track shots with this club (📍 Mark on the map) to see your accuracy.</div>'}</div>`}
  <div class="card"><details class="help"><summary><b>Shot history</b> <span class="sub">${shots.length} shot${shots.length === 1 ? '' : 's'}</span></summary>
    ${shots.map(o => `<div class="list-item" style="cursor:default${o.out ? ';opacity:.45' : ''}"><div><b>${fmtDate(o.r.date)}</b><div class="sub">${esc(o.r.course || '')} · hole ${o.h.n}${o.s.bad && o.s.bad !== 'good' ? ' · ' + o.s.bad : ''}${o.s.pen ? ' · ' + PEN_NAME[o.s.pen] : ''}</div></div><div class="big" style="font-size:19px">${o.out ? '⊘ ' : ''}${fd(o.d)}<small style="font-size:11px"> ${u}</small></div></div>`).join('') || '<div class="sub">No tracked shots yet.</div>'}</details></div>
  ${bagKeys().includes(k) ? `<button class="btn block danger" style="margin-bottom:12px" data-act="toggleClub" data-v="${k}">Remove ${esc(n)} from bag</button>` : `<button class="btn block" style="margin-bottom:12px" data-act="toggleClub" data-v="${k}">Add ${esc(n)} to bag</button>`}`;
}
// Stats → Clubs uses the same rows, with a distance range bar
function statClubs() {
  const list = bagList().filter(([k]) => k !== 'Pt'), u = S.settings.unit;
  const rows = list.map(([k, n]) => { const ok = clubShots(k).filter(o => !o.out).map(o => o.d); return { k, n, lo: ok.length ? Math.min(...ok) : null, hi: ok.length ? Math.max(...ok) : null }; });
  const max = Math.max(250, ...rows.map(r => r.hi || clubDist(r.k).d || 0));
  return `<div class="card"><h2>My clubs <button class="btn sm" data-act="goBag">Edit bag</button></h2>
    <div class="sub" style="margin-bottom:6px">Tap a club for its distance, accuracy, dispersion and strokes gained. Bars show your shortest to longest normal shot (${u}).</div>
    ${rows.map(r => clubRow(r.k, r.n, `<span class="cr-bar">${r.lo != null ? `<i style="left:${(r.lo / max) * 100}%;width:${Math.max(3, ((r.hi - r.lo) / max) * 100)}%"></i>` : ''}</span>`)).join('')}</div>`;
}

Object.assign(ACTIONS, {
  bagEdit() { S.bagEdit = !S.bagEdit; window.scrollTo(0, 0); },
  toggleClub(v) {
    const ks = [...bagKeys()], i = ks.indexOf(v);
    if (i >= 0) { if (ks.length <= 1) return; ks.splice(i, 1); } else ks.push(v);
    S.settings.bagKeys = ks; toast(i >= 0 ? `${CLUB_NAME[v]} removed from bag` : `${CLUB_NAME[v]} added to bag`);
  },
  openClub(v) { S.clubFrom = S.view; S.clubSel = v; S.view = 'club'; S.distEdit = null; window.scrollTo(0, 0); },
  closeClub() { S.view = S.clubFrom && S.clubFrom !== 'club' ? S.clubFrom : 'bag'; S.distEdit = null; },
  distEdit(v) { S.distEdit = S.distEdit === v ? null : v; },
  trueClub(v) { S.settings.manualOnly = S.settings.manualOnly || {}; S.settings.manualOnly[v] = !S.settings.manualOnly[v]; },
  trueAll() { S.settings.useTrue = S.settings.useTrue === false; },
  hand(v) { S.settings.hand = v; },
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-bind="accR"]'); if (!el) return;
  S.settings.accR = Object.assign({}, S.settings.accR, { [el.dataset.v]: Number(el.value) }); persist(); render();
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-bind="clubModel"]'); if (!el) return;
  S.settings.clubModels = Object.assign({}, S.settings.clubModels, { [el.dataset.v]: el.value }); persist();
});
