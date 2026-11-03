const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://localhost:8765/'); await page.tap('#btnPlay');
  await page.waitForFunction(() => window.__fc.game && window.__fc.game.phase === 'spawn');
  await page.evaluate(() => { const g = window.__fc.game; for (let t = 230000; t < 1e6; t++) if (!g.placeHuman(t)) break; g.human.gold = 1e6; });
  // fast-forward 4 minutes of sim
  await page.evaluate(() => { const g = window.__fc.game; for (let i = 0; i < 2400; i++) g.step(); });
  const s = await page.evaluate(() => { const g = window.__fc.game, R = window.__fc.R, H = g.human, W = 1600;
    const site = H.border[0]; const e = g.build(H, 'silo', H.capital);
    // pick a big nation neighbour-ish target far-ish
    const tgt = g.leaderboard(3).find(p => p !== H);
    const t = tgt.border[0]; const err = g.launchNuke(H.id, 'hydrogen', t);
    R.centerOn(t, 1.6); return { e, err, tgt: tgt.name, tiles: H.tiles };
  });
  console.log(s);
  await page.waitForTimeout(1500); await page.screenshot({ path: '../shot-nuke-flight.png' });
  await page.waitForTimeout(5000); await page.screenshot({ path: '../shot-nuke-after.png' });
  // long-press a foreign tile
  const p = await page.evaluate(() => { const g = window.__fc.game, R = window.__fc.R; const t = R.toTile(200, 400); return { o: g.owner[t] }; });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 400 }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  console.log('panel visible', await page.isVisible('#panel'), await page.textContent('#panelTitle'));
  await page.screenshot({ path: '../shot-info.png' });
  // pinch zoom via CDP
  await page.tap('[data-close]').catch(() => {});
  const z0 = await page.evaluate(() => window.__fc.R.cam.z);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 400, id: 1 }, { x: 230, y: 400, id: 2 }] });
  for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180 - i * 15, y: 400, id: 1 }, { x: 230 + i * 15, y: 400, id: 2 }] }); await page.waitForTimeout(30); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  console.log('pinch zoom', z0.toFixed(2), '->', (await page.evaluate(() => window.__fc.R.cam.z)).toFixed(2));
  console.log('errors', errors.length ? errors : 'none');
  await browser.close();
})();
