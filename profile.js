'use strict';
/* Player profile with an on-device "tour headshot":
   face detection -> head-and-shoulders crop -> AI background removal -> studio grade -> transparent PNG.
   Uses Google MediaPipe (Apache-2.0), bundled in vendor/mediapipe and loaded only when you make a headshot.
   The photo never leaves the phone. The headshot is stored in IndexedDB (not localStorage, so it can't crowd out rounds). */

const PF = { busy: null, img: null, url: null, vision: null, err: null };
const HS_W = 720, HS_H = 900; // 4:5 portrait

/* ---------- tiny IndexedDB key/value store ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('golf-stats', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) { const db = await idb(); return new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
async function kvSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }

async function loadHeadshot() {
  try { const blob = await kvGet('headshot'); if (blob) { if (PF.url) URL.revokeObjectURL(PF.url); PF.url = URL.createObjectURL(blob); } } catch (e) {}
  PF.loaded = true; if (S.view === 'profile' || S.view === 'home') render();
}

/* ---------- MediaPipe ---------- */
async function vision() {
  if (PF.vision) return PF.vision;
  const mp = await import('./vendor/mediapipe/vision_bundle.mjs');
  const files = await mp.FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', location.href).href);
  const base = new URL('vendor/mediapipe/', location.href).href;
  const face = await mp.FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: base + 'blaze_face_short_range.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.4 });
  const seg = await mp.ImageSegmenter.createFromOptions(files, { baseOptions: { modelAssetPath: base + 'selfie_multiclass_256x256.tflite', delegate: 'CPU' }, runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true });
  return (PF.vision = { face, seg });
}

function step(msg) { PF.busy = msg; const el = $('#pfBusy'); if (el) el.textContent = msg; }

async function makeHeadshot(file) {
  PF.err = null; step('Loading photo…'); render();
  try {
    // 1) load + downscale (keeps phone memory sane)
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const src = document.createElement('canvas'); src.width = Math.round(bmp.width * k); src.height = Math.round(bmp.height * k);
    src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);

    step('Loading the AI (first time only)…');
    const V = await vision();

    // 2) find the face (largest one)
    step('Finding your face…');
    const det = V.face.detect(src).detections || [];
    const box = det.map(d => d.boundingBox).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    let fx, fy, fw, fh;
    if (box) ({ originX: fx, originY: fy, width: fw, height: fh } = box);
    else { fw = src.width * 0.35; fh = fw * 1.2; fx = (src.width - fw) / 2; fy = src.height * 0.15; toast('No face found, using the centre of the photo'); }

    // 3) head-and-shoulders framing, 4:5 — head in the upper third, cut just below the shoulders
    const cw = fw * 2.45, ch = cw * HS_H / HS_W;
    const cx = fx + fw / 2 - cw / 2, cy = fy - fh * 0.62;
    const crop = document.createElement('canvas'); crop.width = HS_W; crop.height = HS_H;
    const cc = crop.getContext('2d');
    cc.drawImage(src, cx, cy, cw, ch, 0, 0, HS_W, HS_H);

    // 4) background removal on the crop
    step('Removing the background…');
    const res = V.seg.segment(crop);
    const bg = res.confidenceMasks[0].getAsFloat32Array(); // class 0 = background
    const mw = res.confidenceMasks[0].width, mh = res.confidenceMasks[0].height;
    const mask = document.createElement('canvas'); mask.width = mw; mask.height = mh;
    const md = mask.getContext('2d').createImageData(mw, mh);
    // outside the original photo there is nothing to keep
    const inside = (x, y) => { const sx = cx + (x / mw) * cw, sy = cy + (y / mh) * ch; return sx >= 0 && sy >= 0 && sx < src.width && sy < src.height; };
    for (let i = 0, y = 0; y < mh; y++) for (let x = 0; x < mw; x++, i++) {
      let a = 1 - bg[i];
      a = a <= 0.45 ? 0 : a >= 0.75 ? 1 : (a - 0.45) / 0.3; // tighten the edge (trims background colour fringing)
      if (!inside(x, y)) a = 0;
      md.data[i * 4 + 3] = Math.round(a * 255);
    }
    mask.getContext('2d').putImageData(md, 0, 0);
    res.close && res.close();

    // 5) studio look: gentle contrast / colour / clarity, then apply the soft-edged mask
    step('Studio lighting…');
    const out = document.createElement('canvas'); out.width = HS_W; out.height = HS_H;
    const o = out.getContext('2d');
    o.filter = 'contrast(1.08) saturate(1.1) brightness(1.04)';
    o.drawImage(crop, 0, 0);
    o.filter = 'none';
    // soft key light from the upper left
    const g = o.createRadialGradient(HS_W * 0.32, HS_H * 0.22, 20, HS_W * 0.32, HS_H * 0.22, HS_W * 0.9);
    g.addColorStop(0, 'rgba(255,248,235,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.06)');
    o.globalCompositeOperation = 'soft-light'; o.fillStyle = g; o.fillRect(0, 0, HS_W, HS_H);
    o.globalCompositeOperation = 'destination-in';
    o.filter = 'blur(1.2px)';
    o.drawImage(mask, 0, 0, HS_W, HS_H);
    o.filter = 'none'; o.globalCompositeOperation = 'source-over';

    step('Saving…');
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    await kvSet('headshot', blob);
    if (PF.url) URL.revokeObjectURL(PF.url);
    PF.url = URL.createObjectURL(blob);
    PF.busy = null; toast('Headshot ready ✓');
  } catch (e) {
    PF.busy = null; PF.err = 'Couldn\'t make the headshot: ' + (e && e.message ? e.message : e) + '. Try another photo with good light, facing the camera.';
  }
  render();
}

/* ---------- views ---------- */
function profileStats() {
  const full = S.rounds.filter(r => r.completed && r.holes.length === 18 && playedHoles(r).length === 18);
  const scores = full.map(r => sum(playedHoles(r).map(h => h.score)));
  const H = handicapIndex(), A = aggregate(full.slice(-20));
  return { H, best: scores.length ? Math.min(...scores) : null, avg: scores.length ? sum(scores) / scores.length : null, rounds: S.rounds.filter(r => r.completed).length, A };
}
function headshotImg(cls = '') {
  const bgc = S.settings.hsBg || 'green';
  return PF.url ? `<div class="hs ${cls} bg-${bgc}"><img src="${PF.url}" alt="Player headshot"></div>`
    : `<div class="hs ${cls} bg-${bgc} empty-hs"><svg viewBox="0 0 64 80" aria-hidden="true"><circle cx="32" cy="26" r="13"/><path d="M6 80c2-18 13-28 26-28s24 10 26 28z"/></svg></div>`;
}
function viewProfile() {
  setTitle('Player profile', `<button class="tbtn" data-act="goHome">Done</button>`);
  if (!PF.loaded) loadHeadshot();
  const P = S.settings.profile || {}, st = profileStats();
  return `
  <div class="pf-card">
    ${headshotImg('big')}
    <div class="pf-name">${esc(P.name || 'Your name')}</div>
    <div class="pf-club">${esc(P.club || 'Home club')}</div>
    <div class="pf-stats">
      <div><b>${st.H.index != null ? st.H.index.toFixed(1) : '–'}</b><span>Handicap</span></div>
      <div><b>${st.best ?? '–'}</b><span>Best</span></div>
      <div><b>${st.avg ? fmt1(st.avg) : '–'}</b><span>Average</span></div>
      <div><b>${fmtPct(st.A.sz, st.A.szN)}</b><span>SZIR</span></div>
    </div>
  </div>
  ${PF.busy ? `<div class="card"><div class="hr-msg"><span class="spin"></span> <span id="pfBusy">${esc(PF.busy)}</span></div></div>` : ''}
  ${PF.err ? `<div class="card"><div class="cstatus warn">${esc(PF.err)}</div></div>` : ''}
  <div class="card stack">
    <h2>Tour headshot</h2>
    <div class="sub">Take or pick a photo facing the camera, in good light. The app crops it to head and shoulders, removes the background (transparent) and gives it a studio look. All on your phone. The photo never leaves it.</div>
    <label class="btn primary block pf-pick">📷 ${PF.url ? 'New headshot' : 'Make my headshot'}<input type="file" accept="image/*" data-bind="headshot" hidden ${PF.busy ? 'disabled' : ''}></label>
    ${PF.url ? `<div><div class="field-title"><span>Background on your profile</span><span class="muted">the saved file stays transparent</span></div>
      ${seg('hsBg', [['green', 'Green'], ['blue', 'Blue'], ['dark', 'Dark'], ['none', 'None']], S.settings.hsBg || 'green')}</div>
      <div class="grid2"><button class="btn" data-act="hsSave">⬇️ Save PNG</button><button class="btn danger" data-act="hsDelete">Remove</button></div>` : ''}
  </div>
  <div class="card stack">
    <h2>Details</h2>
    <div><label class="f" for="pfName">Name</label><input id="pfName" type="text" data-bind="pfName" value="${esc(P.name || '')}" placeholder="e.g. Jaydon"></div>
    <div><label class="f" for="pfClub">Home club</label><input id="pfClub" type="text" data-bind="pfClub" value="${esc(P.club || '')}" placeholder="e.g. Parow Golf Course"></div>
  </div>`;
}
function homeProfileCard() {
  if (!PF.loaded) loadHeadshot();
  const P = S.settings.profile || {}, H = handicapIndex();
  return `<button class="hp-card" data-act="goProfile">${headshotImg('small')}<span class="hp-t"><b>${esc(P.name || 'Set up your player profile')}</b><small>${P.name ? `${esc(P.club || '')}${H.index != null ? `${P.club ? ' · ' : ''}HCP ${H.index.toFixed(1)}` : ''}` : 'Add your name and a tour-style headshot'}</small></span><span class="hp-chev">›</span></button>`;
}

Object.assign(ACTIONS, {
  goProfile() { S.view = 'profile'; window.scrollTo(0, 0); },
  hsBg(v) { S.settings.hsBg = v; },
  async hsSave() {
    const blob = await kvGet('headshot'); if (!blob) return;
    const name = ((S.settings.profile || {}).name || 'player').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const f = new File([blob], `${name}-headshot.png`, { type: 'image/png' });
    try { if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f] }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    download(f.name, blob, 'image/png');
  },
  async hsDelete() { if (!confirm('Remove your headshot?')) return; await kvSet('headshot', null); if (PF.url) URL.revokeObjectURL(PF.url); PF.url = null; render(); },
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-bind="headshot"]'); if (!el || !el.files || !el.files[0]) return;
  const f = el.files[0]; el.value = ''; makeHeadshot(f);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-bind="pfName"],[data-bind="pfClub"]'); if (!el) return;
  S.settings.profile = Object.assign({}, S.settings.profile, { [el.dataset.bind === 'pfName' ? 'name' : 'club']: el.value }); persist();
});
