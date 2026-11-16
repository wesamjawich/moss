// Records the demo video frame by frame, so it plays smoothly however slow the machine is.
//   npm run build && npx vite preview --port 4173 &
//   node scripts/record-demo.cjs <frames-dir> [--probe]
//   ffmpeg -framerate 24 -i <frames-dir>/%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 20 demo.mp4
// Needs Playwright with Chromium available to Node.
const { chromium } = require('playwright');
const path = require('path');

const FPS = 24, W = 1280, H = 720;
const dir = process.argv[2];
const probe = process.argv.includes('--probe');
const url = process.env.DEMO_URL || 'http://localhost:4173/?capture&start=bare&sim=512&sub=1024&ground=1024';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 500)); });
  await page.goto(url);
  await page.waitForFunction(() => window.__moss && window.__moss.advance);
  await page.waitForTimeout(1500);

  let n = 0;
  const t0 = Date.now();
  // Advance the garden by `count` video frames, with `steps` extra simulation steps in each (time-lapse).
  const F = async (count = 1, steps = 0) => {
    if (process.env.DRY) { n += count; return; }      // DRY=1 checks the script's clicks without rendering
    for (let i = 0; i < count; i++) {
      await page.evaluate(([dt, s]) => { const m = window.__moss; for (let k = 0; k < s; k++) m.step(1); m.advance(dt); }, [1 / FPS, steps]);
      await page.screenshot({ path: path.join(dir, String(n++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 93, timeout: 120000 });
    }
    if (process.env.LIMIT && n >= +process.env.LIMIT) { await browser.close(); process.exit(0); }
    if (n % 24 < count) console.log(`frame ${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  };
  const ease = (u) => u * u * (3 - 2 * u);
  const tool = (label) => page.click(`#tools button:has-text("${label}")`);
  const tab = (label) => page.click(`#tabs button:has-text("${label}")`);
  const setRange = (id, v) => page.evaluate(([i, val]) => { const el = document.getElementById(i); el.value = val; el.dispatchEvent(new Event('input')); }, [id, v]);
  // Drag the brush along fn(u) -> [x, y], u in 0..1.
  const stroke = async (fn, frames) => {
    const [x0, y0] = fn(0);
    await page.mouse.move(x0, y0); await page.mouse.down();
    for (let i = 1; i <= frames; i++) { const [x, y] = fn(i / frames); await page.mouse.move(x, y); await F(1); }
    await page.mouse.up();
  };
  const line = (x0, y0, x1, y1, amp = 0, waves = 1) => (u) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u + amp * Math.sin(u * Math.PI * 2 * waves)];
  // Add an object from the palette and drag it into place.
  const place = async (label, tx, ty, { wheel = 0, turn = 0, frames = 11 } = {}) => {
    await tool(label);
    await F(2);
    const [sx, sy] = await page.evaluate(() => { const m = window.__moss, o = m.world.objects.at(-1); return m.toScreen(o.x, o.y); });
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (let i = 1; i <= frames; i++) {
      const u = ease(i / frames);
      await page.mouse.move(sx + (tx - sx) * u, sy + (ty - sy) * u);
      await F(1);
    }
    await page.mouse.up();
    for (let i = 0; i < Math.abs(wheel); i++) { await page.mouse.wheel(0, wheel > 0 ? -100 : 100); await F(1); }
    if (turn) {
      await page.keyboard.down('Shift');
      for (let i = 0; i < Math.abs(turn); i++) { await page.mouse.wheel(0, turn > 0 ? -100 : 100); await F(1); }
      await page.keyboard.up('Shift');
    }
    await F(3);
  };

  if (probe) { await F(4); await F(2, 20); console.log('probe ms/frame', (Date.now() - t0) / 6); await browser.close(); return; }

  // ---- bare earth ----
  await page.mouse.move(640, 330);
  await page.evaluate(() => { document.getElementById('ring').hidden = true; });
  await F(14);

  // ---- lay a gravel shore ----
  await tab('Ground');
  await setRange('size', 0.09);
  await stroke(line(6, 455, 1274, 430, 22, 1.5), 20);
  await stroke(line(1274, 560, 6, 575, 12, 1), 16);
  await stroke(line(6, 690, 1274, 690), 12);
  await F(4);

  // ---- rake it ----
  await tool('Rake');
  await stroke(line(700, 470, 1270, 420, 34, 1.2), 22);
  await stroke(line(1270, 545, 640, 590, 30, 1.2), 22);
  await F(4);

  // ---- place stones, a branch, a lantern, a basin ----
  await tab('Objects');
  await place('Rock', 330, 395, { wheel: 5 });
  await place('Rock', 462, 468, { wheel: -3 });
  await place('Rock', 222, 478, { wheel: -1 });
  await place('Flat stone', 880, 655, { frames: 8 });
  await place('Flat stone', 935, 572, { frames: 8 });
  await place('Flat stone', 1012, 498, { frames: 8 });
  await place('Flat stone', 1064, 410, { frames: 8 });
  await place('Branch', 800, 205, { turn: 3 });
  await place('Lantern', 190, 175, { wheel: 2 });
  await place('Basin', 1105, 215, { wheel: 1 });
  await place('Jizō', 560, 285);
  await page.keyboard.press('Escape');
  await F(6);

  // ---- sow moss and mist it ----
  await tab('Moss');
  await setRange('size', 0.06);
  await stroke(line(60, 300, 640, 110, 30, 1), 16);
  await stroke(line(660, 330, 1230, 110, -30, 1), 16);
  await stroke(line(1180, 330, 120, 250, 40, 2), 18);
  await stroke(line(180, 400, 520, 470, 20, 1), 10);
  await tool('Mist');
  await stroke(line(80, 180, 1220, 240, 60, 1.5), 16);
  await stroke(line(1220, 330, 80, 360, 40, 1.5), 14);
  await page.mouse.move(640, 300);
  await F(6);

  // ---- years pass ----
  await setRange('humidity', 0.86);
  for (let i = 0; i < 168; i++) await F(1, Math.round(6 + 26 * ease(Math.min(1, i / 40))));
  await F(8);

  // ---- rain ----
  await tool('Rain');
  await F(66, 3);
  await tool('Rain');
  await F(30, 3);

  // ---- autumn leaves ----
  await tab('Ground');
  await tool('Leaves');
  await stroke(line(640, 130, 960, 300, 25, 1), 12);
  await stroke(line(120, 290, 330, 240, 15, 1), 8);
  await page.mouse.move(640, 320);
  await F(8);

  // ---- dusk, night, dawn ----
  await tab('Scene');
  await page.click('#moods button[data-mood="dusk"]');
  await F(46, 2);
  await page.click('#moods button[data-mood="night"]');
  await F(64, 2);
  await page.click('#petals');
  await page.click('#moods button[data-mood="dawn"]');
  await F(54, 2);
  await page.click('#moods button[data-mood="day"]');
  await F(20, 2);

  // ---- the finished garden, controls hidden ----
  await page.keyboard.press('h');
  await page.evaluate(() => { document.getElementById('ring').hidden = true; });
  await F(80, 2);

  console.log('frames', n, 'seconds', ((Date.now() - t0) / 1000).toFixed(0));
  await browser.close();
})();
