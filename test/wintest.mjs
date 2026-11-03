import { Game, N, TPS } from '../src/sim.js';
const g = new Game({ seed: 7, difficulty: 'brutal' });
for (let t = 0; t < N; t++) if (!g.placeHuman(t)) break;
for (let i = 0; i < 9000; i++) g.step();
console.log('brutal 15min: nukes', g.stats.nukes, 'intercepts', g.stats.intercepts, 'boats', g.stats.boats, 'fallout', g.falloutCount, 'events', [...new Set(g.events.map(e => e.type))].join(','), 'phase', g.phase);
// force win
const g2 = new Game({ seed: 3 }); for (let t = 0; t < N; t++) if (!g2.placeHuman(t)) break;
let c = 0; for (let t = 0; t < N && g2.landPct(g2.human) < 81; t++) if (g2.M.land[t]) g2.setOwner(t, g2.human.id);
for (let i = 0; i < 20; i++) g2.step();
console.log('forced win phase', g2.phase, g2.result);
// nuke + SAM test
const g3 = new Game({ seed: 5 }); let sp; for (let t = 0; t < N; t++) if (!g3.placeHuman(t)) { sp = t; break; }
const Hm = g3.human; Hm.gold = 1e6; g3.build(Hm, 'silo', sp);
const victim = g3.players[5]; const tgt = victim.border[0];
console.log('launch', g3.launchNuke(Hm.id, 'atom', tgt), 'victim tiles before', victim.tiles);
for (let i = 0; i < 400; i++) g3.step();
console.log('victim after', victim.tiles, 'fallout', g3.falloutCount);
