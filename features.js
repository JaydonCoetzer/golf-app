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
  const r = activeRound() || S.rounds.find(x => !x.completed);
  const done = S.rounds.filter(x => playedHoles(x).length).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.created - a.created);
  const last = done.find(x => x.completed);
  const recent = done.filter(x => x.completed).slice(0, 10);
  const A = aggregate(recent);
  const H = handicapIndex();
  const hr = new Date().getHours();
  const hello = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';

  let hero;
  if (r) {
    const hs = playedHoles(r), RA = aggregate([r]);
    hero = `<div class="hero"><div class="hero-k">Round in progress</div><div class="hero-t">${esc(r.course || 'Round')}</div>
      <div class="hero-s">${hs.length ? `Thru ${hs.length} · ${toPar(RA.strokes - RA.par)}${hasHcp(r) ? ' · ' + netTotals(r).pts + ' pts' : ''}` : 'Not started yet'}</div>
      <button class="btn hero-btn" data-act="resume" data-v="${r.id}">Continue round ›</button></div>`;
  } else {
    const cs = allCourses().slice(0, 3);
    hero = `<div class="hero"><div class="hero-k">${hello}</div><div class="hero-t">Ready to play?</div>
      <button class="btn hero-btn" data-act="newRound">⛳ Start a round</button>
      ${cs.length ? `<div class="hero-quick">${cs.map((c, i) => `<button data-act="quickStart" data-v="${i}">${esc(c.name)}</button>`).join('')}</div>` : ''}</div>`;
  }

  const tiles = `<div class="tiles home-tiles">
    ${tile('Handicap index', H.index != null ? H.index.toFixed(1) : '–', H.index != null ? 'estimate' : 'needs 3 rated rounds')}
    ${tile('Avg score', A.holes ? fmt1(A.per18(A.strokes)) : '–', A.rounds ? `last ${A.rounds} round${A.rounds > 1 ? 's' : ''}` : 'no rounds yet')}
    ${tile('Scoring zone (SZIR)', fmtPct(A.sz, A.szN), `goal ${S.settings.szGoal}%`, A.szN ? (pct(A.sz, A.szN) >= S.settings.szGoal ? 'good' : 'bad') : '')}
    ${tile('Down in 3', fmtPct(A.d3, A.d3N), `goal ${S.settings.d3Goal}%`, A.d3N ? (pct(A.d3, A.d3N) >= S.settings.d3Goal ? 'good' : 'bad') : '')}
  </div>`;

  const lastCard = last ? (() => {
    const LA = aggregate([last]);
    return `<div class="card"><h2>Last round <button class="btn sm" data-act="openRound" data-v="${last.id}">Scorecard ›</button></h2>
      <div class="row between"><div><b>${esc(last.course || 'Round')}</b><div class="sub">${fmtDate(last.date)}</div></div>
      <div style="text-align:right"><div class="big" style="font-size:28px;font-weight:800">${LA.strokes}</div><div class="sub">${toPar(LA.strokes - LA.par)}${hasHcp(last) ? ' · ' + netTotals(last).pts + ' pts' : ''}</div></div></div>
      <div class="strip" style="margin-top:10px"><div><b>${LA.putts}</b><span>Putts</span></div><div><b>${fmtPct(LA.fir, LA.firN)}</b><span>Fairways</span></div><div><b>${fmtPct(LA.gir, LA.girN)}</b><span>Greens</span></div><div><b>${fmtPct(LA.sz, LA.szN)}</b><span>SZIR</span></div></div></div>`;
  })() : '';

  const focus = recent.length ? focusCard(A) : `<div class="card"><h2>How it works</h2><div class="sub">Start a round and the GPS map opens. Tap <b>Enter score</b> after each hole. Your stats, focus areas and handicap build up from there.</div></div>`;
  return hero + tiles + lastCard + focus;
}
Object.assign(ACTIONS, {
  newRound() { S.view = 'play'; S.activeId = null; S.draft = null; },
  quickStart(v) { S.view = 'play'; S.activeId = null; S.draft = draftFrom(allCourses()[Number(v)], { date: localDate(), hcp: S.settings.hcp ?? '' }); },
});
