const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto('http://localhost:8765/'); await page.tap('#btnPlay');
  await page.waitForFunction(() => window.__fc.game && window.__fc.game.phase === 'spawn');
  const r = await page.evaluate(() => {
    const g = window.__fc.game, R = window.__fc.R; for (let t = 230000; t < 1e6; t++) if (!g.placeHuman(t)) break;
    for (let i = 0; i < 3000; i++) g.step(); R.centerOn(g.human.capital, 3); R.computeLabels(); R.lastLabels = 1e12;
    const time = () => { let s = 0; for (let i = 0; i < 60; i++) { g.step(); const a = performance.now(); R.draw(1); s += performance.now() - a; } return +(s / 60).toFixed(2); };
    const out = { full: time() };
    const L = R.labels; R.labels = []; out.noLabels = time();
    const B = g.buildings; g.buildings = []; out.noLabelsNoBld = time(); g.buildings = B; R.labels = L;
    out.labelCount = L.length; out.bld = B.length; return out;
  });
  console.log(r); await browser.close();
})();
