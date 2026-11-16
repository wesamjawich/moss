import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VERT } from './shaders/common.js';
import { BAKE_FRAG } from './shaders/bake.js';
import { INIT_FRAG, SIM_FRAG, STATS_FRAG } from './shaders/sim.js';
import { RENDER_FRAG, MOTE_VERT, MOTE_FRAG } from './shaders/render.js';

// Grid sizes can be lowered for slow GPUs, e.g. ?sim=512&sub=1024
const query = new URLSearchParams(location.search);
const SIM = +query.get('sim') || 1024;      // simulation grid
const SUB = +query.get('sub') || 2048;      // baked substrate resolution
const DAYS_PER_STEP = 1.5;

const $ = (id) => document.getElementById(id);
const canvas = $('view');

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  if (!renderer.capabilities.isWebGL2) throw new Error('WebGL 2 required');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;

  // ---------- fullscreen pass helpers ----------
  const quad = new THREE.PlaneGeometry(2, 2);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const passScene = new THREE.Scene();
  const passMesh = new THREE.Mesh(quad);
  passMesh.frustumCulled = false;
  passScene.add(passMesh);
  const mat = (fragmentShader, uniforms) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false,
  });
  const runPass = (material, target) => {
    passMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(passScene, cam);
    renderer.setRenderTarget(null);
  };
  const target = (size, type = THREE.HalfFloatType) => new THREE.WebGLRenderTarget(size, size, {
    type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
  });

  const subRT = target(SUB);
  let stateA = target(SIM), stateB = target(SIM);
  const statsRT = target(32, THREE.UnsignedByteType);
  const statsBuf = new Uint8Array(32 * 32 * 4);

  const simScale = new THREE.Vector2(1, 1);
  const world = { seed: Math.random() * 100, type: 0, steps: 0, rain: 0, rainLeft: 0 };
  const brush = { a: new THREE.Vector2(), b: new THREE.Vector2(), down: false, mode: 1, radius: 0.04 };

  const bakeMat = mat(BAKE_FRAG, { uSeed: { value: 0 }, uType: { value: 0 } });
  const initMat = mat(INIT_FRAG, { uSub: { value: subRT.texture }, uSimScale: { value: simScale }, uSeed: { value: 0 }, uSeedMoss: { value: 1 } });
  const simMat = mat(SIM_FRAG, {
    uState: { value: null }, uSub: { value: subRT.texture }, uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
    uSeed: { value: 0 }, uDt: { value: 1 }, uHumidity: { value: 0.72 }, uLight: { value: 0.5 }, uRain: { value: 0 },
    uBrushA: { value: brush.a }, uBrushB: { value: brush.b }, uBrushR: { value: brush.radius }, uBrushMode: { value: 0 },
  });
  const statsMat = mat(STATS_FRAG, { uState: { value: null }, uSimScale: { value: simScale } });
  const viewMat = mat(RENDER_FRAG, {
    uState: { value: null }, uSub: { value: subRT.texture }, uRes: { value: new THREE.Vector2(1, 1) },
    uSimScale: { value: simScale }, uStateSize: { value: new THREE.Vector2(SIM, SIM) },
    uTime: { value: 0 }, uLight: { value: 0.5 }, uRain: { value: 0 }, uType: { value: 0 },
  });

  // ---------- visible scene: the surface plus drifting motes of pollen ----------
  const scene = new THREE.Scene();
  const surface = new THREE.Mesh(quad, viewMat);
  surface.frustumCulled = false;
  scene.add(surface);

  const MOTES = 90;
  const moteGeo = new THREE.BufferGeometry();
  const mp = new Float32Array(MOTES * 3), mr = new Float32Array(MOTES * 4);
  for (let i = 0; i < MOTES; i++) {
    mp[i * 3] = Math.random() * 2 - 1; mp[i * 3 + 1] = Math.random() * 2 - 1;
    for (let k = 0; k < 4; k++) mr[i * 4 + k] = Math.random();
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  moteGeo.setAttribute('aRnd', new THREE.BufferAttribute(mr, 4));
  const moteMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
    uniforms: { uTime: viewMat.uniforms.uTime, uPx: { value: 1 }, uAspect: { value: 1 }, uLight: viewMat.uniforms.uLight },
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  scene.add(motes);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.75, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- simulation ----------
  function step(dt, useBrush) {
    const u = simMat.uniforms;
    u.uState.value = stateA.texture;
    u.uSeed.value = Math.random() * 1000;
    u.uDt.value = dt;
    u.uRain.value = dt > 0 ? world.rain : 0;
    u.uBrushMode.value = useBrush ? brush.mode : 0;
    u.uBrushR.value = brush.radius;
    runPass(simMat, stateB);
    [stateA, stateB] = [stateB, stateA];
    world.steps += dt;
  }

  function seedMoss(amount) {
    initMat.uniforms.uSeed.value = world.seed;
    initMat.uniforms.uSeedMoss.value = amount;
    runPass(initMat, stateA);
    world.steps = 0;
    if (amount > 0) for (let i = 0; i < 260; i++) step(1, false);   // let the first colonies settle in
  }

  function bake() {
    bakeMat.uniforms.uSeed.value = world.seed;
    bakeMat.uniforms.uType.value = world.type;
    runPass(bakeMat, subRT);
    viewMat.uniforms.uType.value = world.type;
  }

  // ---------- layout ----------
  let cssW = 1, cssH = 1, quality = 1;
  function resize() {
    cssW = window.innerWidth; cssH = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const budget = 3.2e6;                                   // keep the fragment load reasonable on 4K screens
    if (cssW * cssH * dpr * dpr > budget) dpr = Math.sqrt(budget / (cssW * cssH));
    dpr *= quality;
    renderer.setPixelRatio(dpr);
    renderer.setSize(cssW, cssH, false);
    composer.setPixelRatio(dpr);
    composer.setSize(cssW, cssH);
    const aspect = cssW / cssH;
    if (aspect >= 1) simScale.set(1, 1 / aspect); else simScale.set(aspect, 1);
    viewMat.uniforms.uRes.value.set(cssW * dpr, cssH * dpr);
    moteMat.uniforms.uPx.value = dpr;
    sizeRing();
  }

  // ---------- input ----------
  const ring = $('ring');
  const hint = $('hint');
  const toSim = (x, y, out) => out.set((x / cssW - 0.5) * simScale.x + 0.5, (0.5 - y / cssH) * simScale.y + 0.5);
  function sizeRing() {
    const d = 2 * brush.radius / simScale.x * cssW;
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.marginLeft = ring.style.marginTop = `${-d / 2}px`;
  }
  const moveRing = (e) => {
    ring.hidden = e.pointerType !== 'mouse' && !brush.down;
    ring.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    brush.down = true;
    toSim(e.clientX, e.clientY, brush.b); brush.a.copy(brush.b);
    moveRing(e);
    hint.classList.add('gone');
    $('panel').hidden = true; $('tune').setAttribute('aria-expanded', 'false');
  });
  canvas.addEventListener('pointermove', (e) => {
    moveRing(e);
    if (brush.down) toSim(e.clientX, e.clientY, brush.b);
  });
  const lift = (e) => { brush.down = false; if (e.pointerType !== 'mouse') ring.hidden = true; };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('pointerleave', () => { if (!brush.down) ring.hidden = true; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setSize(brush.radius * (e.deltaY > 0 ? 0.9 : 1.1));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const toolButtons = [...document.querySelectorAll('[data-tool]')];
  function setTool(n) {
    brush.mode = n;
    toolButtons.forEach((b) => b.classList.toggle('on', +b.dataset.tool === n));
  }
  toolButtons.forEach((b) => b.addEventListener('click', () => setTool(+b.dataset.tool)));

  function setSize(r) {
    brush.radius = Math.min(0.12, Math.max(0.01, r));
    $('size').value = brush.radius;
    $('sizeOut').value = brush.radius < 0.03 ? 'S' : brush.radius < 0.07 ? 'M' : 'L';
    sizeRing();
  }
  let speed = 2;
  const bind = (id, fn) => { const el = $(id); el.addEventListener('input', () => fn(+el.value)); fn(+el.value); };
  bind('speed', (v) => { speed = v; $('speedOut').value = v === 0 ? 'Still' : `${v}×`; });
  bind('humidity', (v) => { simMat.uniforms.uHumidity.value = v; $('humidityOut').value = `${Math.round(v * 100)}%`; });
  bind('light', (v) => { simMat.uniforms.uLight.value = v; viewMat.uniforms.uLight.value = v; $('lightOut').value = `${Math.round(v * 100)}%`; });
  bind('size', setSize);

  const rainBtn = $('rain');
  const rain = () => { world.rainLeft = world.rainLeft > 0 ? 0 : 7; };
  rainBtn.addEventListener('click', rain);
  $('tune').addEventListener('click', () => {
    const p = $('panel');
    p.hidden = !p.hidden;
    $('tune').setAttribute('aria-expanded', String(!p.hidden));
  });
  $('surface').addEventListener('click', () => {
    world.type = 1 - world.type;
    $('surface').textContent = world.type ? 'Surface: cedar bark' : 'Surface: stone';
    bake(); seedMoss(1);
  });
  $('fresh').addEventListener('click', () => { world.seed = Math.random() * 100; bake(); seedMoss(1); });
  $('clear').addEventListener('click', () => seedMoss(0));
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key >= '1' && e.key <= '4') setTool(+e.key);
    else if (e.key === "r" || e.key === "R") rain();
    else if (e.key === '[') setSize(brush.radius * 0.85);
    else if (e.key === ']') setSize(brush.radius * 1.15);
  });
  window.addEventListener('resize', resize);

  // ---------- loop ----------
  const readout = $('readout');
  let last = performance.now(), frame = 0, time = 0, slow = 0;
  function tick(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now; time += dtReal; frame++;

    // Ease the render resolution down if this GPU cannot keep up.
    slow = dtReal > 0.026 ? slow + 1 : Math.max(0, slow - 2);
    if (slow > 45 && quality > 0.5 && frame > 30) { quality *= 0.82; slow = 0; resize(); }

    if (world.rainLeft > 0) world.rainLeft -= dtReal;
    const rainTarget = world.rainLeft > 0 ? 1 : 0;
    world.rain += (rainTarget - world.rain) * Math.min(1, dtReal * 2.5);
    rainBtn.classList.toggle('live', world.rainLeft > 0);

    // The brush is applied once per frame so its strength does not depend on the time setting.
    if (speed === 0) { if (brush.down || world.rain > 0.02) step(0, brush.down); }
    else for (let i = 0; i < speed; i++) step(1, brush.down && i === 0);
    brush.a.copy(brush.b);

    viewMat.uniforms.uState.value = stateA.texture;
    viewMat.uniforms.uTime.value = time;
    viewMat.uniforms.uRain.value = world.rain;
    composer.render();

    if (frame % 20 === 0) {
      statsMat.uniforms.uState.value = stateA.texture;
      runPass(statsMat, statsRT);
      renderer.readRenderTargetPixels(statsRT, 0, 0, 32, 32, statsBuf);
      let c = 0;
      for (let i = 0; i < statsBuf.length; i += 4) c += statsBuf[i];
      const cover = c / (32 * 32 * 255);
      const year = Math.floor(world.steps * DAYS_PER_STEP / 365) + 1;
      readout.textContent = `Year ${year} · moss cover ${Math.round(cover * 100)}%`;
    }
    requestAnimationFrame(tick);
  }

  resize();
  bake();
  seedMoss(1);
  setTool(1);
  window.__moss = { step, world, brush, simMat };
  requestAnimationFrame(tick);
}

try {
  start();
} catch (err) {
  console.error(err);
  $('fail').hidden = false;
  $('hint').hidden = true;
}
