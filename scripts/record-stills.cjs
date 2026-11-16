// Renders finished gardens with the controls hidden, for the closing stills of the demo video.
//   node scripts/record-stills.cjs <out-dir>      (needs the preview server, see record-demo.cjs)
const { chromium } = require('playwright');
const path = require('path');

const W = 390, H = 844, DPR = 2;
const GARDENS = [
  { seed: 8, mood: 'day', steps: 2400 },
  { seed: 10, mood: 'dusk', steps: 2600, leaves: [[0.42, 0.62, 0.56, 0.52], [0.46, 0.30, 0.58, 0.38]] },
  { seed: 1, mood: 'dawn', steps: 2400, petals: true },
  { seed: 6, mood: 'night', steps: 2400, lantern: [0.60, 0.42] },
];

(async () => {
  const dir = process.argv[2];
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [i, g] of GARDENS.entries()) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`http://localhost:4173/?capture&start=surprise&seed=${g.seed}&sim=512&sub=1024&ground=1024`);
    await page.waitForFunction(() => window.__moss && window.__moss.advance);
    await page.evaluate((g) => {
      const m = window.__moss;
      const hum = document.getElementById('humidity'); hum.value = 0.86; hum.dispatchEvent(new Event('input'));
      if (g.lantern) { m.addObject(3); Object.assign(m.world.objects.at(-1), { x: g.lantern[0], y: g.lantern[1] }); m.select(null); m.flags.bake = true; }
      m.advance(0.04);
      for (let k = 0; k < g.steps; k += 1) m.step(1);
      for (const [ax, ay, bx, by] of g.leaves || []) { m.brush.a.set(ax, ay); m.brush.b.set(bx, by); for (let k = 0; k < 12; k++) m.groundStroke(4, 0.05); }
      m.setMood(g.mood, true);
      if (g.petals) document.getElementById('petals').click();
      document.body.classList.add('bare');
      document.getElementById('ring').hidden = true;
      for (let k = 0; k < 30; k++) m.advance(1 / 24);
    }, g);
    await page.screenshot({ path: path.join(dir, `still${i}.png`), timeout: 120000 });
    console.log('still', i);
    await page.close();
  }
  await browser.close();
})();
