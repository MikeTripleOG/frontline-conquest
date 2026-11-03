// Frontline Conquest - canvas renderer
import { W, H, N, BUILDINGS, NUKES, GAS_TICKS } from './sim.js';

const pack = (r, g, b) => (255 << 24 | b << 16 | g << 8 | r) >>> 0;
const CS = 4, CW = Math.ceil(W / CS), CH = Math.ceil(H / CS);
const BAND = 32;

export function fmt(n) {
  n = Math.max(0, n);
  if (n < 1000) return String(Math.floor(n));
  if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0) + 'K';
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M';
}

let BASE = null;
function buildBase(M) {
  if (BASE) return BASE;
  const base = new Uint32Array(N), fall = new Uint32Array(N);
  for (let t = 0; t < N; t++) {
    const y = (t / W) | 0;
    let r, g, b;
    if (!M.land[t]) {
      const d = Math.min(M.dist[t], 14) / 14, dd = Math.sqrt(d);
      r = 44 - dd * 20; g = 104 - dd * 44; b = 156 - dd * 38;
      if (M.dist[t] === 0) { r += 14; g += 18; b += 14; }
    } else {
      const lat = 80 - y / H * 138, e = M.elev[t], al = Math.abs(lat), x = t % W;
      const wob = Math.sin(x * 0.045 + y * 0.02) * 4 + Math.sin(x * 0.013 - y * 0.05) * 5 + (e - 0.5) * 14;
      const L = al + wob;
      const sm = (a, b, v) => { const k = Math.max(0, Math.min(1, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
      // temperate green -> tropical green / dry tan / tundra, blended smoothly
      let pr = 92, pg = 138, pb = 68;
      const trop = 1 - sm(8, 16, L), dry = sm(14, 21, L) * (1 - sm(30, 38, L)) * (0.55 + 0.45 * sm(4, 30, M.dist[t] + wob)), cold = sm(52, 66, L);
      pr += (58 - pr) * trop; pg += (124 - pg) * trop; pb += (54 - pb) * trop;
      pr += (182 - pr) * dry; pg += (162 - pg) * dry; pb += (106 - pb) * dry;
      pr += (156 - pr) * cold; pg += (162 - pg) * cold; pb += (146 - pb) * cold;
      if (M.terr[t] === 1) { pr = pr * 0.7 + 120 * 0.3; pg = pg * 0.7 + 108 * 0.3; pb = pb * 0.7 + 80 * 0.3; }
      if (M.terr[t] === 2) { pr = 124; pg = 114; pb = 102; if (e > 0.86 || (cold > 0.5 && e > 0.8)) { pr = 222; pg = 224; pb = 230; } }
      const sh = 0.9 + (e - 0.5) * 0.35;
      r = pr * sh; g = pg * sh; b = pb * sh;
    }
    base[t] = pack(r | 0, g | 0, b | 0);
    const fr = M.land[t] ? 1 : 0;
    fall[t] = pack((r * 0.35 + 90 * 0.65 * fr) | 0, (g * 0.35 + 110 * 0.65 * fr) | 0, (b * 0.35 + 40 * 0.65 * fr) | 0);
  }
  BASE = { base, fall };
  return BASE;
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d', { alpha: false });
    this.map = document.createElement('canvas'); this.map.width = W; this.map.height = H;
    this.mctx = this.map.getContext('2d');
    this.img = this.mctx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.cam = { x: 0, y: 0, z: 1 };
    this.labels = []; this.lastLabels = 0;
    this.cellOwner = new Uint16Array(CW * CH); this.cellDist = new Uint8Array(CW * CH); this.cq = new Int32Array(CW * CH);
    this.bands = new Int32Array(Math.ceil(H / BAND) * 2);
    this.pings = []; this.sprites = new Map(); this.mctxT = document.createElement('canvas').getContext('2d');
    this.resize();
  }
  setGame(g) {
    this.g = g; const B = buildBase(g.M); this.base = B.base; this.fall = B.fall;
    const P = g.players;
    this.pc = new Uint32Array(P.length); this.pb = new Uint32Array(P.length); this.prgb = [];
    for (let i = 1; i < P.length; i++) {
      const [r, gg, b] = P[i].color;
      this.prgb[i] = P[i].color;
      this.pc[i] = pack(r, gg, b);
      this.pb[i] = P[i].type === 'human' ? pack(255, 255, 255) : pack((r * 0.55) | 0, (gg * 0.55) | 0, (b * 0.55) | 0);
    }
    for (let t = 0; t < N; t++) this.buf[t] = this.px(t);
    g.dirty.length = 0; g.dirtyFlag.fill(0);
    this.mctx.putImageData(this.img, 0, 0);
    this.lastLabels = 0; this.sprites.clear();
  }
  px(t) {
    const g = this.g, o = g.owner[t];
    if (!o) return g.fallout[t] ? this.fall[t] : this.base[t];
    if (g.borderPos[t] >= 0) return this.pb[o];
    // interior: blend nation colour with terrain for texture
    const c = this.pc[o], bs = this.base[t];
    const r = ((c & 255) * 0.72 + (bs & 255) * 0.28) | 0, gg = (((c >> 8) & 255) * 0.72 + ((bs >> 8) & 255) * 0.28) | 0, b = (((c >> 16) & 255) * 0.72 + ((bs >> 16) & 255) * 0.28) | 0;
    return pack(r, gg, b);
  }
  flush() {
    const g = this.g, D = g.dirty; if (!D.length) return;
    const bands = this.bands; bands.fill(-1);
    for (let i = 0; i < D.length; i++) {
      const t = D[i]; g.dirtyFlag[t] = 0; this.buf[t] = this.px(t);
      const x = t % W, bi = (((t / W) | 0) / BAND | 0) * 2;
      if (bands[bi] < 0 || x < bands[bi]) bands[bi] = x;
      if (x > bands[bi + 1]) bands[bi + 1] = x;
    }
    D.length = 0;
    for (let b = 0; b < bands.length; b += 2) if (bands[b] >= 0) {
      const y0 = (b / 2) * BAND;
      this.mctx.putImageData(this.img, 0, 0, bands[b], y0, bands[b + 1] - bands[b] + 1, Math.min(BAND, H - y0));
    }
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.sw = window.innerWidth; this.sh = window.innerHeight;
    this.cv.width = Math.round(this.sw * this.dpr); this.cv.height = Math.round(this.sh * this.dpr);
    this.cv.style.width = this.sw + 'px'; this.cv.style.height = this.sh + 'px';
    this.minZ = Math.min(this.sw / W, this.sh / H) * 0.9;
  }
  fit() { const z = Math.max(this.sw / W, this.minZ / 0.9); this.cam.z = Math.min(z, this.sh / H * 1.6); this.cam.x = W / 2 - this.sw / 2 / this.cam.z; this.cam.y = H / 2 - this.sh / 2 / this.cam.z; this.clamp(); }
  clamp() {
    const c = this.cam; c.z = Math.max(this.minZ, Math.min(40, c.z));
    const vw = this.sw / c.z, vh = this.sh / c.z;
    c.x = vw > W ? (W - vw) / 2 : Math.max(-vw * 0.3, Math.min(W - vw * 0.7, c.x));
    c.y = vh > H ? (H - vh) / 2 : Math.max(-vh * 0.3, Math.min(H - vh * 0.7, c.y));
  }
  toTile(sx, sy) {
    const c = this.cam, x = Math.floor(c.x + sx / c.z), y = Math.floor(c.y + sy / c.z);
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return y * W + x;
  }
  zoomAt(sx, sy, f) {
    const c = this.cam, wx = c.x + sx / c.z, wy = c.y + sy / c.z;
    c.z *= f; this.clamp(); c.x = wx - sx / c.z; c.y = wy - sy / c.z; this.clamp();
  }
  centerOn(t, z) { const c = this.cam; if (z) c.z = z; c.x = t % W + 0.5 - this.sw / 2 / c.z; c.y = ((t / W) | 0) + 0.5 - this.sh / 2 / c.z; this.clamp(); }
  ping(t, color) { this.pings.push({ x: t % W + 0.5, y: ((t / W) | 0) + 0.5, t0: performance.now(), color }); }

  computeLabels() {
    const g = this.g, own = g.owner, co = this.cellOwner, cd = this.cellDist, q = this.cq;
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
      const x = Math.min(W - 1, cx * CS + 2), y = Math.min(H - 1, cy * CS + 2);
      co[cy * CW + cx] = own[y * W + x];
    }
    let qt = 0;
    for (let i = 0; i < co.length; i++) {
      const o = co[i]; cd[i] = 0; if (!o) continue;
      const x = i % CW, y = (i / CW) | 0;
      if (x === 0 || y === 0 || x === CW - 1 || y === CH - 1 || co[i - 1] !== o || co[i + 1] !== o || co[i - CW] !== o || co[i + CW] !== o) { cd[i] = 1; q[qt++] = i; }
    }
    for (let h = 0; h < qt; h++) {
      const i = q[h], d = cd[i] + 1, o = co[i];
      const nb = [i - 1, i + 1, i - CW, i + CW];
      for (const k of nb) if (k >= 0 && k < co.length && co[k] === o && cd[k] === 0) { cd[k] = d > 250 ? 250 : d; q[qt++] = k; }
    }
    const best = new Int32Array(g.players.length).fill(-1);
    for (let i = 0; i < co.length; i++) { const o = co[i]; if (o && (best[o] < 0 || cd[i] > cd[best[o]])) best[o] = i; }
    const labels = [];
    for (let id = 1; id < g.players.length; id++) {
      const p = g.players[id]; if (!p.alive || !p.tiles) continue;
      let x, y, size;
      if (best[id] >= 0) {
        const i = best[id], d = cd[i];
        x = (i % CW) * CS + CS / 2; y = ((i / CW) | 0) * CS + CS / 2;
        size = Math.min(d * CS * 0.75, 3.2 * d * CS / Math.max(4, p.name.length));
      } else {
        const t = own[p.capital] === id ? p.capital : p.border[0]; if (t === undefined) continue;
        x = t % W + 0.5; y = ((t / W) | 0) + 0.5; size = Math.max(1.2, Math.sqrt(p.tiles) * 0.35);
      }
      labels.push({ id, x, y, size, tr: fmt(p.troops) });
    }
    this.labels = labels;
  }

  // labels are pre-rendered into small canvases (cheap to blit every frame)
  labelSprite(L, p, fs) {
    const bucket = Math.round(Math.log(fs) / Math.log(1.18)), bf = Math.pow(1.18, bucket);
    const ally = this.g.human.allies.has(p.id);
    const key = bucket + '|' + L.tr + '|' + ally;
    let s = this.sprites.get(L.id);
    if (s && s.key === key) return s;
    const d = this.dpr, name = p.type === 'human' ? '★ ' + p.name : p.name;
    const f1 = `${p.type === 'human' ? '800' : '600'} ${bf * d}px system-ui,sans-serif`, f2s = Math.max(7, bf * 0.7) * d, f2 = `600 ${f2s}px system-ui,sans-serif`;
    const m = this.mctxT; m.font = f1; const w1 = m.measureText(name).width; m.font = f2; const w2 = m.measureText(L.tr).width;
    const pad = Math.max(2, bf / 6) * d, w = Math.ceil(Math.max(w1, w2) + pad * 2), h = Math.ceil(bf * d * 1.05 + f2s * 1.1 + pad * 2);
    const c = s && s.c.width >= w && s.c.height >= h && s.c.width < w * 2 ? s.c : document.createElement('canvas');
    if (c.width !== w) c.width = w; if (c.height !== h) c.height = h;
    const x = c.getContext('2d'); x.clearRect(0, 0, w, h);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round'; x.strokeStyle = 'rgba(0,0,0,0.6)';
    const y1 = pad + bf * d * 0.52, y2 = pad + bf * d * 1.05 + f2s * 0.55;
    x.font = f1; x.lineWidth = Math.max(2, bf / 6) * d; x.strokeText(name, w / 2, y1); x.fillStyle = ally ? '#b8ffb8' : '#fff'; x.fillText(name, w / 2, y1);
    x.font = f2; x.lineWidth = Math.max(2, f2s / 6); x.strokeText(L.tr, w / 2, y2); x.fillStyle = '#ffe9a8'; x.fillText(L.tr, w / 2, y2);
    s = { key, c, w: w / d, h: h / d, fs: bf };
    this.sprites.set(L.id, s);
    return s;
  }

  draw(now) {
    const g = this.g, ctx = this.ctx, c = this.cam, d = this.dpr;
    this.flush();
    if (now - this.lastLabels > 900) { this.computeLabels(); this.lastLabels = now; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d2238'; ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    ctx.setTransform(c.z * d, 0, 0, c.z * d, -c.x * c.z * d, -c.y * c.z * d);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.map, 0, 0);
    // world-space overlays
    const vx0 = c.x - 2, vy0 = c.y - 2, vx1 = c.x + this.sw / c.z + 2, vy1 = c.y + this.sh / c.z + 2;
    const inView = (x, y, m = 0) => x > vx0 - m && x < vx1 + m && y > vy0 - m && y < vy1 + m;
    // nukes in flight
    const tk = g.tick + (this.alpha || 0);
    for (const n of g.nukes) {
      if (n.done) continue;
      const R = NUKES[n.type].radius;
      ctx.lineWidth = Math.max(0.6, 2 / c.z);
      ctx.strokeStyle = NUKES[n.type].chem ? 'rgba(190,240,60,0.85)' : 'rgba(255,60,40,0.8)'; ctx.setLineDash([4 / c.z, 3 / c.z]);
      ctx.beginPath(); ctx.arc(n.tx + 0.5, n.ty + 0.5, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const f = Math.min(1, (tk - n.t0) / (n.t1 - n.t0));
      const mx = (n.sx + n.tx) / 2, my = (n.sy + n.ty) / 2 - Math.hypot(n.tx - n.sx, n.ty - n.sy) * 0.35;
      const bx = (1 - f) * (1 - f) * n.sx + 2 * (1 - f) * f * mx + f * f * n.tx, by = (1 - f) * (1 - f) * n.sy + 2 * (1 - f) * f * my + f * f * n.ty;
      ctx.strokeStyle = 'rgba(255,200,120,0.35)'; ctx.beginPath(); ctx.moveTo(n.sx, n.sy); ctx.quadraticCurveTo(mx, my, n.tx, n.ty); ctx.stroke();
      ctx.fillStyle = NUKES[n.type].chem ? '#c8f040' : '#ffeb7a'; ctx.beginPath(); ctx.arc(bx, by, Math.max(1.2, 5 / c.z), 0, Math.PI * 2); ctx.fill();
    }
    // chem gas clouds: translucent drifting yellow-green puffs that fade out
    for (const cl of g.clouds) {
      const age = (tk - cl.t0) / GAS_TICKS; if (age < 0 || age > 1) continue;
      const fade = Math.min(1, age * 12) * (1 - age) ** 0.7;
      const R = cl.r * (0.85 + age * 0.3), x0 = cl.x + cl.vx * (this.alpha || 0), y0 = cl.y + cl.vy * (this.alpha || 0);
      if (!inView(x0, y0, R * 1.6)) continue;
      const tt = now / 1000;
      for (let k = 0; k < 7; k++) {
        const ang = cl.seed + k * 0.9 + tt * (0.15 + k * 0.03) * (k % 2 ? 1 : -1);
        const off = k === 0 ? 0 : R * (0.35 + 0.15 * Math.sin(tt * 0.7 + k));
        const px = x0 + Math.cos(ang) * off, py = y0 + Math.sin(ang) * off, pr = R * (k === 0 ? 0.85 : 0.55 + 0.1 * Math.sin(tt + k * 2));
        const gr = ctx.createRadialGradient(px, py, 0, px, py, pr);
        gr.addColorStop(0, `rgba(210,245,70,${0.6 * fade})`);
        gr.addColorStop(0.6, `rgba(175,225,50,${0.4 * fade})`);
        gr.addColorStop(1, 'rgba(150,200,40,0)');
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const e of g.effects) {
      const f = (tk - e.t0) / e.dur; if (f < 0 || f > 1) continue;
      ctx.fillStyle = e.kind === 'blast' ? `rgba(255,${(180 - f * 150) | 0},40,${0.75 * (1 - f)})` : e.kind === 'puff' ? `rgba(220,255,90,${0.6 * (1 - f)})` : `rgba(255,255,255,${0.9 * (1 - f)})`;
      ctx.beginPath(); ctx.arc(e.x + 0.5, e.y + 0.5, e.r * (0.4 + f * 0.8), 0, Math.PI * 2); ctx.fill();
    }
    // ships
    for (const s of g.ships) {
      if (s.done) continue;
      const i = Math.min(s.path.length - 1, Math.floor(s.pos)), t = s.path[i];
      const x = t % W + 0.5, y = ((t / W) | 0) + 0.5; if (!inView(x, y)) continue;
      const col = this.prgb[s.owner];
      const r = Math.max(1.5, 6 / c.z);
      ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`; ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(0.3, 1.5 / c.z);
      ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.3); ctx.lineTo(x + r, y - r * 0.3); ctx.lineTo(x + r * 0.6, y + r * 0.6); ctx.lineTo(x - r * 0.6, y + r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // pings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i], f = (now - p.t0) / 600; if (f > 1) { this.pings.splice(i, 1); continue; }
      ctx.strokeStyle = p.color || 'rgba(255,255,255,' + (1 - f) + ')'; ctx.globalAlpha = 1 - f; ctx.lineWidth = 2 / c.z;
      ctx.beginPath(); ctx.arc(p.x, p.y, (4 + f * 14) / c.z * 2, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // screen-space: buildings + labels
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const sx = x => (x - c.x) * c.z, sy = y => (y - c.y) * c.z;
    if (c.z >= 1.1) {
      const r = Math.min(11, 4 + c.z * 0.9);
      ctx.font = `bold ${Math.round(r * 1.2)}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const b of g.buildings) {
        if (!inView(b.x, b.y)) continue;
        const X = sx(b.x + 0.5), Y = sy(b.y + 0.5), col = this.prgb[b.owner];
        ctx.fillStyle = `rgb(${col[0] * 0.6 | 0},${col[1] * 0.6 | 0},${col[2] * 0.6 | 0})`;
        ctx.strokeStyle = b.owner === g.human.id ? '#fff' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (b.type === 'defense') { ctx.moveTo(X, Y - r); ctx.lineTo(X + r, Y); ctx.lineTo(X, Y + r); ctx.lineTo(X - r, Y); ctx.closePath(); }
        else if (b.type === 'silo' || b.type === 'sam') ctx.rect(X - r * 0.85, Y - r * 0.85, r * 1.7, r * 1.7);
        else ctx.arc(X, Y, r, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = b.type === 'silo' ? '#ff8a7a' : b.type === 'sam' ? '#9fe0ff' : '#fff';
        ctx.fillText(BUILDINGS[b.type].icon, X, Y + 0.5);
      }
    }
    for (const L of this.labels) {
      const fs = Math.min(64, L.size * c.z);
      if (fs < 8) continue;
      const X = sx(L.x), Y = sy(L.y);
      if (X < -200 || X > this.sw + 200 || Y < -60 || Y > this.sh + 60) continue;
      const p = g.players[L.id]; if (!p.alive) continue;
      const spr = this.labelSprite(L, p, fs), k = fs / spr.fs;
      ctx.drawImage(spr.c, X - spr.w * k / 2, Y - spr.h * k / 2, spr.w * k, spr.h * k);
    }
  }
}
