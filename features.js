'use strict';
/* Handicap index estimate, course history (hole averages + best-ever card), personal bests, hole notes. */

/* ---------- handicap (World Handicap System style estimate) ---------- */
function roundDiff(r) {
  if (!r.cr || !r.slope || r.holes.length !== 18) return null;
  const hs = playedHoles(r); if (hs.length !== 18) return null;
  // Adjusted gross score: each hole capped at net double bogey (par + 2 + shots received; par + 5 with no handicap yet).
  const ags = sum(hs.map(h => Math.min(h.score, h.par + 2 + (hasHcp(r) ? shotsGiven(r.hcp, h.si) : 3))));
  return Math.round((113 / r.slope) * (ags - r.cr) * 10) / 10;
}
const WHS_TABLE = { 3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0], 8: [2, 0], 9: [3, 0], 10: [3, 0], 11: [3, 0], 12: [4, 0], 13: [4, 0], 14: [4, 0], 15: [5, 0], 16: [5, 0], 17: [6, 0], 18: [6, 0], 19: [7, 0], 20: [8, 0] };
function handicapIndex() {
  const rs = S.rounds.filter(r => r.completed).map(r => ({ r, d: roundDiff(r) })).filter(x => x.d != null)
    .sort((a, b) => (b.r.date || '').localeCompare(a.r.date || '') || b.r.created - a.r.created).slice(0, 20);
  const n = rs.length;
  if (n < 3) return { n, index: null };
  const [k, adj] = WHS_TABLE[n];
  const best = rs.map(x => x.d).sort((a, b) => a - b).slice(0, k);
  return { n, k, index: Math.min(54, Math.round((sum(best) / k + adj) * 10) / 10) };
}
function courseHcp(index, cr, slope, par) {
  if (index == null || !cr || !slope) return null;
  return Math.round(index * (slope / 113) + (cr - par));
}
function handicapCard() {
  const H = handicapIndex();
  if (H.index == null) return `<div class="card"><h2>Handicap index</h2><div class="sub">Finish ${3 - H.n} more 18-hole round${3 - H.n === 1 ? '' : 's'} with the <b>course rating</b> and <b>slope</b> filled in (they're on the scorecard) and your handicap index is worked out here.</div></div>`;
  return `<div class="card"><div class="tile hero" style="background:none;padding:0"><div><div class="k">Handicap index (estimate)</div><div class="v" style="font-size:34px">${H.index.toFixed(1)}</div></div>
    <div class="sub" style="text-align:right">best ${H.k} of your last ${H.n}<br>World Handicap System method</div></div>
    <div class="sub" style="margin-top:6px">Unofficial. For an official handicap, post your scores with your club or union.</div></div>`;
}

/* ---------- course history ---------- */
const sameCourse = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
function courseRounds(name) { return S.rounds.filter(r => sameCourse(r.course, name)); }
function holeHistory(name, n, excludeId) {
  const out = [];
  for (const r of courseRounds(name)) if (r.id !== excludeId) {
    const h = r.holes.find(x => x.n === n); if (h && h.done && h.score != null) out.push(h.score);
  }
  return out;
}
function historyLine(r, h) {
  const sc = holeHistory(r.course, h.n, r.id);
  if (!sc.length) return '';
  const avg = sum(sc) / sc.length;
  return `<div class="sub">Your history here: avg <b>${avg.toFixed(1)}</b> (${toPar(Math.round((avg - h.par) * 10) / 10)}) · best <b>${Math.min(...sc)}</b> · played ${sc.length}×</div>`;
}
function coursesPlayed() {
  const m = new Map();
  for (const r of S.rounds) if (r.course && playedHoles(r).length) { const k = r.course.trim().toLowerCase(); if (!m.has(k)) m.set(k, { name: r.course.trim(), n: 0 }); m.get(k).n++; }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
function coursesCard() {
  const cs = coursesPlayed(); if (!cs.length) return '';
  return `<div class="card"><h2>Courses</h2><div class="chips">${cs.map(c => `<button data-act="openCourse" data-v="${esc(c.name)}">${esc(c.name)} · ${c.n}</button>`).join('')}</div></div>`;
}
function viewCourse() {
  const name = S.courseView;
  setTitle(name, `<button class="tbtn" data-act="closeCourse">‹ Rounds</button>`);
  const rs = courseRounds(name);
  const maxHoles = Math.max(...rs.map(r => r.holes.length));
  const rows = [];
  let ecl = 0, eclPar = 0, eclN = 0;
  for (let n = 1; n <= maxHoles; n++) {
    const sc = [], pars = [];
    for (const r of rs) { const h = r.holes.find(x => x.n === n); if (h && h.done && h.score != null) { sc.push(h.score); pars.push(h.par); } }
    if (!sc.length) { rows.push({ n, none: true }); continue; }
    const par = pars[pars.length - 1], avg = sum(sc) / sc.length, best = Math.min(...sc);
    ecl += best; eclPar += par; eclN++;
    rows.push({ n, par, avg, best, played: sc.length, diff: avg - par });
  }
  const played = rows.filter(r => !r.none);
  const hardest = [...played].sort((a, b) => b.diff - a.diff).slice(0, 3);
  const full = rs.filter(r => playedHoles(r).length === r.holes.length);
  const avgRound = full.length ? sum(full.map(r => sum(playedHoles(r).map(h => h.score)))) / full.length : null;
  const bestRound = full.length ? Math.min(...full.map(r => sum(playedHoles(r).map(h => h.score)))) : null;
  return `
  <div class="card"><div class="tiles">
    ${tile('Rounds here', rs.length, '')}
    ${tile('Average round', avgRound ? fmt1(avgRound) : '–', full.length ? `best ${bestRound}` : '')}
    ${tile('Best-ever card', eclN ? ecl : '–', eclN ? `${toPar(ecl - eclPar)} · your best score on every hole` : '')}
    ${tile('Hardest for you', hardest[0] ? 'Hole ' + hardest[0].n : '–', hardest[0] ? `avg ${toPar(Math.round(hardest[0].diff * 10) / 10)} over par` : '')}
  </div></div>
  <div class="card scroll-x"><h2>Hole by hole</h2>
    <table class="tbl"><thead><tr><th>Hole</th><th>Par</th><th>Avg</th><th>+/-</th><th>Best</th><th>Played</th></tr></thead><tbody>
    ${rows.map(r => r.none ? `<tr><td>${r.n}</td><td colspan="5" class="muted">—</td></tr>` :
      `<tr><td>${r.n}</td><td>${r.par}</td><td><b>${r.avg.toFixed(1)}</b></td><td style="color:${r.diff > 1 ? 'var(--bad)' : r.diff <= 0.2 ? 'var(--good)' : 'inherit'}">${toPar(Math.round(r.diff * 10) / 10)}</td><td><span class="sc ${scoreClass(r.best - r.par)}">${r.best}</span></td><td>${r.played}</td></tr>`).join('')}
    </tbody></table>
    ${hardest.length ? `<div class="sub" style="margin-top:8px">Your toughest holes here: ${hardest.map(h => `<b>${h.n}</b>`).join(', ')}. Plan a safer strategy on them.</div>` : ''}
  </div>`;
}

/* ---------- personal bests ---------- */
function bestsCard(rounds) {
  const full = rounds.filter(r => r.holes.length === 18 && playedHoles(r).length === 18);
  const items = [];
  const best = (label, arr, f, fmt, lower) => {
    const vals = arr.map(r => ({ r, v: f(r) })).filter(x => x.v != null && isFinite(x.v));
    if (!vals.length) return;
    const b = vals.sort((a, c) => (lower ? a.v - c.v : c.v - a.v))[0];
    items.push(`<div class="list-item" style="cursor:default"><div><b>${label}</b><div class="sub">${esc(b.r.course || '')} · ${fmtDate(b.r.date)}</div></div><div class="big" style="font-size:20px">${fmt(b.v)}</div></div>`);
  };
  best('Lowest score', full, r => sum(playedHoles(r).map(h => h.score)), v => v, true);
  best('Most points', full.filter(hasHcp), r => netTotals(r).pts, v => v + ' pts');
  best('Most birdies or better', full, r => playedHoles(r).filter(h => h.score < h.par).length || null, v => v);
  best('Fewest putts', full, r => { const hs = playedHoles(r); return hs.every(h => h.putts != null) ? sum(hs.map(h => h.putts)) : null; }, v => v, true);
  best('Best Scoring Zone round', full, r => { const A = aggregate([r]); return A.szN >= 12 ? pct(A.sz, A.szN) : null; }, v => v + '%');
  best('Most fairways', full, r => { const A = aggregate([r]); return A.firN >= 8 ? pct(A.fir, A.firN) : null; }, v => v + '%');
  // longest drive from tracked shots
  let ld = null;
  for (const r of rounds) for (const h of r.holes) (h.shots || []).forEach((s, i) => {
    if (s.club !== 'Dr') return; const d = shotDist(h, i); if (d != null && d < 400 && (!ld || d > ld.d)) ld = { d, r };
  });
  if (ld) items.push(`<div class="list-item" style="cursor:default"><div><b>Longest drive</b><div class="sub">${esc(ld.r.course || '')} · ${fmtDate(ld.r.date)}</div></div><div class="big" style="font-size:20px">${fd(ld.d)} ${S.settings.unit}</div></div>`);
  if (!items.length) return '';
  return `<div class="card"><h2>Personal bests</h2>${items.join('')}</div>`;
}

/* ---------- bag (typed-in club distances, used until enough shots are tracked) ---------- */
function bagCard() {
  const bag = S.settings.bag || {};
  return `<div class="card"><h2>My usual club distances <span class="sub">${S.settings.unit}</span></h2>
    <div class="sub" style="margin-bottom:8px">Used for club suggestions on the map until the app has 3+ tracked shots with that club.</div>
    <div class="baggrid">${CLUBS.filter(c => c[0] !== 'Pt').map(([k, n]) =>
      `<label><span>${esc(n)}</span><input type="number" inputmode="numeric" data-bind="bag" data-v="${k}" value="${esc(bag[k] ?? '')}" placeholder="–"></label>`).join('')}</div></div>`;
}

Object.assign(ACTIONS, {
  openCourse(v) { S.courseView = v; S.detailId = null; window.scrollTo(0, 0); },
  closeCourse() { S.courseView = null; },
  useCourseHcp(v) { S.draft.hcp = v; },
});

/* ---------- home ---------- */
function viewHome() {
  setTitle('Golf Stats', '');
  const inprog = activeRound() || S.rounds.find(x => !x.completed);
  const full = S.rounds.filter(x => x.completed && playedHoles(x).length === x.holes.length && x.holes.length === 18)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  const last = S.rounds.filter(x => x.completed && playedHoles(x).length).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created)[0];
  const scores = full.map(r => sum(playedHoles(r).map(h => h.score)));
  const H = handicapIndex();
  const lastScore = last ? sum(playedHoles(last).map(h => h.score)) : null;
  const shortDate = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return iso; } };
  const A = aggregate(full.slice(0, 10));

  return `<div class="home">
    <label class="h-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input type="search" data-bind="homeSearch" placeholder="Find a course to play" autocomplete="off"></label>
    <div id="homeResults"></div>

    <div class="h-title">Handicap</div>
    <div class="h-hcp" data-act="goStats"><svg class="h-golfer" viewBox="0 0 40 60" aria-hidden="true"><circle cx="24" cy="8" r="5"/><path d="M22 15l-6 14 4 2-3 26h5l4-20 5 20h5l-7-30 1-10 9-12-3-2-9 11z"/></svg>
      <span>Handicap estimate</span><b>${H.index != null ? H.index.toFixed(1) : '–'}</b></div>

    <div class="h-trio">
      <div><b>${S.rounds.filter(r => r.completed).length}</b><span>Rounds</span></div>
      <div><b>${scores.length ? fmt1(sum(scores) / scores.length) : '–'}</b><span>Average score</span></div>
      <div><b>${scores.length ? Math.min(...scores) : '–'}</b><span>Best score</span></div>
    </div>

    <div class="h-title">Rounds</div>
    ${inprog ? (() => { const hs = playedHoles(inprog), RA = aggregate([inprog]);
      return `<button class="h-last live" data-act="resume" data-v="${inprog.id}"><div><small>In progress · thru ${hs.length}</small><b>${esc(inprog.course || 'Round')}</b></div><span class="h-score">${hs.length ? toPar(RA.strokes - RA.par) : '–'}</span></button>`; })() : ''}
    ${last ? `<button class="h-last" data-act="openRound" data-v="${last.id}"><div><small>Last round: ${shortDate(last.date)}</small><b>${esc(last.course || 'Round')}</b></div><span class="h-score">${lastScore}</span></button>` : ''}

    <div class="h-duo">
      <button data-act="goStats"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>My stats</span></button>
      <button data-act="goBag"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8l1-9H7zM9 12V5l-2-2M12 12V3M15 12V6l2-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Golf bag</span></button>
    </div>

    ${A.rounds ? `<div class="h-section">Your game · last ${A.rounds} round${A.rounds > 1 ? 's' : ''}</div>
    <div class="h-quad">
      <div><b>${fmtPct(A.sz, A.szN)}</b><span>SZIR</span></div><div><b>${fmtPct(A.d3, A.d3N)}</b><span>Down in 3</span></div>
      <div><b>${fmtPct(A.fir, A.firN)}</b><span>Fairways</span></div><div><b>${fmtPct(A.gir, A.girN)}</b><span>Greens</span></div>
    </div>` : ''}

    <button class="h-start" data-act="${inprog ? 'resume' : 'newRound'}" data-v="${inprog ? inprog.id : ''}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V3l11 4.5L8 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/></svg>
      ${inprog ? 'Continue round' : 'Start a round'}</button>
  </div>`;
}
function homeResults(q) {
  const el = $('#homeResults'); if (!el) return;
  q = q.trim().toLowerCase();
  if (!q) { el.innerHTML = ''; return; }
  const names = new Map();
  for (const c of allCourses()) names.set(c.name.toLowerCase(), c.name);
  for (const r of S.rounds) if (r.course) names.set(r.course.trim().toLowerCase(), r.course.trim());
  const hits = [...names.values()].filter(n => n.toLowerCase().includes(q)).slice(0, 6);
  el.innerHTML = `<div class="h-results">${hits.map(n => `<button data-act="searchStart" data-v="${esc(n)}"><b>${esc(n)}</b><span>Play ›</span></button>`).join('')}
    ${hits.some(n => n.toLowerCase() === q) ? '' : `<button data-act="searchStart" data-v="${esc(q.replace(/\b\w/g, c => c.toUpperCase()))}"><b>+ New course: “${esc(q)}”</b><span>Set up ›</span></button>`}</div>`;
}

/* ---------- golf bag ---------- */
function viewBag() {
  setTitle('Golf bag', `<button class="tbtn" data-act="goHome">‹ Home</button>`);
  const bag = bagDistances();
  return `${bag.length ? `<div class="card"><h2>Your distances <span class="sub">${S.settings.unit}</span></h2>
    <div class="bagbars">${bag.slice().reverse().map(c => `<div class="bb"><span>${esc(CLUB_NAME[c.k])}</span><div><i style="width:${Math.round(c.d / bag[bag.length - 1].d * 100)}%"></i></div><b>${fd(c.d)}</b></div>`).join('')}</div>
    <div class="sub" style="margin-top:6px">From your tracked shots where you have 3+ good shots, otherwise from what you typed below. These power the club suggestions on the map.</div></div>` : ''}
    ${clubCard(S.rounds)}${bagCard()}`;
}

/* ---------- hole insights (map sheet) ---------- */
function holeInsights(n) {
  const r = activeRound();
  const rs = courseRounds(r.course).filter(x => x.id !== r.id && x.completed)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created).slice(0, 10);
  const hs = rs.map(x => x.holes.find(h => h.n === n)).filter(h => h && h.done && h.score != null);
  if (!hs.length) return null;
  const A = aggregate([{ holes: hs }]);
  return { n: hs.length, avg: A.strokes / A.holes, fir: pct(A.fir, A.firN), gir: pct(A.gir, A.girN), putts: A.puttsN ? A.putts / A.puttsN : null,
    pen: (A.ob + A.water + A.pen) / A.holes, sz: pct(A.sz, A.szN), d3: pct(A.d3, A.d3N), best: Math.min(...hs.map(h => h.score)) };
}
function insightsSheet() {
  const h = curHole(), r = activeRound(), I = holeInsights(h.n), B = benchFor(S.settings.target);
  const tab = M.insTab || 'stats';
  const row = (label, you, them) => `<div class="ins-row"><b>${you}</b><span>${label}</span><em>${them}</em></div>`;
  const note = (courseGeo().notes || {})[h.n] || '';
  return `<div class="sheet-h"><b class="ins-title">📈 Insights</b><button class="mt-x dark" data-act="sheet" data-v="">✕</button></div>
    <div class="seg ins-tabs"><button data-act="insTab" data-v="stats" class="${tab === 'stats' ? 'on' : ''}">Hole ${h.n} stats</button><button data-act="insTab" data-v="notes" class="${tab === 'notes' ? 'on' : ''}">Hole ${h.n} notes${note ? ' •' : ''}</button></div>
    ${tab === 'stats' ? `
      <div class="ins-head"><span>You <small>(last ${I ? I.n : 0} here)</small></span><span>${S.settings.target} hcp avg</span></div>
      ${row('Average score', I ? I.avg.toFixed(1) : '–', '–')}
      ${row('Best score', I ? I.best : '–', '–')}
      ${h.par > 3 ? row('Fairway hit', I && I.fir != null ? I.fir + '%' : '–', B.fir + '%') : ''}
      ${row('GIR', I && I.gir != null ? I.gir + '%' : '–', B.gir + '%')}
      ${row('Putts', I && I.putts != null ? I.putts.toFixed(1) : '–', (B.putts / 18).toFixed(1))}
      ${row('Penalties', I ? I.pen.toFixed(1) : '–', (B.pen / 18).toFixed(1))}
      ${row('Scoring zone in reg.', I && I.sz != null ? I.sz + '%' : '–', `goal ${S.settings.szGoal}%`)}
      ${row('Down in 3', I && I.d3 != null ? I.d3 + '%' : '–', `goal ${S.settings.d3Goal}%`)}
      ${I ? '' : '<div class="sub" style="margin-top:8px">Play this hole once and your history shows up here.</div>'}`
    : `<textarea data-bind="holeNote" style="min-height:140px" placeholder="e.g. Aim at the left edge of the bunker. Green runs back to front.">${esc(note)}</textarea>
       <div class="sub" style="margin-top:6px">Saved for every time you play this hole.</div>`}
    <div class="ins-foot">
      <button data-act="mapPrev" ${S.hole === 0 ? 'disabled' : ''}>‹ ${S.hole === 0 ? '' : h.n - 1}</button>
      <div><b>Hole ${h.n}</b><span>Par ${h.par}${h.si ? ', SI ' + h.si : ''}</span></div>
      <button data-act="mapNext" ${S.hole >= r.holes.length - 1 ? 'disabled' : ''}>${S.hole >= r.holes.length - 1 ? '' : h.n + 1} ›</button>
    </div>`;
}

Object.assign(ACTIONS, {
  newRound() { S.view = 'play'; S.activeId = null; S.draft = null; },
  quickStart(v) { S.view = 'play'; S.activeId = null; S.draft = draftFrom(allCourses()[Number(v)], { date: localDate(), hcp: S.settings.hcp ?? '' }); },
  searchStart(v) {
    const c = allCourses().find(x => sameCourse(x.name, v)) || S.courses.find(x => sameCourse(x.name, v));
    S.view = 'play'; S.activeId = null;
    S.draft = draftFrom(c || null, { date: localDate(), hcp: S.settings.hcp ?? '' });
    if (!c) S.draft.course = v;
  },
  goStats() { S.view = 'stats'; },
  goBag() { S.view = 'bag'; window.scrollTo(0, 0); },
  insTab(v) { M.insTab = v; },
});
