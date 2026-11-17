'use strict';
/* Strokes gained (estimate). Baseline = expected strokes to hole out for a tour-level player by distance and lie
   (after Mark Broadie's published tables, rounded). Only holes where your tracked shots + penalties + putts add up
   to your score are counted, so half-tracked holes can't skew it. */

const SG_YD = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540, 560, 580, 600];
const SG_T = {
  tee:      [2.4, 2.6, 2.7, 2.75, 2.92, 2.99, 2.97, 2.99, 3.05, 3.12, 3.17, 3.25, 3.45, 3.65, 3.71, 3.79, 3.86, 3.92, 3.96, 3.99, 4.02, 4.08, 4.17, 4.28, 4.41, 4.54, 4.65, 4.74, 4.79, 4.82],
  fairway:  [2.4, 2.6, 2.7, 2.75, 2.8, 2.85, 2.91, 2.98, 3.08, 3.19, 3.32, 3.45, 3.58, 3.69, 3.78, 3.84, 3.88, 3.95, 4.03, 4.11, 4.15, 4.2, 4.29, 4.4, 4.53, 4.66, 4.78, 4.86, 4.91, 4.94],
  rough:    [2.59, 2.78, 2.91, 2.96, 3.02, 3.08, 3.15, 3.23, 3.31, 3.42, 3.53, 3.64, 3.74, 3.83, 3.9, 3.95, 4.02, 4.11, 4.21, 4.3, 4.34, 4.39, 4.48, 4.59, 4.72, 4.85, 4.97, 5.05, 5.1, 5.13],
  sand:     [2.53, 2.82, 3.15, 3.24, 3.23, 3.21, 3.22, 3.28, 3.4, 3.55, 3.7, 3.84, 3.93, 4.0, 4.04, 4.12, 4.26, 4.41, 4.55, 4.69, 4.73, 4.78, 4.87, 4.98, 5.11, 5.24, 5.36, 5.44, 5.49, 5.52],
  trouble:  [3.45, 3.6, 3.7, 3.75, 3.8, 3.78, 3.8, 3.81, 3.82, 3.87, 3.92, 3.97, 4.03, 4.1, 4.2, 4.31, 4.44, 4.56, 4.66, 4.75, 4.79, 4.84, 4.93, 5.04, 5.17, 5.3, 5.42, 5.5, 5.55, 5.58],
};
const SG_FT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 40, 50, 60, 90], SG_P = [1.0, 1.01, 1.04, 1.13, 1.23, 1.34, 1.42, 1.5, 1.56, 1.61, 1.78, 1.87, 1.98, 2.06, 2.14, 2.21, 2.4];
function lerp(xs, ys, x) {
  if (x <= xs[0]) return ys[0]; if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1; while (xs[i] < x) i++;
  return ys[i - 1] + ((x - xs[i - 1]) / (xs[i] - xs[i - 1])) * (ys[i] - ys[i - 1]);
}
function sgExpected(m, lie) {
  if (m <= 0) return 0;
  if (lie === 'green') return lerp(SG_FT, SG_P, m * 3.281);
  const yd = m / 0.9144;
  if (yd < 20) return Math.max(2.0, lerp(SG_YD, SG_T[lie] || SG_T.fairway, 20) - (20 - yd) * 0.02);
  return lerp(SG_YD, SG_T[lie] || SG_T.fairway, yd);
}
const PUTT1_M = [0.5, 1.5, 3, 6, 11];

function sgHole(r, h) {
  if (!h.done || h.score == null || h.putts == null) return null;
  const g = (S.geo[(r.course || 'unnamed').trim().toLowerCase()] || { holes: {} }).holes[h.n];
  const shots = h.shots || []; if (!g || !g.c || !shots.length) return null;
  const off = shots.filter(s => s.club !== 'Pt'), firstPt = shots.find(s => s.club === 'Pt');
  const pens = off.filter(s => s.pen).length;
  if (off.length + pens + h.putts !== h.score) return null;
  const dTo = s => dist([s.lat, s.lng], g.c);
  const putt1 = h.putts ? (h.putt1 != null ? PUTT1_M[h.putt1] : firstPt ? Math.max(0.5, Math.min(25, dTo(firstPt))) : null) : 0;
  if (h.putts && putt1 == null) return null;
  const out = { drive: 0, app: 0, short: 0, putt: 0, shots: [] };
  off.forEach((s, i) => {
    const lie = i === 0 ? 'tee' : s.lie && s.lie !== 'green' && s.lie !== 'tee' ? s.lie : (i === 1 && h.fw && h.fw !== 'hit' ? 'rough' : 'fairway');
    const d0 = dTo(s), nx = off[i + 1];
    let e1;
    if (nx) { const nl = nx.lie && nx.lie !== 'green' && nx.lie !== 'tee' ? nx.lie : 'fairway'; e1 = sgExpected(dTo(nx), s.pen === 'ob' ? lie : nl); }
    else e1 = h.putts ? sgExpected(putt1, 'green') : 0;
    const v = sgExpected(d0, lie) - e1 - 1 - (s.pen ? 1 : 0);
    const cat = i === 0 && h.par > 3 ? 'drive' : d0 > zoneMetres() ? 'app' : 'short';
    out[cat] += v; out.shots.push({ club: s.club, v });
  });
  if (h.putts) { out.putt = sgExpected(putt1, 'green') - h.putts; out.shots.push({ club: 'Pt', v: out.putt / h.putts }); }
  return out;
}
function sgTotals(rounds) {
  const T = { drive: 0, app: 0, short: 0, putt: 0, holes: 0, played: 0 };
  for (const r of rounds) for (const h of playedHoles(r)) { T.played++; const x = sgHole(r, h); if (!x) continue; T.holes++; for (const k of ['drive', 'app', 'short', 'putt']) T[k] += x[k]; }
  return T;
}
function statSG(rs) {
  const T = sgTotals(rs), cats = [['drive', 'Driving', 'Tee shots on par 4s and 5s'], ['app', 'Approach', `Shots from outside ${zoneLabel()}`], ['short', 'Short game', `Inside ${zoneLabel()}, off the green`], ['putt', 'Putting', 'On the green']];
  const intro = `<div class="sub">Strokes gained shows how many shots each part of your game wins or loses against a tour-level player, per 18 holes. Everyone below tour level is negative; what matters is <b>which bar is longest</b> and whether it shrinks over time.</div>`;
  if (!T.holes) return `<div class="card"><h2>Strokes gained</h2>${intro}
    <div class="cstatus warn" style="margin-top:10px">No fully tracked holes yet. A hole counts when: you tap 📍 Mark before every shot (including one Putter mark on the green), the green is set on the map, and shots + penalties + putts add up to your score.</div></div>`;
  const per = k => (T[k] / T.holes) * 18, vals = cats.map(c => per(c[0])), total = sum(vals), worst = cats[vals.indexOf(Math.min(...vals))];
  const max = Math.max(2, ...vals.map(Math.abs));
  const tips = { drive: 'Keep the tee shot in play first. Distance second. Penalties off the tee cost the most.', app: 'Aim at the middle of the green and take enough club. Check your real club distances in Stats → Clubs.', short: 'Practise chips and pitches to a landing spot. Getting it on the green every time is the first goal.', putt: 'Work on pace from 8–12 m to stop 3-putts, and make practice putts from 1–2 m.' };
  return `<div class="card"><h2>Strokes gained <span class="sub">per 18 · estimate</span></h2>${intro}
    <div class="tiles" style="margin:10px 0"><div class="tile hero"><div><div class="k">Total vs tour level</div><div class="v">${(total > 0 ? '+' : '') + total.toFixed(1)}</div></div><div style="text-align:right"><div class="k">Holes counted</div><div class="v">${T.holes}<small style="font-size:13px;color:var(--muted)"> / ${T.played}</small></div></div></div></div>
    <div class="sgbars">${cats.map((c, i) => `<div><span><b>${c[1]}</b><small>${c[2]}</small></span><div class="sg-track"><i class="${vals[i] < 0 ? 'neg' : 'pos'}" style="width:${(Math.abs(vals[i]) / max) * 50}%"></i></div><em class="${vals[i] < 0 ? 'neg' : 'pos'}">${(vals[i] > 0 ? '+' : '') + vals[i].toFixed(1)}</em></div>`).join('')}</div></div>
  <div class="card"><h2>Practice priority</h2><div class="focus"><b>${worst[1]}: ${Math.min(...vals).toFixed(1)} shots per round</b><div class="sub">${tips[worst[0]]}</div></div>
    <div class="sub">This is where you lose the most shots. ${T.holes < 18 ? `Based on only ${T.holes} hole${T.holes > 1 ? 's' : ''}, so treat it as a first hint.` : ''}</div></div>`;
}
