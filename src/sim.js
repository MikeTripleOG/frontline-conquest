// Frontline Conquest - simulation (no DOM). Original code.
import { MAP_W, MAP_H, MAP_RLE } from './mapdata.js';

export const W = MAP_W, H = MAP_H, N = W * H;
export const TPS = 10; // ticks per second

export const BUILDINGS = {
  city:    { name: 'City',         cost: 5000,  icon: 'C', desc: '+15K max troops' },
  factory: { name: 'Factory',      cost: 4000,  icon: 'F', desc: '+40 gold / sec' },
  port:    { name: 'Port',         cost: 3000,  icon: 'P', desc: 'Coast only. Send boat invasions across water' },
  defense: { name: 'Defense Post', cost: 2000,  icon: 'D', desc: 'Enemies pay 3x to take land within 12 tiles' },
  silo:    { name: 'Missile Silo', cost: 12000, icon: 'M', desc: 'Lets you launch nukes & chem strikes' },
  sam:     { name: 'SAM Site',     cost: 8000,  icon: 'S', desc: '75% chance to shoot down nukes within 70 tiles' },
};
export const NUKES = {
  atom:     { name: 'Atom Bomb',     cost: 8000,  radius: 10 },
  hydrogen: { name: 'Hydrogen Bomb', cost: 30000, radius: 24 },
  chem:     { name: 'Chem Strike',   cost: 5000,  radius: 14, chem: true },
};
export const GAS_TICKS = 250; // gas cloud lasts ~25 s
export const DIFFS = {
  relaxed:  { label: 'Relaxed',  regen: 0.85, protect: 180, aggr: 0.15, nukes: false, nukeTick: 1e9,  humanBias: 0.6, think: 14 },
  standard: { label: 'Standard', regen: 1.0,  protect: 120, aggr: 0.3,  nukes: true,  nukeTick: 4800, humanBias: 1.0, think: 10 },
  brutal:   { label: 'Brutal',   regen: 1.2,  protect: 60,  aggr: 0.5,  nukes: true,  nukeTick: 2400, humanBias: 1.6, think: 7 },
};
const TERR_MULT = [1, 1.4, 2.0];
const SAM_RANGE = 70, DEF_RANGE = 12, FALLOUT = 240;

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- static map (built once) ----------
let MAP = null;
export function getMap() {
  if (MAP) return MAP;
  const land = new Uint8Array(N);
  let i = 0, v = 0;
  for (const r of MAP_RLE.split(',')) { const n = parseInt(r, 36); if (v) land.fill(1, i, i + n); i += n; v ^= 1; }
  // value-noise elevation
  const rng = mulberry32(1337);
  const G = 64, grid = new Float32Array(G * G);
  for (let k = 0; k < G * G; k++) grid[k] = rng();
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = grid[((yi & 63) * G) + (xi & 63)], b = grid[((yi & 63) * G) + ((xi + 1) & 63)];
    const c = grid[(((yi + 1) & 63) * G) + (xi & 63)], d = grid[(((yi + 1) & 63) * G) + ((xi + 1) & 63)];
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
  };
  // distance from coast (land: inland distance, water: offshore distance)
  const dist = new Uint8Array(N).fill(255);
  const q = new Int32Array(N); let qh = 0, qt = 0;
  for (let t = 0; t < N; t++) {
    const x = t % W, l = land[t];
    if ((x > 0 && land[t - 1] !== l) || (x < W - 1 && land[t + 1] !== l) || (t >= W && land[t - W] !== l) || (t < N - W && land[t + W] !== l)) { dist[t] = 0; q[qt++] = t; }
  }
  while (qh < qt) {
    const t = q[qh++], x = t % W, d = dist[t] + 1; if (d > 250) continue;
    const l = land[t];
    if (x > 0 && dist[t - 1] === 255 && land[t - 1] === l) { dist[t - 1] = d; q[qt++] = t - 1; }
    if (x < W - 1 && dist[t + 1] === 255 && land[t + 1] === l) { dist[t + 1] = d; q[qt++] = t + 1; }
    if (t >= W && dist[t - W] === 255 && land[t - W] === l) { dist[t - W] = d; q[qt++] = t - W; }
    if (t < N - W && dist[t + W] === 255 && land[t + W] === l) { dist[t + W] = d; q[qt++] = t + W; }
  }
  const terr = new Uint8Array(N), elev = new Float32Array(N), coastal = new Uint8Array(N);
  let landCount = 0; const coastList = [];
  for (let t = 0; t < N; t++) {
    if (!land[t]) continue;
    landCount++;
    const x = t % W, y = (t / W) | 0;
    let e = vn(x / 40, y / 40) * 0.5 + vn(x / 16, y / 16) * 0.3 + vn(x / 6, y / 6) * 0.2;
    e = e * 0.8 + Math.min(dist[t] / 60, 1) * 0.3;
    elev[t] = e;
    terr[t] = e > 0.78 ? 2 : e > 0.62 ? 1 : 0;
    if (dist[t] === 0) { coastal[t] = 1; coastList.push(t); }
  }
  // landmass ids
  const mass = new Int32Array(N).fill(-1), massSize = [];
  for (let t = 0; t < N; t++) if (land[t] && mass[t] < 0) {
    const id = massSize.length; let h = 0, tl = 0; q[tl++] = t; mass[t] = id;
    while (h < tl) {
      const c = q[h++], x = c % W;
      if (x > 0 && land[c - 1] && mass[c - 1] < 0) { mass[c - 1] = id; q[tl++] = c - 1; }
      if (x < W - 1 && land[c + 1] && mass[c + 1] < 0) { mass[c + 1] = id; q[tl++] = c + 1; }
      if (c >= W && land[c - W] && mass[c - W] < 0) { mass[c - W] = id; q[tl++] = c - W; }
      if (c < N - W && land[c + W] && mass[c + W] < 0) { mass[c + W] = id; q[tl++] = c + W; }
    }
    massSize.push(tl);
  }
  MAP = { land, terr, elev, dist, coastal, coastList: Int32Array.from(coastList), mass, massSize, landCount };
  return MAP;
}

// ---------- names ----------
const SYL_A = ['Var', 'Kel', 'Mor', 'Ast', 'Bel', 'Cor', 'Dra', 'Ery', 'Fal', 'Gor', 'Hal', 'Ise', 'Jor', 'Kar', 'Lum', 'Mar', 'Nor', 'Ost', 'Pel', 'Quor', 'Ras', 'Sol', 'Tal', 'Ul', 'Ves', 'Wyn', 'Xan', 'Yr', 'Zan', 'Bra', 'Cal', 'Dun', 'Eld', 'Fen', 'Gal', 'Hes', 'Ivo', 'Kas', 'Lor', 'Mir', 'Nav', 'Orv', 'Pra', 'Sar', 'Tor', 'Val', 'Zel', 'Ara', 'Tem', 'Rho'];
const SYL_B = ['ania', 'oria', 'heim', 'stan', 'mark', 'land', 'vania', 'gard', 'dor', 'ica', 'esia', 'onia', 'ara', 'avia', 'mere', 'fell', 'holm', 'aine', 'uri', 'eth', 'ovar', 'ennia', 'ador', 'ista', 'yne'];
const PREFIX = ['', '', '', '', 'Republic of ', 'Kingdom of ', 'United ', 'Free ', 'Empire of ', 'Grand '];
const TRIBE_A = ['Ka', 'Mo', 'Tu', 'Ri', 'Na', 'Lo', 'Shi', 'Ba', 'Ze', 'Wa', 'Ko', 'Am', 'Ul', 'Te', 'Yo', 'Ha', 'Pe', 'Su', 'Di', 'Ro'];
const TRIBE_B = ['ruk', 'lan', 'tok', 'mira', 'zul', 'pa', 'nok', 'ri', 'ta', 'ken', 'wo', 'sha', 'dar', 'lu', 'mek', 'ga', 'nis', 'bo'];

function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// ---------- the game ----------
export class Game {
  constructor(opts = {}) {
    this.opts = opts;
    this.seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
    this.rng = mulberry32(this.seed);
    this.M = getMap();
    this.diffKey = opts.difficulty || 'standard';
    this.diff = DIFFS[this.diffKey];
    this.owner = new Uint16Array(N);
    this.borderPos = new Int32Array(N).fill(-1);
    this.fallout = new Uint8Array(N); this.falloutList = []; this.falloutCount = 0;
    this.dirty = []; this.dirtyFlag = new Uint8Array(N);
    this.visit = new Uint32Array(N); this.stamp = 1; this.prev = new Int32Array(N); this.queue = new Int32Array(N);
    this.nbA = new Int32Array(4); this.nbB = new Int32Array(4); this.nbC = new Int32Array(4);
    this.players = [null]; this.buildings = []; this.buildingAt = new Map();
    this.attacks = []; this.ships = []; this.nukes = []; this.clouds = []; this.effects = []; this.events = [];
    this.tick = 0; this.phase = 'spawn'; this.protectUntil = 0; this.nextId = 1;
    this.stats = { nukes: 0, chem: 0, intercepts: 0, boats: 0, gasKilled: 0 };
    this.makePlayers(opts.nations ?? 87, opts.tribes ?? 400, opts.playerName || 'You');
  }

  // ---- players ----
  newPlayer(type, name, color) {
    const p = {
      id: this.players.length, type, name, color, troops: type === 'human' ? 1200 : type === 'nation' ? 1200 : 500,
      gold: type === 'human' ? 1500 : 1000, tiles: 0, border: [], alive: true, spawned: false, capital: -1,
      count: { city: 0, factory: 0, port: 0, defense: 0, silo: 0, sam: 0 }, blds: [],
      allies: new Map(), grudge: new Map(), lastAllyAsk: -1e9, gasFrac: 0,
      ai: { threshold: 0.35 + this.rng() * 0.35, pct: 0.2 + this.rng() * 0.25, every: type === 'tribe' ? 25 + ((this.rng() * 15) | 0) : this.diff.think + ((this.rng() * 5) | 0) },
    };
    this.players.push(p); return p;
  }
  makePlayers(nNations, nTribes, playerName) {
    const r = this.rng;
    this.human = this.newPlayer('human', playerName, [255, 196, 20]);
    const used = new Set();
    for (let i = 0; i < nNations; i++) {
      let name, g = 0;
      do { name = PREFIX[(r() * PREFIX.length) | 0] + SYL_A[(r() * SYL_A.length) | 0] + SYL_B[(r() * SYL_B.length) | 0]; } while (used.has(name) && ++g < 50);
      used.add(name);
      let hue = (i * 137.508 + 20) % 360; if (hue > 190 && hue < 235) hue = (hue - 190) * 0.4 + 250; if (hue > 38 && hue < 58) hue -= 20;
      this.newPlayer('nation', name, hsl(hue, 55 + r() * 30, 42 + r() * 18));
    }
    for (let i = 0; i < nTribes; i++) {
      let name, g = 0;
      do { name = TRIBE_A[(r() * TRIBE_A.length) | 0] + TRIBE_B[(r() * TRIBE_B.length) | 0] + (r() < 0.3 ? TRIBE_B[(r() * TRIBE_B.length) | 0] : ''); } while (used.has(name) && ++g < 50);
      used.add(name);
      let th = r() * 300; if (th > 190) th += 50; this.newPlayer('tribe', name[0].toUpperCase() + name.slice(1), hsl(th, 18 + r() * 22, 48 + r() * 18));
    }
    // AI spawns
    const spawns = [];
    const M = this.M;
    for (const p of this.players) {
      if (!p || p.type === 'human') continue;
      const minD = p.type === 'nation' ? 34 : 12;
      let best = -1;
      for (let tries = 0; tries < 400; tries++) {
        const t = (r() * N) | 0;
        if (!M.land[t] || this.owner[t] || M.massSize[M.mass[t]] < 60) continue;
        const x = t % W, y = (t / W) | 0;
        let ok = true;
        const md = tries < 250 ? minD : minD / 2;
        for (const s of spawns) { const dx = s[0] - x, dy = s[1] - y; if (dx * dx + dy * dy < md * md) { ok = false; break; } }
        if (ok) { best = t; break; }
      }
      if (best >= 0) { spawns.push([best % W, (best / W) | 0]); this.spawnAt(p, best, p.type === 'nation' ? 3 : 2); }
      else p.alive = false;
    }
  }
  spawnAt(p, t, rad) {
    const cx = t % W, cy = (t / W) | 0;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (dx * dx + dy * dy > rad * rad + 1) continue;
      const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = y * W + x; if (this.M.land[k] && !this.owner[k]) this.setOwner(k, p.id);
    }
    p.spawned = true; p.capital = t;
  }
  // human chooses spawn. returns error string or null
  placeHuman(t) {
    const M = this.M;
    if (t < 0 || t >= N || !M.land[t]) return 'Pick a spot on land.';
    if (this.owner[t]) return 'That land is taken. Pick unclaimed land.';
    if (M.massSize[M.mass[t]] < 30) return 'That island is too small.';
    this.spawnAt(this.human, t, 4);
    this.phase = 'play';
    this.protectUntil = this.tick + this.diff.protect * TPS;
    return null;
  }
  isProtected(p) { return p.type === 'human' && this.tick < this.protectUntil; }
  allied(a, b) { return a !== 0 && b !== 0 && this.players[a].allies.has(b); }
  cap(p) { return 2000 + 60 * Math.pow(p.tiles, 0.8) + p.count.city * 15000; }
  goldRate(p) { return (1 + Math.sqrt(p.tiles) * 0.12 + p.count.factory * 4) * TPS; } // per second

  // ---- tiles ----
  nbrs(t, b) {
    let n = 0; const x = t % W;
    if (x > 0) b[n++] = t - 1;
    if (x < W - 1) b[n++] = t + 1;
    if (t >= W) b[n++] = t - W;
    if (t < N - W) b[n++] = t + W;
    return n;
  }
  markDirty(t) { if (!this.dirtyFlag[t]) { this.dirtyFlag[t] = 1; this.dirty.push(t); } }
  removeBorder(t, p) {
    const arr = p.border, i = this.borderPos[t], last = arr.pop();
    if (last !== t) { arr[i] = last; this.borderPos[last] = i; }
    this.borderPos[t] = -1;
  }
  updBorder(t) {
    const o = this.owner[t];
    if (!o) return;
    const land = this.M.land, b = this.nbC, n = this.nbrs(t, b);
    let isB = false;
    for (let i = 0; i < n; i++) { const k = b[i]; if (land[k] && this.owner[k] !== o) { isB = true; break; } }
    const was = this.borderPos[t] >= 0;
    if (isB && !was) { const p = this.players[o]; this.borderPos[t] = p.border.length; p.border.push(t); this.markDirty(t); }
    else if (!isB && was) { this.removeBorder(t, this.players[o]); this.markDirty(t); }
  }
  setOwner(t, o) {
    const old = this.owner[t];
    if (old === o) return;
    if (old) {
      const op = this.players[old]; op.tiles--;
      if (this.borderPos[t] >= 0) this.removeBorder(t, op);
      if (op.tiles <= 0 && op.alive) this.eliminate(op);
    }
    this.owner[t] = o;
    if (o) this.players[o].tiles++;
    if (this.fallout[t] && o) { this.fallout[t] = 0; this.falloutCount--; }
    const bl = this.buildingAt.get(t);
    if (bl) { if (o) this.transferBuilding(bl, o); else this.destroyBuilding(bl); }
    this.markDirty(t);
    this.updBorder(t);
    const b = this.nbB, n = this.nbrs(t, b);
    for (let i = 0; i < n; i++) this.updBorder(b[i]);
  }
  eliminate(p) {
    p.alive = false; p.troops = 0;
    for (const a of this.attacks) if (a.att === p.id) a.done = true;
    for (const s of this.ships) if (s.owner === p.id) s.done = true;
    for (const q of this.players) if (q) { q.allies.delete(p.id); }
    p.allies.clear();
    this.events.push({ type: 'eliminated', id: p.id });
  }

  // ---- buildings ----
  buildCost(p, type) { return Math.round(BUILDINGS[type].cost * Math.min(4, 1 + 0.5 * p.count[type])); }
  canBuild(p, type, t) {
    if (t < 0 || t >= N || this.owner[t] !== p.id) return 'Build inside your own territory.';
    if (type === 'port' && !this.M.coastal[t]) return 'Ports must be on the coast.';
    if (p.gold < this.buildCost(p, type)) return 'Not enough gold.';
    const x = t % W, y = (t / W) | 0;
    for (const b of p.blds) { const dx = b.x - x, dy = b.y - y; if (dx * dx + dy * dy < 9) return 'Too close to another building.'; }
    return null;
  }
  build(p, type, t) {
    const err = this.canBuild(p, type, t); if (err) return err;
    p.gold -= this.buildCost(p, type);
    const b = { id: this.nextId++, type, tile: t, x: t % W, y: (t / W) | 0, owner: p.id, cd: 0 };
    this.buildings.push(b); this.buildingAt.set(t, b); p.blds.push(b); p.count[type]++;
    return null;
  }
  transferBuilding(b, o) {
    const op = this.players[b.owner]; const i = op.blds.indexOf(b); if (i >= 0) op.blds.splice(i, 1); op.count[b.type]--;
    b.owner = o; const np = this.players[o]; np.blds.push(b); np.count[b.type]++;
  }
  destroyBuilding(b) {
    const op = this.players[b.owner]; const i = op.blds.indexOf(b); if (i >= 0) op.blds.splice(i, 1); op.count[b.type]--;
    this.buildingAt.delete(b.tile); b.dead = true;
    const j = this.buildings.indexOf(b); if (j >= 0) this.buildings.splice(j, 1);
  }
  defenseNear(pid, t) {
    const p = this.players[pid]; if (!p.count.defense) return false;
    const x = t % W, y = (t / W) | 0;
    for (const b of p.blds) if (b.type === 'defense') { const dx = b.x - x, dy = b.y - y; if (dx * dx + dy * dy <= DEF_RANGE * DEF_RANGE) return true; }
    return false;
  }

  // ---- attacks ----
  findAttack(a, tgt) { for (const x of this.attacks) if (!x.done && x.att === a && x.tgt === tgt) return x; return null; }
  canAttack(a, tgt) {
    if (tgt === a) return false;
    if (tgt === 0) return true;
    const T = this.players[tgt];
    if (!T || !T.alive) return false;
    if (this.allied(a, tgt)) return false;
    if (a !== this.human.id && this.isProtected(T)) return false;
    return true;
  }
  addCands(at, t) {
    const land = this.M.land, b = this.nbA, n = this.nbrs(t, b);
    for (let i = 0; i < n; i++) { const k = b[i]; if (land[k] && this.owner[k] === at.tgt && !at.set.has(k)) { at.set.add(k); at.cand.push(k); } }
  }
  // returns true if the attack has a frontier
  startAttack(aid, tgt, troops, seedTile = -1) {
    const A = this.players[aid];
    if (!A.alive || !this.canAttack(aid, tgt)) return false;
    troops = Math.min(troops, A.troops);
    if (troops < 1) return false;
    let at = this.findAttack(aid, tgt);
    const isNew = !at;
    if (isNew) at = { att: aid, tgt, troops: 0, cand: [], set: new Set(), done: false };
    const before = at.cand.length;
    if (seedTile >= 0) this.addCands(at, seedTile);
    else for (let i = 0; i < A.border.length; i++) this.addCands(at, A.border[i]);
    if (isNew && at.cand.length === 0) return false;
    if (!isNew && at.cand.length === before && seedTile < 0 && at.cand.length === 0) return false;
    A.troops -= troops; at.troops += troops;
    if (isNew) this.attacks.push(at);
    if (tgt) {
      const T = this.players[tgt];
      T.grudge.set(aid, this.tick);
      // opposing attacks cancel out
      const opp = this.findAttack(tgt, aid);
      if (opp) { const m = Math.min(opp.troops, at.troops); opp.troops -= m; at.troops -= m; }
      if (tgt === this.human.id && A.type !== 'human' && isNew) this.events.push({ type: 'attacked', id: aid });
    }
    return true;
  }
  tileCost(at, t) {
    let m = TERR_MULT[this.M.terr[t]];
    if (this.fallout[t]) m *= 2.5;
    if (at.tgt === 0) return 2 * m;
    const D = this.players[at.tgt];
    const dens = D.troops / Math.max(1, D.tiles);
    let c = (1.5 + dens * 0.9) * m;
    if (this.defenseNear(at.tgt, t)) c *= 3;
    return c;
  }
  attNeighbors(t, a) {
    const b = this.nbA, n = this.nbrs(t, b); let c = 0;
    for (let i = 0; i < n; i++) if (this.owner[b[i]] === a) c++;
    return c;
  }
  processAttacks() {
    const r = this.rng;
    for (const at of this.attacks) {
      if (at.done) continue;
      const A = this.players[at.att];
      if (!A.alive) { at.done = true; continue; }
      if (at.tgt && (!this.players[at.tgt].alive || this.allied(at.att, at.tgt) || (A.type !== 'human' && this.isProtected(this.players[at.tgt])))) { this.endAttack(at); continue; }
      const cand = at.cand;
      let steps = Math.min(cand.length, Math.max(3, Math.ceil(Math.sqrt(cand.length) * 2 + cand.length * 0.03)));
      while (steps-- > 0 && cand.length > 0) {
        // pick the better of two random frontier tiles (fills gaps -> smooth fronts)
        let i = (r() * cand.length) | 0;
        const j = (r() * cand.length) | 0;
        if (j !== i && this.attNeighbors(cand[j], at.att) > this.attNeighbors(cand[i], at.att)) i = j;
        const t = cand[i]; const last = cand.pop(); if (i < cand.length) cand[i] = last;
        at.set.delete(t);
        if (this.owner[t] !== at.tgt || !this.attNeighbors(t, at.att)) continue;
        const cost = this.tileCost(at, t);
        if (at.troops < cost) { at.troops = 0; break; }
        at.troops -= cost;
        if (at.tgt) { const D = this.players[at.tgt]; const dens = D.troops / Math.max(1, D.tiles); D.troops = Math.max(0, D.troops - dens - 0.5); }
        this.setOwner(t, at.att);
        this.addCands(at, t);
      }
      if (at.troops < 1 || cand.length === 0) this.endAttack(at);
    }
    if (this.tick % 5 === 0) this.attacks = this.attacks.filter(a => !a.done);
  }
  endAttack(at) {
    if (at.done) return;
    at.done = true;
    const A = this.players[at.att];
    if (A.alive) A.troops += Math.max(0, at.troops);
    at.troops = 0;
  }

  // ---- boats ----
  // find a coastal landing tile near t on the same landmass
  landingNear(t) {
    const M = this.M; if (!M.land[t]) return -1;
    if (M.coastal[t]) return t;
    const st = ++this.stamp, q = this.queue; let h = 0, tl = 0; q[tl++] = t; this.visit[t] = st;
    const b = this.nbA;
    while (h < tl && tl < 40000) {
      const c = q[h++]; if (M.coastal[c]) return c;
      const n = this.nbrs(c, b);
      for (let i = 0; i < n; i++) { const k = b[i]; if (M.land[k] && this.visit[k] !== st) { this.visit[k] = st; q[tl++] = k; } }
    }
    return -1;
  }
  isPortTile(t, pid) { const b = this.buildingAt.get(t); return !!b && b.type === 'port' && b.owner === pid; }
  // water path from one of pid's ports to landing tile L. returns Int32Array path of tiles (port -> water... -> L) or null
  boatPath(pid, L, maxNodes = 700000) {
    const M = this.M, st = ++this.stamp, q = this.queue, prev = this.prev, land = M.land;
    let h = 0, tl = 0; const b = this.nbA, b2 = this.nbB;
    let n = this.nbrs(L, b);
    for (let i = 0; i < n; i++) { const k = b[i]; if (!land[k]) { this.visit[k] = st; prev[k] = L; q[tl++] = k; } }
    while (h < tl && tl < maxNodes) {
      const c = q[h++];
      n = this.nbrs(c, b);
      for (let i = 0; i < n; i++) {
        const k = b[i];
        if (land[k]) {
          if (this.owner[k] === pid && this.isPortTile(k, pid)) {
            const path = [k]; let x = c; while (x !== L) { path.push(x); x = prev[x]; } path.push(L);
            return Int32Array.from(path);
          }
          continue;
        }
        if (this.visit[k] !== st) { this.visit[k] = st; prev[k] = c; q[tl++] = k; }
      }
    }
    return null;
  }
  // returns error string or null
  launchBoat(pid, targetTile, troops, maxNodes = 700000) {
    const P = this.players[pid];
    if (!P.count.port) return 'You need a Port to invade across water.';
    const L = this.landingNear(targetTile);
    if (L < 0) return 'No coast to land on near there.';
    const tgt = this.owner[L];
    if (tgt === pid) return 'You already own that coast.';
    if (!this.canAttack(pid, tgt)) return tgt && this.allied(pid, tgt) ? 'You are allied with them.' : 'They are protected right now.';
    troops = Math.min(troops, P.troops); if (troops < 1) return 'Not enough troops.';
    const path = this.boatPath(pid, L, maxNodes);
    if (!path) return 'No sea route from your ports.';
    P.troops -= troops;
    this.ships.push({ owner: pid, troops, path, pos: 0, L, done: false });
    this.stats.boats++;
    if (tgt === this.human.id) this.events.push({ type: 'boat', id: pid });
    return null;
  }
  processShips() {
    for (const s of this.ships) {
      if (s.done) continue;
      s.pos += 1.6;
      if (s.pos >= s.path.length - 1) {
        s.done = true;
        const P = this.players[s.owner]; if (!P.alive) continue;
        const L = s.L, tgt = this.owner[L];
        if (tgt === s.owner || !this.canAttack(s.owner, tgt)) { P.troops += s.troops; continue; }
        const cost = this.tileCost({ tgt }, L);
        if (s.troops <= cost) continue;
        if (tgt) { const D = this.players[tgt]; D.grudge.set(s.owner, this.tick); }
        this.setOwner(L, s.owner);
        P.troops += s.troops - cost;
        this.startAttack(s.owner, tgt, s.troops - cost, L);
      }
    }
    if (this.tick % 10 === 0) this.ships = this.ships.filter(s => !s.done);
  }

  // ---- nukes ----
  launchNuke(pid, type, target) {
    const P = this.players[pid], spec = NUKES[type];
    if (!P.count.silo) return 'You need a Missile Silo.';
    if (P.gold < spec.cost) return 'Not enough gold.';
    if (target < 0 || target >= N) return 'Bad target.';
    const tx = target % W, ty = (target / W) | 0;
    let silo = null, bd = Infinity;
    for (const b of P.blds) if (b.type === 'silo' && b.cd <= this.tick) { const d = (b.x - tx) ** 2 + (b.y - ty) ** 2; if (d < bd) { bd = d; silo = b; } }
    if (!silo) return 'Silo is reloading.';
    P.gold -= spec.cost; silo.cd = this.tick + 100;
    const dist = Math.sqrt(bd), dur = Math.max(25, Math.round(dist / 3));
    let interceptAt = -1;
    for (const b of this.buildings) {
      if (b.type !== 'sam' || b.owner === pid || this.allied(b.owner, pid) || b.cd > this.tick) continue;
      const d = (b.x - tx) ** 2 + (b.y - ty) ** 2;
      if (d <= SAM_RANGE * SAM_RANGE) { b.cd = this.tick + 60; if (this.rng() < 0.75) { interceptAt = this.tick + Math.round(dur * 0.85); this.interceptSam = b; } break; }
    }
    const victim = this.owner[target];
    // nuking breaks alliances with the victim
    if (victim && victim !== pid) { this.breakAlliance(pid, victim); this.players[victim].grudge.set(pid, this.tick + 3000); }
    this.nukes.push({ owner: pid, type, sx: silo.x, sy: silo.y, tx, ty, t0: this.tick, t1: this.tick + dur, interceptAt, target });
    if (spec.chem) this.stats.chem++; else this.stats.nukes++;
    if (victim === this.human.id && pid !== victim) this.events.push({ type: spec.chem ? 'chem' : 'nuke', id: pid });
    return null;
  }
  processNukes() {
    for (const n of this.nukes) {
      if (n.done) continue;
      if (n.interceptAt >= 0 && this.tick >= n.interceptAt) {
        n.done = true; this.stats.intercepts++;
        const f = (n.interceptAt - n.t0) / (n.t1 - n.t0);
        this.effects.push({ kind: 'intercept', x: n.sx + (n.tx - n.sx) * f, y: n.sy + (n.ty - n.sy) * f, r: 6, t0: this.tick, dur: 15 });
        continue;
      }
      if (this.tick >= n.t1) { n.done = true; this.detonate(n); }
    }
    if (this.tick % 10 === 0) this.nukes = this.nukes.filter(n => !n.done);
    this.effects = this.effects.filter(e => this.tick < e.t0 + e.dur);
  }
  detonate(n) {
    const R = NUKES[n.type].radius, M = this.M;
    if (NUKES[n.type].chem) {
      // gas cloud: drifts with a random wind, drains troops and halts regen underneath; buildings survive
      const a = this.rng() * Math.PI * 2, sp = 0.02 + this.rng() * 0.03;
      this.clouds.push({ owner: n.owner, x: n.tx + 0.5, y: n.ty + 0.5, r: R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t0: this.tick, t1: this.tick + GAS_TICKS, seed: this.rng() * 1000 });
      this.effects.push({ kind: 'puff', x: n.tx, y: n.ty, r: R * 0.6, t0: this.tick, dur: 12 });
      return;
    }
    this.effects.push({ kind: 'blast', x: n.tx, y: n.ty, r: R, t0: this.tick, dur: 25 });
    const hit = new Set();
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy; if (d2 > R * R) continue;
      const x = n.tx + dx, y = n.ty + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const t = y * W + x; if (!M.land[t]) continue;
      // outer ring has a chance to survive
      if (d2 > R * R * 0.6 && this.rng() < 0.4) continue;
      const o = this.owner[t];
      if (o) { const p = this.players[o]; p.troops -= p.troops / Math.max(1, p.tiles) * 1.5; if (p.troops < 0) p.troops = 0; hit.add(o); this.setOwner(t, 0); }
      const bl = this.buildingAt.get(t); if (bl) this.destroyBuilding(bl);
      if (!this.fallout[t]) { this.falloutCount++; this.falloutList.push(t); }
      this.fallout[t] = FALLOUT; this.markDirty(t);
    }
    for (const o of hit) if (o !== n.owner) this.players[o].grudge.set(n.owner, this.tick + 3000);
  }
  processClouds() {
    for (let i = 1; i < this.players.length; i++) this.players[i].gasFrac = 0;
    if (!this.clouds.length) return;
    const own = this.owner, land = this.M.land, cnt = new Map();
    for (const c of this.clouds) {
      c.x += c.vx * 5; c.y += c.vy * 5;
      const age = (this.tick - c.t0) / GAS_TICKS, strength = 1 - age * 0.6, R = c.r * (0.85 + age * 0.3);
      cnt.clear();
      const cx = Math.round(c.x), cy = Math.round(c.y), Ri = Math.ceil(R);
      for (let dy = -Ri; dy <= Ri; dy++) for (let dx = -Ri; dx <= Ri; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const t = y * W + x; if (!land[t]) continue;
        const o = own[t]; if (o) cnt.set(o, (cnt.get(o) || 0) + 1);
      }
      for (const [o, k] of cnt) {
        const p = this.players[o]; if (!p.alive) continue;
        const frac = Math.min(1, k / Math.max(1, p.tiles));
        p.gasFrac = Math.min(1, p.gasFrac + frac);
        const loss = Math.min(p.troops, (p.troops * frac * 0.045 + k * 0.5) * strength); p.troops -= loss; this.stats.gasKilled += loss;
        if (o !== c.owner && !p.grudge.has(c.owner)) p.grudge.set(c.owner, this.tick + 1500);
      }
    }
    this.clouds = this.clouds.filter(c => this.tick < c.t1);
  }
  processFallout() {
    const f = this.fallout; let w = 0; const L = this.falloutList;
    for (let i = 0; i < L.length; i++) {
      const t = L[i]; if (!f[t]) continue;
      if (--f[t] === 0) { this.falloutCount--; this.markDirty(t); continue; }
      L[w++] = t;
    }
    L.length = w;
  }

  // ---- alliances ----
  makeAlliance(a, b) {
    const until = this.tick + 300 * TPS;
    this.players[a].allies.set(b, until); this.players[b].allies.set(a, until);
    for (const at of this.attacks) if (!at.done && ((at.att === a && at.tgt === b) || (at.att === b && at.tgt === a))) this.endAttack(at);
  }
  breakAlliance(a, b) {
    const A = this.players[a], B = this.players[b];
    if (A.allies.has(b)) { A.allies.delete(b); B.allies.delete(a); B.grudge.set(a, this.tick + 1500); if (a === this.human.id || b === this.human.id) this.events.push({ type: 'allyBroken', id: a === this.human.id ? b : a }); }
  }
  // human asks an AI for alliance -> returns true/false
  requestAlliance(aid) {
    const H = this.human, A = this.players[aid];
    if (!A || !A.alive || A.type === 'human') return false;
    if (H.allies.has(aid)) return true;
    const g = A.grudge.get(H.id);
    const angry = g !== undefined && this.tick - g < 1200;
    const ok = !angry && (A.type === 'tribe' ? this.rng() < 0.5 : (H.tiles > A.tiles * 0.4 && this.rng() < 0.7));
    if (ok) this.makeAlliance(H.id, aid);
    return ok;
  }

  // ---- AI ----
  scanNeighbors(p, samples = 30) {
    const res = { neutral: 0, players: new Map() };
    const B = p.border; if (!B.length) return res;
    const land = this.M.land, b = this.nbA, r = this.rng;
    const k = Math.min(samples, B.length);
    for (let s = 0; s < k; s++) {
      const t = B[(r() * B.length) | 0], n = this.nbrs(t, b);
      for (let i = 0; i < n; i++) {
        const q = b[i]; if (!land[q]) continue;
        const o = this.owner[q]; if (o === p.id) continue;
        if (o === 0) res.neutral++; else res.players.set(o, (res.players.get(o) || 0) + 1);
      }
    }
    return res;
  }
  ai(p) {
    const r = this.rng, d = this.diff, cap = this.cap(p);
    if (p.type === 'nation') {
      if (r() < 0.35) this.aiBuild(p);
      if (d.nukes && this.tick > d.nukeTick && p.count.silo && this.tick - (p.lastStrike || 0) > 900 && r() < 0.08) this.aiNuke(p);
    }
    if (p.troops < cap * p.ai.threshold) return;
    const info = this.scanNeighbors(p);
    const pct = p.ai.pct;
    // alliance offers to the human
    if (p.type === 'nation' && info.players.has(this.human.id) && !p.allies.has(this.human.id) && this.tick - p.lastAllyAsk > 1800 && r() < 0.02) {
      const g = p.grudge.get(this.human.id);
      if (g === undefined || this.tick - g > 1500) { p.lastAllyAsk = this.tick; this.events.push({ type: 'allyRequest', id: p.id }); }
    }
    if (info.neutral > 0 && (info.players.size === 0 || r() < 0.75)) { this.startAttack(p.id, 0, p.troops * pct); return; }
    let best = 0, bestS = 0;
    const pd = p.troops / Math.max(1, p.tiles);
    for (const [id, cnt] of info.players) {
      const q = this.players[id];
      if (!this.canAttack(p.id, id)) continue;
      const qd = q.troops / Math.max(1, q.tiles);
      let s = cnt * (pd + 1) / (qd + 1) * (0.6 + r() * 0.8);
      if (q.type === 'tribe') s *= 1.6;
      if (q.type === 'human') s *= d.humanBias;
      const g = p.grudge.get(id); if (g !== undefined && this.tick - g < 1200) s *= 2;
      if (s > bestS) { bestS = s; best = id; }
    }
    if (best) {
      const q = this.players[best];
      if (p.troops * pct > q.troops * 0.3 || r() < d.aggr) { this.startAttack(p.id, best, p.troops * (pct + 0.1)); return; }
    }
    if (p.type === 'nation' && info.neutral === 0 && (info.players.size === 0 || r() < 0.15)) {
      if (p.count.port) { if (r() < 0.4) this.aiBoat(p); }
      else if (info.players.size === 0) this.aiBuild(p, 'port');
    }
  }
  aiBoat(p) {
    const r = this.rng, CL = this.M.coastList;
    const port = p.blds.find(b => b.type === 'port'); if (!port) return;
    let best = -1, bd = Infinity;
    for (let i = 0; i < 40; i++) {
      const t = CL[(r() * CL.length) | 0], o = this.owner[t];
      if (o === p.id || !this.canAttack(p.id, o)) continue;
      const d = (t % W - port.x) ** 2 + (((t / W) | 0) - port.y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    if (best >= 0) this.launchBoat(p.id, best, p.troops * 0.35, 250000);
  }
  findSite(p, type) {
    const B = p.border; if (!B.length) return -1;
    const M = this.M, st = ++this.stamp, q = this.queue, b = this.nbA;
    const start = B[(this.rng() * B.length) | 0];
    let h = 0, tl = 0; q[tl++] = start; this.visit[start] = st;
    let found = -1;
    while (h < tl && tl < 600) {
      const c = q[h++];
      if (type === 'port' ? M.coastal[c] : type === 'defense' ? h < 40 : h > tl * 0.6) {
        if (!this.canBuild(p, type, c)) { found = c; if (type !== 'city' && type !== 'silo' && type !== 'sam' && type !== 'factory') break; }
      }
      const n = this.nbrs(c, b);
      for (let i = 0; i < n; i++) { const k = b[i]; if (this.owner[k] === p.id && this.visit[k] !== st) { this.visit[k] = st; q[tl++] = k; } }
    }
    return found;
  }
  aiBuild(p, force) {
    const r = this.rng, c = p.count, d = this.diff;
    let type = force;
    if (!type) {
      const opts = [];
      if (!c.port && p.tiles > 150) opts.push('port', 'port');
      opts.push('city', 'city', 'factory', 'factory');
      if (p.tiles > 400) opts.push('defense');
      if (d.nukes && this.tick > d.nukeTick * 0.6 && !c.silo && p.tiles > 1500) opts.push('silo', 'silo');
      if (this.tick > d.nukeTick * 0.6 && c.sam < 1 + (c.city >> 2) && p.tiles > 1200) opts.push('sam');
      type = opts[(r() * opts.length) | 0];
    }
    if (p.gold < this.buildCost(p, type)) return;
    const t = this.findSite(p, type);
    if (t >= 0) this.build(p, type, t);
  }
  aiNuke(p) {
    const r = this.rng;
    let target = null, bs = 0;
    for (const [id, g] of p.grudge) {
      const q = this.players[id]; if (!q || !q.alive || this.allied(p.id, id) || this.isProtected(q)) continue;
      const s = q.tiles * (this.tick - g < 2000 ? 2 : 0.5) * (q.type === 'tribe' ? 0.1 : 1) * (q.type === 'human' ? this.diff.humanBias : 1);
      if (s > bs) { bs = s; target = q; }
    }
    if (!target || target.tiles < 300) return;
    const type = p.gold > NUKES.hydrogen.cost * 1.3 && r() < 0.4 ? 'hydrogen' : (r() < 0.3 || p.gold < NUKES.atom.cost * 1.2) ? 'chem' : 'atom';
    if (p.gold < NUKES[type].cost * 1.2) return;
    const city = target.blds.find(b => b.type === 'city' || b.type === 'silo');
    const t = city && type !== 'chem' ? city.tile : target.border[(r() * target.border.length) | 0];
    if (t !== undefined && !this.launchNuke(p.id, type, t)) p.lastStrike = this.tick;
  }

  // ---- main tick ----
  step() {
    if (this.phase !== 'play' && !(this.result && this.spectate)) return;
    this.tick++;
    const d = this.diff;
    for (let i = 1; i < this.players.length; i++) {
      const p = this.players[i]; if (!p.alive || !p.spawned) continue;
      const cap = this.cap(p);
      const mult = p.type === 'human' ? 1 : d.regen;
      if (p.troops < cap) p.troops += (3 + Math.pow(p.troops, 0.7) / 10) * (1 - p.troops / cap) * mult * (1 - p.gasFrac);
      else p.troops -= (p.troops - cap) * 0.01;
      p.gold += this.goldRate(p) / TPS * (p.type === 'human' ? 1 : d.regen);
    }
    this.processAttacks();
    this.processShips();
    this.processNukes();
    if (this.tick % 10 === 0) this.processFallout();
    if (this.tick % 5 === 0) this.processClouds();
    for (let i = 2; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.alive && (this.tick + i) % p.ai.every === 0) this.ai(p);
    }
    if (this.tick % 10 === 0) {
      for (const p of this.players) if (p && p.alive) for (const [id, until] of p.allies) if (this.tick >= until) {
        p.allies.delete(id); if (p.id === this.human.id) this.events.push({ type: 'allyExpired', id });
      }
      const H = this.human;
      if (!this.result) {
        if (!H.alive || H.tiles <= 0) this.result = 'lost';
        else if (this.landPct(H) >= 80 || !this.players.some(p => p && p.alive && p.type === 'nation')) this.result = 'won';
        if (this.result) { this.phase = this.result; this.events.push({ type: this.result }); }
      }
    }
  }
  landPct(p) { return p.tiles / Math.max(1, this.M.landCount - this.falloutCount) * 100; }
  leaderboard(n = 10) {
    return this.players.filter(p => p && p.alive && p.spawned).sort((a, b) => b.tiles - a.tiles).slice(0, n);
  }
}
