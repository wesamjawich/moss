import { NOISE } from './common.js';

// Bakes the substrate once: R height, G concavity (0.5 = flat, >0.5 = hollow),
// B porosity, A large-scale dampness (seep zones).
export const BAKE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform float uSeed;
uniform float uType;   // 0 stone, 1 cedar bark
${NOISE}

float stoneH(vec2 p) {
  vec2 w = p + 0.55 * vec2(fbm(p * 0.8 + 3.1), fbm(p * 0.8 + 7.7));
  float h = 0.55 * fbm(w * 0.7) + 0.22 * fbm(w * 2.3 + 9.0);
  vec2 cw = w * 0.5 + 0.30 * vec2(fbm(w * 2.0 + 1.0), fbm(w * 2.0 + 5.0));
  vec3 v = voro(cw);
  float e = v.y - v.x;
  float open = smoothstep(0.38, 0.62, fbm(w * 1.1 + 30.0));   // fissures fade in and out
  h += (v.z - 0.5) * 0.10 * open;                             // shifted blocks
  h -= 0.30 * fall(0.0, 0.045, e) * (0.15 + 0.85 * open);     // fissures
  h -= 0.07 * fall(0.0, 0.22, e) * (0.3 + 0.7 * open);        // worn shoulders
  // weathered runnels and hollows
  float run = 1.0 - abs(2.0 * fbm(w * 1.6 + 70.0) - 1.0);
  h -= 0.10 * smoothstep(0.80, 0.98, run);
  vec3 v2 = voro(p * 6.0 + 20.0);
  h -= 0.05 * fall(0.05, 0.30, v2.x) * step(0.55, v2.z);   // pits
  h += 0.05 * (fbm(p * 9.0) - 0.5) + 0.02 * (fbm(p * 30.0) - 0.5);
  return h;
}

float barkH(vec2 p) {
  float warp = fbm(vec2(p.x * 1.5, p.y * 0.3) + 4.0);
  vec2 q = vec2(p.x * 2.2 + 0.5 * warp, p.y * 0.22);
  float r = fbm(q * vec2(2.0, 1.0));
  float ridge = 1.0 - abs(2.0 * vnoise(q * vec2(3.0, 1.2) + r) - 1.0);
  float h = 0.30 * r + 0.38 * ridge * ridge;
  vec3 v = voro(vec2(p.x * 2.6, p.y * 0.36) + 0.35 * r);
  float e = v.y - v.x;
  h -= 0.22 * (1.0 - smoothstep(0.0, 0.10, e));     // furrows between plates
  h += (v.z - 0.5) * 0.14;                          // flaking plates
  h += 0.06 * (fbm(vec2(p.x * 42.0, p.y * 3.0)) - 0.5);   // fibres
  return h + 0.22;
}

float H(vec2 uv) {
  vec2 p = uv * 5.0 + uSeed;
  return uType < 0.5 ? stoneH(p) : barkH(p);
}

void main() {
  float h = H(vUv);
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = 6.2831853 * float(i) / 8.0;
    vec2 d = vec2(cos(a), sin(a));
    acc += H(vUv + d * 0.005) + H(vUv + d * 0.014);
  }
  float cav = 0.5 + (acc / 16.0 - h) * 2.6;
  vec2 p = vUv * 5.0 + uSeed;
  float por = fbm(p * 5.0 + 31.0);
  float damp = fbm(p * 0.9 + 57.0);
  fragColor = vec4(h, clamp(cav, 0.0, 1.0), por, damp);
}`;
