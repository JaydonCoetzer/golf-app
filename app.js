'use strict';
/* Golf Stats — on-course stat tracker built around the scoring zone.
   All data lives in this browser's localStorage. Use More → Backup to export. */

const KEYS = { rounds: 'gs.rounds', courses: 'gs.courses', settings: 'gs.settings', active: 'gs.active' };
const DEFAULT_SETTINGS = { hcp: '', zone: 100, unit: 'm', target: 15, szGoal: 70, d3Goal: 70, theme: 'light' };
const STD_PARS = [4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5];
/* Built-in course cards. Par and stroke index (men's) from public scorecards; check against the club card. */
const BUILTIN_COURSES = [
  { name: 'Parow Golf Club', area: 'Parow, Cape Town',
    pars: [4, 3, 5, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4],
    si:   [9, 13, 5, 15, 11, 1, 17, 7, 3, 16, 12, 2, 18, 8, 4, 10, 14, 6] },
];
const PUTT_BUCKETS = ['0–1', '1–2', '2–4', '4–8', '8+'];

/* Rough per-18-hole averages for amateur golfers by handicap.
   Compiled from widely published amateur stat summaries (Shot Scope / Arccos style data);
   treat them as a guide, not gospel. */
const BENCH = {
  0:  { fir: 60, gir: 65, putts: 29.5, three: 0.6, ud: 55, sand: 45, pen: 0.4 },
  5:  { fir: 54, gir: 50, putts: 30.6, three: 1.1, ud: 42, sand: 33, pen: 0.8 },
  10: { fir: 48, gir: 39, putts: 31.6, three: 1.7, ud: 33, sand: 25, pen: 1.3 },
  15: { fir: 43, gir: 29, putts: 32.5, three: 2.4, ud: 26, sand: 19, pen: 1.9 },
  20: { fir: 38, gir: 21, putts: 33.4, three: 3.1, ud: 20, sand: 14, pen: 2.6 },
  25: { fir: 34, gir: 14, putts: 34.4, three: 3.8, ud: 15, sand: 10, pen: 3.3 },
  30: { fir: 30, gir: 9,  putts: 35.4, three: 4.6, ud: 11, sand: 7,  pen: 4.2 },
};

/* ---------- storage ---------- */
function load(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Could not save — export a backup'); return false; } }

const S = {
  rounds: load(KEYS.rounds, []),
  courses: load(KEYS.courses, []),
  settings: Object.assign({}, DEFAULT_SETTINGS, load(KEYS.settings, {})),
  activeId: load(KEYS.active, null),
  view: 'home',
  hole: 0,
  range: '10',
  trend: 'toPar',
  detailId: null,
  draft: null,
};
if (!S.settings.themeV2) { S.settings.theme = 'light'; S.settings.themeV2 = true; }
function persist() {
  save(KEYS.rounds, S.rounds); save(KEYS.courses, S.courses);
  save(KEYS.settings, S.settings); save(KEYS.active, S.activeId);
}

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = a => a.reduce((x, y) => x + y, 0);
function localDate() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const fmtPct = (a, b) => (b ? pct(a, b) + '%' : '–');
const fmt1 = v => (v == null || !isFinite(v) ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const toPar = n => (n === 0 ? 'E' : n > 0 ? '+' + n : String(n));
const scoreClass = tp => (tp <= -2 ? 'eagle' : tp === -1 ? 'birdie' : tp === 0 ? 'par' : tp === 1 ? 'bogey' : tp === 2 ? 'double' : 'triple');
const scoreName = (s, par) => {
  if (s === 1) return 'Hole in one!';
  const tp = s - par;
  return { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double', 3: 'Triple' }[tp] || (tp > 0 ? '+' + tp : tp);
};
function fmtDate(iso) {
  try { return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
  catch (e) { return iso; }
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function buzz() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) {} }
function allCourses() {
  const saved = S.courses.map(c => c.si ? c : { ...c, si: (BUILTIN_COURSES.find(b => b.name.toLowerCase() === c.name.toLowerCase()) || {}).si });
  return [...saved, ...BUILTIN_COURSES.filter(b => !S.courses.some(c => c.name.toLowerCase() === b.name.toLowerCase()))];
}
/* Handicap shots received on a hole, from course handicap and stroke index. */
function shotsGiven(hcp, si) {
  if (hcp == null || hcp === '' || !si) return 0;
  const h = Math.round(Number(hcp)); if (!isFinite(h) || h <= 0) return 0;
  return Math.floor(h / 18) + (si <= h % 18 ? 1 : 0);
}
function hasHcp(r) { return r.hcp != null && r.hcp !== '' && r.holes.some(h => h.si); }
function points(r, h) { return Math.max(0, 2 + h.par + shotsGiven(r.hcp, h.si) - h.score); }
function netTotals(r) {
  const hs = playedHoles(r);
  return { pts: sum(hs.map(h => points(r, h))), net: sum(hs.map(h => h.score - shotsGiven(r.hcp, h.si))) };
}
function zoneLabel() { return `${S.settings.zone} ${S.settings.unit}`; }
function benchFor(h) {
  const keys = Object.keys(BENCH).map(Number).sort((a, b) => a - b);
  let k = keys[0]; for (const x of keys) if (h >= x) k = x;
  return BENCH[k];
}

/* ---------- model ---------- */
function newHole(n, par, si, len) {
  return { n, par, si: si || null, len: len || null, score: null, putts: null, fw: null, szir: null, inZone: null, miss: null, ud: null, sand: null, ob: 0, water: 0, pen: 0, putt1: null, done: false };
}
function derive(h) {
  if (h.score == null) return null;
  const putts = h.putts ?? 0;
  const gir = h.score - putts <= h.par - 2;
  return {
    toPar: h.score - h.par,
    gir,
    fir: h.par > 3 && h.fw ? h.fw === 'hit' : null,
    d3: h.inZone != null ? h.inZone <= 3 : null,
    toZone: h.inZone != null ? h.score - h.inZone : null,
    pens: (h.ob || 0) + (h.water || 0) + (h.pen || 0),
  };
}
const activeRound = () => S.rounds.find(r => r.id === S.activeId) || null;
const playedHoles = r => r.holes.filter(h => h.done && h.score != null);

function aggregate(rounds) {
  const A = {
    rounds: 0, holes: 0, strokes: 0, par: 0,
    byPar: { 3: { n: 0, s: 0 }, 4: { n: 0, s: 0 }, 5: { n: 0, s: 0 } },
    dist: { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0, triple: 0 },
    firN: 0, fir: 0, fwL: 0, fwR: 0, fwS: 0,
    girN: 0, gir: 0, missN: 0, miss: { short: 0, long: 0, left: 0, right: 0 },
    puttsN: 0, putts: 0, onePutt: 0, threePutt: 0, girPutts: 0, girPuttN: 0,
    p1: PUTT_BUCKETS.map(() => ({ n: 0, one: 0, three: 0 })),
    udN: 0, ud: 0, sandN: 0, sand: 0,
    ob: 0, water: 0, pen: 0, penHoles: 0,
    szN: 0, sz: 0, szByPar: { 3: [0, 0], 4: [0, 0], 5: [0, 0] },
    d3N: 0, d3: 0, inZoneSum: 0, szAndD3: 0, szAndD3N: 0, szirPar: 0, noSzirPar: 0, noSzirN: 0,
  };
  for (const r of rounds) {
    const hs = playedHoles(r);
    if (!hs.length) continue;
    A.rounds++;
    for (const h of hs) {
      const x = derive(h);
      A.holes++; A.strokes += h.score; A.par += h.par;
      const bp = A.byPar[h.par]; if (bp) { bp.n++; bp.s += h.score; }
      A.dist[scoreClass(x.toPar)]++;
      if (h.par > 3 && h.fw) {
        A.firN++;
        if (h.fw === 'hit') A.fir++; else if (h.fw === 'left') A.fwL++; else if (h.fw === 'right') A.fwR++; else A.fwS++;
      }
      if (h.putts != null) {
        A.girN++;
        if (x.gir) { A.gir++; A.girPuttN++; A.girPutts += h.putts; }
        else if (h.miss) { A.missN++; A.miss[h.miss]++; }
        A.puttsN++; A.putts += h.putts;
        if (h.putts === 1) A.onePutt++;
        if (h.putts >= 3) A.threePutt++;
        if (h.putt1 != null && h.putts > 0) {
          const b = A.p1[h.putt1]; b.n++;
          if (h.putts === 1) b.one++;
          if (h.putts >= 3) b.three++;
        }
      }
      if (h.ud === 'made' || h.ud === 'missed') { A.udN++; if (h.ud === 'made') A.ud++; }
      if (h.sand === 'saved' || h.sand === 'missed') { A.sandN++; if (h.sand === 'saved') A.sand++; }
      A.ob += h.ob || 0; A.water += h.water || 0; A.pen += h.pen || 0;
      if (x.pens) A.penHoles++;
      if (h.szir != null) {
        A.szN++; if (h.szir) A.sz++;
        const sp = A.szByPar[h.par]; if (sp) { sp[1]++; if (h.szir) sp[0]++; }
        if (h.szir) { if (x.toPar <= 0) A.szirPar++; } else { A.noSzirN++; if (x.toPar <= 0) A.noSzirPar++; }
      }
      if (h.inZone != null) {
        A.d3N++; if (h.inZone <= 3) A.d3++; A.inZoneSum += h.inZone;
        if (h.szir != null) { A.szAndD3N++; if (h.szir && h.inZone <= 3) A.szAndD3++; }
      }
    }
  }
  A.per18 = v => (A.holes ? (v / A.holes) * 18 : null);
  return A;
}

/* ---------- rendering ---------- */
function setTitle(t, right = '') { $('#title').textContent = t; $('#topRight').innerHTML = right; }
function render() {
  if (S.pendingReload && S.view !== 'map') { S.pendingReload = false; persist(); location.reload(); return; }
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.view === (S.view === 'map' ? 'play' : S.view === 'bag' ? 'home' : S.view)));
  document.body.classList.toggle('mapmode', S.view === 'map');
  if (S.view !== 'map' && typeof stopMap === 'function') stopMap();
  if (S.view === 'map') { applyTheme(); return renderMap(); }
  applyTheme();
  const m = $('#main');
  if (S.view === 'home') m.innerHTML = viewHome();
  else if (S.view === 'play') m.innerHTML = activeRound() ? viewHole() : viewNewRound();
  else if (S.view === 'rounds') m.innerHTML = S.courseView ? viewCourse() : S.detailId ? viewRoundDetail() : viewRounds();
  else if (S.view === 'stats') m.innerHTML = viewStats();
  else if (S.view === 'bag') m.innerHTML = viewBag();
  else m.innerHTML = viewSettings();
  if (S.view === 'play' && activeRound()) {
    const cur = $('.hchip.cur'); if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
}
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

const seg = (act, options, current, extra = '') =>
  `<div class="seg" ${extra}>${options.map(([v, label, cls]) =>
    `<button data-act="${act}" data-v="${esc(v)}" class="${String(current) === String(v) ? 'on ' + (cls || '') : ''}">${label}</button>`).join('')}</div>`;

const stepper = (act, value, label, small = false) =>
  `<div class="stepper ${small ? 'small' : ''}">
    <button data-act="${act}" data-v="-1" aria-label="minus">−</button>
    <div class="val"><b>${value ?? '–'}</b>${label ? `<small>${label}</small>` : ''}</div>
    <button data-act="${act}" data-v="1" aria-label="plus">+</button>
  </div>`;

/* ----- new round ----- */
function newDraft() {
  const last = allCourses()[0];
  return draftFrom(last, { date: localDate(), hcp: S.settings.hcp ?? '' });
}
function draftFrom(c, base) {
  return { ...base, course: c ? c.name : '', tees: c ? c.tees || '' : '', count: c ? c.pars.length : 18,
    pars: c ? [...c.pars, ...STD_PARS.slice(c.pars.length)] : [...STD_PARS], si: c && c.si ? [...c.si] : null, len: c && c.len ? [...c.len] : null, center: c && c.center || null, cr: c && c.cr ? c.cr : '', slope: c && c.slope ? c.slope : '' };
}
function viewNewRound() {
  setTitle('New round');
  if (!S.draft) S.draft = newDraft();
  const d = S.draft;
  const inProgress = S.rounds.filter(r => !r.completed);
  const parTotal = sum(d.pars.slice(0, d.count));
  return `
  ${inProgress.length ? `<div class="card"><h2>Rounds in progress</h2>${inProgress.map(r => {
    const hs = playedHoles(r);
    return `<button class="list-item" data-act="resume" data-v="${r.id}"><div><b>${esc(r.course || 'Round')}</b><div class="sub">${fmtDate(r.date)} · thru ${hs.length}</div></div><span class="btn sm primary">Resume</span></button>`;
  }).join('')}</div>` : ''}
  <div class="card stack">
    <div>
      <div class="field-title"><span>Pick a course</span></div>
      <div class="chips">${allCourses().map((c, i) => `<button data-act="pickCourse" data-v="${i}" class="${c.name === d.course ? 'on' : ''}">${esc(c.name)}</button>`).join('')}
        <button data-act="pickCourse" data-v="-1" class="${!d.course ? 'on' : ''}">+ Other course</button></div>
    </div>
    <div>
      <label class="f" for="dCourse">Course</label>
      <input id="dCourse" type="search" data-bind="course" value="${esc(d.course)}" placeholder="Search any South African course" autocomplete="off">
      <div id="roundResults"></div>
      ${d.status ? `<div class="cstatus ${d.status.busy ? 'busy' : d.status.warn ? 'warn' : d.status.ok ? 'ok' : ''}">${d.status.busy ? '<span class="spin"></span>' : ''}${esc(d.status.msg)}${d.status.retry ? ' <button class="chipbtn" data-act="retryCourse">Try again</button>' : ''}</div>` : ''}
    </div>
    <div class="grid2">
      <div><label class="f" for="dDate">Date</label><input id="dDate" type="date" data-bind="date" value="${esc(d.date)}"></div>
      <div><label class="f" for="dTees">Tees</label><input id="dTees" type="text" data-bind="tees" value="${esc(d.tees)}" placeholder="e.g. White"></div>
    </div>
    <div>
      <label class="f" for="dHcp">Your handicap (playing) <span class="muted">— optional, for net score & points</span></label>
      <input id="dHcp" type="number" inputmode="decimal" data-bind="hcp" value="${esc(d.hcp)}" placeholder="e.g. 18">
      ${(() => { const H = typeof handicapIndex === 'function' ? handicapIndex() : {}; const ch = H.index != null ? courseHcp(H.index, Number(d.cr), Number(d.slope), sum(d.pars.slice(0, d.count))) : null;
        return ch != null && String(ch) !== String(d.hcp) ? `<button class="btn sm" style="margin-top:6px" data-act="useCourseHcp" data-v="${ch}">Use my course handicap: ${ch}</button>` : ''; })()}
    </div>
    <div class="grid2">
      <div><label class="f" for="dCr">Course rating</label><input id="dCr" type="number" inputmode="decimal" step="0.1" data-bind="cr" value="${esc(d.cr)}" placeholder="e.g. 71.4"></div>
      <div><label class="f" for="dSlope">Slope</label><input id="dSlope" type="number" inputmode="numeric" data-bind="slope" value="${esc(d.slope)}" placeholder="e.g. 128"></div>
    </div>
    <div class="sub" style="margin-top:-4px">Rating & slope are on the scorecard for your tees. Fill them in to get a handicap index.</div>
    <div>
      <div class="field-title"><span>Holes</span></div>
      ${seg('draftCount', [[18, '18 holes'], [9, '9 holes']], d.count)}
    </div>
    <div>
      <div class="field-title"><span>Par for each hole (tap to change)</span><span>Par ${parTotal}</span></div>
      <div class="pargrid">${d.pars.slice(0, d.count).map((p, i) =>
        `<button data-act="draftPar" data-v="${i}" class="p${p}"><small>${i + 1}</small><b>${p}</b>${d.si ? `<small>SI ${d.si[i]}</small>` : ''}${d.len && d.len[i] ? `<small>${fd(d.len[i])}</small>` : ''}${d.si && shotsGiven(d.hcp, d.si[i]) ? `<small class="dots">${'•'.repeat(shotsGiven(d.hcp, d.si[i]))}</small>` : ''}</button>`).join('')}</div>
      ${d.si ? `<div class="sub" style="margin-top:6px">SI = stroke index (1 = hardest).${d.hcp !== '' ? ' • = a shot you get on that hole.' : ''}</div>` : ''}
    </div>
    <button class="btn primary block" data-act="startRound">Tee off ⛳</button>
  </div>
  <div class="card">
    <details class="help"><summary>How to track a hole</summary>
      <ul>
        <li><b>Score & putts</b> — total strokes (including penalties) and putts on the green.</li>
        <li><b>Tee shot</b> — fairway, missed left or right, or short (par 4s and 5s).</li>
        <li><b>Scoring zone</b> — were you inside ${esc(zoneLabel())} in regulation (par 3: 1 shot, par 4: 2 shots, par 5: 3 shots)? Then how many shots it took to hole out from inside the zone.</li>
        <li><b>Green</b> — GIR is worked out for you. Missed it? Log where you missed and whether you got up and down.</li>
        <li><b>Penalties</b> — out of bounds, water and other drops.</li>
      </ul>
    </details>
  </div>`;
}

/* ----- hole entry ----- */
function viewHole() {
  const r = activeRound();
  if (S.hole >= r.holes.length) S.hole = r.holes.length - 1;
  const h = r.holes[S.hole];
  const hs = playedHoles(r);
  const A = aggregate([r]);
  const tp = A.strokes - A.par;
  setTitle(r.course || 'Round', `<button class="tbtn" data-act="openMap">${S.fromMap ? '‹ Map' : '📍 Map'}</button>`);

  const preview = h.score == null ? { ...h, score: h.par, putts: 2 } : h;
  const x = derive(preview);
  const reg = h.par - 2;

  const hc = hasHcp(r), NT = netTotals(r), given = shotsGiven(r.hcp, h.si);
  const strip = `<div class="strip" style="margin-bottom:10px">
    <div><b>${hs.length ? toPar(tp) : '–'}</b><span>${hs.length ? A.strokes + ' · thru ' + hs.length : 'To par'}</span></div>
    ${hc ? `<div><b>${hs.length ? NT.pts : '–'}</b><span>Points</span></div>` : `<div><b>${A.puttsN ? A.putts : '–'}</b><span>Putts</span></div>`}
    <div><b>${fmtPct(A.sz, A.szN)}</b><span>SZIR</span></div>
    <div><b>${fmtPct(A.d3, A.d3N)}</b><span>Down in 3</span></div>
  </div>`;

  const nav = `<div class="holes">${r.holes.map((hh, i) => {
    const sc = hh.done && hh.score != null ? `<span class="sc ${scoreClass(hh.score - hh.par)}">${hh.score}</span>` : '<b class="muted">·</b>';
    return `<button class="hchip ${i === S.hole ? 'cur' : ''}" data-act="goHole" data-v="${i}"><small>${hh.n}</small>${sc}</button>`;
  }).join('')}</div>`;

  const tee = h.par > 3 ? `
    <div>
      <div class="field-title"><span>Tee shot</span></div>
      ${seg('fw', [['left', '← Left', 'warn'], ['hit', 'Fairway ✓'], ['right', 'Right →', 'warn'], ['short', 'Short', 'warn']], h.fw)}
    </div>` : '';

  const szHint = (h.szir != null && h.inZone != null && h.score != null)
    ? (h.szir && h.score - h.inZone > reg ? `Heads up: that's ${h.score - h.inZone} shots to reach the zone — regulation is ${reg}.` :
       (!h.szir && h.score - h.inZone <= reg && h.score - h.inZone >= 0 ? `That's ${h.score - h.inZone} shots to reach the zone — sounds like a Yes.` : ''))
    : '';

  const zone = `
    <div>
      <div class="field-title"><span>In scoring zone (${esc(zoneLabel())}) in ${reg} shot${reg === 1 ? '' : 's'}?</span></div>
      ${seg('szir', [['true', 'Yes ✓'], ['false', 'No', 'bad']], h.szir)}
    </div>
    <div>
      <div class="field-title"><span>Shots from inside the zone to hole out</span><span>${h.inZone == null ? 'not set' : ''}</span></div>
      ${stepper('inZone', h.inZone, h.inZone == null ? 'tap + / −' : h.inZone <= 3 ? 'Down in 3 ✓' : 'Not down in 3', true)}
      ${szHint ? `<div class="hint">${szHint}</div>` : ''}
    </div>`;

  const green = `
    <div class="badges">
      <span class="badge ${x.gir ? 'yes' : 'no'}">GIR ${x.gir ? '✓' : '✗'}</span>
      ${x.fir != null ? `<span class="badge ${x.fir ? 'yes' : 'no'}">Fairway ${x.fir ? '✓' : '✗'}</span>` : ''}
      ${h.szir != null ? `<span class="badge ${h.szir ? 'yes' : 'no'}">SZIR ${h.szir ? '✓' : '✗'}</span>` : ''}
      ${x.d3 != null ? `<span class="badge ${x.d3 ? 'yes' : 'no'}">Down in 3 ${x.d3 ? '✓' : '✗'}</span>` : ''}
      ${preview.putts >= 3 ? `<span class="badge no">3-putt</span>` : ''}
    </div>
    ${!x.gir ? `
    <div style="margin-top:12px">
      <div class="field-title"><span>Approach missed the green…</span></div>
      ${seg('miss', [['short', 'Short'], ['long', 'Long'], ['left', 'Left'], ['right', 'Right']], h.miss)}
    </div>
    <div style="margin-top:12px">
      <div class="field-title"><span>Up & down (2 shots from just off the green)</span></div>
      ${seg('ud', [['made', 'Made ✓'], ['missed', 'Missed', 'bad'], ['na', 'No chance']], h.ud)}
    </div>` : ''}
    <div style="margin-top:12px">
      <div class="field-title"><span>Greenside bunker</span></div>
      ${seg('sand', [['none', 'None'], ['saved', 'Sand save ✓'], ['missed', 'No save', 'bad']], h.sand || 'none')}
    </div>
    ${preview.putts > 0 ? `
    <div style="margin-top:12px">
      <div class="field-title"><span>First putt distance (m)</span><span class="muted">optional</span></div>
      ${seg('putt1', PUTT_BUCKETS.map((b, i) => [i, b]), h.putt1)}
    </div>` : ''}`;

  const pens = `
    <div class="grid2">
      <div><div class="field-title"><span>Out of bounds</span></div>${stepper('ob', h.ob || 0, '', true)}</div>
      <div><div class="field-title"><span>Water / hazard</span></div>${stepper('water', h.water || 0, '', true)}</div>
    </div>
    <div style="margin-top:10px"><div class="field-title"><span>Other (lost ball, unplayable)</span></div>${stepper('pen', h.pen || 0, '', true)}</div>`;

  const last = S.hole === r.holes.length - 1;
  return `
  ${strip}
  ${nav}
  <div class="card">
    <div class="holehead">
      <div><div class="hn">Hole ${h.n}</div>${historyLine(r, h)}<div class="sub">${h.len ? `${fd(h.len)} ${S.settings.unit} · ` : ''}${h.si ? `SI ${h.si}` : ''}${hc ? ` · ${given ? `you get ${given} shot${given > 1 ? 's' : ''}` : 'no shot'}` : ''}${h.si ? ' · ' : ''}${h.done ? 'Saved' : 'Not saved'}</div></div>
      ${seg('par', [[3, 'Par 3'], [4, 'Par 4'], [5, 'Par 5']], h.par)}
    </div>
    <div class="grid2">
      <div><div class="field-title"><span>Score</span></div>${stepper('score', preview.score, scoreName(preview.score, h.par) + (hc ? ` · ${points(r, preview)} pts` : ''))}</div>
      <div><div class="field-title"><span>Putts</span></div>${stepper('putts', preview.putts, preview.putts === 1 ? 'one-putt' : preview.putts >= 3 ? 'three-putt' : 'putts')}</div>
    </div>
  </div>
  <button class="btn block gpsbtn" data-act="openMap">📍 GPS map, distances & shot tracking${(h.shots || []).length ? ` · ${h.shots.length} shot${h.shots.length > 1 ? 's' : ''} marked` : ''}</button>
  <div class="card stack">${tee || ''}${tee ? '' : '<div class="sub">Par 3 — no fairway to track.</div>'}</div>
  <div class="card stack"><h2>Scoring zone</h2>${zone}</div>
  <div class="card"><h2>Around the green</h2>${green}</div>
  <div class="card"><details class="help"${((courseGeo().notes || {})[h.n]) ? ' open' : ''}><summary>📝 Notes for hole ${h.n} <span class="sub">saved for next time</span></summary>
    <textarea data-bind="holeNote" placeholder="e.g. Aim left of the bunker. Green slopes back to front.">${esc((courseGeo().notes || {})[h.n] || '')}</textarea></details></div>
  <div class="card"><h2>Penalties <span class="sub">already counted in your score</span></h2>${pens}</div>
  <div class="navbar">
    <button class="btn" data-act="prevHole" ${S.hole === 0 ? 'disabled' : ''}>‹ Back</button>
    ${last ? `<button class="btn primary" data-act="finishRound">Save & finish round</button>`
           : `<button class="btn primary" data-act="nextHole">Save · Hole ${h.n + 1} ›</button>`}
  </div>`;
}

/* ----- rounds list ----- */
function roundSummary(r) {
  const A = aggregate([r]);
  return { A, tp: A.strokes - A.par };
}
function viewRounds() {
  setTitle('Rounds');
  const rs = [...S.rounds].sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  if (!rs.length) return `<div class="card empty">
      <svg viewBox="0 0 24 24"><path d="M6 21V3l11 4.5L8 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      <p>No rounds yet.<br>Head to <b>Play</b> to start one.</p></div>`;
  return coursesCard() + `<div class="card">${rs.map(r => {
    const { A, tp } = roundSummary(r);
    return `<button class="list-item" data-act="openRound" data-v="${r.id}">
      <div><b>${esc(r.course || 'Round')}</b> ${!r.completed ? '<span class="pill">In progress</span>' : ''}
        <div class="sub">${fmtDate(r.date)} · ${A.holes}/${r.holes.length} holes${r.tees ? ' · ' + esc(r.tees) : ''}</div>
        <div class="sub">${hasHcp(r) && A.holes ? netTotals(r).pts + ' pts · ' : ''}Putts ${A.putts || '–'} · FIR ${fmtPct(A.fir, A.firN)} · GIR ${fmtPct(A.gir, A.girN)} · SZIR ${fmtPct(A.sz, A.szN)} · D3 ${fmtPct(A.d3, A.d3N)}</div>
      </div>
      <div style="text-align:right"><div class="big">${A.holes ? A.strokes : '–'}</div><div class="sub">${A.holes ? toPar(tp) : ''}</div></div>
    </button>`;
  }).join('')}</div>`;
}

function viewRoundDetail() {
  const r = S.rounds.find(x => x.id === S.detailId);
  if (!r) { S.detailId = null; return viewRounds(); }
  setTitle(r.course || 'Round', `<button class="tbtn" data-act="closeDetail">‹ Rounds</button>`);
  const { A, tp } = roundSummary(r);
  const hc = hasHcp(r), NT = netTotals(r);
  const yes = v => (v == null ? '<span class="muted">–</span>' : v ? '✓' : '<span style="color:var(--bad)">✗</span>');
  const rows = r.holes.map(h => {
    if (!h.done || h.score == null) return `<tr><td>${h.n}</td><td>${h.par}</td><td colspan="${hc ? 8 : 7}" class="muted">—</td></tr>`;
    const x = derive(h);
    return `<tr><td>${h.n}</td><td>${h.par}</td><td><span class="sc ${scoreClass(x.toPar)}">${h.score}</span></td><td>${h.putts ?? '–'}</td>
      <td>${h.par > 3 ? (h.fw === 'hit' ? '✓' : h.fw ? { left: '←', right: '→', short: '↓' }[h.fw] : '–') : ''}</td>
      <td>${yes(x.gir)}</td><td>${yes(h.szir)}</td><td>${yes(x.d3)}</td><td>${x.pens || ''}</td>${hc ? `<td>${points(r, h)}</td>` : ''}</tr>`;
  }).join('');
  return `
  <div class="card">
    <div class="row between"><div><b>${fmtDate(r.date)}</b><div class="sub">${r.tees ? esc(r.tees) + ' tees · ' : ''}${A.holes}/${r.holes.length} holes${hc ? ` · hcp ${r.hcp}` : ''}</div>${hc && A.holes ? `<div style="margin-top:4px"><b>${NT.pts} points</b> · net ${NT.net}</div>` : ''}</div>
    <div style="text-align:right"><div class="big" style="font-size:30px;font-weight:800">${A.strokes || '–'}</div><div class="sub">${A.holes ? toPar(tp) : ''}</div></div></div>
  </div>
  <div class="card scroll-x">
    <table class="tbl"><thead><tr><th>#</th><th>Par</th><th>Score</th><th>Putts</th><th>FW</th><th>GIR</th><th>SZ</th><th>D3</th><th>Pen</th>${hc ? '<th>Pts</th>' : ''}</tr></thead>
    <tbody>${rows}
    <tr class="tot"><td>Tot</td><td>${A.par}</td><td>${A.strokes}</td><td>${A.putts}</td><td>${A.fir}/${A.firN}</td><td>${A.gir}/${A.girN}</td><td>${A.sz}/${A.szN}</td><td>${A.d3}/${A.d3N}</td><td>${A.ob + A.water + A.pen || ''}</td>${hc ? `<td>${NT.pts}</td>` : ''}</tr>
    </tbody></table>
  </div>
  ${statsBody(A, [r], true)}
  <div class="card">
    <label class="f" for="rNotes">Notes</label>
    <textarea id="rNotes" data-bind="notes" data-v="${r.id}" placeholder="Wind, what worked, what to practise…">${esc(r.notes || '')}</textarea>
  </div>
  <div class="grid2" style="margin-bottom:12px">
    <button class="btn" data-act="editRound" data-v="${r.id}">Edit holes</button>
    <button class="btn danger" data-act="deleteRound" data-v="${r.id}">Delete</button>
  </div>`;
}

/* ----- stats ----- */
function rangeRounds() {
  const rs = S.rounds.filter(r => playedHoles(r).length)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  return S.range === 'all' ? rs : rs.slice(0, Number(S.range));
}
function viewStats() {
  setTitle('Stats');
  const rs = rangeRounds();
  const chips = `<div class="chips" style="margin-bottom:12px">${[['5', 'Last 5'], ['10', 'Last 10'], ['20', 'Last 20'], ['all', 'All']].map(([v, l]) =>
    `<button data-act="range" data-v="${v}" class="${S.range === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  if (!rs.length) return chips + `<div class="card empty"><p>Play a round and your stats will show up here.</p></div>`;
  const A = aggregate(rs);
  return chips + handicapCard() + focusCard(A) + statsBody(A, rs, false) + clubCard(rs) + trendCard(rs) + bestsCard(S.rounds);
}

function tile(k, v, note, cls = '') { return `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div>${note ? `<div class="t ${cls}">${note}</div>` : ''}</div>`; }
function vsTarget(actual, target, higherBetter, unit = '') {
  if (actual == null || target == null) return ['', ''];
  const good = higherBetter ? actual >= target : actual <= target;
  return [`${S.settings.target} hcp avg: ${target}${unit}`, good ? 'good' : 'bad'];
}

function statsBody(A, rs, single) {
  const B = benchFor(S.settings.target);
  const p18 = v => A.per18(v);
  const scoreAvg = p18(A.strokes), parAvg = p18(A.par);
  const firP = pct(A.fir, A.firN), girP = pct(A.gir, A.girN), udP = pct(A.ud, A.udN), sandP = pct(A.sand, A.sandN);
  const putts18 = A.puttsN ? (A.putts / A.puttsN) * 18 : null;
  const three18 = A.puttsN ? (A.threePutt / A.puttsN) * 18 : null;
  const one18 = A.puttsN ? (A.onePutt / A.puttsN) * 18 : null;
  const pen18 = p18(A.ob + A.water + A.pen);
  const szP = pct(A.sz, A.szN), d3P = pct(A.d3, A.d3N);
  const t = (...a) => vsTarget(...a);

  const distColors = { eagle: 'var(--eagle)', birdie: 'var(--birdie)', par: 'var(--par)', bogey: 'var(--bogey)', double: 'var(--double)', triple: '#333' };
  const distLabels = { eagle: 'Eagle+', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double', triple: 'Triple+' };
  const distBar = `<div class="bar">${Object.keys(A.dist).filter(k => A.dist[k]).map(k =>
    `<div style="flex:${A.dist[k]};background:${distColors[k]}">${pct(A.dist[k], A.holes) >= 7 ? pct(A.dist[k], A.holes) + '%' : ''}</div>`).join('')}</div>
    <div class="legend">${Object.keys(A.dist).map(k => `<span><i style="background:${distColors[k]}"></i>${distLabels[k]} ${A.dist[k]}</span>`).join('')}</div>`;

  const parAvgs = [3, 4, 5].map(p => A.byPar[p].n ? tile(`Par ${p} average`, fmt1(A.byPar[p].s / A.byPar[p].n), `${toPar(Math.round((A.byPar[p].s / A.byPar[p].n - p) * 100) / 100)} per hole · ${A.byPar[p].n} holes`) : '').join('');

  const fwBar = A.firN ? `<div class="bar">
      <div style="flex:${A.fwL};background:var(--warn)">${A.fwL ? 'L ' + pct(A.fwL, A.firN) + '%' : ''}</div>
      <div style="flex:${A.fir};background:var(--good)">${A.fir ? pct(A.fir, A.firN) + '%' : ''}</div>
      <div style="flex:${A.fwR};background:var(--warn)">${A.fwR ? 'R ' + pct(A.fwR, A.firN) + '%' : ''}</div>
      <div style="flex:${A.fwS};background:var(--par)">${A.fwS ? 'S' : ''}</div></div>
      <div class="legend"><span>Left ${A.fwL}</span><span>Fairway ${A.fir}</span><span>Right ${A.fwR}</span><span>Short ${A.fwS}</span></div>` : '';

  const missRow = A.missN ? `<div class="legend" style="font-size:13px">Missed greens: ${['short', 'long', 'left', 'right'].map(k => `<span><b>${k[0].toUpperCase() + k.slice(1)}</b> ${pct(A.miss[k], A.missN)}%</span>`).join('')}</div>` : '';

  const puttRows = A.p1.some(b => b.n) ? `<h3>Putting by first-putt distance</h3>
    <table class="tbl"><thead><tr><th>Distance (m)</th><th>Putts</th><th>1-putt</th><th>3-putt</th></tr></thead><tbody>
    ${A.p1.map((b, i) => b.n ? `<tr><td>${PUTT_BUCKETS[i]}</td><td>${b.n}</td><td>${fmtPct(b.one, b.n)}</td><td>${fmtPct(b.three, b.n)}</td></tr>` : '').join('')}
    </tbody></table>` : '';

  const scoringConv = A.szN ? `<div class="sub" style="margin-top:8px">
      Par or better when you reached the zone in regulation: <b>${fmtPct(A.szirPar, A.sz)}</b> · when you didn't: <b>${fmtPct(A.noSzirPar, A.noSzirN)}</b></div>` : '';

  return `
  <div class="card">
    <h2>Scoring <span class="sub">${single ? '' : `${A.rounds} round${A.rounds === 1 ? '' : 's'} · ${A.holes} holes`}</span></h2>
    <div class="tiles">
      <div class="tile hero"><div><div class="k">${single ? 'Score' : 'Average score (per 18)'}</div><div class="v">${single ? A.strokes : fmt1(scoreAvg)}</div></div>
        <div style="text-align:right"><div class="k">To par</div><div class="v">${single ? toPar(A.strokes - A.par) : (scoreAvg - parAvg >= 0 ? '+' : '') + fmt1(scoreAvg - parAvg)}</div></div></div>
      ${parAvgs}
    </div>
    <h3>Score mix</h3>${distBar}
  </div>

  <div class="card">
    <h2>Scoring Method</h2>
    <div class="tiles">
      ${tile('Scoring zone in regulation', szP == null ? '–' : szP + '%', `${A.sz}/${A.szN} holes · goal ${S.settings.szGoal}%`, szP == null ? '' : szP >= S.settings.szGoal ? 'good' : 'bad')}
      ${tile('Down in 3 from the zone', d3P == null ? '–' : d3P + '%', `${A.d3}/${A.d3N} holes · goal ${S.settings.d3Goal}%`, d3P == null ? '' : d3P >= S.settings.d3Goal ? 'good' : 'bad')}
      ${tile('Avg shots inside zone', A.d3N ? fmt1(A.inZoneSum / A.d3N) : '–', 'lower is better')}
      ${tile('SZIR + Down in 3', fmtPct(A.szAndD3, A.szAndD3N), 'both on the same hole')}
      ${[3, 4, 5].map(p => A.szByPar[p][1] ? tile(`SZIR par ${p}s`, fmtPct(...A.szByPar[p]), `${A.szByPar[p][0]}/${A.szByPar[p][1]}`) : '').join('')}
    </div>
    ${scoringConv}
  </div>

  <div class="card">
    <h2>Off the tee</h2>
    <div class="tiles">
      ${tile('Fairways hit', firP == null ? '–' : firP + '%', ...t(firP, B.fir, true, '%'))}
      ${tile('Penalties per 18', fmt1(pen18), ...t(pen18 == null ? null : Math.round(pen18 * 10) / 10, B.pen, false))}
      ${tile('Out of bounds', A.ob, single ? '' : fmt1(p18(A.ob)) + ' per 18')}
      ${tile('Water / other', `${A.water} / ${A.pen}`, single ? '' : fmt1(p18(A.water + A.pen)) + ' per 18')}
    </div>
    ${fwBar ? `<h3>Tee shot pattern</h3>${fwBar}` : ''}
  </div>

  <div class="card">
    <h2>Approach & short game</h2>
    <div class="tiles">
      ${tile('Greens in regulation', girP == null ? '–' : girP + '%', ...t(girP, B.gir, true, '%'))}
      ${tile('GIR per 18', fmt1(A.girN ? (A.gir / A.girN) * 18 : null), `${A.gir}/${A.girN} greens`)}
      ${tile('Up & down', udP == null ? '–' : udP + '%', ...(A.udN ? t(udP, B.ud, true, '%') : ['no chances logged', '']))}
      ${tile('Sand saves', sandP == null ? '–' : sandP + '%', ...(A.sandN ? t(sandP, B.sand, true, '%') : ['no bunkers logged', '']))}
    </div>
    ${missRow}
  </div>

  <div class="card">
    <h2>Putting</h2>
    <div class="tiles">
      ${tile(single ? 'Total putts' : 'Putts per 18', single ? A.putts : fmt1(putts18), ...t(putts18 == null ? null : Math.round(putts18 * 10) / 10, B.putts, false))}
      ${tile('Putts per GIR', A.girPuttN ? (A.girPutts / A.girPuttN).toFixed(2) : '–', 'tour ≈ 1.75')}
      ${tile(single ? '1-putts' : '1-putts per 18', single ? A.onePutt : fmt1(one18), '')}
      ${tile(single ? '3-putts' : '3-putts per 18', single ? A.threePutt : fmt1(three18), ...t(three18 == null ? null : Math.round(three18 * 10) / 10, B.three, false))}
    </div>
    ${puttRows}
  </div>`;
}

function focusCard(A) {
  const B = benchFor(S.settings.target);
  const items = [];
  const add = (name, actual, target, higher, enough, tip, unit = '') => {
    if (actual == null || !enough) return;
    const gap = higher ? (target - actual) / target : (actual - target) / Math.max(target, 0.5);
    items.push({ name, actual, target, gap, tip, unit, higher });
  };
  const putts18 = A.puttsN ? (A.putts / A.puttsN) * 18 : null;
  const three18 = A.puttsN ? (A.threePutt / A.puttsN) * 18 : null;
  const pen18 = A.per18(A.ob + A.water + A.pen);
  add('Fairways hit', pct(A.fir, A.firN), B.fir, true, A.firN >= 6, 'Take the club you can keep in play. A hybrid in the fairway beats a driver in the trees.', '%');
  add('Greens in regulation', pct(A.gir, A.girN), B.gir, true, A.girN >= 9, 'Aim for the middle of the green and take one more club. Most amateur misses are short.', '%');
  add('Up & down', pct(A.ud, A.udN), B.ud, true, A.udN >= 5, 'Chip to one landing spot. Get it on the green first, then inside 2 m.', '%');
  add('Sand saves', pct(A.sand, A.sandN), B.sand, true, A.sandN >= 4, 'Get it out first. Splash the sand 3–5 cm behind the ball with an open face.', '%');
  add('Putts per 18', putts18 && Math.round(putts18 * 10) / 10, B.putts, false, A.puttsN >= 9, 'Do lag-putting drills from 8–12 m and try to leave every putt inside a 1 m circle.');
  add('3-putts per 18', three18 && Math.round(three18 * 10) / 10, B.three, false, A.puttsN >= 9, 'Most 3-putts come from bad pace on long putts, not bad aim. Practise speed.');
  add('Penalties per 18', pen18 && Math.round(pen18 * 10) / 10, B.pen, false, A.holes >= 9, 'Each penalty costs about 1–2 shots. Play away from OB and water, even if it means a longer next shot.');
  const sz = pct(A.sz, A.szN), d3 = pct(A.d3, A.d3N);
  add('Scoring zone in regulation', sz, S.settings.szGoal, true, A.szN >= 9, `Plan backwards from the zone. Pick tee and lay-up clubs that leave you inside ${zoneLabel()} in regulation, not the longest club you own.`, '%');
  add('Down in 3', d3, S.settings.d3Goal, true, A.d3N >= 9, `Inside ${zoneLabel()}, aim for the fat part of the green and make an easy two-putt. Don't chase pins.`, '%');

  if (!items.length) return `<div class="card"><h2>Focus areas</h2><div class="sub">Log a few more holes and your biggest leaks will show up here. Comparing against a ${S.settings.target} handicap (change this under More).</div></div>`;
  const worst = items.filter(i => i.gap > 0.05).sort((a, b) => b.gap - a.gap).slice(0, 3);
  const best = items.filter(i => i.gap < -0.1).sort((a, b) => a.gap - b.gap).slice(0, 2);
  return `<div class="card"><h2>Focus areas <span class="sub">vs ${S.settings.target} hcp / your goals</span></h2>
    ${worst.length ? worst.map(i => `<div class="focus"><b>${i.name}: ${i.actual}${i.unit} <span class="muted">(target ${i.target}${i.unit})</span></b><div class="sub">${i.tip}</div></div>`).join('')
      : '<div class="sub" style="margin-bottom:8px">Nothing is well below target. Nice! Try lowering your target handicap.</div>'}
    ${best.map(i => `<div class="focus good"><b>Strength: ${i.name} ${i.actual}${i.unit}</b><div class="sub">Better than the ${i.target}${i.unit} target.</div></div>`).join('')}
  </div>`;
}

const TRENDS = {
  toPar: { label: 'To par', f: A => A.holes ? ((A.strokes - A.par) / A.holes) * 18 : null, fmt: v => (v > 0 ? '+' : '') + Math.round(v) },
  putts: { label: 'Putts', f: A => A.puttsN ? (A.putts / A.puttsN) * 18 : null, fmt: v => Math.round(v) },
  sz: { label: 'SZIR %', f: A => pct(A.sz, A.szN), fmt: v => v + '%' },
  d3: { label: 'Down in 3 %', f: A => pct(A.d3, A.d3N), fmt: v => v + '%' },
  fir: { label: 'FIR %', f: A => pct(A.fir, A.firN), fmt: v => v + '%' },
  gir: { label: 'GIR %', f: A => pct(A.gir, A.girN), fmt: v => v + '%' },
  pen: { label: 'Penalties', f: A => A.per18(A.ob + A.water + A.pen), fmt: v => fmt1(v) },
};
function trendCard(rs) {
  const series = [...rs].reverse().map(r => ({ r, v: TRENDS[S.trend].f(aggregate([r])) })).filter(p => p.v != null);
  const chips = `<div class="chips" style="margin-bottom:10px">${Object.entries(TRENDS).map(([k, t]) =>
    `<button data-act="trend" data-v="${k}" class="${S.trend === k ? 'on' : ''}">${t.label}</button>`).join('')}</div>`;
  if (series.length < 2) return `<div class="card"><h2>Trend</h2>${chips}<div class="sub">You need at least 2 rounds to see a trend.</div></div>`;
  const W = 320, H = 150, pad = { l: 8, r: 8, t: 16, b: 22 };
  const vals = series.map(p => p.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (S.trend === 'toPar') { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const n = series.length, bw = (W - pad.l - pad.r) / n;
  const y = v => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const base = S.trend === 'toPar' ? y(0) : H - pad.b;
  const lower = S.trend === 'toPar' || S.trend === 'putts' || S.trend === 'pen';
  const bars = series.map((p, i) => {
    const x = pad.l + i * bw + bw * 0.15, w = bw * 0.7;
    const top = Math.min(y(p.v), base), h = Math.max(2, Math.abs(base - y(p.v)));
    const d = new Date(p.r.date + 'T12:00:00');
    return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="var(--brand)" opacity="${0.55 + 0.45 * (i + 1) / n}"/>
      ${n <= 12 ? `<text x="${(x + w / 2).toFixed(1)}" y="${(top - 4).toFixed(1)}" text-anchor="middle">${TRENDS[S.trend].fmt(p.v)}</text>
      <text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d.getDate()}/${d.getMonth() + 1}</text>` : ''}`;
  }).join('');
  const half = Math.floor(n / 2);
  const avg = a => sum(a) / a.length;
  const older = avg(vals.slice(0, half)), newer = avg(vals.slice(half));
  const better = lower ? newer < older : newer > older;
  return `<div class="card"><h2>Trend <span class="sub">oldest → newest</span></h2>${chips}
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${TRENDS[S.trend].label} per round">
      <line x1="0" x2="${W}" y1="${base}" y2="${base}" stroke="var(--line)"/>${bars}</svg>
    <div class="sub" style="margin-top:6px">Recent rounds average ${TRENDS[S.trend].fmt(Math.round(newer * 10) / 10)} vs ${TRENDS[S.trend].fmt(Math.round(older * 10) / 10)} before.
      <b style="color:${better ? 'var(--good)' : newer === older ? 'inherit' : 'var(--bad)'}">${newer === older ? 'Steady.' : better ? 'Improving ↗' : 'Slipping ↘'}</b></div>
  </div>`;
}

/* ----- settings ----- */
function viewSettings() {
  setTitle('More');
  const s = S.settings;
  return `
  <div class="card stack">
    <h2>Targets</h2>
    <div>
      <div class="field-title"><span>Compare my stats with a handicap of</span></div>
      ${seg('target', [0, 5, 10, 15, 20, 25, 30].map(v => [v, String(v)]), s.target)}
    </div>
    <div class="grid2">
      <div><label class="f" for="szGoal">SZIR goal %</label><input id="szGoal" type="number" inputmode="numeric" data-bind="szGoal" value="${s.szGoal}"></div>
      <div><label class="f" for="d3Goal">Down in 3 goal %</label><input id="d3Goal" type="number" inputmode="numeric" data-bind="d3Goal" value="${s.d3Goal}"></div>
    </div>
  </div>
  <div class="card stack">
    <h2>Scoring zone</h2>
    <div class="grid2">
      <div><label class="f" for="zone">Zone distance</label><input id="zone" type="number" inputmode="numeric" data-bind="zone" value="${s.zone}"></div>
      <div><div class="field-title"><span>Units</span></div>${seg('unit', [['m', 'Metres'], ['yd', 'Yards']], s.unit)}</div>
    </div>
  </div>
  <div class="card">
    <h2>Appearance</h2>
    ${seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme)}
  </div>
  <button class="btn block" style="margin-bottom:12px" data-act="goBag">🏌️ Golf bag: club distances ›</button>
  <div class="card">
    <h2>Saved courses</h2>
    ${S.courses.length ? S.courses.map((c, i) => `<div class="list-item"><div><b>${esc(c.name)}</b><div class="sub">${c.pars.length} holes · par ${sum(c.pars)}${c.tees ? ' · ' + esc(c.tees) : ''}</div></div>
      <button class="btn sm danger" data-act="delCourse" data-v="${i}">Remove</button></div>`).join('') : '<div class="sub">Courses are saved when you start a round.</div>'}
  </div>
  <div class="card stack">
    <h2>Backup</h2>
    <div class="sub">Your rounds are stored only on this phone, in this browser. Export a backup now and then, especially before you clear browser data or switch phones.</div>
    <div class="grid2">
      <button class="btn" data-act="exportJson">Export backup</button>
      <button class="btn" data-act="importJson">Import backup</button>
    </div>
    <button class="btn block" data-act="exportCsv">Export holes as CSV (spreadsheet)</button>
    <button class="btn block danger" data-act="wipe">Delete all data</button>
  </div>
  <div class="card">
    <details class="help"><summary>About the Scoring Method</summary>
      <p>This app follows the scoring-zone idea taught by PGA coach Will Robins in <i>The Scoring Method</i>. It splits each hole in two:</p>
      <ul>
        <li><b>Enter the scoring zone in regulation (SZIR).</b> Get inside ${esc(zoneLabel())} in par minus 2 shots: 1 shot on a par 3, 2 on a par 4, 3 on a par 5.</li>
        <li><b>Get down in 3.</b> Once you're in the zone, hole out in 3 shots or fewer.</li>
      </ul>
      <p>Do both and you make par or better. The aim is to play smart to the zone with the swing you already have, not to hit it further.</p>
    </details>
    <details class="help"><summary>Install on your phone</summary>
      <p><b>iPhone (Safari):</b> tap Share → <i>Add to Home Screen</i>.<br><b>Android (Chrome):</b> tap ⋮ → <i>Install app</i> / <i>Add to Home screen</i>.<br>After the first load it works offline, even with no signal on the course.</p>
    </details>
    <div class="sub" style="margin-top:8px">Version 1.7</div>
  </div>`;
}

/* ---------- actions ---------- */
function touch(h) { h.done = true; }
function clampHole(h) {
  if (h.score == null) { h.score = h.par; h.putts = 2; }
  h.score = Math.max(1, Math.min(15, h.score));
  h.putts = Math.max(0, Math.min(h.score, h.putts ?? 0));
  if (h.inZone != null) h.inZone = Math.max(0, Math.min(h.score, h.inZone));
  if (derive(h).gir) { h.miss = null; h.ud = null; }
  if (h.putts === 0) h.putt1 = null;
}
function saveRoundCourse(r) {
  const name = (r.course || '').trim(); if (!name) return;
  const pars = r.holes.map(h => h.par);
  const si = r.holes.every(h => h.si) ? r.holes.map(h => h.si) : null;
  const i = S.courses.findIndex(c => c.name.toLowerCase() === name.toLowerCase() && c.pars.length === pars.length);
  const prev = S.courses.find(x => x.name.toLowerCase() === name.toLowerCase()) || {};
  const len = r.holes.some(h => h.len) ? r.holes.map(h => h.len || null) : prev.len || null;
  const c = { name, pars, si, len, center: prev.center || null, tees: r.tees || '', cr: r.cr || null, slope: r.slope || null };
  if (i >= 0) S.courses.splice(i, 1);
  S.courses.unshift(c);
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

const ACTIONS = {
  /* draft */
  pickCourse(v) {
    const c = Number(v) >= 0 ? allCourses()[Number(v)] : null;
    S.draft = draftFrom(c, { date: S.draft.date, hcp: S.draft.hcp });
    if (!c) setTimeout(() => { const i = $('#dCourse'); i && i.focus(); }, 0);
  },
  draftCount(v) { S.draft.count = Number(v); },
  draftPar(v) { const i = Number(v); const p = S.draft.pars[i]; S.draft.pars[i] = p === 5 ? 3 : p + 1; },
  startRound() {
    const d = S.draft;
    const r = { id: uid(), created: Date.now(), date: d.date || localDate(), course: d.course.trim(), tees: d.tees.trim(), notes: '', completed: false,
      holes: d.pars.slice(0, d.count).map((p, i) => newHole(i + 1, p, d.si && d.si[i], d.len && d.len[i])), hcp: d.hcp === '' ? null : Number(d.hcp), cr: Number(d.cr) || null, slope: Number(d.slope) || null };
    S.settings.hcp = d.hcp;
    S.rounds.push(r); S.activeId = r.id; S.hole = 0; S.draft = null; S.view = 'map'; window.scrollTo(0, 0);
    saveRoundCourse(r);
    toast('Round started. Good luck!');
  },
  resume(v) { S.activeId = v; const r = activeRound(); const i = r.holes.findIndex(h => !h.done); S.hole = i < 0 ? 0 : i; S.view = 'map'; },
  exitRound() { S.activeId = null; S.draft = null; S.view = 'home'; toast('Round saved. Resume it any time.'); },

  /* hole */
  goHole(v) { S.hole = Number(v); },
  prevHole() { S.hole = Math.max(0, S.hole - 1); },
  nextHole() { const h = curHole(); clampHole(h); touch(h); S.hole++; if (S.fromMap) S.view = 'map'; window.scrollTo(0, 0); },
  finishRound() {
    const r = activeRound(); const h = curHole(); clampHole(h); touch(h);
    r.completed = true; saveRoundCourse(r); S.activeId = null;
    S.view = 'rounds'; S.detailId = r.id; toast('Round complete!'); window.scrollTo(0, 0);
  },
  par(v) { const h = curHole(); h.par = Number(v); if (!h.done) { h.score = null; h.putts = null; } if (h.par === 3) h.fw = null; },
  score(v) { const h = curHole(); clampHole(h); h.score += Number(v); clampHole(h); touch(h); },
  putts(v) { const h = curHole(); clampHole(h); h.putts += Number(v); clampHole(h); touch(h); },
  fw(v) { const h = curHole(); clampHole(h); h.fw = h.fw === v ? null : v; touch(h); },
  szir(v) { const h = curHole(); clampHole(h); const b = v === 'true'; h.szir = h.szir === b ? null : b;
    if (h.szir != null && h.inZone == null) h.inZone = Math.max(0, Math.min(h.score, h.szir ? h.score - (h.par - 2) : 3));
    touch(h); },
  inZone(v) { const h = curHole(); clampHole(h); h.inZone = h.inZone == null ? Math.min(h.score, 3) : h.inZone + Number(v); clampHole(h); touch(h); },
  miss(v) { const h = curHole(); clampHole(h); h.miss = h.miss === v ? null : v; touch(h); },
  ud(v) { const h = curHole(); clampHole(h); h.ud = h.ud === v ? null : v; touch(h); },
  sand(v) { const h = curHole(); clampHole(h); h.sand = v === 'none' ? null : v; touch(h); },
  putt1(v) { const h = curHole(); clampHole(h); const n = Number(v); h.putt1 = h.putt1 === n ? null : n; touch(h); },
  ob(v) { const h = curHole(); clampHole(h); h.ob = Math.max(0, (h.ob || 0) + Number(v)); touch(h); },
  water(v) { const h = curHole(); clampHole(h); h.water = Math.max(0, (h.water || 0) + Number(v)); touch(h); },
  pen(v) { const h = curHole(); clampHole(h); h.pen = Math.max(0, (h.pen || 0) + Number(v)); touch(h); },

  /* rounds */
  openRound(v) { S.view = 'rounds'; S.courseView = null; S.detailId = v; window.scrollTo(0, 0); },
  closeDetail() { S.detailId = null; },
  editRound(v) { S.activeId = v; const r = activeRound(); r.completed = false; S.hole = 0; S.view = 'play'; S.detailId = null; window.scrollTo(0, 0); },
  deleteRound(v) {
    if (!confirm('Delete this round? This cannot be undone.')) return;
    S.rounds = S.rounds.filter(r => r.id !== v); if (S.activeId === v) S.activeId = null; S.detailId = null; toast('Round deleted');
  },

  /* stats */
  range(v) { S.range = v; },
  trend(v) { S.trend = v; },

  /* settings */
  target(v) { S.settings.target = Number(v); },
  unit(v) { S.settings.unit = v; },
  theme(v) { S.settings.theme = v; },
  delCourse(v) { S.courses.splice(Number(v), 1); },
  exportJson() {
    download(`golf-stats-backup-${localDate()}.json`, JSON.stringify({ app: 'golf-stats', version: 1, exported: new Date().toISOString(), rounds: S.rounds, courses: S.courses, settings: S.settings, geo: S.geo }, null, 1), 'application/json');
  },
  importJson() { $('#importFile').click(); },
  exportCsv() {
    const head = ['date', 'course', 'tees', 'hole', 'par', 'score', 'to_par', 'putts', 'tee_shot', 'fir', 'gir', 'approach_miss', 'up_down', 'sand', 'szir', 'shots_to_zone', 'shots_in_zone', 'down_in_3', 'ob', 'water', 'other_pen', 'first_putt_m'];
    const lines = [head.join(',')];
    for (const r of S.rounds) for (const h of playedHoles(r)) {
      const x = derive(h);
      const row = [r.date, r.course, r.tees, h.n, h.par, h.score, x.toPar, h.putts, h.fw ?? '', x.fir ?? '', x.gir, h.miss ?? '', h.ud ?? '', h.sand ?? '', h.szir ?? '', x.toZone ?? '', h.inZone ?? '', x.d3 ?? '', h.ob, h.water, h.pen, h.putt1 != null ? PUTT_BUCKETS[h.putt1] : ''];
      lines.push(row.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','));
    }
    download(`golf-stats-holes-${localDate()}.csv`, lines.join('\n'), 'text/csv');
  },
  wipe() {
    if (!confirm('Delete ALL rounds, courses and settings from this phone?')) return;
    if (!confirm('Really? Export a backup first if you might want them.')) return;
    S.rounds = []; S.courses = []; S.settings = { ...DEFAULT_SETTINGS }; S.activeId = null; S.draft = null; toast('All data deleted');
  },
};
function curHole() { return activeRound().holes[S.hole]; }

document.addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (tab) {
    S.view = tab.dataset.view;
    if (S.view === 'play') S.fromMap = false;
    if (S.view === 'play' && activeRound()) S.view = 'map';
    if (S.view === 'rounds') { S.detailId = null; S.courseView = null; }
    persist(); render(); window.scrollTo(0, 0); return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  buzz();
  fn(el.dataset.v);
  persist(); render();
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-bind]'); if (!el) return;
  const k = el.dataset.bind;
  if ((k === 'cr' || k === 'slope') && S.draft) { S.draft[k] = el.value; return; }
  if (k === 'homeSearch') { homeResults(el.value); return; }
  if (k === 'holeNote') { const g = courseGeo(); g.notes = g.notes || {}; g.notes[curHole().n] = el.value; saveGeo(); return; }
  if (k === 'bag') { S.settings.bag = S.settings.bag || {}; S.settings.bag[el.dataset.v] = el.value; persist(); return; }
  if (k === 'hcp' && S.draft) { S.draft.hcp = el.value; const pos = el.selectionStart; render(); const i = $('#dHcp'); i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} return; }
  if (['course', 'date', 'tees'].includes(k) && S.draft) {
    if (k === 'course') { S.draft.si = null; S.draft.len = null; S.draft.status = null; }
    S.draft[k] = el.value;
    if (k === 'course') courseSearch(el.value, '#roundResults');
    return;
  }
  if (k === 'notes') { const r = S.rounds.find(r => r.id === el.dataset.v); if (r) { r.notes = el.value; persist(); } return; }
  if (['zone', 'szGoal', 'd3Goal'].includes(k)) {
    const n = Number(el.value); if (el.value !== '' && isFinite(n) && n >= 0) { S.settings[k] = n; persist(); }
  }
});

$('#importFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.rounds)) throw new Error('bad file');
    const ids = new Set(S.rounds.map(r => r.id));
    let added = 0;
    for (const r of data.rounds) if (r && r.id && Array.isArray(r.holes) && !ids.has(r.id)) { S.rounds.push(r); added++; }
    if (data.geo) for (const k in data.geo) if (!S.geo[k]) S.geo[k] = data.geo[k];
    save('gs.geo', S.geo);
    for (const c of data.courses || []) if (c && c.name && !S.courses.some(x => x.name === c.name && x.pars.length === c.pars.length)) S.courses.push(c);
    persist(); render(); toast(`Imported ${added} round${added === 1 ? '' : 's'}`);
  } catch (err) { toast("That doesn't look like a Golf Stats backup"); }
});

/* ---------- boot ---------- */
if (activeRound()) { const r = activeRound(); const i = r.holes.findIndex(h => !h.done); S.hole = i < 0 ? r.holes.length - 1 : i; }
document.addEventListener('DOMContentLoaded', render);
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 30 * 60000);
    }).catch(() => {});
    // When a new version takes over, reload once so the new look/code shows straight away (not mid-map).
    let reloaded = false; const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      if (S.view !== 'map') { reloaded = true; location.reload(); }
      else S.pendingReload = true; // never interrupt the map mid-hole; reload when you next leave it
    });
  });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
