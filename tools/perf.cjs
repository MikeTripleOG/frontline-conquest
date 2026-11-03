const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8765/'); await page.tap('#btnPlay');
  await page.waitForFunction(() => window.__fc.game && window.__fc.game.phase === 'spawn');
  await page.evaluate(() => { const g = window.__fc.game; for (let t = 230000; t < 1e6; t++) if (!g.placeHuman(t)) break; });
  const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = await page.evaluate(() => {
    const g = window.__fc.game, R = window.__fc.R; const out = {};
    const run = (label, z) => { if (z) R.centerOn(g.human.capital, z); else R.fit(); let st = 0, sd = 0, mt = 0, md = 0;
      for (let i = 0; i < 100; i++) { let a = performance.now(); g.step(); let b = performance.now(); R.draw(b); let c = performance.now(); st += b - a; sd += c - b; mt = Math.max(mt, b - a); md = Math.max(md, c - b); }
      out[label] = { tickAvg: +(st / 100).toFixed(2), tickMax: +mt.toFixed(1), drawAvg: +(sd / 100).toFixed(2), drawMax: +md.toFixed(1) }; };
    run('early-world', 0); for (let i = 0; i < 3000; i++) g.step(); run('5min-world', 0); run('5min-zoom3', 3); run('5min-zoom8', 8);
    return out;
  });
  console.log('CPU throttled 4x (phone-like):', JSON.stringify(r, null, 1));
  await browser.close();
})();
