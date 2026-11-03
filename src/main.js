// Frontline Conquest - UI, input and main loop
import { Game, W, N, TPS, BUILDINGS, NUKES, DIFFS, getMap } from './sim.js';
import { Renderer, fmt } from './render.js';

const $ = id => document.getElementById(id);
const cv = $('cv');
const R = new Renderer(cv);
let G = null, pct = 25, mode = null, speed = 1, paused = false, acc = 0, last = 0, watching = false;
let lastHud = 0, lastLb = 0;
const attackedToast = new Map();
let lastElimToast = 0;

// ---------- start screen ----------
const opts = { difficulty: 'standard', nations: 87, tribes: 400 };
function seg(id, key, num) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $(id).children) x.classList.toggle('on', x === b);
    opts[key] = num ? +b.dataset.v : b.dataset.v;
  });
}
seg('segDiff', 'difficulty'); seg('segNations', 'nations', true); seg('segTribes', 'tribes', true);
$('inName').value = localStorage.getItem('fc_name') || '';
$('btnPlay').onclick = () => {
  const name = ($('inName').value.trim() || 'Player').slice(0, 18);
  localStorage.setItem('fc_name', name);
  $('start').classList.add('hidden'); $('loading').classList.remove('hidden');
  setTimeout(() => newGame(name), 30);
};
function newGame(name) {
  getMap();
  G = new Game({ ...opts, playerName: name });
  R.setGame(G); R.fit();
  $('loading').classList.add('hidden'); $('end').classList.add('hidden'); $('hud').classList.remove('hidden');
  mode = null; setMode(null); paused = false; watching = false; speed = 1; $('btnSpeed').textContent = '⏩ 1x';
  $('toasts').innerHTML = ''; attackedToast.clear(); lastElimToast = 0;
  closePanel();
  setBanner('👆 Tap unclaimed land to place your capital');
  updateHud(true);
}
$('btnAgain').onclick = () => { $('end').classList.add('hidden'); $('hud').classList.add('hidden'); $('start').classList.remove('hidden'); G = null; };
$('btnWatch').onclick = () => { $('end').classList.add('hidden'); watching = true; G.spectate = true; };

// ---------- HUD ----------
function setBanner(t) { $('banner').textContent = t || ''; }
for (const b of document.querySelectorAll('.pct')) {
  b.classList.toggle('on', +b.dataset.p === pct);
  b.onclick = () => { pct = +b.dataset.p; for (const x of document.querySelectorAll('.pct')) x.classList.toggle('on', x === b); };
}
$('lbHead').onclick = () => $('lb').classList.toggle('collapsed');
if (window.innerWidth < 560) $('lb').classList.add('collapsed');
$('btnSpeed').onclick = () => { speed = speed === 1 ? 2 : speed === 2 ? 3 : 1; $('btnSpeed').textContent = '⏩ ' + speed + 'x'; };
$('btnHome').onclick = () => { if (!G) return; const H = G.human; const t = G.owner[H.capital] === H.id ? H.capital : H.border[0]; if (t !== undefined && t >= 0) { R.centerOn(t, Math.max(R.cam.z, 3)); R.ping(t); } };
$('btnBuild').onclick = () => openBuild(-1);
$('btnNuke').onclick = openNuke;
$('btnMenu').onclick = openMenu;
$('modeCancel').onclick = () => setMode(null);

function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function updateHud(force) {
  if (!G) return;
  const H = G.human, cap = G.cap(H);
  $('sTroops').textContent = fmt(H.troops); $('sCap').textContent = '/' + fmt(cap);
  $('sGold').textContent = fmt(H.gold); $('sGoldRate').textContent = '+' + fmt(G.goldRate(H)) + '/s';
  const lp = G.landPct(H); $('sLand').textContent = lp.toFixed(lp < 10 ? 2 : 1) + '%';
  $('goalFill').style.width = Math.min(100, lp) + '%';
  if (G.phase === 'play') {
    const left = (G.protectUntil - G.tick) / TPS;
    setBanner(left > 0 ? `🛡️ Spawn protection: ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '');
  }
  // attacks
  const chips = G.attacks.filter(a => !a.done && a.att === H.id).slice(0, 6).map(a => {
    const t = a.tgt ? G.players[a.tgt] : null;
    return `<div class="chip" style="border-color:${t ? rgb(t.color) : '#8a8'}">⚔ ${t ? esc(t.name) : 'Wilderness'} · ${fmt(a.troops)}</div>`;
  });
  const ships = G.ships.filter(s => !s.done && s.owner === H.id).length;
  if (ships) chips.push(`<div class="chip">⛵ ${ships} boat${ships > 1 ? 's' : ''} at sea</div>`);
  $('attacks').innerHTML = chips.join('');
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function updateLb() {
  const H = G.human, lb = G.leaderboard(8);
  let html = lb.map((p, i) => `<li class="${p === H ? 'me' : ''}"><span class="rk">${i + 1}</span><span class="sw" style="background:${rgb(p.color)}"></span><span class="nm">${esc(p.name)}</span><span class="pc">${G.landPct(p).toFixed(1)}%</span></li>`).join('');
  if (!lb.includes(H) && H.alive && H.spawned) {
    const rank = G.players.filter(p => p && p.alive && p.tiles > H.tiles).length + 1;
    html += `<li class="me"><span class="rk">${rank}</span><span class="sw" style="background:${rgb(H.color)}"></span><span class="nm">${esc(H.name)}</span><span class="pc">${G.landPct(H).toFixed(1)}%</span></li>`;
  }
  const alive = G.players.filter(p => p && p.alive && p.type === 'nation').length;
  html += `<li style="opacity:.6;justify-content:center">${alive} nations left</li>`;
  $('lbList').innerHTML = html;
}

// ---------- toasts ----------
function toast(html, cls = '', ms = 3200, buttons) {
  const el = document.createElement('div'); el.className = 'toast ' + cls; el.innerHTML = html;
  if (buttons) {
    const row = document.createElement('div'); row.className = 'row';
    for (const [label, fn, c] of buttons) { const b = document.createElement('button'); b.textContent = label; if (c) b.className = c; b.onclick = () => { fn(); el.remove(); }; row.appendChild(b); }
    el.appendChild(row);
  }
  const box = $('toasts'); box.prepend(el);
  while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => el.remove(), ms);
}
function handleEvents() {
  const H = G.human;
  for (const e of G.events) {
    const p = e.id ? G.players[e.id] : null;
    const nm = p ? `<b style="color:${rgb(p.color)}">${esc(p.name)}</b>` : '';
    switch (e.type) {
      case 'attacked': {
        const lt = attackedToast.get(e.id) || -1e9;
        if (G.tick - lt > 200) { attackedToast.set(e.id, G.tick); toast(`⚔️ ${nm} is attacking you!`, 'bad'); }
        break;
      }
      case 'boat': toast(`⛵ ${nm} launched a naval invasion at you!`, 'bad'); break;
      case 'nuke': toast(`☢️ ${nm} launched a nuke at you!`, 'bad', 5000); break;
      case 'allyRequest':
        if (!p.alive) break;
        toast(`🤝 ${nm} proposes an alliance (5 min).`, 'warn', 15000, [['Accept', () => { if (p.alive) { G.makeAlliance(H.id, p.id); toast(`🤝 Allied with ${nm}.`, 'good'); } }], ['Decline', () => { }, 'no']]);
        break;
      case 'allyExpired': toast(`Alliance with ${nm} has expired.`, 'warn'); break;
      case 'allyBroken': toast(`💔 Alliance with ${nm} is over.`, 'bad'); break;
      case 'eliminated': if (p && p.type === 'nation' && H.alive && G.tick - lastElimToast > 150) { lastElimToast = G.tick; toast(`☠️ ${nm} has been wiped out.`, '', 2500); } break;
      case 'won': showEnd(true); break;
      case 'lost': showEnd(false); break;
    }
  }
  G.events.length = 0;
}
function showEnd(won) {
  const H = G.human, mins = Math.floor(G.tick / TPS / 60);
  $('endTitle').textContent = won ? '🏆 Victory!' : '💀 Defeated';
  $('endText').innerHTML = won
    ? `${esc(H.name)} controls ${G.landPct(H).toFixed(1)}% of the world after ${mins} minutes. The world is yours.`
    : `Your nation fell after ${mins} minutes. Leader: <b>${esc(G.leaderboard(1)[0]?.name || '?')}</b>.`;
  $('btnWatch').classList.toggle('hidden', won);
  $('end').classList.remove('hidden');
}

// ---------- panels ----------
function openPanel(title, html) { $('panelTitle').innerHTML = title; $('panelBody').innerHTML = html; $('panel').classList.remove('hidden'); }
function closePanel() { $('panel').classList.add('hidden'); }
$('panel').addEventListener('click', e => { if (e.target.closest('[data-close]')) closePanel(); });
function setMode(m) {
  mode = m;
  $('modeBar').classList.toggle('hidden', !m);
  if (m) $('modeTxt').textContent = m.kind === 'build' ? `Tap your land to place a ${BUILDINGS[m.type].name}` : `Tap a target for your ${NUKES[m.type].name}`;
}
function openBuild(tile) {
  if (!G || G.phase !== 'play') return;
  const H = G.human;
  const cards = Object.entries(BUILDINGS).map(([k, b]) => {
    const cost = G.buildCost(H, k);
    let dis = H.gold < cost;
    if (tile >= 0 && k === 'port' && !G.M.coastal[tile]) dis = true;
    return `<button class="bcard" data-b="${k}" ${dis ? 'disabled' : ''}><b><span class="bico">${b.icon}</span>${b.name}</b><small>${b.desc}</small><span class="cost">💰 ${fmt(cost)}</span><small>You own: ${H.count[k]}</small></button>`;
  }).join('');
  openPanel(tile >= 0 ? '🏗️ Build here' : '🏗️ Build', `<div class="grid">${cards}</div><p style="font-size:12px;opacity:.7;margin:10px 0 0">Gold: 💰 ${fmt(H.gold)} · Tip: tap your own land to build right there.</p>`);
  for (const b of $('panelBody').querySelectorAll('.bcard')) b.onclick = () => {
    const type = b.dataset.b;
    if (tile >= 0) { const err = G.build(H, type, tile); closePanel(); if (err) toast(err, 'bad'); else { toast(`Built a ${BUILDINGS[type].name}.`, 'good', 1800); R.ping(tile, '#ffd34d'); } }
    else { closePanel(); setMode({ kind: 'build', type }); }
  };
}
function openNuke() {
  if (!G || G.phase !== 'play') return;
  const H = G.human;
  const rows = Object.entries(NUKES).map(([k, n]) => `<button class="bcard" data-n="${k}" ${H.gold < n.cost || !H.count.silo ? 'disabled' : ''}><b>☢️ ${n.name}</b><small>Blast radius ${n.radius} tiles. Kills troops & buildings, leaves fallout.</small><span class="cost">💰 ${fmt(n.cost)}</span></button>`).join('');
  openPanel('☢️ Nukes', `${H.count.silo ? '' : '<p style="color:#ff9a8a;margin:0 0 8px">Build a Missile Silo first.</p>'}<div class="grid">${rows}</div><p style="font-size:12px;opacity:.7;margin:10px 0 0">Enemy SAM sites can shoot nukes down. Nuking an ally ends the alliance.</p>`);
  for (const b of $('panelBody').querySelectorAll('.bcard')) b.onclick = () => { closePanel(); setMode({ kind: 'nuke', type: b.dataset.n }); };
}
function openInfo(t) {
  if (!G || t < 0) return;
  const H = G.human;
  if (!G.M.land[t]) { openPanel('🌊 Ocean', '<div class="info"><p>Open water. With a Port, tap land across the sea to send a boat invasion.</p></div>'); return; }
  const o = G.owner[t];
  if (!o) { openPanel(G.fallout[t] ? '☢️ Fallout' : '🌲 Unclaimed land', `<div class="info"><p>${G.fallout[t] ? 'Radioactive wasteland. Slow and costly to reclaim.' : 'Nobody owns this yet. Tap it to expand.'}</p><p>Terrain: ${['Plains', 'Hills', 'Mountains'][G.M.terr[t]]}</p></div>`); return; }
  const p = G.players[o];
  const bl = G.buildingAt.get(t);
  let html = `<div class="info"><p>${p.type === 'human' ? 'Your nation' : p.type === 'nation' ? 'AI nation' : 'Tribe'} · ${G.landPct(p).toFixed(2)}% of the world</p><p>🪖 Troops: <b>${fmt(p.troops)}</b> · 🗺️ Tiles: <b>${fmt(p.tiles)}</b></p>`;
  if (p.type !== 'tribe') html += `<p>🏙️ ${p.count.city} · 🏭 ${p.count.factory} · ⚓ ${p.count.port} · 🛡️ ${p.count.defense} · 🚀 ${p.count.silo} · 📡 ${p.count.sam}</p>`;
  if (bl) html += `<p>Here: <b>${BUILDINGS[bl.type].name}</b></p>`;
  const btns = [];
  if (o === H.id) btns.push(`<button data-a="build">🏗️ Build here</button>`);
  else {
    const ally = H.allies.get(o);
    if (ally) { html += `<p style="color:#8f8">🤝 Allied · ${Math.ceil((ally - G.tick) / TPS / 60)} min left</p>`; btns.push(`<button data-a="break" class="danger">Break alliance</button>`); }
    else { btns.push(`<button data-a="attack">⚔️ Attack with ${pct}% (${fmt(H.troops * pct / 100)})</button>`); if (p.type !== 'human') btns.push(`<button data-a="ally" class="alt">🤝 Ask for alliance</button>`); }
  }
  html += `<div class="btns">${btns.join('')}</div></div>`;
  openPanel(`<span style="color:${rgb(p.color)}">■</span> ${esc(p.name)}`, html);
  for (const b of $('panelBody').querySelectorAll('[data-a]')) b.onclick = () => {
    const a = b.dataset.a; closePanel();
    if (a === 'build') openBuild(t);
    if (a === 'attack') doAttack(t);
    if (a === 'break') { G.breakAlliance(H.id, o); }
    if (a === 'ally') { const ok = G.requestAlliance(o); toast(ok ? `🤝 ${esc(p.name)} accepted your alliance!` : `${esc(p.name)} declined.`, ok ? 'good' : 'bad'); }
  };
}
function openMenu() {
  if (!G) return;
  paused = true;
  openPanel('⏸ Paused', `<div class="info"><p>Map: ${W}×${Math.round(N / W)} tiles · ${G.players.length - 1} rivals & tribes · ${DIFFS[G.diffKey].label}</p><p>Time: ${Math.floor(G.tick / TPS / 60)} min</p><div class="btns"><button data-m="resume">▶ Resume</button><button data-m="help" class="alt">❓ How to play</button><button data-m="quit" class="danger">Quit to title</button></div></div>`);
  for (const b of $('panelBody').querySelectorAll('[data-m]')) b.onclick = () => {
    const m = b.dataset.m;
    if (m === 'resume') { closePanel(); paused = false; }
    if (m === 'help') { $('panelBody').innerHTML = `<details open>${$('howto').innerHTML.replace(/<summary>.*?<\/summary>/, '')}</details><div class="info"><div class="btns"><button id="resumeBtn">▶ Resume</button></div></div>`; $('resumeBtn').onclick = () => { closePanel(); paused = false; }; }
    if (m === 'quit') { closePanel(); paused = false; $('btnAgain').onclick(); }
  };
  $('panel').querySelector('[data-close]').addEventListener('click', () => { paused = false; }, { once: true });
}

// ---------- actions ----------
function doAttack(t) {
  const H = G.human, o = G.owner[t], troops = H.troops * pct / 100;
  if (o && G.allied(H.id, o)) { toast('You are allied with them. Long-press to break the alliance.', 'warn'); return; }
  // land route? our border touches the target on this landmass
  const M = G.M, mass = M.mass[t], nb = new Int32Array(4);
  let reach = false;
  const B = H.border;
  for (let i = 0; i < B.length && !reach; i++) { const n = G.nbrs(B[i], nb); for (let k = 0; k < n; k++) { const q = nb[k]; if (M.land[q] && G.owner[q] === o && M.mass[q] === mass) { reach = true; break; } } }
  const name = o ? G.players[o].name : 'the wilderness';
  if (reach && G.startAttack(H.id, o, troops)) { R.ping(t, '#ff6b5a'); return; }
  const err = G.launchBoat(H.id, t, troops);
  if (err) toast(reach ? 'No front line there.' : (H.count.port ? err : 'Not on your border. Build a ⚓ Port on your coast to invade by sea.'), 'bad');
  else { toast(`⛵ Boat with ${fmt(troops)} troops sent toward ${esc(name)}.`, '', 2200); R.ping(t, '#5cf0ff'); }
}
function tap(sx, sy) {
  if (!G) return;
  const t = R.toTile(sx, sy);
  if (G.phase === 'spawn') {
    const err = G.placeHuman(t);
    if (err) toast(err, 'bad', 2000);
    else { R.centerOn(t, Math.max(R.cam.z, 3)); R.ping(t, '#ffd34d'); toast(`🛡️ Capital placed! AI nations can't attack you for ${G.diff.protect / 60} min. Pick a % and tap nearby land to expand.`, 'good', 6000); }
    return;
  }
  if (G.phase !== 'play' || t < 0) return;
  const H = G.human; if (!H.alive) return;
  if (mode) {
    if (mode.kind === 'build') { const err = G.build(H, mode.type, t); if (err) toast(err, 'bad', 2000); else { toast(`Built a ${BUILDINGS[mode.type].name}.`, 'good', 1800); R.ping(t, '#ffd34d'); setMode(null); } }
    else { const err = G.launchNuke(H.id, mode.type, t); if (err) toast(err, 'bad', 2000); else { toast(`☢️ ${NUKES[mode.type].name} launched!`, 'warn', 2000); setMode(null); } }
    return;
  }
  if (!G.M.land[t]) return;
  if (G.owner[t] === H.id) { openBuild(t); return; }
  doAttack(t);
}

// ---------- input: pan / pinch / tap / long-press ----------
const ptrs = new Map();
let st = null, pinch = null, lpTimer = 0;
cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    st = { x: e.clientX, y: e.clientY, cx: R.cam.x, cy: R.cam.y, moved: false, long: false };
    clearTimeout(lpTimer);
    if (e.pointerType !== 'mouse') lpTimer = setTimeout(() => { if (st && !st.moved && ptrs.size === 1) { st.long = true; if (navigator.vibrate) navigator.vibrate(15); openInfo(R.toTile(st.x, st.y)); } }, 500);
  } else if (ptrs.size === 2) {
    clearTimeout(lpTimer);
    const [a, b] = [...ptrs.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: R.cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    pinch.wx = R.cam.x + pinch.mx / R.cam.z; pinch.wy = R.cam.y + pinch.my / R.cam.z;
    if (st) st.moved = true;
  }
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1 && st) {
    const dx = e.clientX - st.x, dy = e.clientY - st.y;
    if (!st.moved && Math.hypot(dx, dy) > 9) st.moved = true;
    if (st.moved) { R.cam.x = st.cx - dx / R.cam.z; R.cam.y = st.cy - dy / R.cam.z; R.clamp(); }
  } else if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    R.cam.z = pinch.z * d / Math.max(1, pinch.d); R.clamp();
    R.cam.x = pinch.wx - mx / R.cam.z; R.cam.y = pinch.wy - my / R.cam.z; R.clamp();
  }
});
function up(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); clearTimeout(lpTimer);
  if (ptrs.size === 0) {
    if (st && !st.moved && !st.long && e.type === 'pointerup' && e.button !== 2) tap(e.clientX, e.clientY);
    st = null; pinch = null;
  } else if (ptrs.size === 1) {
    const [a] = [...ptrs.values()]; pinch = null;
    st = { x: a.x, y: a.y, cx: R.cam.x, cy: R.cam.y, moved: true, long: false };
  }
}
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
cv.addEventListener('wheel', e => { e.preventDefault(); R.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
cv.addEventListener('contextmenu', e => { e.preventDefault(); if (G && G.phase === 'play') openInfo(R.toTile(e.clientX, e.clientY)); });
window.addEventListener('resize', () => { R.resize(); R.clamp(); });
window.addEventListener('keydown', e => {
  if (!G || e.target.tagName === 'INPUT') return;
  const map = { '1': 10, '2': 25, '3': 35, '4': 50, '5': 75 };
  if (map[e.key]) { pct = map[e.key]; for (const x of document.querySelectorAll('.pct')) x.classList.toggle('on', +x.dataset.p === pct); }
  if (e.key === 'Escape') { setMode(null); closePanel(); paused = false; }
  if (e.key === 'b') openBuild(-1);
});
document.addEventListener('gesturestart', e => e.preventDefault());

// ---------- main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  if (!G) return;
  const dt = Math.min(250, now - (last || now)); last = now;
  if (!paused && (G.phase === 'play' || watching)) {
    acc += dt * speed;
    let n = 0;
    while (acc >= 1000 / TPS && n < 6) { G.step(); acc -= 1000 / TPS; n++; }
    if (n === 6) acc = 0;
    R.alpha = acc / (1000 / TPS);
    handleEvents();
  }
  R.draw(now);
  if (now - lastHud > 250) { lastHud = now; updateHud(); }
  if (now - lastLb > 1000) { lastLb = now; updateLb(); }
}
requestAnimationFrame(frame);
window.__fc = { get game() { return G; }, R };
