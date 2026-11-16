import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VERT } from './shaders/common.js';
import { HEIGHT_FRAG, SUB_FRAG, MAX_OBJECTS } from './shaders/bake.js';
import { GROUND_INIT_FRAG, GROUND_BRUSH_FRAG, GROUND_LOAD_FRAG, STATE_LOAD_FRAG, SNAPSHOT_FRAG } from './shaders/ground.js';
import { INIT_FRAG, SIM_FRAG, STATS_FRAG } from './shaders/sim.js';
import { RENDER_FRAG, MOTE_VERT, MOTE_FRAG, PETAL_VERT, PETAL_FRAG } from './shaders/render.js';
import { TYPES, makeObject, hit, footprint, composeGarden } from './garden.js';
import { createAmbience } from './audio.js';

// Grid sizes can be lowered for slow GPUs, e.g. ?sim=512&sub=1024
const query = new URLSearchParams(location.search);
const SIM = +query.get('sim') || 1024;      // moss simulation grid
const SUB = +query.get('sub') || 2048;      // baked relief resolution
const GROUND = +query.get('ground') || 1024;
const DAYS_PER_STEP = 1.5;
const BASE_STEPS = 1.25;                    // simulation steps per frame at 1× (60 fps)
const SPEEDS = [0, 0.25, 0.5, 1, 2, 4, 8];
const STORE_KEY = 'koke.garden.v1';
const CAPTURE = query.has('capture');

const $ = (id) => document.getElementById(id);
const canvas = $('view');

const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
const ICON = {
  sow: '<g class="f"><circle cx="7" cy="8" r="1.4"/><circle cx="13" cy="5" r="1.1"/><circle cx="17" cy="10" r="1.5"/><circle cx="10" cy="13" r="1.2"/><circle cx="15" cy="16" r="1.1"/><circle cx="7" cy="18" r="1.4"/></g>',
  mist: '<path d="M12 3.5c3 3.6 5.2 6.4 5.2 9.4a5.2 5.2 0 0 1-10.4 0c0-3 2.2-5.8 5.2-9.4z"/>',
  warm: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.400l1.8-1.8"/>',
  scrape: '<path d="M5 19l9.5-9.5M13 5.500l5.500 5.500-3 3-5.500-5.500z"/>',
  rain: '<path d="M7 14.500a4 4 0 0 1 .6-7.960 5 5 0 0 1 9.600 1.200A3.400 3.400 0 0 1 17 14.500z"/><path d="M9 17.500l-1 2.500M13 17.500l-1 2.500M17 17.500l-1 2.500"/>',
  gravel: '<circle cx="6.500" cy="13.500" r="2.300"/><circle cx="12.500" cy="8.500" r="2.700"/><circle cx="17.500" cy="14.500" r="2.400"/><circle cx="11.500" cy="17.500" r="1.800"/>',
  soil: '<path d="M3 18c3-7 6-9.500 9-9.500s6 2.500 9 9.500z"/>',
  rake: '<path d="M12 3v9M6 12h12M6 12v7M10 12v7M14 12v7M18 12v7"/>',
  leaves: '<path d="M12 21v-9M12 12c-5 0-7.500-3-7.500-7.500 4.500 0 7.500 2.500 7.500 7.500zM12 15c4 0 7-2 7-6.500-4 0-7 2-7 6.500z"/>',
  sweep: '<path d="M19 4l-8 9M8.500 11.500l5 4.500-2 4.500H5.500l-1.500-3z"/>',
  rock: '<path d="M4 18l2.500-8.500 6.500-3.500 6 4.500 1 7.500z"/>',
  flat: '<ellipse cx="12" cy="13" rx="8.500" ry="4.500"/>',
  branch: '<path d="M3 17c5-1 11-3.500 18-9M11.500 13.500l2.500-6.500M8 15.500l-1.500 4"/>',
  lantern: '<path d="M12 3v2M5.500 9.500L12 5l6.500 4.500zM8 9.500V15h8V9.500M7 15h10M10 15v5.500h4V15"/>',
  basin: '<path d="M4 10h16l-2 8.500H6zM8 10c0-2.300 8-2.300 8 0"/>',
  jizo: '<circle cx="12" cy="7" r="3"/><path d="M7 20.500c0-6.500 2-9.500 5-9.500s5 3 5 9.500z"/>',
  bridge: '<path d="M3 14.500c5-5 13-5 18 0M3 18.500c5-5 13-5 18 0M7 12v4M12 10.800v4M17 12v4"/>',
  camera: '<path d="M4 8h3l2-2.500h6L17 8h3v11H4z"/><circle cx="12" cy="13.200" r="3.400"/>',
  sound: '<path d="M4 10v4h3l5 4V6l-5 4zM15.500 9c1.600 1.600 1.600 4.400 0 6M18 6.500c3 3 3 8 0 11"/>',
  eye: '<path d="M2.500 12c3-5 6-7 9.500-7s6.500 2 9.500 7c-3 5-6 7-9.500 7s-6.500-2-9.500-7z"/><circle cx="12" cy="12" r="3"/>',
};

// Tool groups shown in the dock. brush = sim brush mode, ground = ground brush mode, place = object type.
const GROUPS = [
  { key: 'moss', label: 'Moss', hint: 'Press and drag to sow moss', tools: [
    { key: 'sow', label: 'Sow', icon: 'sow', brush: 1 },
    { key: 'mist', label: 'Mist', icon: 'mist', brush: 2 },
    { key: 'warm', label: 'Warm', icon: 'warm', brush: 3 },
    { key: 'scrape', label: 'Scrape', icon: 'scrape', brush: 4 },
    { key: 'rain', label: 'Rain', icon: 'rain', action: 'rain' },
  ] },
  { key: 'ground', label: 'Ground', hint: 'Lay gravel, then rake it', tools: [
    { key: 'gravel', label: 'Gravel', icon: 'gravel', ground: 1, brush: 4 },
    { key: 'soil', label: 'Soil', icon: 'soil', ground: 2 },
    { key: 'rake', label: 'Rake', icon: 'rake', ground: 3 },
    { key: 'leaves', label: 'Leaves', icon: 'leaves', ground: 4 },
    { key: 'sweep', label: 'Sweep', icon: 'sweep', ground: 5 },
  ] },
  { key: 'objects', label: 'Objects', hint: 'Tap an object to add it, then drag it into place', tools: [
    { key: 'rock', label: 'Rock', icon: 'rock', place: 0 },
    { key: 'flat', label: 'Flat stone', icon: 'flat', place: 1 },
    { key: 'branch', label: 'Branch', icon: 'branch', place: 2 },
    { key: 'lantern', label: 'Lantern', icon: 'lantern', place: 3 },
    { key: 'basin', label: 'Basin', icon: 'basin', place: 4 },
    { key: 'jizo', label: 'Jizō', icon: 'jizo', place: 5 },
    { key: 'bridge', label: 'Bridge', icon: 'bridge', place: 6 },
  ] },
  { key: 'scene', label: 'Scene', tools: null },
];

const MOODS = {
  dawn: { sun: [0.75, 0.38, 0.30], sunCol: [3.3, 2.35, 2.05], sky: [0.27, 0.30, 0.36], mist: 0.36, night: 0 },
  day: { sun: [-0.60, 0.55, 0.42], sunCol: [4.6, 4.0, 2.95], sky: [0.27, 0.32, 0.30], mist: 0.0, night: 0 },
  dusk: { sun: [-0.80, -0.28, 0.25], sunCol: [4.6, 2.5, 1.10], sky: [0.20, 0.21, 0.30], mist: 0.10, night: 0.25 },
  night: { sun: [0.38, 0.60, 0.55], sunCol: [0.42, 0.56, 0.85], sky: [0.030, 0.052, 0.090], mist: 0.18, night: 1 },
};

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
  const target = (size, type = THREE.HalfFloatType, count = 1) => new THREE.WebGLRenderTarget(size, size, {
    count, type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false,
  });

  const heightRT = target(SUB, THREE.HalfFloatType, 2);
  const subRT = target(SUB);
  let stateA = target(SIM), stateB = target(SIM);
  let groundA = target(GROUND), groundB = target(GROUND);
  const statsRT = target(32, THREE.UnsignedByteType);
  const statsBuf = new Uint8Array(32 * 32 * 4);

  const simScale = new THREE.Vector2(1, 1);
  const world = { seed: Math.random() * 100, steps: 0, rain: 0, wet: 0, rainLeft: 0, objects: [], mood: 'day', petals: false, shroom: 0, nature: !CAPTURE, nextRain: 90, nextMood: 100 };
  const brush = { a: new THREE.Vector2(), b: new THREE.Vector2(), dir: new THREE.Vector2(1, 0), down: false, radius: 0.04 };
  const flags = { bake: true, groundSave: true, saveAt: 0 };

  const objA = Array.from({ length: MAX_OBJECTS }, () => new THREE.Vector4());
  const objB = Array.from({ length: MAX_OBJECTS }, () => new THREE.Vector4());
  const lamps = Array.from({ length: 4 }, () => new THREE.Vector4());

  const heightMat = mat(HEIGHT_FRAG, { uGround: { value: null }, uObjA: { value: objA }, uObjB: { value: objB }, uCount: { value: 0 }, uSeed: { value: 0 } });
  const subMat = mat(SUB_FRAG, { uH: { value: heightRT.textures[0] }, uM: { value: heightRT.textures[1] }, uSeed: { value: 0 } });
  const groundInitMat = mat(GROUND_INIT_FRAG, { uSimScale: { value: simScale }, uSeed: { value: 0 }, uStyle: { value: 0 } });
  const groundBrushMat = mat(GROUND_BRUSH_FRAG, {
    uGround: { value: null }, uA: { value: brush.a }, uB: { value: brush.b }, uDir: { value: brush.dir }, uR: { value: 0.04 }, uMode: { value: 0 },
  });
  const initMat = mat(INIT_FRAG, { uSub: { value: subRT.texture }, uSimScale: { value: simScale }, uSeed: { value: 0 }, uSeedMoss: { value: 1 } });
  const simMat = mat(SIM_FRAG, {
    uState: { value: null }, uSub: { value: subRT.texture }, uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
    uSeed: { value: 0 }, uDt: { value: 1 }, uHumidity: { value: 0.72 }, uLight: { value: 0.5 }, uRain: { value: 0 },
    uBrushA: { value: new THREE.Vector2() }, uBrushB: { value: new THREE.Vector2() }, uBrushR: { value: 0.04 }, uBrushMode: { value: 0 },
  });
  const statsMat = mat(STATS_FRAG, { uState: { value: null }, uSimScale: { value: simScale } });
  const viewMat = mat(RENDER_FRAG, {
    uState: { value: null }, uSub: { value: subRT.texture }, uTex0: { value: heightRT.textures[0] }, uTex1: { value: heightRT.textures[1] },
    uGround: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uSimScale: { value: simScale }, uView: { value: new THREE.Vector3(0.5, 0.5, 1) }, uStateSize: { value: new THREE.Vector2(SIM, SIM) },
    uTime: { value: 0 }, uLight: { value: 0.5 }, uRain: { value: 0 }, uWet: { value: 0 }, uAge: { value: 0 }, uShroom: { value: 0 },
    uSun: { value: new THREE.Vector3(...MOODS.day.sun) }, uSunCol: { value: new THREE.Vector3(...MOODS.day.sunCol) },
    uSkyCol: { value: new THREE.Vector3(...MOODS.day.sky) }, uMist: { value: 0 }, uNight: { value: 0 }, uLamps: { value: lamps },
  });

  // ---------- visible scene: the garden plus things adrift in the air ----------
  const scene = new THREE.Scene();
  const surface = new THREE.Mesh(quad, viewMat);
  surface.frustumCulled = false;
  scene.add(surface);

  const cloud = (n) => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), rnd = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 2 - 1; pos[i * 3 + 1] = Math.random() * 2 - 1;
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    return geo;
  };
  const uPx = { value: 1 };
  const drift = (n, speed, size) => {
    const m = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      uniforms: { uTime: viewMat.uniforms.uTime, uPx, uSpeed: { value: speed }, uSize: { value: size }, uColor: { value: new THREE.Vector3() } },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    });
    const pts = new THREE.Points(cloud(n), m);
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  };
  const pollen = drift(90, 1, 1);
  const fireflies = drift(44, 2, 1.25);
  const petalMat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG,
    uniforms: { uTime: viewMat.uniforms.uTime, uPx, uTint: { value: new THREE.Vector3(1, 1, 1) } },
    depthTest: false, depthWrite: false, transparent: true,
  });
  const petals = new THREE.Points(cloud(46), petalMat);
  petals.frustumCulled = false;
  petals.visible = false;
  scene.add(petals);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.75, 0.9));
  composer.addPass(new OutputPass());

  // ---------- simulation ----------
  function step(dt, mode = 0, ax = 0, ay = 0, bx = 0, by = 0, r = 0.04) {
    const u = simMat.uniforms;
    u.uState.value = stateA.texture;
    u.uSeed.value = Math.random() * 1000;
    u.uDt.value = dt;
    u.uRain.value = dt > 0 ? world.rain : 0;
    u.uBrushMode.value = mode;
    u.uBrushA.value.set(ax, ay); u.uBrushB.value.set(bx, by); u.uBrushR.value = r;
    runPass(simMat, stateB);
    [stateA, stateB] = [stateB, stateA];
    world.steps += dt;
  }

  function bake() {
    const n = Math.min(world.objects.length, MAX_OBJECTS);
    let l = 0;
    lamps.forEach((v) => v.set(0, 0, 1, 0));
    for (let i = 0; i < n; i++) {
      const o = world.objects[i];
      objA[i].set(o.x, o.y, o.rot, o.scale);
      objB[i].set(o.type, o.seed, 0, 0);
      if (o.type === 3 && l < 4) lamps[l++].set(o.x, o.y, o.scale, 1);
    }
    heightMat.uniforms.uCount.value = n;
    heightMat.uniforms.uSeed.value = world.seed;
    heightMat.uniforms.uGround.value = groundA.texture;
    subMat.uniforms.uSeed.value = world.seed;
    runPass(heightMat, heightRT);
    runPass(subMat, subRT);
    flags.bake = false;
  }

  function groundStroke(mode, r) {
    const u = groundBrushMat.uniforms;
    u.uGround.value = groundA.texture; u.uMode.value = mode; u.uR.value = r;
    runPass(groundBrushMat, groundB);
    [groundA, groundB] = [groundB, groundA];
    if (mode <= 3) flags.bake = true;
    flags.groundSave = true;
    touch();
  }

  const clearUnder = (o) => { const f = footprint(o); step(0, 5, f.ax, f.ay, f.bx, f.by, f.r); };

  function newGarden(kind, rnd = Math.random) {
    world.seed = rnd() * 100;
    const g = composeGarden(kind, simScale, rnd);
    world.objects = g.objects;
    groundInitMat.uniforms.uSeed.value = world.seed;
    groundInitMat.uniforms.uStyle.value = g.style;
    runPass(groundInitMat, groundA);
    bake();
    initMat.uniforms.uSeed.value = world.seed;
    initMat.uniforms.uSeedMoss.value = kind === 'bare' ? 0 : 1;
    runPass(initMat, stateA);
    world.steps = 0;
    if (kind !== 'bare') for (let i = 0; i < 260; i++) step(1);   // let the first colonies settle in
    select(null);
    flags.groundSave = true;
    touch();
  }

  // ---------- saving the garden in this browser ----------
  const touch = () => { flags.saveAt = performance.now() + 2500; };
  const snapMat = mat(SNAPSHOT_FRAG, { uGround: { value: null }, uState: { value: null }, uWhich: { value: 0 } });
  const snapRTs = {};
  function snapshot(which, size) {
    const rt = snapRTs[size] || (snapRTs[size] = target(size, THREE.UnsignedByteType));
    snapMat.uniforms.uGround.value = groundA.texture;
    snapMat.uniforms.uState.value = stateA.texture;
    snapMat.uniforms.uWhich.value = which;
    runPass(snapMat, rt);
    const buf = new Uint8ClampedArray(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').putImageData(new ImageData(buf, size, size), 0, 0);
    return c.toDataURL('image/png');
  }
  let savedGround = null;
  function save() {
    flags.saveAt = performance.now() + 30000;
    try {
      if (flags.groundSave || !savedGround) { savedGround = snapshot(0, Math.min(GROUND, 1024)); flags.groundSave = false; }
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1, seed: world.seed, steps: world.steps, objects: world.objects, mood: world.mood, petals: world.petals, nature: world.nature,
        humidity: +$('humidity').value, light: +$('light').value, speed: +$('speed').value,
        ground: savedGround, moss: snapshot(1, 256),
      }));
    } catch (err) { /* storage unavailable or full: the garden simply is not kept */ }
  }
  const loadTexture = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const t = new THREE.Texture(img);
      t.flipY = false; t.premultiplyAlpha = false; t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
      resolve(t);
    };
    img.onerror = reject;
    img.src = url;
  });
  async function restore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (err) { return false; }
    if (!data || data.v !== 1 || !data.ground || !data.moss || !Array.isArray(data.objects)) return false;
    const [gt, mt] = await Promise.all([loadTexture(data.ground), loadTexture(data.moss)]);
    world.seed = data.seed; world.steps = data.steps || 0;
    world.objects = data.objects.filter((o) => TYPES[o.type]).slice(0, MAX_OBJECTS);
    runPass(mat(GROUND_LOAD_FRAG, { uImg: { value: gt }, uMoss: { value: mt } }), groundA);
    bake();
    runPass(mat(STATE_LOAD_FRAG, { uMoss: { value: mt } }), stateA);
    gt.dispose(); mt.dispose();
    for (const [id, v] of [['humidity', data.humidity], ['light', data.light], ['speed', data.speed]]) {
      if (typeof v === 'number') { $(id).value = v; $(id).dispatchEvent(new Event('input')); }
    }
    setMood(MOODS[data.mood] ? data.mood : 'day', true);
    setPetals(!!data.petals);
    if (typeof data.nature === 'boolean') setNature(data.nature);
    savedGround = data.ground; flags.groundSave = false;
    return true;
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
    uPx.value = dpr;
    sizeRing();
  }
  // The camera: centre (x, y) and zoom. Zoom 1 shows the whole garden.
  const view = viewMat.uniforms.uView.value;
  const toSim = (x, y, out) => out.set((x / cssW - 0.5) * simScale.x / view.z + view.x, (0.5 - y / cssH) * simScale.y / view.z + view.y);
  const toScreen = (x, y) => [((x - view.x) * view.z / simScale.x + 0.5) * cssW, (0.5 - (y - view.y) * view.z / simScale.y) * cssH];
  const uvToPx = (r) => r * view.z / simScale.x * cssW;
  function setView(x, y, z) {
    z = Math.min(6, Math.max(1, z));
    const hx = simScale.x / 2 * (1 - 1 / z), hy = simScale.y / 2 * (1 - 1 / z);
    view.set(Math.min(0.5 + hx, Math.max(0.5 - hx, x)), Math.min(0.5 + hy, Math.max(0.5 - hy, y)), z);
    sizeRing();
  }
  // Zoom by `factor`, keeping the garden point under screen position (sx, sy) fixed.
  function zoomAt(sx, sy, factor) {
    const before = toSim(sx, sy, new THREE.Vector2());
    const z = Math.min(6, Math.max(1, view.z * factor));
    setView(before.x - (sx / cssW - 0.5) * simScale.x / z, before.y - (0.5 - sy / cssH) * simScale.y / z, z);
  }

  // ---------- tools ----------
  const ring = $('ring'), selRing = $('sel'), hint = $('hint');
  let group = GROUPS[0], tool = GROUPS[0].tools[0];
  const lastTool = {};
  let selected = null, dragging = null;
  const grab = new THREE.Vector2(), ptr = new THREE.Vector2();

  function sizeRing() {
    const d = 2 * uvToPx(brush.radius * (tool && tool.ground === 3 ? 0.6 : 1));
    ring.style.width = ring.style.height = `${d}px`;
    ring.style.marginLeft = ring.style.marginTop = `${-d / 2}px`;
  }
  function renderTools() {
    const box = $('tools');
    box.innerHTML = '';
    box.hidden = !group.tools;
    for (const t of group.tools || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `${svg(ICON[t.icon])}<span>${t.label}</span>`;
      b.classList.toggle('on', t === tool && !t.action && t.place === undefined);
      if (t.action === 'rain') b.id = 'rainBtn';
      b.addEventListener('click', () => {
        if (t.action === 'rain') { world.rainLeft = world.rainLeft > 0 ? 0 : 12; return; }
        if (t.place !== undefined) { addObject(t.place); return; }
        tool = t; lastTool[group.key] = t; renderTools(); sizeRing();
      });
      box.appendChild(b);
    }
    canvas.classList.toggle('arrange', group.key === 'objects');
  }
  function setGroup(key) {
    const g = GROUPS.find((x) => x.key === key);
    const scene = g.key === 'scene';
    if (scene && !$('panel').hidden) { $('panel').hidden = true; setGroup(lastTool.group || 'moss'); return; }
    $('panel').hidden = !scene;
    if (!scene) {
      group = g; lastTool.group = g.key;
      tool = lastTool[g.key] || g.tools.find((t) => !t.action) || null;
      if (g.key === 'objects') tool = null;
      else select(null);
      if (g.hint && !hint.classList.contains('gone')) hint.textContent = g.hint;
      renderTools(); sizeRing();
    } else select(null);
    [...$('tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.key === key));
  }
  for (const g of GROUPS) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = g.label; b.dataset.key = g.key; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => setGroup(g.key));
    $('tabs').appendChild(b);
  }

  // ---------- objects ----------
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function select(o) {
    // A newly added object clears the moss beneath it only once it has been put somewhere.
    if (selected && selected !== o && selected.fresh) { delete selected.fresh; clearUnder(selected); }
    selected = o;
    $('objpanel').hidden = !o;
    selRing.hidden = !o;
    if (!o) return;
    const t = TYPES[o.type];
    $('objname').textContent = t.name;
    $('objsize').value = (o.scale - t.size[0]) / (t.size[1] - t.size[0]);
    $('objturn').value = ((o.rot * 180 / Math.PI) % 360 + 360) % 360;
  }
  function addObject(type) {
    if (world.objects.length >= MAX_OBJECTS) { toast('The garden is full. Remove something first.'); return; }
    const j = () => (Math.random() - 0.5) * 0.18;
    const o = makeObject(type, 0.5 + j() * simScale.x, 0.5 + (0.08 + j()) * simScale.y);
    o.fresh = true;
    world.objects.push(o);
    flags.bake = true;
    hint.classList.add('gone');
    select(o);
    touch();
  }
  function placeSelRing() {
    if (!selected) return;
    const [x, y] = toScreen(selected.x, selected.y);
    const d = 2 * uvToPx(selected.scale) + 14;
    selRing.style.width = selRing.style.height = `${d}px`;
    selRing.style.transform = `translate(${x - d / 2}px, ${y - d / 2}px)`;
  }
  $('objsize').addEventListener('input', () => {
    if (!selected) return;
    const t = TYPES[selected.type];
    selected.scale = t.size[0] + (t.size[1] - t.size[0]) * +$('objsize').value;
    flags.bake = true; touch();
  });
  $('objsize').addEventListener('change', () => selected && clearUnder(selected));
  $('objturn').addEventListener('input', () => {
    if (!selected) return;
    selected.rot = +$('objturn').value * Math.PI / 180;
    flags.bake = true; touch();
  });
  $('objturn').addEventListener('change', () => selected && clearUnder(selected));
  $('objremove').addEventListener('click', () => {
    if (!selected) return;
    world.objects = world.objects.filter((o) => o !== selected);
    select(null);
    flags.bake = true; touch();
  });
  $('objdone').addEventListener('click', () => select(null));

  // ---------- pointer ----------
  const moveRing = (e) => {
    ring.hidden = group.key === 'objects' || (e.pointerType !== 'mouse' && !brush.down);
    ring.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  };
  // Two fingers (or the middle mouse button) move the camera instead of the brush.
  const fingers = new Map();
  let pinch = null;
  const pinchState = () => {
    const [a, b] = [...fingers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (fingers.size === 2 || e.button === 1) {
      e.preventDefault();
      if (dragging) { clearUnder(dragging); dragging = null; }
      brush.down = false; ring.hidden = true;
      pinch = fingers.size === 2 ? pinchState() : { d: 0, mx: e.clientX, my: e.clientY };
      return;
    }
    toSim(e.clientX, e.clientY, ptr);
    hint.classList.add('gone');
    if (!$('panel').hidden) setGroup('scene');
    if (group.key === 'objects') {
      const pad = e.pointerType === 'mouse' ? 0.004 : 0.02;
      let found = null;
      for (let i = world.objects.length - 1; i >= 0 && !found; i--) if (hit(world.objects[i], ptr.x, ptr.y, pad)) found = world.objects[i];
      select(found);
      if (found) { dragging = found; grab.set(ptr.x - found.x, ptr.y - found.y); }
      return;
    }
    brush.down = true;
    brush.a.copy(ptr); brush.b.copy(ptr);
    moveRing(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (fingers.has(e.pointerId)) fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      const now = fingers.size >= 2 ? pinchState() : { d: 0, mx: e.clientX, my: e.clientY };
      if (pinch.d > 0 && now.d > 0) zoomAt(now.mx, now.my, now.d / pinch.d);
      setView(view.x - (now.mx - pinch.mx) / cssW * simScale.x / view.z, view.y + (now.my - pinch.my) / cssH * simScale.y / view.z, view.z);
      pinch = now;
      return;
    }
    moveRing(e);
    toSim(e.clientX, e.clientY, ptr);
    if (dragging) {
      dragging.x = Math.min(0.98, Math.max(0.02, ptr.x - grab.x));
      dragging.y = Math.min(0.98, Math.max(0.02, ptr.y - grab.y));
      flags.bake = true;
    } else if (brush.down) brush.b.copy(ptr);
  });
  const lift = (e) => {
    fingers.delete(e.pointerId);
    if (pinch) { if (fingers.size < 2) pinch = null; return; }
    if (dragging) { delete dragging.fresh; clearUnder(dragging); dragging = null; touch(); }
    brush.down = false;
    if (e.pointerType !== 'mouse') ring.hidden = true;
  };
  canvas.addEventListener('pointerup', lift);
  canvas.addEventListener('pointercancel', lift);
  canvas.addEventListener('pointerleave', () => { if (!brush.down) ring.hidden = true; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const up = e.deltaY < 0;
    if (group.key === 'objects' && selected) {
      const t = TYPES[selected.type];
      if (e.shiftKey) selected.rot += up ? 0.12 : -0.12;
      else selected.scale = Math.min(t.size[1], Math.max(t.size[0], selected.scale * (up ? 1.06 : 0.94)));
      select(selected); flags.bake = true; touch();
    } else if (e.altKey) setSize(brush.radius * (up ? 1.1 : 0.9));
    else zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- scene controls ----------
  function setSize(r) {
    brush.radius = Math.min(0.12, Math.max(0.01, r));
    $('size').value = brush.radius;
    $('sizeOut').value = brush.radius < 0.03 ? 'S' : brush.radius < 0.07 ? 'M' : 'L';
    sizeRing();
  }
  let speed = 1;
  const bind = (id, fn) => { const el = $(id); el.addEventListener('input', () => { fn(+el.value); touch(); }); fn(+el.value); };
  bind('speed', (v) => { speed = SPEEDS[v]; $('speedOut').value = speed === 0 ? 'Still' : `${speed < 1 ? (speed === 0.25 ? '¼' : '½') : speed}×`; });
  bind('humidity', (v) => { simMat.uniforms.uHumidity.value = v; $('humidityOut').value = `${Math.round(v * 100)}%`; });
  bind('light', (v) => { simMat.uniforms.uLight.value = v; viewMat.uniforms.uLight.value = v; $('lightOut').value = `${Math.round(v * 100)}%`; });
  bind('size', setSize);

  const moodNow = { sun: new THREE.Vector3(...MOODS.day.sun), sunCol: new THREE.Vector3(...MOODS.day.sunCol), sky: new THREE.Vector3(...MOODS.day.sky), mist: 0, night: 0 };
  function setMood(name, instant) {
    world.mood = name;
    [...$('moods').children].forEach((b) => b.classList.toggle('on', b.dataset.mood === name));
    if (instant) blendMood(1);
    touch();
  }
  const tmp = new THREE.Vector3();
  function blendMood(k) {
    const m = MOODS[world.mood];
    moodNow.sun.lerp(tmp.set(...m.sun), k);
    moodNow.sunCol.lerp(tmp.set(...m.sunCol), k);
    moodNow.sky.lerp(tmp.set(...m.sky), k);
    moodNow.mist += (m.mist - moodNow.mist) * k;
    moodNow.night += (m.night - moodNow.night) * k;
    const u = viewMat.uniforms;
    u.uSun.value.copy(moodNow.sun); u.uSunCol.value.copy(moodNow.sunCol); u.uSkyCol.value.copy(moodNow.sky);
    u.uMist.value = moodNow.mist; u.uNight.value = moodNow.night;
    const day = 1 - Math.min(1, moodNow.night * 1.4);
    pollen.material.uniforms.uColor.value.set(1.0, 0.92, 0.70).multiplyScalar((0.10 + 0.5 * u.uLight.value) * day);
    fireflies.material.uniforms.uColor.value.set(0.80, 1.0, 0.22).multiplyScalar(2.2 * Math.max(0, moodNow.night - 0.3) / 0.7);
    fireflies.visible = moodNow.night > 0.32;
    petalMat.uniforms.uTint.value.setScalar(1 - 0.72 * moodNow.night);
  }
  [...$('moods').children].forEach((b) => b.addEventListener('click', () => { setNature(false); setMood(b.dataset.mood); }));
  // "Let nature run": showers drift in on their own and the light moves through the day.
  function setNature(v) {
    world.nature = v;
    $('nature').setAttribute('aria-pressed', String(v));
    touch();
  }
  $('nature').addEventListener('click', () => setNature(!world.nature));
  $('nature').setAttribute('aria-pressed', String(world.nature));
  const DAY_CYCLE = ['dawn', 'day', 'day', 'dusk', 'night'];
  let dayIndex = 1;
  function setPetals(v) {
    world.petals = v; petals.visible = v;
    $('petals').setAttribute('aria-pressed', String(v));
    touch();
  }
  $('petals').addEventListener('click', () => setPetals(!world.petals));

  // Replacing the whole garden takes two taps.
  const armed = (id, kind) => {
    const b = $(id), label = b.textContent;
    let timer = 0;
    b.addEventListener('click', () => {
      if (b.classList.contains('armed')) {
        clearTimeout(timer); b.classList.remove('armed'); b.textContent = label;
        newGarden(kind);
        return;
      }
      b.classList.add('armed'); b.textContent = 'Tap again to replace';
      timer = setTimeout(() => { b.classList.remove('armed'); b.textContent = label; }, 3000);
    });
  };
  armed('newComposed', 'composed'); armed('newSurprise', 'surprise'); armed('newBare', 'bare');

  // ---------- sound, hiding the controls, saving a picture ----------
  const ambience = createAmbience();
  $('sound').innerHTML = svg(ICON.sound);
  $('hide').innerHTML = svg(ICON.eye);
  $('show').innerHTML = svg(ICON.eye);
  $('shot').innerHTML = svg(ICON.camera);
  $('sound').addEventListener('click', () => {
    ambience.setEnabled(!ambience.enabled);
    $('sound').setAttribute('aria-pressed', String(ambience.enabled));
  });
  const setBare = (v) => { document.body.classList.toggle('bare', v); $('show').hidden = !v; if (v) select(null); };
  $('hide').addEventListener('click', () => setBare(true));
  $('show').addEventListener('click', () => setBare(false));

  let downloads;      // the hosting page's save capability, when the garden runs inside one
  async function savePicture() {
    composer.render();
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const g = out.getContext('2d');
    g.drawImage(canvas, 0, 0);
    const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
    if (!blob) { toast('The picture could not be made.'); return; }
    const filename = `koke-garden-${new Date().toISOString().slice(0, 10)}.png`;
    try {
      if (downloads === undefined) downloads = (window.claude && window.claude.use) ? await window.claude.use('downloads') : null;
      if (downloads) { await downloads.save({ filename, data: blob }); toast('Picture saved'); return; }
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ files: [file], title: 'My moss garden' });
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Picture saved');
    } catch (err) {
      if (err && (err.name === 'AbortError' || err.code === 'declined')) return;
      toast('Saving is not available here. Hide the controls and take a screenshot.');
    }
  }
  $('shot').addEventListener('click', savePicture);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '5' && group.tools && group.key !== 'objects') {
      const t = group.tools.filter((x) => !x.action)[+k - 1];
      if (t) { tool = t; lastTool[group.key] = t; renderTools(); sizeRing(); }
    } else if (k === 'r') world.rainLeft = world.rainLeft > 0 ? 0 : 12;
    else if (k === 'h') setBare(!document.body.classList.contains('bare'));
    else if (k === 'p') savePicture();
    else if (k === '0') setView(0.5, 0.5, 1);
    else if (k === '[') setSize(brush.radius * 0.85);
    else if (k === ']') setSize(brush.radius * 1.15);
    else if ((k === 'delete' || k === 'backspace') && selected) $('objremove').click();
    else if (k === 'escape') select(null);
  });
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---------- loop ----------
  const readout = $('readout');
  let last = performance.now(), frame = 0, time = 0, slow = 0, acc = 0;
  function tick(now) {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Ease the render resolution down if this GPU cannot keep up.
    slow = dtReal > 0.026 ? slow + 1 : Math.max(0, slow - 2);
    if (slow > 45 && quality > 0.5 && frame > 30) { quality *= 0.82; slow = 0; resize(); }
    advance(dtReal, now);
    requestAnimationFrame(tick);
  }
  // One frame of garden time. With ?capture the page does not run on its own: a recorder calls this per video frame.
  function advance(dtReal, now = performance.now()) {
    time += dtReal; frame++;

    if (world.rainLeft > 0) world.rainLeft -= dtReal;
    world.rain += ((world.rainLeft > 0 ? 1 : 0) - world.rain) * Math.min(1, dtReal * 2.5);
    const rainBtn = $('rainBtn');
    if (rainBtn) rainBtn.classList.toggle('live', world.rainLeft > 0);
    ambience.setRain(world.rain);
    // Surfaces soak quickly and stay wet for a while after the shower, drying faster in dry air.
    if (world.nature) {
      world.nextRain -= dtReal; world.nextMood -= dtReal;
      if (world.nextRain <= 0) { world.rainLeft = 10 + Math.random() * 10; world.nextRain = 120 + Math.random() * 150; }
      if (world.nextMood <= 0) { dayIndex = (dayIndex + 1) % DAY_CYCLE.length; setMood(DAY_CYCLE[dayIndex]); world.nextMood = 70 + Math.random() * 40; }
    }
    // Mushrooms come up in the minute after rain and fade over the following few.
    if (world.wet > 0.5) world.shroom = Math.min(1, world.shroom + dtReal / 25);
    else world.shroom = Math.max(0, world.shroom - dtReal / 240);
    if (world.rain > 0.3) world.wet += (1 - world.wet) * Math.min(1, dtReal * 0.6);
    else world.wet = Math.max(0, world.wet - dtReal * (1.5 - simMat.uniforms.uHumidity.value) / 40);

    // Brushes act once per frame so their strength does not depend on the time setting.
    let simBrush = 0;
    if (brush.down && tool) {
      const moved = brush.a.distanceTo(brush.b);
      if (tool.ground) {
        const r = brush.radius * (tool.ground === 3 ? 0.6 : 1);
        if (tool.ground !== 3) groundStroke(tool.ground, r);
        else if (moved > 0.0015) {
          tmp.set(brush.b.x - brush.a.x, brush.b.y - brush.a.y, 0).normalize();
          brush.dir.lerp(new THREE.Vector2(tmp.x, tmp.y), 0.4).normalize();
          groundStroke(3, r);
        }
      }
      if (tool.brush) simBrush = tool.brush;
      if (tool.brush || tool.ground) touch();
    }
    acc = Math.min(12, acc + speed * BASE_STEPS * dtReal * 60);
    const n = Math.floor(acc);
    acc -= n;
    const b = brush;
    if (n === 0 && simBrush) step(0, simBrush, b.a.x, b.a.y, b.b.x, b.b.y, b.radius);
    for (let i = 0; i < n; i++) step(1, i === 0 ? simBrush : 0, b.a.x, b.a.y, b.b.x, b.b.y, b.radius);
    if (!(tool && tool.ground === 3) || brush.a.distanceTo(brush.b) > 0.0015) brush.a.copy(brush.b);

    if (flags.bake) bake();
    blendMood(1 - Math.exp(-dtReal * 1.6));
    placeSelRing();

    viewMat.uniforms.uState.value = stateA.texture;
    viewMat.uniforms.uGround.value = groundA.texture;
    viewMat.uniforms.uTime.value = time;
    viewMat.uniforms.uRain.value = world.rain;
    viewMat.uniforms.uWet.value = world.wet;
    viewMat.uniforms.uShroom.value = world.shroom;
    viewMat.uniforms.uAge.value = world.steps * DAYS_PER_STEP / 365;
    composer.render();

    if (frame % 20 === 0) {
      statsMat.uniforms.uState.value = stateA.texture;
      runPass(statsMat, statsRT);
      renderer.readRenderTargetPixels(statsRT, 0, 0, 32, 32, statsBuf);
      let c = 0;
      for (let i = 0; i < statsBuf.length; i += 4) c += statsBuf[i];
      const year = Math.floor(world.steps * DAYS_PER_STEP / 365) + 1;
      readout.textContent = `Year ${year} · moss cover ${Math.round(c / (32 * 32 * 255) * 100)}%`;
    }
    if (flags.saveAt && now > flags.saveAt && !brush.down && !dragging && !CAPTURE) save();
  }

  resize();
  setGroup('moss');
  setMood('day', true);
  window.__moss = { step, world, brush, flags, newGarden, addObject, setMood, setGroup, groundStroke, save, select, advance, toScreen, view: viewMat.uniforms.uView.value };
  const begin = (restored) => {
    if (!restored) {
      // ?seed=N makes the first garden repeatable.
      let a = (+query.get('seed') || 0) >>> 0;
      const seeded = () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      newGarden(query.get('start') || 'composed', query.has('seed') ? seeded : Math.random);
    } else hint.classList.add('gone');
    if (!CAPTURE) requestAnimationFrame(tick);
  };
  (query.has('fresh') || CAPTURE ? Promise.resolve(false) : restore()).then(begin, () => begin(false));
}

try {
  start();
} catch (err) {
  console.error(err);
  $('fail').hidden = false;
  $('hint').hidden = true;
}
