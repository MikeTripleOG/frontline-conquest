import { Game, N, W, NUKES, GAS_TICKS } from '../src/sim.js';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const g = new Game({ seed: 11 });
for (let t = 0; t < N; t++) if (!g.placeHuman(t)) break;
for (let i = 0; i < 600; i++) g.step();
const Hm = g.human; Hm.gold = 1e6; g.build(Hm, 'silo', Hm.capital);
const V = g.leaderboard(5).find(p => p !== Hm && p.type === 'nation');
V.gold = 1e5; const bt = V.border[0]; let site = -1;
for (const t of [V.capital, ...V.border]) if (!g.canBuild(V, 'city', t)) { site = t; break; }
g.build(V, 'city', site);
ok(NUKES.chem.cost < NUKES.atom.cost, 'chem cheaper than atom');
const g0 = Hm.gold; ok(g.launchNuke(Hm.id, 'chem', site) === null, 'chem launched'); ok(g0 - Hm.gold === NUKES.chem.cost, 'gold charged');
const before = V.troops, bld = V.count.city;
let maxFrac = 0, regenFrozen = true; let i = 0;
while (g.nukes.length && i++ < 200) g.step();
ok(g.clouds.length === 1, 'gas cloud released on impact');
const tAfterImpact = V.troops;
for (let k = 0; k < GAS_TICKS + 20; k++) { g.step(); maxFrac = Math.max(maxFrac, V.gasFrac); }
ok(g.clouds.length === 0, 'cloud dissipates after ~25s');
ok(g.buildingAt.get(site)?.type === 'city' && !g.buildingAt.get(site).dead, 'building under the cloud survives');
ok(maxFrac > 0, `regen suppressed on gassed share (max gasFrac ${maxFrac.toFixed(3)})`);
console.log(`  troops killed by gas: ${Math.round(g.stats.gasKilled)}; victim troops at impact ${Math.round(tAfterImpact)} -> after cloud ${Math.round(V.troops)} (fallout tiles ${g.falloutCount})`);
ok(g.falloutCount === 0, 'no fallout from chem');
// SAM interception
const g2 = new Game({ seed: 12 }); for (let t = 0; t < N; t++) if (!g2.placeHuman(t)) break;
for (let k = 0; k < 300; k++) g2.step();
const H2 = g2.human; H2.gold = 1e7; g2.build(H2, 'silo', H2.capital);
const V2 = g2.players.find(p => p && p.type === 'nation' && p.alive); V2.gold = 1e6; let s2 = -1;
for (const t of V2.border) if (!g2.canBuild(V2, 'sam', t)) { s2 = t; break; } g2.build(V2, 'sam', s2);
let intercepted = 0;
for (let n = 0; n < 20; n++) { for (const b of g2.buildings) b.cd = 0; const c0 = g2.stats.intercepts; g2.launchNuke(H2.id, 'chem', s2); for (let k = 0; k < 300 && g2.nukes.length; k++) g2.step(); intercepted += g2.stats.intercepts - c0; }
ok(intercepted > 8, `SAM intercepted ${intercepted}/20 chem strikes`);
// AI usage over long brutal game (spectate after loss)
const g3 = new Game({ seed: 21, difficulty: 'brutal' }); for (let t = 0; t < N; t++) if (!g3.placeHuman(t)) break; g3.spectate = true;
for (let k = 0; k < 15000; k++) g3.step();
ok(g3.stats.chem > 0, `AI used chem strikes in 25 min brutal game: chem=${g3.stats.chem} nukes=${g3.stats.nukes}`);
const g4 = new Game({ seed: 22, difficulty: 'relaxed' }); for (let t = 0; t < N; t++) if (!g4.placeHuman(t)) break; g4.spectate = true;
for (let k = 0; k < 9000; k++) g4.step();
ok(g4.stats.chem === 0, 'no AI chem on Relaxed');
