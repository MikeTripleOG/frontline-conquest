const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/', { waitUntil: 'load' });
  await page.screenshot({ path: '../shot-start.png' });
  await page.fill('#inName', 'Remi');
  await page.tap('#btnPlay');
  await page.waitForFunction(() => window.__fc.game && window.__fc.game.phase === 'spawn', null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '../shot-spawn.png' });
  // find a free land tile in western Europe and tap it on screen
  const pos = await page.evaluate(() => {
    const g = window.__fc.game, R = window.__fc.R, W = 1600;
    for (let r = 0; r < 60; r++) for (let a = 0; a < 40; a++) {
      const x = Math.round(820 + r * Math.cos(a)), y = Math.round(140 + r * Math.sin(a));
      const t = y * W + x;
      if (g.M.land[t] && !g.owner[t] && g.M.massSize[g.M.mass[t]] > 1000) {
        // check neighbours free
        let ok = true; for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) if (g.owner[t + dy * W + dx]) ok = false;
        if (ok) return { x: (x + 0.5 - R.cam.x) * R.cam.z, y: (y + 0.5 - R.cam.y) * R.cam.z, t };
      }
    }
  });
  console.log('spawn at', pos);
  await page.touchscreen.tap(pos.x, pos.y);
  await page.waitForTimeout(300);
  console.log('phase', await page.evaluate(() => window.__fc.game.phase));
  // human: tap neutral land beside us a few times
  const tapNear = async () => {
    const p = await page.evaluate(() => {
      const g = window.__fc.game, R = window.__fc.R, W = 1600, H = g.human, nb = new Int32Array(4);
      for (let i = 0; i < 400; i++) {
        const b = H.border[(Math.random() * H.border.length) | 0]; if (b === undefined) return null;
        const n = g.nbrs(b, nb);
        for (let k = 0; k < n; k++) { const q = nb[k]; if (g.M.land[q] && g.owner[q] !== H.id && !g.allied(H.id, g.owner[q])) {
          const x = (q % W + 0.5 - R.cam.x) * R.cam.z, y = (((q / W) | 0) + 0.5 - R.cam.y) * R.cam.z;
          if (x > 10 && x < R.sw - 10 && y > 120 && y < R.sh - 140) return { x, y };
        } }
      }
      return null;
    });
    if (p) await page.touchscreen.tap(p.x, p.y);
    return p;
  };
  await page.tap('#btnSpeed'); await page.tap('#btnSpeed'); // 3x
  for (let i = 0; i < 12; i++) { await tapNear(); await page.waitForTimeout(1500); }
  // frame timing
  const perf = await page.evaluate(() => new Promise(res => {
    const ts = []; let last = performance.now();
    function f(now) { ts.push(now - last); last = now; if (ts.length < 120) requestAnimationFrame(f); else res(ts); }
    requestAnimationFrame(f);
  }));
  perf.sort((a, b) => a - b);
  console.log('frame ms median', perf[60].toFixed(1), 'p95', perf[114].toFixed(1));
  // build a city via UI: tap own land
  const own = await page.evaluate(() => { const g = window.__fc.game, R = window.__fc.R, W = 1600, t = g.human.capital; g.human.gold += 20000; return { x: (t % W + 0.5 - R.cam.x) * R.cam.z, y: (((t / W) | 0) + 0.5 - R.cam.y) * R.cam.z }; });
  await page.touchscreen.tap(own.x, own.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: '../shot-build.png' });
  await page.tap('.bcard[data-b="city"]');
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => { const g = window.__fc.game; return { tick: g.tick, tiles: g.human.tiles, pct: g.landPct(g.human), troops: Math.round(g.human.troops), cities: g.human.count.city, attacks: g.attacks.length, alive: g.players.filter(p => p && p.alive).length }; });
  console.log('state', st);
  // zoom in a bit around capital with wheel-less: use R
  await page.evaluate(() => { const R = window.__fc.R, g = window.__fc.game; R.centerOn(g.human.capital, 2.2); });
  for (let i = 0; i < 6; i++) { await tapNear(); await page.waitForTimeout(1500); }
  await page.waitForTimeout(800);
  await page.screenshot({ path: '../screenshot.png' });
  await page.evaluate(() => { window.__fc.R.fit(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '../shot-world.png' });
  // desktop check
  const d = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  d.on('pageerror', e => errors.push('desktop pageerror: ' + e.message));
  await d.goto('http://localhost:8765/'); await d.click('#btnPlay');
  await d.waitForFunction(() => window.__fc.game && window.__fc.game.phase === 'spawn');
  await d.waitForTimeout(400); await d.screenshot({ path: '../shot-desktop.png' });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
