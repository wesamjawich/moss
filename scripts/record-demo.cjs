// Records the demo video frame by frame, so it plays smoothly however slow the machine is.
//   npm run build && npx vite preview --port 4173 &
//   node scripts/record-demo.cjs <frames-dir> [--probe]
//   ffmpeg -framerate 24 -i <frames-dir>/%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 20 demo.mp4
// Needs Playwright with Chromium available to Node.
const { chromium } = require('playwright');
const path = require('path');

const FPS = 24, W = 390, H = 844, DPR = 2;      // an iPhone-shaped portrait frame, 780 x 1688
const dir = process.argv[2];
const probe = process.argv.includes('--probe');
const url = process.env.DEMO_URL || 'http://localhost:4173/?capture&start=surprise&seed=3&sim=768&sub=2048&ground=1024';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 500)); });
  await page.goto(url, { timeout: 600000 });
  await page.waitForFunction(() => window.__moss && window.__moss.advance);
  await page.waitForTimeout(1500);

  let n = 0;
  const t0 = Date.now();
  // Advance the garden by `count` video frames, with `steps` extra simulation steps in each (time-lapse).
  let cam = { x: 0.5, y: 0.5, z: 1 };
  const ease = (u) => u * u * (3 - 2 * u);
  const F = async (count = 1, steps = 0, to = null) => {
    const from = { ...cam };
    if (process.env.DRY) { n += count; return; }      // DRY=1 checks the script's clicks without rendering
    for (let i = 0; i < count; i++) {
      if (to) {      // glide the camera towards `to` over these frames
        const u = ease((i + 1) / count);
        cam = { x: from.x + (to.x - from.x) * u, y: from.y + (to.y - from.y) * u, z: from.z * Math.pow(to.z / from.z, u) };
      }
      await page.evaluate(([dt, s, c]) => { const m = window.__moss; m.view.set(c.x, c.y, c.z); for (let k = 0; k < s; k++) m.step(1); m.advance(dt); }, [1 / FPS, steps, cam]);
      await page.screenshot({ path: path.join(dir, String(n++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 93, timeout: 120000 });
    }
    if (process.env.LIMIT && n >= +process.env.LIMIT) { await browser.close(); process.exit(0); }
    if (n % 24 < count) console.log(`frame ${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  };
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

  const bare = (v) => page.evaluate((b) => { document.body.classList.toggle('bare', b); document.getElementById('ring').hidden = true; document.getElementById('hint').hidden = true; document.getElementById('show').hidden = true; }, v);
  const park = async () => { await page.mouse.move(195, 640); await page.evaluate(() => { document.getElementById('ring').hidden = true; }); };

  // ---- macro: young moss creeping over the soil in dappled light ----
  await bare(true);
  await setRange('light', 0.62);
  await setRange('humidity', 0.86);
  await page.evaluate(() => { const m = window.__moss; for (let k = 0; k < 6; k++) m.step(0, 1, 0.36, 0.80, 0.56, 0.90, 0.07); });
  cam = { x: 0.43, y: 0.83, z: 3.4 };
  await F(120, 3, { x: 0.47, y: 0.81, z: 3.0 });

  // ---- pull back as the years pass and the garden fills in ----
  await F(170, 16, { x: 0.5, y: 0.5, z: 1 });
  await F(40, 22);

  // ---- rain ----
  await page.evaluate(() => { window.__moss.world.rainLeft = 3.4; });
  await F(120, 4, { x: 0.5, y: 0.47, z: 1.12 });

  // ---- the gardener's hand: scrape a path, set stones along it ----
  await F(16, 2, { x: 0.5, y: 0.5, z: 1 });
  await bare(false);
  await tool('Scrape');
  await setRange('size', 0.035);
  await stroke(line(35, 100, 270, 210, 14, 1), 26);
  await stroke((u) => [190 + 24 * Math.cos(u * 12.6), 320 + 20 * Math.sin(u * 12.6)], 18);
  await tab('Objects');
  await place('Rock', 190, 320, { wheel: 1, frames: 9 });
  await place('Flat stone', 75, 116, { frames: 7 });
  await place('Flat stone', 150, 152, { frames: 7 });
  await place('Flat stone', 226, 190, { frames: 7 });
  await page.keyboard.press('Escape');
  await park();
  await bare(true);

  // ---- push in while moss closes around the new stones ----
  await F(150, 14, { x: 0.45, y: 0.80, z: 2.1 });

  // ---- evening ----
  await page.evaluate(() => window.__moss.setMood('dusk'));
  await F(96, 3, { x: 0.5, y: 0.56, z: 1.25 });

  console.log('frames', n, 'seconds', ((Date.now() - t0) / 1000).toFixed(0));
  await browser.close();
})();
