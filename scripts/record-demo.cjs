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
// SOFTWARE=1 forces CPU rendering (for machines without a GPU, where a recording takes most of an hour).
const GPU_ARGS = process.env.SOFTWARE ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--enable-gpu', '--ignore-gpu-blocklist'];
const SIM = process.env.SOFTWARE ? 'sim=768&sub=2048&ground=1024' : 'sim=1024&sub=2048&ground=1024';
const url = process.env.DEMO_URL || `http://localhost:4173/?capture&start=bare&${SIM}`;

(async () => {
  const browser = await chromium.launch({ args: GPU_ARGS });
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
  // A smooth curve through points (Catmull-Rom), eased so the hand speeds up and settles.
  const curve = (pts) => (u) => {
    const t = ease(u) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(t)), f = t - i;
    const p = (k) => pts[Math.max(0, Math.min(pts.length - 1, k))];
    const [a, b, c, d] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const cr = (k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * f + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f * f + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * f * f * f);
    return [cr(0), cr(1)];
  };
  const spiral = (cx, cy, r0, r1, turns) => (u) => { const a = u * turns * 6.2832 - 1.2, r = r0 + (r1 - r0) * u; return [cx + r * Math.cos(a), cy + r * 0.92 * Math.sin(a)]; };
  // view-space helper: where a screen point (at zoom 1) sits in the garden
  const uv = (sx, sy) => ({ x: (sx / W - 0.5) * (W / H) + 0.5, y: (0.5 - sy / H) + 0.5 });

  // ---- bare earth; a river of gravel poured in one sweeping line ----
  await setRange('light', 0.6);
  await setRange('humidity', 0.86);
  await park();
  await F(12);
  await tab('Ground');
  await setRange('size', 0.085);
  await stroke(curve([[352, 70], [268, 190], [292, 330], [236, 470], [262, 600], [200, 690]]), 34);
  await stroke(curve([[214, 640], [300, 560], [318, 420], [330, 250], [300, 120]]), 22);

  // ---- raked: a spiral where the main stone will stand, a long wave downstream ----
  await tool('Rake');
  await setRange('size', 0.05);
  await stroke(spiral(272, 330, 10, 62, 2.6), 36);
  await stroke(curve([[250, 440], [300, 500], [236, 570], [280, 640]]), 18);

  // ---- stones, a branch, a lantern, a basin ----
  await tab('Objects');
  await place('Rock', 272, 330, { wheel: 3, frames: 7 });
  await place('Rock', 226, 382, { wheel: -2, frames: 6 });
  await place('Flat stone', 262, 520, { frames: 6 });
  await place('Flat stone', 228, 590, { frames: 6 });
  await place('Flat stone', 268, 655, { frames: 6 });
  await place('Branch', 112, 468, { turn: 2, frames: 7 });
  await place('Lantern', 92, 176, { wheel: 2, frames: 7 });
  await place('Basin', 318, 128, { frames: 7 });
  await page.keyboard.press('Escape');

  // ---- sow in one long wandering gesture, then a breath of mist ----
  await tab('Moss');
  await setRange('size', 0.055);
  await stroke(curve([[150, 60], [60, 110], [170, 210], [70, 300], [160, 380], [60, 470], [150, 560], [70, 660]]), 40);
  await tool('Mist');
  await stroke(curve([[40, 640], [150, 470], [60, 300], [170, 130], [240, 60]]), 22);
  await park();
  await bare(true);

  // ---- years pass over the whole garden, with one slow visit to the moss front ----
  const lapse = (i, n) => Math.round(6 + 28 * ease(Math.min(1, i / 40)) * ease(Math.min(1, (n - i) / 20)));
  for (let i = 0; i < 90; i++) await F(1, lapse(i, 90), null);
  await F(70, 22, { ...uv(120, 300), z: 2.3 });
  await F(50, 14, { ...uv(150, 360), z: 2.0 });
  await F(80, 26, { x: 0.5, y: 0.5, z: 1 });

  // ---- rain, then mushrooms on the old branch ----
  await page.evaluate(() => { window.__moss.world.rainLeft = 3.6; });
  await F(96, 4, { x: 0.5, y: 0.48, z: 1.1 });
  await F(84, 5, { ...uv(118, 470), z: 2.6 });

  // ---- dusk, lantern light and fireflies, dawn over the finished garden ----
  await page.evaluate(() => window.__moss.setMood('dusk'));
  await F(56, 3, { x: 0.5, y: 0.5, z: 1 });
  await page.evaluate(() => window.__moss.setMood('night'));
  await F(72, 3, { ...uv(120, 210), z: 1.6 });
  await page.evaluate(() => window.__moss.setMood('dawn'));
  await F(70, 3, { x: 0.5, y: 0.5, z: 1 });
  await page.evaluate(() => window.__moss.setMood('day'));
  await F(40, 3);

  console.log('frames', n, 'seconds', ((Date.now() - t0) / 1000).toFixed(0));
  await browser.close();
})();
