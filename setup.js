'use strict';
/* Course page + round setup.
   Play tab with no course chosen: choose a course (search, nearby, saved).
   With a course: satellite hero photo, weather, key numbers for the chosen tee, Preview / Play,
   a fold-out scorecard, and tap-to-pick rows (tees, round type, date, format, players, handicap) that open
   bottom sheets, so nothing needs typing except a new player's name. */

const PS = { w: {} };

/* Devonvale tee data (men's ratings), per-hole lengths scaled from the yellow card. */
(function devonvaleTees() {
  const c = BUILTIN_COURSES.find(x => /devonvale/i.test(x.name)); if (!c || c.teeSets) return;
  const base = sum(c.len), mk = (name, total, cr, slope) => ({ name, g: 'M', cr, slope, pars: c.pars.slice(), si: c.si.slice(), len: c.len.map(l => Math.round(l * total / base)) });
  c.teeSets = [mk('Yellow', 5611, 72.9, 125), mk('White', 5217, 70.9, 122), mk('Blue', 4995, 69.8, 120), mk('Red', 4566, 67.7, 116)];
  c.teeIdx = 0;
})();

function teeOptions(d) {
  if (d.teeSets && d.teeSets.length) return d.teeSets;
  const b = BUILTIN_COURSES.find(x => sameCourse(x.name, d.course) && x.teeSets);
  if (b) { d.teeSets = b.teeSets; return d.teeSets; }
  return d.cr || d.slope ? [{ name: d.tees || 'Standard', g: 'M', cr: Number(d.cr) || null, slope: Number(d.slope) || null, pars: d.pars.slice(0, d.count), si: d.si, len: d.len }] : [];
}
const teeLen = t => (t.len && t.len.some(Boolean) ? sum(t.len.map(x => x || 0)) : null);
const TEE_COLOURS = { yellow: '#f2c230', white: '#ffffff', blue: '#2d6be0', red: '#d9363e', black: '#16181d', gold: '#c9a227', green: '#2f9e5b', silver: '#c0c4cc' };
const teeDot = n => `<i class="tee-dot" style="background:${TEE_COLOURS[(n || '').toLowerCase().split(' ')[0]] || '#9aa0ab'}"></i>`;

function heroImg(c) {
  if (!c) return '';
  const [lat, lon] = c, dy = 0.0065, dx = 0.0095;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${lon - dx},${lat - dy},${lon + dx},${lat + dy}&bboxSR=4326&imageSR=3857&size=900,560&format=jpg&f=image`;
}
function courseCentre(d) {
  return d.center || (S.geo[(d.course || '').trim().toLowerCase()] || {}).center || (BUILTIN_COURSES.find(x => sameCourse(x.name, d.course)) || {}).center || null;
}
async function loadWeather(name, c) {
  if (!c || PS.w[name]) return;
  PS.w[name] = { busy: true };
  try {
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c[0].toFixed(3)}&longitude=${c[1].toFixed(3)}&current=temperature_2m,wind_speed_10m,weather_code`)).json();
    PS.w[name] = j.current ? { t: Math.round(j.current.temperature_2m), w: Math.round(j.current.wind_speed_10m), code: j.current.weather_code } : null;
  } catch (e) { PS.w[name] = null; }
  if (S.view === 'play' && S.draft && sameCourse(S.draft.course, name)) render();
}
const wxIcon = code => (code == null ? '' : code <= 1 ? '☀️' : code <= 3 ? '⛅' : code <= 48 ? '🌫️' : code <= 67 ? '🌧️' : code <= 77 ? '🌨️' : '⛈️');

/* ---------- views ---------- */
function viewNewRound() {
  const inProgress = S.rounds.filter(r => !r.completed);
  if (!S.draft || !S.draft.course) {
    setTitle('Play');
    if (!S.draft) S.draft = { course: '', date: localDate(), hcp: S.settings.hcp ?? '', count: 18, pars: [...STD_PARS] };
    return `
    ${inProgress.map(r => { const hs = playedHoles(r); return `<button class="h-last live" data-act="resume" data-v="${r.id}" style="margin-bottom:10px"><div><small>In progress · thru ${hs.length}</small><b>${esc(r.course || 'Round')}</b></div><span class="btn sm primary">Resume</span></button>`; }).join('')}
    <div class="h-title" style="margin:6px 2px 10px">Choose a course</div>
    <label class="h-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input type="search" data-bind="homeSearch" placeholder="Find any course in South Africa" autocomplete="off"></label>
    <div id="homeResults" style="margin-top:8px"></div>
    <div id="nearby" style="margin:12px 0"></div>
    ${allCourses().length ? `<div class="nb-card"><div class="nb-h">My courses</div>${allCourses().slice(0, 8).map((c, i) => `<button class="nb-row" data-act="quickStart" data-v="${i}"><span class="hr-n"><b>${esc(c.name)}</b><small>${c.pars.length} holes · par ${sum(c.pars)}</small></span><span>›</span></button>`).join('')}</div>` : ''}`;
  }
  const d = S.draft, tees = teeOptions(d), T = tees[d.teeIdx ?? -1] || null;
  const centre = courseCentre(d); loadWeather(d.course, centre);
  const W = PS.w[d.course], img = heroImg(centre);
  const B = BUILTIN_COURSES.find(x => sameCourse(x.name, d.course)) || {};
  const town = B.area || (d.status && d.status.town) || '';
  const n = d.count, parT = sum(d.pars.slice(0, n)), lenT = T ? teeLen(T) : (d.len ? sum(d.len.slice(0, n).map(x => x || 0)) : null);
  const su = setup(), fr = S.settings.friends || [], players = su.players.map(id => fr.find(f => f.id === id)).filter(Boolean);
  const half = d.half || 'all', fmt = FORMATS.find(f => f[0] === su.format) || FORMATS[0];
  const card = (a, b, label) => `<tr class="pv-sub"><td>${label}</td>${d.pars.slice(a, b).map((_, k) => `<td>${a + k + 1}</td>`).join('')}<td></td></tr>
    <tr><td>Par</td>${d.pars.slice(a, b).map(p => `<td>${p}</td>`).join('')}<td><b>${sum(d.pars.slice(a, b))}</b></td></tr>
    ${d.si ? `<tr><td>SI</td>${d.si.slice(a, b).map(p => `<td>${p || ''}</td>`).join('')}<td></td></tr>` : ''}
    ${d.len && d.len.some(Boolean) ? `<tr><td>${S.settings.unit}</td>${d.len.slice(a, b).map(l => `<td>${l ? fd(l) : ''}</td>`).join('')}<td>${fd(sum(d.len.slice(a, b).map(x => x || 0)))}</td></tr>` : ''}`;
  const hcpTxt = d.hcp === '' || d.hcp == null ? 'Set' : (Number(d.hcp) < 0 ? '+' + Math.abs(d.hcp) : d.hcp);
  setTitle('Round setup', `<button class="tbtn" data-act="draftClear">‹ Courses</button>`);
  return `
  <div class="cp-hero">${img ? `<img src="${img}" alt="" loading="eager" onerror="this.remove()">` : ''}<div class="cp-shade"></div>
    <div class="cp-name"><b>${esc(d.course)}</b>${town ? `<span>${esc(town)}</span>` : ''}</div>
    ${W && !W.busy ? `<div class="cp-wx"><span>${wxIcon(W.code)}</span><small>${W.w} km/h<br>${W.t}°C</small></div>` : ''}
  </div>
  ${d.status && (d.status.busy || d.status.warn) ? `<div class="cstatus ${d.status.busy ? 'busy' : 'warn'}" style="margin-bottom:10px">${d.status.busy ? '<span class="spin"></span>' : ''}${esc(d.status.msg)}${d.status.retry ? ' <button class="chipbtn" data-act="retryCourse">Try again</button>' : ''}</div>` : ''}
  <div class="cp-stats"><div><b>${n}</b><span>Holes</span></div><div><b>${parT}</b><span>Par</span></div><div><b>${lenT ? fd(lenT) : '–'}<small>${lenT ? S.settings.unit : ''}</small></b><span>Length</span></div><div><b>${T && T.cr ? `${T.cr}<small>/${T.slope}</small>` : '–'}</b><span>Rating/Slope</span></div></div>
  <div class="cp-btns"><button class="btn cp-prev" data-act="cpPreview">Course preview</button><button class="btn primary" data-act="startRound">Play</button></div>
  <div class="card cp-card"><details class="help"><summary><b>Course scorecard</b> <span class="sub">${T ? esc(T.name) + ' tees' : 'tap to view'}</span></summary>
    <div class="scroll-x" style="margin-top:8px"><table class="tbl pv-card">${card(0, Math.min(9, n), 'Out')}${n > 9 ? card(9, n, 'In') : ''}</table></div>
    <button class="btn sm" style="margin-top:8px" data-act="psheet" data-v="pars">Edit pars</button></details></div>

  <div class="setup">
    <button class="su-row" data-act="psheet" data-v="tee"><span>Tee box</span><em class="${T ? '' : 'need'}">${T ? `${teeDot(T.name)}${esc(T.name)}${T.g === 'L' ? ' (L)' : ''}` : tees.length ? 'Select' : 'No tee data'}</em><i>›</i></button>
    <div class="su-row static"><span>Round</span>${seg('suHalf', [['all', d.count === 9 ? '9 holes' : '18 holes'], ...(d.pars.length >= 18 && d.count === 18 ? [['front', 'Front 9'], ['back', 'Back 9']] : [])], half)}</div>
    <label class="su-row"><span>Date</span><input type="date" data-bind="date" value="${esc(d.date)}"></label>
    <button class="su-row" data-act="psheet" data-v="format"><span>Game format</span><em>${esc(fmt[1])}</em><i>›</i></button>
  </div>
  <div class="h-title" style="margin:16px 2px 4px">Your scorecard</div><div class="sub" style="margin:0 2px 8px">Add up to 5 players. Scores stay on this phone.</div>
  <div class="pl-row"><button class="pl-main" data-act="psheet" data-v="tee"><b>${esc(myName())}</b><small>${T ? `${teeDot(T.name)}${esc(T.name)} ${lenT ? fd(lenT) + S.settings.unit : ''}${T.cr ? ` (${T.cr}/${T.slope})` : ''}` : 'Select tee'}</small></button>
    <button class="pl-hcp" data-act="psheet" data-v="hcp"><b>${hcpTxt}</b><small>Hcp</small></button></div>
  ${players.map(p => `<div class="pl-row"><div class="pl-main"><b>${esc(p.name)}</b><small>${T ? esc(T.name) + ' tees' : ''}</small></div>
    <button class="pl-hcp" data-act="psheet" data-v="ph:${p.id}"><b>${p.hcp === '' || p.hcp == null ? 'Set' : p.hcp}</b><small>Hcp</small></button><button class="pl-x" data-act="togglePlayerId" data-v="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></div>`).join('')}
  ${players.length < 5 ? '<button class="btn block pl-add" data-act="psheet" data-v="players">＋ Add player</button>' : ''}
  <div class="card" style="margin-top:12px"><details class="help"><summary><b>Other settings</b> <span class="sub">handicap counting, scoring zone</span></summary>
    <div class="row between" style="margin-top:10px"><span><b>Count for handicap</b><div class="sub">Turn off for practice or scrambles.</div></span>${toggle('suHcp', !d.noHcp)}</div>
    <div class="sub" style="margin-top:10px">Scoring zone: ${esc(zoneLabel())} (change in Settings).</div></details></div>
  <button class="btn primary block su-start" data-act="startRound">Start round</button>`;
}

/* ---------- bottom sheets on normal pages ---------- */
function stepper2(act, v, label) { return `<div class="hs-step"><button data-act="${act}" data-v="-1">−</button><div><b>${v}</b><small>${label}</small></div><button data-act="${act}" data-v="1">+</button></div>`; }
function pageSheetHtml() {
  const d = S.draft, k = S.psheet || ''; if (!k || !d) return '';
  const head = t => `<div class="sheet-h"><b>${t}</b><button class="mt-x dark" data-act="psheet" data-v="">✕</button></div>`;
  if (k === 'tee') {
    const tees = teeOptions(d), g = S.teeG || (tees.some(t => t.g === 'M') ? 'M' : 'L');
    const list = tees.map((t, i) => ({ t, i })).filter(x => x.t.g === g || !tees.some(t => t.g === 'L'));
    return head('Select a tee') + (tees.some(t => t.g === 'L') ? `<div class="seg ins-tabs" style="margin-bottom:8px"><button data-act="teeG" data-v="M" class="${g === 'M' ? 'on' : ''}">Men</button><button data-act="teeG" data-v="L" class="${g === 'L' ? 'on' : ''}">Women</button></div>` : '')
      + (list.length ? list.map(({ t, i }) => `<button class="su-opt" data-act="pickTee2" data-v="${i}">${teeDot(t.name)}<span><b>${esc(t.name)}</b> ${teeLen(t) ? fd(teeLen(t)) + ' ' + S.settings.unit : ''}${t.cr ? ` <small>(${t.cr}/${t.slope})</small>` : ''}</span><i class="radio ${d.teeIdx === i ? 'on' : ''}"></i></button>`).join('')
        : '<div class="sub">No tee data for this course yet. Add one below with the rating and slope from the scorecard.</div>')
      + `<button class="btn block sm" style="margin-top:10px" data-act="psheet" data-v="addtee">＋ Add a tee</button>`;
  }
  if (k === 'addtee') {
    const t = S.newTee = S.newTee || { name: 'White', cr: 70.0, slope: 120 };
    return head('Add a tee') + `<div class="chips" style="margin-bottom:10px">${['Black', 'Blue', 'White', 'Yellow', 'Red', 'Green', 'Gold'].map(c => `<button data-act="ntName" data-v="${c}" class="${t.name === c ? 'on' : ''}">${teeDot(c)}${c}</button>`).join('')}</div>
      <div class="grid2">${stepper2('ntCr', t.cr.toFixed(1), 'Course rating')}${stepper2('ntSlope', t.slope, 'Slope')}</div>
      <div class="sub" style="margin-top:6px">Both are printed on the club's scorecard for each tee.</div>
      <button class="btn primary block" style="margin-top:12px" data-act="ntSave">Save tee</button>`;
  }
  if (k === 'hcp' || k.startsWith('ph:')) {
    const fid = k.startsWith('ph:') ? k.slice(3) : null, f = fid && (S.settings.friends || []).find(x => x.id === fid);
    const v = fid ? (f && f.hcp !== '' && f.hcp != null ? Number(f.hcp) : 18) : (d.hcp === '' || d.hcp == null ? 18 : Number(d.hcp));
    const H = !fid && typeof handicapIndex === 'function' ? handicapIndex() : {}, T = teeOptions(d)[d.teeIdx ?? -1];
    const ch = H.index != null && T && T.cr ? courseHcp(H.index, T.cr, T.slope, sum(d.pars.slice(0, d.count))) : null;
    return head(fid ? `${esc(f.name)}'s handicap` : 'Your playing handicap') + stepper2(fid ? 'phStep' : 'hcpStep', v < 0 ? '+' + Math.abs(v) : v, 'strokes')
      + `<div class="chips" style="margin-top:10px;justify-content:center">${[0, 5, 10, 15, 18, 20, 24, 28, 36].map(x => `<button data-act="${fid ? 'phSet' : 'hcpSet'}" data-v="${x}">${x}</button>`).join('')}</div>
      ${ch != null ? `<button class="btn block" style="margin-top:10px" data-act="hcpSet" data-v="${ch}">Use my course handicap: ${ch}</button>` : ''}
      ${fid ? '' : '<button class="btn block sm" style="margin-top:8px" data-act="hcpSet" data-v="">No handicap (gross only)</button>'}
      <button class="btn primary block" style="margin-top:10px" data-act="psheet" data-v="">Done</button>`;
  }
  if (k === 'format') {
    const su = setup();
    return head('Game format') + `<div class="sub" style="margin-bottom:6px">Some formats need 2 or more players.</div>` + FORMATS.map(([f, l, desc]) => {
      const off = (f === 'match' || f === 'skins') && !su.players.length;
      return `<button class="su-opt ${off ? 'off' : ''}" data-act="${off ? 'psheet' : 'setFormat2'}" data-v="${off ? 'players' : f}"><span><b>${l}</b><small>${desc}${off ? ' · add a player first' : ''}</small></span><i class="radio ${su.format === f ? 'on' : ''}"></i></button>`;
    }).join('');
  }
  if (k === 'players') {
    const su = setup(), fr = S.settings.friends || [], np = S.newP = S.newP || { hcp: 18 };
    return head('Add player') + `<div class="sub" style="margin-bottom:6px">Up to 5 extra players.</div>`
      + fr.map((f, i) => `<button class="su-opt" data-act="togglePlayer" data-v="${i}"><span><b>${esc(f.name)}</b><small>${f.hcp !== '' && f.hcp != null ? 'Hcp ' + f.hcp : 'no handicap'}</small></span><i class="radio sq ${su.players.includes(f.id) ? 'on' : ''}"></i></button>`).join('')
      + `<div class="np2"><input id="np2Name" type="text" placeholder="New player name" autocomplete="off" value="${esc(np.name || '')}">${stepper2('npStep', np.hcp, 'Hcp')}</div>
      <button class="btn primary block" style="margin-top:8px" data-act="npAdd">＋ New player</button>
      <button class="btn block" style="margin-top:8px" data-act="psheet" data-v="">Done</button>`;
  }
  if (k === 'pars') {
    return head('Edit pars') + `<div class="sub" style="margin-bottom:8px">Tap a hole to change its par (3 → 4 → 5).</div><div class="pargrid">${d.pars.slice(0, d.count).map((p, i) =>
      `<button data-act="draftPar" data-v="${i}" class="p${p}"><small>${i + 1}</small><b>${p}</b>${d.si ? `<small>SI ${d.si[i]}</small>` : ''}</button>`).join('')}</div>
      <div class="grid2" style="margin-top:10px">${seg('draftCount', [[18, '18 holes'], [9, '9 holes']], d.count)}</div>
      <button class="btn primary block" style="margin-top:10px" data-act="psheet" data-v="">Done</button>`;
  }
  return '';
}
function paintPageSheet() {
  let el = document.getElementById('pageSheet');
  if (!el) { el = document.createElement('div'); el.id = 'pageSheet'; document.body.appendChild(el); }
  const html = S.view === 'play' ? pageSheetHtml() : '';
  el.className = html ? 'open' : '';
  el.innerHTML = html ? `<div class="sheet-bg" data-act="psheet" data-v=""></div><div class="sheet ${PS.shown === S.psheet ? 'noanim' : ''}">${html}</div>` : '';
  PS.shown = html ? S.psheet : null;
  document.body.classList.toggle('sheet-open', !!html);
}
const _renderBase = render;
render = function () { _renderBase(); paintPageSheet(); };

/* ---------- actions ---------- */
const clampH = v => Math.max(-8, Math.min(54, v));
Object.assign(ACTIONS, {
  psheet(v) { S.psheet = v || null; if (v === 'addtee') S.newTee = null; },
  draftClear() { S.draft = null; S.psheet = null; },
  cpPreview() { const d = S.draft; if (!S.courses.some(c => sameCourse(c.name, d.course)) && !BUILTIN_COURSES.some(c => sameCourse(c.name, d.course))) rememberCourse(d); ACTIONS.pvOpen(d.course); },
  teeG(v) { S.teeG = v; },
  pickTee2(v) { const d = S.draft, t = teeOptions(d)[Number(v)]; d.teeSets = teeOptions(d); d.teeIdx = Number(v); applyTee(d, t); rememberCourse(d); S.psheet = null; },
  ntName(v) { S.newTee.name = v; },
  ntCr(v) { S.newTee.cr = Math.round((S.newTee.cr + Number(v) * 0.1) * 10) / 10; },
  ntSlope(v) { S.newTee.slope = Math.max(55, Math.min(155, S.newTee.slope + Number(v))); },
  ntSave() {
    const d = S.draft, t = S.newTee, sets = teeOptions(d).filter(x => x.name !== 'Standard' || x.cr);
    sets.push({ name: t.name, g: 'M', cr: t.cr, slope: t.slope, pars: d.pars.slice(0, d.count), si: d.si, len: d.len });
    d.teeSets = sets; d.teeIdx = sets.length - 1; applyTee(d, sets[d.teeIdx]); rememberCourse(d); S.psheet = 'tee';
  },
  hcpStep(v) { const d = S.draft; const cur = d.hcp === '' || d.hcp == null ? 18 : Number(d.hcp); d.hcp = clampH(cur + Number(v)); S.settings.hcp = d.hcp; },
  hcpSet(v) { const d = S.draft; d.hcp = v === '' ? '' : clampH(Number(v)); S.settings.hcp = d.hcp; if (v === '' || S.psheet !== 'hcp') S.psheet = null; },
  phStep(v) { const f = (S.settings.friends || []).find(x => x.id === S.psheet.slice(3)); if (f) f.hcp = clampH((f.hcp === '' || f.hcp == null ? 18 : Number(f.hcp)) + Number(v)); },
  phSet(v) { const f = (S.settings.friends || []).find(x => x.id === S.psheet.slice(3)); if (f) f.hcp = Number(v); },
  setFormat2(v) { setup().format = v; S.psheet = null; },
  npStep(v) { S.newP = S.newP || { hcp: 18 }; const i = $('#np2Name'); if (i) S.newP.name = i.value; S.newP.hcp = clampH(S.newP.hcp + Number(v)); },
  npAdd() {
    const name = (($('#np2Name') || {}).value || '').trim(); if (!name) { toast('Type a name first'); return; }
    S.settings.friends = S.settings.friends || [];
    const f = { id: 'p' + uid(), name, hcp: (S.newP || {}).hcp ?? 18 }; S.settings.friends.push(f);
    const su = setup(); if (su.players.length < 5) su.players.push(f.id);
    S.newP = { hcp: 18 }; toast(`${name} added`);
  },
  togglePlayerId(v) { const su = setup(); su.players = su.players.filter(id => id !== v); if (!su.players.length && (su.format === 'match' || su.format === 'skins')) su.format = 'stroke'; },
  suHalf(v) { S.draft.half = v; },
  suHcp() { S.draft.noHcp = !S.draft.noHcp; },
  startRound() {
    const d = S.draft; if (!d || !d.course) return;
    const half = d.half || 'all', off = half === 'back' ? 9 : 0, n = half === 'all' ? d.count : 9;
    const r = { id: uid(), created: Date.now(), date: d.date || localDate(), course: d.course.trim(), tees: (d.tees || '').trim(), notes: '', completed: false,
      holes: d.pars.slice(off, off + n).map((p, i) => newHole(off + i + 1, p, d.si && d.si[off + i], d.len && d.len[off + i])),
      hcp: d.hcp === '' || d.hcp == null ? null : Number(d.hcp), cr: Number(d.cr) || null, slope: Number(d.slope) || null, noHcp: !!d.noHcp };
    if (half !== 'all') { r.cr = null; r.slope = null; }
    S.settings.hcp = d.hcp;
    { const su = setup(), fr = S.settings.friends || []; r.players = su.players.map(id => fr.find(f => f.id === id)).filter(Boolean).map(f => ({ id: f.id, name: f.name, hcp: f.hcp === '' ? null : f.hcp })); r.format = su.format || 'stroke'; }
    S.rounds.push(r); S.activeId = r.id; S.hole = 0; S.draft = null; S.psheet = null; S.view = 'map'; window.scrollTo(0, 0);
    saveRoundCourse(r);
    toast('Round started. Good luck!');
  },
});
