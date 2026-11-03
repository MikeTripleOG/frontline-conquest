const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(process.env.URL || 'http://localhost:8765/'); await page.tap('#btnPlay');
  await page.waitForFunction(() => window.__fc.game && window.__fc.game.phase === 'spawn');
  const sp = await page.evaluate(() => { const g = window.__fc.game, R = window.__fc.R; for (let t = 230000; t < 1e6; t++) if (!g.placeHuman(t)) break;
    for (let i = 0; i < 900; i++) g.step(); g.human.gold = 1e6; g.build(g.human, 'silo', g.human.capital); R.centerOn(g.human.capital, 3);
    const t = g.human.capital, W = 1600; return { x: (t % W + 0.5 - R.cam.x) * R.cam.z, y: (((t / W) | 0) + 0.5 - R.cam.y) * R.cam.z }; });
  // launch through the real UI: Strike button -> Chem Strike -> tap target
  await page.tap('#btnNuke'); await page.waitForTimeout(200);
  await page.screenshot({ path: '../docs/shot-strike-menu.png' });
  await page.tap('.bcard[data-n="chem"]');
  const tgt = await page.evaluate(() => { const g = window.__fc.game, R = window.__fc.R, W = 1600, H = g.human;
    const V = g.leaderboard(30).find(p => p !== H && p.type === 'nation' && Math.hypot(p.capital % W - H.capital % W, ((p.capital / W) | 0) - ((H.capital / W) | 0)) < 120);
    const t = V.border[(V.border.length / 2) | 0]; R.centerOn(t, 4.5);
    return { x: (t % W + 0.5 - R.cam.x) * R.cam.z, y: (((t / W) | 0) + 0.5 - R.cam.y) * R.cam.z, name: V.name, troops: Math.round(V.troops) }; });
  await page.touchscreen.tap(tgt.x, tgt.y);
  await page.waitForTimeout(800); await page.screenshot({ path: '../docs/shot-chem-flight.png' });
  await page.waitForFunction(() => window.__fc.game.clouds.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: '../docs/chem.png' });
  const st = await page.evaluate(() => { const g = window.__fc.game; return { clouds: g.clouds.length, chemLaunched: g.stats.chem, gasKilled: Math.round(g.stats.gasKilled) }; });
  console.log('target', tgt.name, tgt.troops, st, 'help has chem:', await page.evaluate(() => document.getElementById('howto').textContent.includes('Chem Strike')));
  console.log('errors', errors.length ? errors : 'none');
  await browser.close();
})();
