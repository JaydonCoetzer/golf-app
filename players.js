'use strict';
/* Other players on your scorecard (kept on this phone only) and game formats:
   stroke play, Stableford, match play and skins. Net scores use each player's handicap and the hole's stroke index. */

const FORMATS = [['stroke', 'Stroke play', 'Total of all shots'], ['stableford', 'Stableford', 'Points per hole from net score'], ['match', 'Match play', 'Most holes won (net)'], ['skins', 'Skins', 'Lowest net wins the hole; ties carry over']];
const FORMAT_NAME = Object.fromEntries(FORMATS.map(f => [f[0], f[1]]));
function setup() { return (S.setup = S.setup || { players: [], format: 'stroke' }); }
function myName() { return ((S.settings.profile || {}).name || 'Me').split(' ')[0]; }

function playersSetup() {
  const su = setup(), friends = S.settings.friends || [];
  return `<div>
    <div class="field-title"><span>Who's playing?</span><span class="muted">scores stay on this phone</span></div>
    <div class="chips"><button class="on" disabled>${esc(myName())}</button>
      ${friends.map((f, i) => `<button data-act="togglePlayer" data-v="${i}" class="${su.players.includes(f.id) ? 'on' : ''}">${esc(f.name)}${f.hcp !== '' && f.hcp != null ? ` (${f.hcp})` : ''}</button>`).join('')}</div>
    <div class="np-row"><input id="npName" type="text" placeholder="New player name" autocomplete="off"><input id="npHcp" type="number" inputmode="decimal" placeholder="Hcp"><button class="btn sm" data-act="addPlayer">Add</button></div>
    ${friends.length ? `<details class="help" style="margin-top:4px"><summary class="sub">Remove a saved player</summary><div class="chips" style="margin-top:6px">${friends.map((f, i) => `<button data-act="delFriend" data-v="${i}">✕ ${esc(f.name)}</button>`).join('')}</div></details>` : ''}
  </div>
  <div>
    <div class="field-title"><span>Game format</span></div>
    <div class="chips">${FORMATS.map(([k, l]) => `<button data-act="setFormat" data-v="${k}" class="${su.format === k ? 'on' : ''}" ${(k === 'match' || k === 'skins') && !su.players.length ? 'disabled style="opacity:.4"' : ''}>${l}</button>`).join('')}</div>
    <div class="sub" style="margin-top:4px">${FORMATS.find(f => f[0] === su.format)[2]}.${(su.format !== 'stroke') ? ' Enter handicaps for net scoring.' : ''}</div>
  </div>`;
}

/* ---------- scoring helpers ---------- */
function allPlayers(r) { return [{ id: 'me', name: myName(), hcp: r.hcp }, ...(r.players || [])]; }
function pScore(h, pid) { return pid === 'me' ? (h.done && h.score != null ? h.score : null) : ((h.others || {})[pid] || {}).score ?? null; }
function pNet(h, pl) { const s = pScore(h, pl.id); return s == null ? null : s - shotsGiven(pl.hcp, h.si); }
function pPoints(h, pl) { const s = pScore(h, pl.id); return s == null ? null : Math.max(0, 2 + h.par + shotsGiven(pl.hcp, h.si) - s); }
function gameState(r) {
  const ps = allPlayers(r), fmt = r.format || 'stroke';
  const rows = ps.map(pl => {
    const hs = r.holes.filter(h => pScore(h, pl.id) != null);
    return { pl, thru: hs.length, gross: sum(hs.map(h => pScore(h, pl.id))), net: sum(hs.map(h => pNet(h, pl))), par: sum(hs.map(h => h.par)), pts: sum(hs.map(h => pPoints(h, pl))), won: 0, skins: 0 };
  });
  let note = '';
  if (fmt === 'match' && ps.length >= 2) {
    // each opponent against you
    for (const row of rows.slice(1)) {
      let d = 0, n = 0;
      for (const h of r.holes) { const a = pNet(h, ps[0]), b = pNet(h, row.pl); if (a == null || b == null) continue; n++; if (a < b) d++; else if (b < a) d--; }
      row.match = n ? (d === 0 ? 'All square' : d > 0 ? `${esc(myName())} ${d} up` : `${esc(row.pl.name)} ${-d} up`) + ` thru ${n}` : 'Not started';
    }
  }
  if (fmt === 'skins' && ps.length >= 2) {
    let carry = 0;
    for (const h of r.holes) {
      const nets = ps.map(pl => pNet(h, pl)); if (nets.some(x => x == null)) continue;
      const lo = Math.min(...nets), winners = nets.filter(x => x === lo).length;
      if (winners === 1) { rows[nets.indexOf(lo)].skins += 1 + carry; carry = 0; } else carry++;
    }
    if (carry) note = `${carry} skin${carry > 1 ? 's' : ''} carried over`;
  }
  const key = fmt === 'stableford' ? (a, b) => b.pts - a.pts : fmt === 'skins' ? (a, b) => b.skins - a.skins : (a, b) => (a.thru ? a.net - a.par : 99) - (b.thru ? b.net - b.par : 99);
  return { fmt, rows, order: [...rows].sort(key), note };
}
function gameCard(r) {
  if (!(r.players || []).length && (r.format || 'stroke') === 'stroke') return '';
  const G = gameState(r);
  return `<div class="card"><h2>${FORMAT_NAME[G.fmt]} <span class="sub">${G.rows.length} player${G.rows.length > 1 ? 's' : ''}</span></h2>
    <table class="tbl"><thead><tr><th>Player</th><th>Thru</th><th>Gross</th><th>Net</th>${G.fmt === 'stableford' ? '<th>Pts</th>' : ''}${G.fmt === 'skins' ? '<th>Skins</th>' : ''}</tr></thead><tbody>
    ${G.order.map((x, i) => `<tr><td><b>${i === 0 && x.thru && G.fmt !== 'match' ? '🏆 ' : ''}${esc(x.pl.name)}</b>${x.pl.hcp != null && x.pl.hcp !== '' ? ` <span class="muted">(${x.pl.hcp})</span>` : ''}</td><td>${x.thru}</td><td>${x.thru ? `${x.gross} (${toPar(x.gross - x.par)})` : '–'}</td><td>${x.thru ? x.net : '–'}</td>${G.fmt === 'stableford' ? `<td><b>${x.pts}</b></td>` : ''}${G.fmt === 'skins' ? `<td><b>${x.skins}</b></td>` : ''}</tr>`).join('')}
    </tbody></table>
    ${G.fmt === 'match' ? G.rows.slice(1).map(x => `<div class="focus good" style="margin-top:8px"><b>vs ${esc(x.pl.name)}: ${x.match}</b></div>`).join('') : ''}
    ${G.note ? `<div class="sub" style="margin-top:6px">${G.note}</div>` : ''}</div>`;
}
function gameLine(r) {
  if (!(r.players || []).length) return '';
  const G = gameState(r);
  if (G.fmt === 'match') return G.rows.slice(1).map(x => x.match).join(' · ');
  if (G.fmt === 'skins') return 'Skins: ' + G.rows.map(x => `${esc(x.pl.name)} ${x.skins}`).join(', ');
  if (G.fmt === 'stableford') return G.order.map(x => `${esc(x.pl.name)} ${x.pts} pts`).join(' · ');
  return G.order.filter(x => x.thru).map(x => `${esc(x.pl.name)} ${toPar(x.gross - x.par)}`).join(' · ');
}

Object.assign(ACTIONS, {
  togglePlayer(v) { const su = setup(), f = (S.settings.friends || [])[Number(v)]; if (!f) return; const i = su.players.indexOf(f.id); if (i >= 0) su.players.splice(i, 1); else if (su.players.length < 5) su.players.push(f.id); else toast('Up to 5 extra players'); if (!su.players.length && (su.format === 'match' || su.format === 'skins')) su.format = 'stroke'; },
  addPlayer() {
    const name = ($('#npName').value || '').trim(), hcp = $('#npHcp').value; if (!name) { toast('Type a name first'); return; }
    S.settings.friends = S.settings.friends || [];
    const f = { id: 'p' + uid(), name, hcp: hcp === '' ? '' : Number(hcp) }; S.settings.friends.push(f);
    const su = setup(); if (su.players.length < 5) su.players.push(f.id);
  },
  delFriend(v) { const f = S.settings.friends.splice(Number(v), 1)[0]; const su = setup(); su.players = su.players.filter(id => id !== f.id); },
  setFormat(v) { setup().format = v; },
  who(v) { M.who = v || null; },
  oScore(v) { const h = curHole(); h.others = h.others || {}; const o = (h.others[M.who] = h.others[M.who] || {}); o.score = o.score === Number(v) ? null : Number(v); },
  oScoreUp() { const h = curHole(); h.others = h.others || {}; const o = (h.others[M.who] = h.others[M.who] || {}); o.score = (o.score ?? h.par) + 1; },
  oPutts(v) { const h = curHole(); h.others = h.others || {}; const o = (h.others[M.who] = h.others[M.who] || {}); o.putts = o.putts === Number(v) ? null : Number(v); },
});
