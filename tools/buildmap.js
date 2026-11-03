// Rasterizes Natural Earth (public domain) land polygons into a tile mask.
const fs = require('fs');
const W = 1600, LAT0 = 80, LAT1 = -58;
const H = Math.round((LAT0 - LAT1) / 360 * W);
const mask = new Uint8Array(W * H);
const px = lon => (lon + 180) / 360 * W;
const py = lat => (LAT0 - lat) / (LAT0 - LAT1) * H;
function fillRings(rings, val) {
  // even-odd scanline fill of a polygon (outer + holes)
  const edges = [];
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
    const [x1, y1] = [px(r[i][0]), py(r[i][1])], [x2, y2] = [px(r[i + 1][0]), py(r[i + 1][1])];
    if (y1 !== y2) edges.push([x1, y1, x2, y2]);
  }
  let minY = Infinity, maxY = -Infinity;
  for (const e of edges) { minY = Math.min(minY, e[1], e[3]); maxY = Math.max(maxY, e[1], e[3]); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const sy = y + 0.5, xs = [];
    for (const [x1, y1, x2, y2] of edges) {
      if ((y1 <= sy && y2 > sy) || (y2 <= sy && y1 > sy)) xs.push(x1 + (sy - y1) / (y2 - y1) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.round(xs[k])), b = Math.min(W - 1, Math.round(xs[k + 1]) - 1);
      for (let x = a; x <= b; x++) mask[y * W + x] = val;
    }
  }
}
function each(file, val, filter) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const f of j.features) {
    if (filter && !filter(f.properties)) continue;
    const g = f.geometry;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of polys) fillRings(p, val);
  }
}
each('land50.geojson', 1);
each('lakes50.geojson', 0, p => p.scalerank <= 1);
// remove specks smaller than 4 tiles
const seen = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) if (mask[i] && !seen[i]) {
  const comp = [i]; seen[i] = 1;
  for (let k = 0; k < comp.length; k++) {
    const t = comp[k], x = t % W, y = (t / W) | 0;
    for (const n of [x > 0 ? t - 1 : -1, x < W - 1 ? t + 1 : -1, y > 0 ? t - W : -1, y < H - 1 ? t + W : -1])
      if (n >= 0 && mask[n] && !seen[n]) { seen[n] = 1; comp.push(n); }
  }
  if (comp.length < 4) for (const t of comp) mask[t] = 0;
}
const runs = []; let cur = 0, len = 0;
for (let i = 0; i < W * H; i++) { if (mask[i] === cur) len++; else { runs.push(len); cur = mask[i]; len = 1; } }
runs.push(len);
let land = 0; for (const v of mask) land += v;
fs.writeFileSync('../src/mapdata.js', `// Generated from Natural Earth (public domain) land data by tools/buildmap.js\nexport const MAP_W=${W},MAP_H=${H};\nexport const MAP_RLE="${runs.map(r => r.toString(36)).join(',')}";\n`);
console.log({ W, H, land, pct: (land / (W * H)).toFixed(3), bytes: fs.statSync('../src/mapdata.js').size });
// preview
const { execSync } = require('child_process');
let pgm = `P5 ${W} ${H} 255\n`; const buf = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) buf[i] = mask[i] ? 255 : 0;
fs.writeFileSync('preview.pgm', Buffer.concat([Buffer.from(pgm), buf]));
