'use strict';
/* Stats hub: one category at a time, picked from a scrolling selector (Overview, Rounds, Scoring, Driving,
   Approach, Short game, Putting, Clubs). Replaces the single long stats page. */

const STAT_TABS = [['overview', 'Overview'], ['rounds', 'Rounds'], ['scoring', 'Scoring'], ['driving', 'Driving'], ['approach', 'Approach'], ['short', 'Short game'], ['putting', 'Putting'], ['sg', 'Strokes gained'], ['clubs', 'Clubs']];

function statSelector() {
  const t = S.statTab || 'overview';
  return `<div class="stabs">${STAT_TABS.map(([k, l]) => `<button data-act="statTab" data-v="${k}" class="${t === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function rangeChips() {
  return `<div class="seg ins-tabs" style="margin-bottom:12px">${[['5', 'Last 5'], ['10', 'Last 10'], ['20', 'Last 20'], ['all', 'All']].map(([v, l]) => `<button data-act="range" data-v="${v}" class="${S.range === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
/* extra numbers the main aggregate doesn't carry */
function extraStats(rounds) {
  const X = { hitN: 0, hitTP: 0, missN: 0, missTP: 0, puttsByPar: { 3: [0, 0], 4: [0, 0], 5: [0, 0] }, putt: [0, 0, 0, 0], firByPar: { 4: [0, 0], 5: [0, 0] }, girByPar: { 3: [0, 0], 4: [0, 0], 5: [0, 0] },
    girHitTP: [0, 0], girMissTP: [0, 0], lies: {}, penByType: { ob: 0, water: 0, pen: 0 }, d3ByPar: { 3: [0, 0], 4: [0, 0], 5: [0, 0] } };
  for (const r of rounds) for (const h of playedHoles(r)) {
    const x = derive(h), tp = h.score - h.par;
    if (h.par > 3 && h.fw) { if (h.fw === 'hit') { X.hitN++; X.hitTP += tp; } else { X.missN++; X.missTP += tp; } const f = X.firByPar[h.par]; if (f) { f[1]++; if (h.fw === 'hit') f[0]++; } }
    if (h.putts != null) {
      const p = X.puttsByPar[h.par]; if (p) { p[0] += h.putts; p[1]++; }
      X.putt[Math.min(3, h.putts)]++;
      const g = X.girByPar[h.par]; if (g) { g[1]++; if (x.gir) g[0]++; }
      const t = x.gir ? X.girHitTP : X.girMissTP; t[0] += tp; t[1]++;
    }
    if (h.inZone != null) { const d = X.d3ByPar[h.par]; if (d) { d[1]++; if (h.inZone <= 3) d[0]++; } }
    X.penByType.ob += h.ob || 0; X.penByType.water += h.water || 0; X.penByType.pen += h.pen || 0;
    for (const s of h.shots || []) if (s.lie) X.lies[s.lie] = (X.lies[s.lie] || 0) + 1;
  }
  return X;
}
const sgn = v => (v == null || !isFinite(v) ? '–' : (v > 0 ? '+' : '') + v.toFixed(2));
function donut(parts, big, small) {
  const total = sum(parts.map(p => p.v)) || 1, R = 54, C = 2 * Math.PI * R; let off = 0;
  return `<div class="donut"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(small)}">${parts.filter(p => p.v).map(p => { const len = (p.v / total) * C; const el = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${p.c}" stroke-width="22" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 70 70)"/>`; off += len; return el; }).join('')}
    <text x="70" y="68" text-anchor="middle" class="dn-b">${big}</text><text x="70" y="86" text-anchor="middle" class="dn-s">${esc(small)}</text></svg>
    <div class="legend" style="justify-content:center">${parts.map(p => `<span><i style="background:${p.c}"></i>${p.l} ${Math.round((p.v / total) * 100)}%</span>`).join('')}</div></div>`;
}
function hbars(rows, max, fmt = v => v) {
  return `<div class="hbars">${rows.map(([l, v, note]) => `<div><span>${l}</span><div><i style="width:${v == null ? 0 : Math.max(3, Math.min(100, (v / max) * 100))}%"></i></div><b>${v == null ? '–' : fmt(v)}</b>${note ? `<small>${note}</small>` : ''}</div>`).join('')}</div>`;
}
function ring(label, a, b, note) {
  const p = b ? a / b : 0, C = 2 * Math.PI * 30;
  return `<div class="ring"><svg viewBox="0 0 76 76"><circle cx="38" cy="38" r="30" fill="none" stroke="var(--surface-2)" stroke-width="8"/><circle cx="38" cy="38" r="30" fill="none" stroke="var(--brand-2)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(p * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle">${b ? Math.round(p * 100) + '%' : '–'}</text></svg><b>${label}</b><span>${b ? `${a}/${b}` : 'no data'}${note ? ' · ' + note : ''}</span></div>`;
}
/* slider row: target in the middle, your value as a bubble (right = better) */
function swRow(label, you, target, higher, fmt = v => v) {
  if (you == null || !isFinite(you)) return `<div class="sw"><div class="sw-h"><span>${label}</span><b>${fmt(target)}</b></div><div class="sw-bar"><em style="left:50%"></em></div><small>no data yet</small></div>`;
  const rel = (higher ? you - target : target - you) / Math.max(Math.abs(target), 1);
  const pos = Math.max(6, Math.min(94, 50 + rel * 110));
  return `<div class="sw"><div class="sw-h"><span>${label}</span><b>${fmt(target)}</b></div><div class="sw-bar"><em style="left:50%"></em><i style="left:${pos}%" class="${pos >= 50 ? 'good' : 'bad'}">${fmt(you)}</i></div></div>`;
}

function statOverview(A, rs) {
  const B = benchFor(S.settings.target), p1 = v => Math.round(v * 10) / 10;
  const putts18 = A.puttsN ? (A.putts / A.puttsN) * 18 : null, pen18 = A.per18(A.ob + A.water + A.pen);
  return handicapCard() + `<div class="card"><h2>Strengths & weaknesses</h2>
    <div class="sub" style="margin-bottom:10px">Your stats against a ${S.settings.target}-handicap golfer (the mark in the middle). Right of the mark is better. Change the target in Settings.</div>
    ${swRow('Scoring avg.', A.holes ? p1(A.per18(A.strokes)) : null, p1(A.per18(A.par) + S.settings.target) || 72 + S.settings.target, false)}
    ${swRow('Fairway hits', pct(A.fir, A.firN), B.fir, true, v => v + '%')}
    ${swRow('Green hits', pct(A.gir, A.girN), B.gir, true, v => v + '%')}
    ${swRow('Up & downs', pct(A.ud, A.udN), B.ud, true, v => v + '%')}
    ${swRow('Putts per round', putts18 == null ? null : p1(putts18), B.putts, false)}
    ${swRow('Penalties', pen18 == null ? null : p1(pen18), B.pen, false)}
    ${swRow('Scoring zone in reg.', pct(A.sz, A.szN), S.settings.szGoal, true, v => v + '%')}
    ${swRow('Down in 3', pct(A.d3, A.d3N), S.settings.d3Goal, true, v => v + '%')}
  </div>` + focusCard(A) + trendCard(rs) + bestsCard(S.rounds);
}
function statScoring(A, X) {
  const dc = { eagle: 'var(--eagle)', birdie: 'var(--birdie)', par: 'var(--par)', bogey: 'var(--bogey)', double: 'var(--double)', triple: '#333' };
  const dl = { eagle: 'Eagles', birdie: 'Birdies', par: 'Pars', bogey: 'Bogeys', double: 'Doubles', triple: 'Other' };
  const sc = A.per18(A.strokes), pr = A.per18(A.par);
  return `<div class="card"><h2>Scoring <span class="sub">${A.rounds} round${A.rounds === 1 ? '' : 's'} · ${A.holes} holes</span></h2>
    <div class="tiles"><div class="tile hero"><div><div class="k">Average score (per 18)</div><div class="v">${fmt1(sc)}</div></div><div style="text-align:right"><div class="k">To par</div><div class="v">${(sc - pr >= 0 ? '+' : '') + fmt1(sc - pr)}</div></div></div></div>
    <h3>Score mix</h3><div class="bar">${Object.keys(A.dist).filter(k => A.dist[k]).map(k => `<div style="flex:${A.dist[k]};background:${dc[k]}"></div>`).join('')}</div>
    <div class="mix">${Object.keys(A.dist).map(k => `<div><span><i style="background:${dc[k]}"></i>${dl[k]}</span><b>${A.dist[k]}</b></div>`).join('')}</div></div>
  <div class="card"><div class="rings">${ring('Scrambling', A.ud, A.udN, 'up & downs')}${ring('GIR', A.gir, A.girN)}${ring('Scoring zone', A.sz, A.szN)}${ring('Down in 3', A.d3, A.d3N)}</div></div>
  <div class="card"><h2>Score by par</h2><div class="vbars">${[3, 4, 5].map(p => { const b = A.byPar[p], avg = b.n ? b.s / b.n : null;
    return `<div><b>${avg ? avg.toFixed(1) : '–'}</b><div><i style="height:${avg ? Math.min(100, Math.max(8, (avg - p + 0.3) * 40)) : 0}%" class="${avg && avg - p > 1.5 ? 'bad' : ''}"></i></div><span>Par ${p}s</span><small>${avg ? toPar(Math.round((avg - p) * 10) / 10) : ''}</small></div>`; }).join('')}</div></div>
  <div class="card"><h2>Scoring Method</h2><div class="tiles">
    ${tile('Par or better with SZIR', fmtPct(A.szirPar, A.sz), 'when you reach the zone in regulation')}
    ${tile('Par or better without', fmtPct(A.noSzirPar, A.noSzirN), 'when you don\'t')}
    ${tile('Avg shots inside zone', A.d3N ? fmt1(A.inZoneSum / A.d3N) : '–', 'lower is better')}
    ${tile('SZIR + Down in 3', fmtPct(A.szAndD3, A.szAndD3N), 'both on the same hole')}</div>
    <h3>SZIR and Down in 3 by par</h3>${hbars([3, 4, 5].flatMap(p => [[`SZIR par ${p}`, pct(...A.szByPar[p])], [`D3 par ${p}`, pct(...X.d3ByPar[p])]]), 100, v => v + '%')}</div>`;
}
function statDriving(A, X, rs) {
  const P = (a) => (A.firN ? Math.round((a / A.firN) * 100) : 0), B = benchFor(S.settings.target);
  const dr = clubStats(rs).by.Dr, drT = dr && dr.all.length ? [...(dr.good.length ? dr.good : dr.all)].sort((a, b) => a - b) : null;
  return `<div class="card"><h2>Driving accuracy <span class="sub">${A.firN} tee shots</span></h2>
    <div class="fwg"><div class="fwg-fw"></div>
      <div class="fwg-l"><small>Left</small><b>${P(A.fwL)}%</b></div><div class="fwg-c"><small>Hit</small><b>${P(A.fir)}%</b></div><div class="fwg-r"><small>Right</small><b>${P(A.fwR)}%</b></div><div class="fwg-s">Short <b>${P(A.fwS)}%</b></div></div>
    <div class="sub" style="margin-top:8px">${S.settings.target} handicap average: ${B.fir}% fairways.${A.firN && Math.abs(A.fwL - A.fwR) >= Math.max(2, A.firN * 0.15) ? ` Your miss is mostly <b>${A.fwL > A.fwR ? 'left' : 'right'}</b>. Aim to allow for it.` : ''}</div></div>
  <div class="card"><div class="tiles">
    ${tile('Score with fairway hit', X.hitN ? sgn(X.hitTP / X.hitN) : '–', 'avg to par per hole')}
    ${tile('Score with fairway miss', X.missN ? sgn(X.missTP / X.missN) : '–', X.hitN && X.missN ? `a miss costs ${(X.missTP / X.missN - X.hitTP / X.hitN).toFixed(2)} shots` : 'avg to par per hole')}
    ${tile('Typical drive', drT ? fd(drT[Math.floor(drT.length / 2)]) + ' ' + S.settings.unit : '–', drT ? `longest ${fd(Math.max(...dr.all))} · ${dr.all.length} tracked` : 'track shots with Driver')}
    ${tile('Out of bounds', X.penByType.ob, fmt1(A.per18(X.penByType.ob)) + ' per 18')}</div>
    <h3>Fairways by par</h3><div class="rings">${ring('Par 4s', ...X.firByPar[4])}${ring('Par 5s', ...X.firByPar[5])}</div></div>`;
}
function statApproach(A, X) {
  const M = k => (A.missN ? Math.round((A.miss[k] / A.missN) * (100 - (pct(A.gir, A.girN) || 0))) : 0), B = benchFor(S.settings.target);
  const worst = A.missN ? ['short', 'long', 'left', 'right'].sort((a, b) => A.miss[b] - A.miss[a])[0] : null;
  return `<div class="card"><h2>Approach accuracy <span class="sub">${A.girN} greens</span></h2>
    <div class="apg"><div class="apg-o"></div><div class="apg-g"></div>
      <div class="apg-t"><small>Long</small><b>${M('long')}%</b></div><div class="apg-b"><small>Short</small><b>${M('short')}%</b></div>
      <div class="apg-l"><small>Left</small><b>${M('left')}%</b></div><div class="apg-r"><small>Right</small><b>${M('right')}%</b></div>
      <div class="apg-c"><small>⛳ Hit</small><b>${pct(A.gir, A.girN) ?? 0}%</b></div></div>
    <div class="sub" style="margin-top:8px">${S.settings.target} handicap average: ${B.gir}% greens.${A.girN - A.gir > A.missN ? ` Miss direction logged on ${A.missN} of ${A.girN - A.gir} missed greens.` : ''}${worst && A.miss[worst] >= 3 ? ` Most misses are <b>${worst}</b>${worst === 'short' ? ': take one more club' : ''}.` : ''}</div></div>
  <div class="card"><h2>Greens in regulation by par</h2><div class="rings">${[3, 4, 5].map(p => ring(`Par ${p}s`, ...X.girByPar[p])).join('')}</div>
    <div class="tiles" style="margin-top:12px">${tile('Score with green hit', X.girHitTP[1] ? sgn(X.girHitTP[0] / X.girHitTP[1]) : '–', 'avg to par per hole')}${tile('Score with green missed', X.girMissTP[1] ? sgn(X.girMissTP[0] / X.girMissTP[1]) : '–', 'avg to par per hole')}
    ${tile('GIR per 18', fmt1(A.girN ? (A.gir / A.girN) * 18 : null), `${A.gir}/${A.girN}`)}${tile('Scoring zone in reg.', fmtPct(A.sz, A.szN), `goal ${S.settings.szGoal}%`)}</div></div>`;
}
function statShort(A, X) {
  const B = benchFor(S.settings.target), pens = A.ob + A.water + A.pen;
  return `<div class="card"><h2>Short game</h2><div class="rings">${ring('Up & down', A.ud, A.udN, `${B.ud}% avg`)}${ring('Sand saves', A.sand, A.sandN, `${B.sand}% avg`)}${ring('Down in 3', A.d3, A.d3N, `goal ${S.settings.d3Goal}%`)}</div>
    <div class="tiles" style="margin-top:12px">${tile('Bunkers per 18', fmt1(A.per18(A.sandN)), `${A.sandN} greenside bunkers`)}${tile('Avg shots inside zone', A.d3N ? fmt1(A.inZoneSum / A.d3N) : '–', `inside ${zoneLabel()}`)}</div></div>
  <div class="card"><h2>Penalties <span class="sub">${fmt1(A.per18(pens))} per 18</span></h2>
    ${donut([{ l: 'Out of bounds', v: X.penByType.ob, c: '#e5484d' }, { l: 'Water', v: X.penByType.water, c: '#4aa8ff' }, { l: 'Lost / other', v: X.penByType.pen, c: '#f5a524' }], pens, 'penalty shots')}
    <div class="sub" style="margin-top:8px">${A.penHoles} of ${A.holes} holes had a penalty. ${S.settings.target} handicap average: ${B.pen} per round.</div></div>`;
}
function statPutting(A, X) {
  const B = benchFor(S.settings.target), n = A.puttsN, p18 = n ? (A.putts / n) * 18 : null;
  return `<div class="card"><h2>Putts</h2>
    ${donut([{ l: '0 putt', v: X.putt[0], c: '#b7e3c0' }, { l: '1 putt', v: X.putt[1], c: '#57b46f' }, { l: '2 putts', v: X.putt[2], c: '#1f8a5b' }, { l: '3+ putts', v: X.putt[3], c: '#e5484d' }], fmt1(p18), 'putts / round')}
    <div class="tiles" style="margin-top:12px">${tile('Putts per hole', n ? (A.putts / n).toFixed(2) : '–', `${S.settings.target} hcp: ${(B.putts / 18).toFixed(2)}`)}${tile('Putts per GIR', A.girPuttN ? (A.girPutts / A.girPuttN).toFixed(2) : '–', 'tour ≈ 1.75')}
    ${tile('3-putts per 18', fmt1(n ? (A.threePutt / n) * 18 : null), `${S.settings.target} hcp: ${B.three}`)}${tile('1-putts per 18', fmt1(n ? (A.onePutt / n) * 18 : null), '')}</div>
    <h3>Putts per hole by par</h3>${hbars([3, 4, 5].map(p => [`Par ${p}`, X.puttsByPar[p][1] ? X.puttsByPar[p][0] / X.puttsByPar[p][1] : null]), 3, v => v.toFixed(2))}</div>
  <div class="card"><h2>Putting distances</h2>${A.p1.some(b => b.n) ? `
    <div class="arcs">${A.p1.map((b, i) => `<div style="--i:${i}"><b>${b.n ? Math.round((b.one / b.n) * 100) + '%' : '–'}</b></div>`).join('')}</div>
    <table class="tbl" style="margin-top:10px"><thead><tr><th>First putt (m)</th><th>Holes</th><th>1-putt</th><th>3-putt</th></tr></thead><tbody>${A.p1.map((b, i) => `<tr><td>${PUTT_BUCKETS[i]}</td><td>${b.n}</td><td>${b.n ? fmtPct(b.one, b.n) : '–'}</td><td>${b.n ? fmtPct(b.three, b.n) : '–'}</td></tr>`).join('')}</tbody></table>
    <div class="sub" style="margin-top:6px">The rings show your one-putt chance from each distance, closest in the middle.</div>` : '<div class="sub">Log your first-putt distance when you enter a score (in Settings stats) to see your make rate from each distance.</div>'}</div>`;
}
function clubShots(k) {
  const out = [];
  for (const r of S.rounds) for (const h of r.holes) (h.shots || []).forEach((s, i) => { if (s.club !== k) return; const d = shotDist(h, i); if (d != null && d >= 5) out.push({ d, r, h, s }); });
  const ds = out.map(o => o.d).sort((a, b) => a - b), med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  for (const o of out) o.out = (o.s.bad && o.s.bad !== 'good') || !!o.s.pen || (ds.length >= 4 && (o.d < med * 0.75 || o.d > med * 1.25));
  return out.sort((a, b) => (b.r.date || '').localeCompare(a.r.date || ''));
}
function statClubs() {
  const u = S.settings.unit;
  if (S.clubSel) {
    const k = S.clubSel, shots = clubShots(k), ok = shots.filter(o => !o.out), avg = ok.length ? sum(ok.map(o => o.d)) / ok.length : null;
    return `<div class="card"><h2>${esc(CLUB_NAME[k])} <button class="btn sm" data-act="clubSel" data-v="">‹ All clubs</button></h2>
      <div class="sub">${shots.length} tracked shot${shots.length === 1 ? '' : 's'}</div>
      <div class="clubtags"><span class="avg">Avg <b>${avg ? fd(avg) : '–'}</b>${u}</span><span class="long">Long <b>${ok.length ? fd(Math.max(...ok.map(o => o.d))) : '–'}</b>${u}</span></div>
      <div class="sub" style="margin:8px 0">Mishits, penalty shots and distances far from your normal are left out of the average (shown greyed with ⊘).</div>
      ${shots.map(o => `<div class="list-item" style="cursor:default${o.out ? ';opacity:.45' : ''}"><div><b>${fmtDate(o.r.date)}</b><div class="sub">${esc(o.r.course || '')} · hole ${o.h.n}${o.s.bad && o.s.bad !== 'good' ? ' · ' + o.s.bad : ''}${o.s.pen ? ' · ' + PEN_NAME[o.s.pen] : ''}</div></div><div class="big" style="font-size:19px">${o.out ? '⊘ ' : ''}${fd(o.d)}<small style="font-size:11px"> ${u}</small></div></div>`).join('') || '<div class="sub">No tracked shots yet.</div>'}</div>`;
  }
  const bag = Object.fromEntries(bagDistances().map(c => [c.k, c.d]));
  const rows = CLUBS.filter(c => c[0] !== 'Pt').map(([k, n]) => { const sh = clubShots(k), ok = sh.filter(o => !o.out); return { k, n, cnt: sh.length, lo: ok.length ? Math.min(...ok.map(o => o.d)) : null, hi: ok.length ? Math.max(...ok.map(o => o.d)) : null, avg: ok.length ? sum(ok.map(o => o.d)) / ok.length : bag[k] || null }; });
  const max = Math.max(250, ...rows.map(r => r.hi || r.avg || 0));
  return `<div class="card"><h2>My clubs <span class="sub">average distance, ${u}</span></h2>
    ${rows.map(r => `<button class="clubrow" data-act="clubSel" data-v="${r.k}"><span><b>${esc(r.n)}</b><small>${r.cnt} shot${r.cnt === 1 ? '' : 's'}</small></span>
      <div class="cr-bar">${r.lo != null ? `<i style="left:${(r.lo / max) * 100}%;width:${Math.max(3, ((r.hi - r.lo) / max) * 100)}%"></i>` : r.avg ? `<i class="typed" style="left:${(r.avg / max) * 100 - 1.5}%;width:3%"></i>` : ''}</div><em>${r.avg ? fd(r.avg) : '–'}</em><span class="hp-chev">›</span></button>`).join('')}
    <div class="sub" style="margin-top:8px">Bars show your shortest to longest normal shot. Clubs with no tracked shots use the distances typed in your Golf bag.</div>
    </div>`;
}

function viewStats() {
  setTitle('Stats');
  const t = S.statTab || 'overview';
  if (t === 'rounds') { const html = viewRounds(); setTitle('Stats'); return statSelector() + html; }
  if (t === 'clubs') return statSelector() + statClubs();
  const rs = rangeRounds();
  if (!rs.length) return statSelector() + `<div class="card empty"><p>Play a round and your stats will show up here.</p></div>`;
  const A = aggregate(rs), X = extraStats(rs);
  const body = t === 'scoring' ? statScoring(A, X) : t === 'driving' ? statDriving(A, X, rs) : t === 'approach' ? statApproach(A, X) : t === 'short' ? statShort(A, X) : t === 'putting' ? statPutting(A, X) : t === 'sg' ? statSG(rs) : statOverview(A, rs);
  return statSelector() + rangeChips() + body;
}
Object.assign(ACTIONS, {
  statTab(v) { S.statTab = v; S.clubSel = null; window.scrollTo(0, 0); },
  clubSel(v) { S.clubSel = v || null; window.scrollTo(0, 0); },
  allRounds() { S.view = 'stats'; S.statTab = 'rounds'; window.scrollTo(0, 0); },
});
