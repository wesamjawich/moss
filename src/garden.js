// What can be placed in the garden, and how starting gardens are composed.

export const TYPES = [
  { id: 0, name: 'Rock', size: [0.035, 0.14], def: 0.075 },
  { id: 1, name: 'Flat stone', size: [0.022, 0.08], def: 0.042 },
  { id: 2, name: 'Branch', size: [0.06, 0.28], def: 0.14 },
  { id: 3, name: 'Lantern', size: [0.028, 0.08], def: 0.046 },
  { id: 4, name: 'Basin', size: [0.028, 0.08], def: 0.048 },
  { id: 5, name: 'Jizō', size: [0.024, 0.065], def: 0.040 },
  { id: 6, name: 'Bridge', size: [0.06, 0.22], def: 0.11 },
];

export function makeObject(type, x, y, rnd = Math.random, scale, rot) {
  const t = TYPES[type];
  return {
    type, x, y,
    rot: rot ?? (type === 3 || type === 5 ? 0 : rnd() * Math.PI * 2),
    scale: scale ?? t.def * (0.85 + 0.3 * rnd()),
    seed: 0.05 + 0.9 * rnd(),
  };
}

// Local coordinates of a garden point relative to an object (object radius = 1).
export function toLocal(o, x, y) {
  const dx = x - o.x, dy = y - o.y, c = Math.cos(o.rot), s = Math.sin(o.rot);
  return [(c * dx + s * dy) / o.scale, (-s * dx + c * dy) / o.scale];
}

export function hit(o, x, y, pad = 0) {
  const [qx, qy] = toLocal(o, x, y);
  const m = pad / o.scale;
  if (o.type === 2) return Math.abs(qx) < 1 + m && Math.abs(qy) < 0.3 + m;
  if (o.type === 6) return Math.abs(qx) < 1 + m && Math.abs(qy) < 0.4 + m;
  return Math.hypot(qx, qy) < 0.95 + m;
}

// The capsule (two end points and a radius) that covers an object's footprint.
export function footprint(o) {
  if (o.type === 2 || o.type === 6) {
    const c = Math.cos(o.rot), s = Math.sin(o.rot), l = o.scale * 0.85;
    return { ax: o.x - c * l, ay: o.y - s * l, bx: o.x + c * l, by: o.y + s * l, r: o.scale * (o.type === 2 ? 0.2 : 0.36) };
  }
  return { ax: o.x, ay: o.y, bx: o.x, by: o.y, r: o.scale * 0.95 };
}

// kind: 'composed' (a classic arrangement), 'surprise' (random), 'bare'.
// Positions are generated in view space (-0.5..0.5) and mapped through simScale so they fit any screen.
export function composeGarden(kind, simScale, rnd = Math.random) {
  const k = Math.max(0.62, Math.min(1, Math.min(simScale.x, simScale.y) / 0.56));
  const at = (vx, vy) => [0.5 + vx * simScale.x, 0.5 + vy * simScale.y];
  const j = (a) => (rnd() - 0.5) * a;
  const objects = [];
  const add = (type, vx, vy, scale, rot) => {
    const [x, y] = at(vx, vy);
    objects.push(makeObject(type, x, y, rnd, scale === undefined ? undefined : scale * k, rot));
  };
  if (kind === 'bare') return { style: 0, objects };

  if (kind === 'composed') {
    // A triad of standing stones on the gravel shore, a path of flat stones, a lantern in the moss.
    add(0, -0.20 + j(0.03), -0.10 + j(0.03), 0.095);
    add(0, -0.09 + j(0.02), -0.20 + j(0.02), 0.050);
    add(0, -0.30 + j(0.02), -0.21 + j(0.02), 0.062);
    for (let i = 0; i < 4; i++) add(1, 0.10 + i * 0.085 + j(0.02), -0.36 + i * 0.105 + j(0.02), 0.040 + j(0.008));
    add(2, 0.12 + j(0.04), 0.27 + j(0.03), 0.15, 0.35 + j(0.3));
    add(3, -0.33 + j(0.03), 0.24 + j(0.03), 0.046);
    add(4, 0.37 + j(0.02), 0.22 + j(0.03), 0.048);
    return { style: 1, objects };
  }

  const style = 1 + Math.floor(rnd() * 3);
  const groups = 1 + Math.floor(rnd() * 3);
  for (let g = 0; g < groups; g++) {
    const cx = j(0.7), cy = j(0.6);
    add(0, cx, cy, 0.07 + rnd() * 0.04);
    const n = Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.283, d = 0.11 + rnd() * 0.06;
      add(0, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, 0.035 + rnd() * 0.03);
    }
  }
  if (rnd() < 0.75) {
    let px = j(0.6), py = -0.42, dir = j(0.8);
    const n = 3 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) { add(1, px, py, 0.036 + rnd() * 0.012); dir += j(0.5); px += Math.sin(dir) * 0.09; py += 0.11; }
  }
  const logs = Math.floor(rnd() * 3);
  for (let i = 0; i < logs; i++) add(2, j(0.8), j(0.8), 0.10 + rnd() * 0.08);
  if (rnd() < 0.7) add(3, j(0.8), j(0.8));
  if (rnd() < 0.5) add(4, j(0.8), j(0.8));
  if (rnd() < 0.4) add(5, j(0.8), j(0.8));
  if (style === 2 && rnd() < 0.6) add(6, j(0.2), j(0.2), 0.11);
  return { style, objects };
}
