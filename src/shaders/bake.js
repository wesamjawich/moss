import { NOISE } from './common.js';

export const MAX_OBJECTS = 40;

// Pass 1 composes the garden's relief: ground (soil or raked gravel) plus every placed object.
//   out 0: R height, G gravel fraction, B object rotation, A object seed
//   out 1: material weights - R rock, G wood, B carved stone, A water
export const HEIGHT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
uniform sampler2D uGround;          // R gravel, G rake pattern (-1..1), B rake coverage, A fallen leaves
uniform vec4 uObjA[${MAX_OBJECTS}]; // x, y, rotation, scale
uniform vec4 uObjB[${MAX_OBJECTS}]; // type, seed
uniform int uCount;
uniform float uSeed;
${NOISE}

const float G0 = 0.16;        // mean ground level
const float LIFT = 25.0;      // 1 / relief scale: converts uv lengths to height units
const float RAKE_F = 105.0;   // rake grooves per uv unit

float stoneH(vec2 p) {
  vec2 w = p + 0.55 * vec2(fbm(p * 0.8 + 3.1), fbm(p * 0.8 + 7.7));
  float h = 0.55 * fbm(w * 0.7) + 0.22 * fbm(w * 2.3 + 9.0);
  vec2 cw = w * 0.5 + 0.30 * vec2(fbm(w * 2.0 + 1.0), fbm(w * 2.0 + 5.0));
  vec3 v = voro(cw);
  float e = v.y - v.x;
  float open = smoothstep(0.38, 0.62, fbm(w * 1.1 + 30.0));
  h += (v.z - 0.5) * 0.10 * open;
  h -= 0.30 * fall(0.0, 0.045, e) * (0.15 + 0.85 * open);
  h -= 0.07 * fall(0.0, 0.22, e) * (0.3 + 0.7 * open);
  float run = 1.0 - abs(2.0 * fbm(w * 1.6 + 70.0) - 1.0);
  h -= 0.10 * smoothstep(0.80, 0.98, run);
  vec3 v2 = voro(p * 6.0 + 20.0);
  h -= 0.05 * fall(0.05, 0.30, v2.x) * step(0.55, v2.z);
  h += 0.05 * (fbm(p * 9.0) - 0.5) + 0.02 * (fbm(p * 30.0) - 0.5);
  return h;
}

float capsule(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// Each object returns its top height t (in units of its own radius) and m > 0 inside its footprint.
// mw = material weights (rock, wood, carved, water).
void objRock(vec2 q, float seed, out float t, out float m, out vec4 mw) {
  float R = 0.74 + 0.36 * fbm(q * 1.7 + seed * 17.0);               // lumpy outline
  vec2 qs = q * vec2(1.0, 1.0 + 0.35 * sin(seed * 9.0));
  float rr = length(qs) / R;
  m = 1.0 - rr;
  for (int k = 0; k < 5; k++) {                                      // a few cleaved faces
    float a = 6.2831853 * (float(k) + hash12(vec2(seed * 53.0, float(k)))) / 5.0;
    float dk = 0.52 + 0.42 * hash12(vec2(float(k) * 3.1, seed * 77.0));
    m = min(m, (dk - dot(q, vec2(cos(a), sin(a)))) * 1.1);
  }
  float mm = 1.0 - clamp(m * 1.5, 0.0, 1.0);
  float flank = sqrt(max(1.0 - mm * mm, 0.0));
  vec2 pk = 0.30 * (hash22(vec2(seed * 91.0, seed * 13.0)) - 0.5);   // off-centre summit
  float rs = length(qs - pk) / R;
  float crown = max(1.0 - rs * rs * 0.8, 0.0);
  float detail = stoneH(q * 1.15 + seed * 31.0) - 0.35;
  float facet = voro(q * 1.5 + seed * 5.0).z - 0.5;
  t = flank * (0.26 + 0.40 * crown + 0.40 * detail + 0.12 * facet);
  mw = vec4(1.0, 0.0, 0.0, 0.0);
}
void objStep(vec2 q, float seed, out float t, out float m, out vec4 mw) {
  float R = 0.78 + 0.26 * fbm(q * 1.1 + seed * 17.0);
  float rr = length(q) / R;
  m = 1.0 - rr;
  t = 0.11 * sqrt(clamp((1.0 - rr) / 0.22, 0.0, 1.0)) * (0.85 + 0.3 * fbm(q * 3.0 + seed * 5.0));
  mw = vec4(1.0, 0.0, 0.0, 0.0);
}
void objLog(vec2 q, float seed, out float t, out float m, out vec4 mw) {
  float x = q.x;
  float cy = 0.05 * sin(x * 2.3 + seed * 10.0);
  float rad = 0.165 * (1.0 - 0.20 * x) * (0.90 + 0.20 * fbm(vec2(x * 3.0, seed * 7.0)));
  float dy = q.y - cy;
  float inX = step(abs(x), 1.0);
  float t1 = sqrt(max(rad * rad - dy * dy, 0.0)) * inX;
  float ridges = fbm(vec2(x * 5.0 + seed, dy / rad * 2.2 + seed * 3.0));
  t1 *= 0.82 + 0.36 * ridges;
  float m1 = min(rad - abs(dy), 1.0 - abs(x));
  // a broken side limb
  float side = seed > 0.5 ? 1.0 : -1.0;
  vec2 b0 = vec2(0.15 - 0.5 * fract(seed * 7.3), cy);
  vec2 b1 = b0 + vec2(0.34, 0.42 * side);
  float d2 = capsule(q, b0, b1);
  float r2 = 0.075;
  float t2 = sqrt(max(r2 * r2 - d2 * d2, 0.0)) * 1.1;
  t = max(t1, t2);
  m = max(m1, r2 - d2);
  mw = vec4(0.0, 1.0, 0.0, 0.0);
}
void objLantern(vec2 q, float seed, out float t, out float m, out vec4 mw) {
  vec2 a = abs(q);
  float dh = max(a.x * 0.866 + a.y * 0.5, a.y) / 0.9;      // hexagonal roof
  m = 1.0 - dh;
  float roof = 0.42 + 0.72 * (1.0 - dh);
  float corner = pow(abs(cos(3.0 * atan(q.y, q.x))), 8.0);
  roof += 0.14 * corner * smoothstep(0.35, 1.0, dh);        // ribs, upturned at the eaves
  roof += 0.015 * (fbm(q * 9.0 + seed) - 0.5);
  float r = length(q);
  if (r < 0.2) roof = max(roof, 1.08 + 1.3 * sqrt(0.04 - r * r));   // finial jewel
  t = roof;
  mw = vec4(0.0, 0.0, 1.0, 0.0);
}
void objBasin(vec2 q, float seed, out float t, out float m, out vec4 mw) {
  float R = 0.90 + 0.10 * fbm(q * 2.0 + seed * 13.0);
  float r = length(q);
  float rr = r / R;
  m = 1.0 - rr;
  t = 0.40 * pow(max(1.0 - rr * rr * rr * rr, 0.0), 0.5) + 0.03 * (fbm(q * 5.0 + seed) - 0.5);
  float bowl = fall(0.50, 0.62, r);
  t = mix(t, 0.27, bowl);
  mw = vec4(0.0, 0.0, 1.0 - fall(0.50, 0.55, r), fall(0.50, 0.55, r));
}
void objJizo(vec2 q, float seed, out float t, out float m, out vec4 mw) {
  vec2 bq = abs(q) - vec2(0.46, 0.46);
  float base = 0.16 - (length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0));   // rounded plinth
  float e = length(q / vec2(0.78, 0.62));
  m = max(base, 1.0 - e);
  t = base > 0.0 ? 0.20 : 0.0;
  if (e < 1.0) t = max(t, 0.30 + 1.25 * sqrt(1.0 - e * e));               // robed body
  float hr = length(q - vec2(0.0, 0.04));
  if (hr < 0.30) t = max(t, 1.75 + 1.1 * sqrt(0.09 - hr * hr));            // head
  t += 0.012 * (fbm(q * 8.0 + seed) - 0.5);
  mw = vec4(0.0, 0.0, 1.0, 0.0);
}
void objBridge(vec2 q, float seed, out float t, out float m, out vec4 mw) {
  float wob = 0.03 * (fbm(q * 3.0 + seed * 11.0) - 0.5);
  m = min(1.0 - abs(q.x) + wob, 0.34 - abs(q.y) + wob);
  t = (0.13 + 0.06 * (1.0 - q.x * q.x)) * sqrt(clamp(m / 0.05, 0.0, 1.0)) + 0.02 * (fbm(q * 6.0 + seed) - 0.5);
  mw = vec4(0.0, 0.0, 1.0, 0.0);
}

void main() {
  vec2 p = vUv * 5.0 + uSeed;
  vec4 g = texture(uGround, vUv);
  float gravel = clamp(g.r, 0.0, 1.0);

  // Raked gravel: straight furrows that bend into rings around standing stones.
  float ringD = 1e3;
  for (int i = 0; i < ${MAX_OBJECTS}; i++) {
    if (i >= uCount) break;
    int ty = int(uObjB[i].x + 0.5);
    if (ty == 2 || ty == 6) continue;
    ringD = min(ringD, length(vUv - uObjA[i].xy) - uObjA[i].w * 0.80);
  }
  float straight = vUv.y + 0.012 * sin(vUv.x * 7.0 + uSeed);
  float rings = fall(0.030, 0.046, ringD);                 // crossfade the two patterns, never their phases
  float def = mix(cos(6.2831853 * RAKE_F * straight), cos(6.2831853 * RAKE_F * ringD), rings);
  float pat = mix(def, g.g, clamp(g.b, 0.0, 1.0));

  float broad = fbm(p * 1.2);
  float soilH = G0 + 0.10 * (broad - 0.5) + 0.035 * (fbm(p * 7.0) - 0.5) + 0.022 * (fbm(p * 26.0) - 0.5);
  float gravH = G0 + 0.006 + 0.025 * (broad - 0.5) + 0.030 * pat;
  float h = mix(soilH, gravH, gravel);

  vec4 w = vec4(0.0);
  float ang = 0.0, sd = 0.0;
  for (int i = 0; i < ${MAX_OBJECTS}; i++) {
    if (i >= uCount) break;
    vec4 A = uObjA[i];
    vec2 d = vUv - A.xy;
    float s = A.w;
    if (dot(d, d) > s * s * 1.9) continue;
    float c = cos(A.z), sn = sin(A.z);
    vec2 q = vec2(c * d.x + sn * d.y, -sn * d.x + c * d.y) / s;
    int ty = int(uObjB[i].x + 0.5);
    float seed = uObjB[i].y;
    float t, m; vec4 mw;
    if (ty == 0) objRock(q, seed, t, m, mw);
    else if (ty == 1) objStep(q, seed, t, m, mw);
    else if (ty == 2) objLog(q, seed, t, m, mw);
    else if (ty == 3) objLantern(q, seed, t, m, mw);
    else if (ty == 4) objBasin(q, seed, t, m, mw);
    else if (ty == 5) objJizo(q, seed, t, m, mw);
    else objBridge(q, seed, t, m, mw);
    float ho = G0 - 0.02 + t * s * LIFT;
    if (m > 0.0 && ho > h) {
      h = ho;
      w = mix(w, mw, smoothstep(0.0, 0.03, m));
      ang = A.z; sd = seed;
    }
  }
  o0 = vec4(h, gravel * (1.0 - clamp(w.r + w.g + w.b + w.a, 0.0, 1.0)), ang, sd);
  o1 = w;
}`;

// Pass 2 derives what the moss cares about: R height, G concavity (0.5 flat, >0.5 hollow),
// B habitat suitability, A dampness (2.0 marks open water).
export const SUB_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uH;
uniform sampler2D uM;
uniform float uSeed;
${NOISE}
void main() {
  vec4 t0 = texture(uH, vUv);
  vec4 w = texture(uM, vUv);
  float h = t0.r;
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = 6.2831853 * float(i) / 8.0;
    vec2 d = vec2(cos(a), sin(a));
    acc += texture(uH, vUv + d * 0.005).r + texture(uH, vUv + d * 0.014).r;
  }
  float cav = clamp(0.5 + (acc / 16.0 - h) * 2.6, 0.0, 1.0);
  vec2 p = vUv * 5.0 + uSeed;
  float n = fbm(p * 5.0 + 31.0);
  float ground = mix(0.70 + 0.30 * n, 0.05, t0.g);
  float obj = clamp(w.r + w.g + w.b + w.a, 0.0, 1.0);
  float suit = ground * (1.0 - obj) + w.r * (0.34 + 0.52 * n) + w.g * (0.80 + 0.20 * n) + w.b * (0.36 + 0.34 * n);
  float big = fbm(p * 0.9 + 57.0);
  float groundDamp = mix(0.62 + 0.55 * big, 0.20, t0.g);       // soil holds water, gravel drains
  float damp = groundDamp * (1.0 - obj) + obj * (big + 0.25 * w.g);
  if (w.a > 0.5) { damp = 2.0; suit = 0.0; }
  fragColor = vec4(h, cav, suit, damp);
}`;
