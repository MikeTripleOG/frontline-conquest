import { Game, W, H, N, TPS, getMap } from '../src/sim.js';
const t0 = performance.now(); const M = getMap(); console.log('map', W, H, 'land', M.landCount, 'init ms', (performance.now() - t0).toFixed(0));
const diff = process.argv[2] || 'standard', mins = +(process.argv[3] || 10);
const g = new Game({ seed: 42, difficulty: diff });
console.log('players', g.players.length - 1, 'nations', g.players.filter(p => p && p.type === 'nation' && p.alive).length, 'tribes', g.players.filter(p => p && p.type === 'tribe' && p.alive).length);
// place human somewhere free in Europe-ish area
let spot = -1; for (let i = 0; i < 1e6 && spot < 0; i++) { const t = (Math.random() * N) | 0; if (!g.placeHuman(t)) spot = t; }
// simple human bot: expand neutral, build
const Hm = g.human;
let maxT = 0, sumT = 0, n = 0; const slow = [];
for (let tk = 0; tk < mins * 60 * TPS && g.phase === 'play'; tk++) {
  const a = performance.now();
  if (tk % 20 === 0 && Hm.alive && Hm.troops > g.cap(Hm) * 0.4) {
    const info = g.scanNeighbors(Hm);
    if (info.neutral) g.startAttack(Hm.id, 0, Hm.troops * 0.25);
    else { const ids = [...info.players.keys()]; if (ids.length) g.startAttack(Hm.id, ids[0], Hm.troops * 0.35); }
  }
  if (tk % 50 === 0 && Hm.alive) g.aiBuild(Hm);
  g.step();
  g.dirty.length = 0; g.dirtyFlag.fill(0);  // emulate renderer drain (cost excluded below)
  const dt = performance.now() - a; sumT += dt; n++; if (dt > maxT) maxT = dt;
  if (tk % 600 === 0) {
    const lb = g.leaderboard(5).map(p => `${p.name}:${p.tiles}(${Math.round(p.troops)})`).join(' ');
    const own = g.players.reduce((a,p)=>a+(p&&p.alive?p.tiles:0),0); const alive = g.players.filter(p => p && p.alive);
    console.log(`t=${tk / 10}s avg=${(sumT / n).toFixed(2)}ms max=${maxT.toFixed(1)}ms attacks=${g.attacks.length} ships=${g.ships.length} bld=${g.buildings.length} nukes=${g.stats.nukes} boats=${g.stats.boats} alive=${alive.length} nat=${alive.filter(p=>p.type==='nation').length} you=${Hm.tiles} ${g.landPct(Hm).toFixed(1)}% claimed=${(own/M.landCount*100).toFixed(0)}% | ${lb}`);
    sumT = 0; n = 0; maxT = 0;
  }
}
console.log('phase', g.phase, 'events', g.events.length);
