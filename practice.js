'use strict';
/* Practice: drills picked from your weakest area (strokes gained if you have fully tracked holes,
   otherwise your focus-area gaps), with quick score logging and a history per drill.
   Stored on this phone under gs.practice and included in backups. */

S.practice = load('gs.practice', []);
const savePractice = () => save('gs.practice', S.practice);

const DRILLS = [
  { id: 'lag', area: 'putt', name: 'Lag ladder', max: 10, how: 'Putt 10 balls from 8–12 m. Score 1 for every putt that finishes within 1 m of the hole (a putter-length).' },
  { id: 'circle', area: 'putt', name: 'Short-putt circle', max: 10, how: 'Put 10 balls in a circle 1–1.5 m around the hole. Count how many you hole.' },
  { id: 'updown', area: 'short', name: 'Up & down challenge', max: 9, how: 'Drop 9 balls around the green: 3 easy, 3 medium, 3 hard lies. Count the ones you get up and down (chip + 1 putt).' },
  { id: 'land', area: 'short', name: 'Landing-spot chips', max: 10, how: 'Pick a spot on the green 2 m on. Chip 10 balls; score 1 each time the ball lands within a towel\'s width of it.' },
  { id: 'bunker', area: 'short', name: 'Bunker escape', max: 10, how: 'Hit 10 greenside bunker shots. Score 1 for every ball that finishes on the green.' },
  { id: 'ladder', area: 'app', name: 'Wedge distance ladder', max: 9, how: 'Hit 3 balls each to 50, 70 and 90 m (use your part swings). Score 1 for every ball within 5 m of the target distance.' },
  { id: 'green', area: 'app', name: 'Middle of the green', max: 10, how: 'Pick a flag 120–150 m away. Hit 10 balls aiming at the middle; count the ones that would finish on a 25 m wide green.' },
  { id: 'funnel', area: 'drive', name: 'Fairway funnel', max: 10, how: 'Pick two targets about 30 m apart as fairway edges. Hit 10 drives; count the ones that finish between them.' },
  { id: 'tee3', area: 'drive', name: 'Safe-club tee shots', max: 10, how: 'Alternate driver and your safest tee club (3W / hybrid) into the same 30 m fairway. Count fairways; it shows which club to trust.' },
];
const AREA = { drive: 'Off the tee', app: 'Approach', short: 'Short game', putt: 'Putting' };

function practiceFocus() {
  const rs = rangeRounds();
  if (!rs.length) return null;
  if (typeof sgTotals === 'function') {
    const T = sgTotals(rs);
    if (T.holes >= 9) {
      const v = { drive: T.drive, app: T.app, short: T.short, putt: T.putt }, k = Object.keys(v).sort((a, b) => v[a] - v[b])[0];
      return { area: k, why: `Strokes gained says ${AREA[k].toLowerCase()} costs you the most (${(v[k] / T.holes * 18).toFixed(1)} per round).` };
    }
  }
  const A = aggregate(rs), B = benchFor(S.settings.target), gap = [];
  const per18 = (a, n) => (n ? (a / n) * 18 : null);
  const add = (area, you, target, higher, label) => { if (you == null) return; gap.push({ area, g: higher ? (target - you) / target : (you - target) / Math.max(target, 0.5), label }); };
  add('drive', pct(A.fir, A.firN), B.fir, true, 'fairways hit');
  add('drive', per18(A.ob + A.water + A.pen, A.holes), B.pen, false, 'penalties');
  add('app', pct(A.gir, A.girN), B.gir, true, 'greens in regulation');
  add('short', pct(A.ud, A.udN), B.ud, true, 'up & downs');
  add('putt', per18(A.threePutt, A.puttsN), B.three, false, '3-putts');
  add('putt', A.puttsN ? (A.putts / A.puttsN) * 18 : null, B.putts, false, 'putts per round');
  if (!gap.length) return null;
  const w = gap.sort((a, b) => b.g - a.g)[0];
  return { area: w.area, why: `Your ${w.label} are furthest from a ${S.settings.target}-handicap golfer's.` };
}

function drillHistory(id) { return S.practice.filter(x => x.drill === id).sort((a, b) => a.at - b.at); }
function drillCard(d, open) {
  const hist = drillHistory(d.id), last = hist.slice(-6), best = hist.length ? Math.max(...hist.map(h => h.score)) : null;
  const avg = hist.length ? sum(hist.slice(-5).map(h => h.score)) / Math.min(5, hist.length) : null;
  const val = S.prLog === d.id ? S.prVal : null;
  return `<div class="card dr-card">
    <button class="dr-head" data-act="prOpen" data-v="${d.id}"><span><b>${esc(d.name)}</b><small>${AREA[d.area]}${hist.length ? ` · best ${best}/${d.max} · avg ${avg.toFixed(1)}` : ' · not tried yet'}</small></span><i>${open ? '⌃' : '⌄'}</i></button>
    ${last.length ? `<div class="dr-spark">${last.map(h => `<i style="height:${Math.max(8, (h.score / d.max) * 100)}%" title="${h.score}/${d.max}"></i>`).join('')}</div>` : ''}
    ${open ? `<div class="sub" style="margin:8px 0">${esc(d.how)}</div>
      ${val != null ? `<div class="hs-step"><button data-act="prStep" data-v="-1">−</button><div><b>${val} / ${d.max}</b><small>your score</small></div><button data-act="prStep" data-v="1">+</button></div>
        <div class="grid2" style="margin-top:8px"><button class="btn" data-act="prCancel">Cancel</button><button class="btn primary" data-act="prSave">Save</button></div>`
      : `<button class="btn primary block" data-act="prLog" data-v="${d.id}">Log a session</button>`}
      ${hist.length ? `<div class="sub" style="margin-top:8px">${hist.slice(-5).reverse().map(h => `${new Date(h.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: <b>${h.score}/${d.max}</b>`).join(' · ')}</div>` : ''}` : ''}
  </div>`;
}
function viewPractice() {
  setTitle('Practice');
  const F = practiceFocus(), order = F ? [...DRILLS.filter(d => d.area === F.area), ...DRILLS.filter(d => d.area !== F.area)] : DRILLS;
  const week = S.practice.filter(x => Date.now() - x.at < 7 * 864e5).length;
  return `${F ? `<div class="card pr-focus"><div class="k">Work on this first</div><b>${AREA[F.area]}</b><div class="sub">${esc(F.why)} Start with the drills below.</div></div>`
    : '<div class="card"><b>Practice drills</b><div class="sub">Play a few rounds and the app will put the drills for your weakest area first.</div></div>'}
    <div class="row between" style="margin:2px 2px 10px"><div class="h-title" style="margin:0">Drills</div><span class="sub">${week} session${week === 1 ? '' : 's'} this week</span></div>
    ${order.map(d => drillCard(d, S.prOpen === d.id)).join('')}`;
}
Object.assign(ACTIONS, {
  prOpen(v) { S.prOpen = S.prOpen === v ? null : v; S.prLog = null; },
  prLog(v) { const d = DRILLS.find(x => x.id === v), h = drillHistory(v); S.prLog = v; S.prVal = h.length ? h[h.length - 1].score : Math.round(d.max / 2); },
  prStep(v) { const d = DRILLS.find(x => x.id === S.prLog); S.prVal = Math.max(0, Math.min(d.max, S.prVal + Number(v))); },
  prCancel() { S.prLog = null; },
  prSave() { S.practice.push({ id: uid(), drill: S.prLog, score: S.prVal, at: Date.now() }); savePractice(); S.prLog = null; toast('Session saved'); },
});
