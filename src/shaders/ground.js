import { NOISE } from './common.js';

// The ground map is painted by the visitor: R gravel, G rake pattern (-1..1), B rake coverage, A fallen leaves.

export const GROUND_INIT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec2 uSimScale;
uniform float uSeed;
uniform float uStyle;    // 0 all soil, 1 gravel shore, 2 gravel stream, 3 gravel courtyard with moss islands
${NOISE}
void main() {
  vec2 v = (vUv - 0.5) / uSimScale;              // -0.5..0.5 across the visible garden
  float n = fbm(vUv * 6.0 + uSeed) - 0.5;
  float sdf = 1.0;
  if (uStyle > 2.5) {
    sdf = -1.0;
    for (int i = 0; i < 4; i++) {
      vec2 c = (hash22(vec2(float(i) * 5.1 + uSeed, uSeed * 2.3)) - 0.5) * 0.85;
      float r = 0.14 + 0.12 * hash12(vec2(float(i), uSeed));
      sdf = max(sdf, r - length((v - c) * vec2(1.0, 1.25)) + 0.10 * n);
    }
  } else if (uStyle > 1.5) {
    float a = 0.5 + hash12(vec2(uSeed, 3.0)) * 0.8;
    float y = v.y * cos(a) - v.x * sin(a) + 0.07 * sin((v.x * cos(a) + v.y * sin(a)) * 8.0 + uSeed);
    sdf = abs(y) - 0.11 + 0.10 * n;
  } else if (uStyle > 0.5) {
    sdf = v.y + 0.10 + 0.07 * sin(v.x * 6.0 + uSeed) + 0.14 * n;
  }
  float gravel = 1.0 - smoothstep(-0.012, 0.012, sdf);
  fragColor = vec4(gravel, 0.0, 0.0, 0.0);
}`;

export const GROUND_BRUSH_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uGround;
uniform vec2 uA;
uniform vec2 uB;
uniform vec2 uDir;       // rake travel direction
uniform float uR;
uniform float uMode;     // 1 gravel, 2 soil, 3 rake, 4 scatter leaves, 5 sweep leaves
${NOISE}
void main() {
  vec4 g = texture(uGround, vUv);
  vec2 pa = vUv - uA, ba = uB - uA;
  float hseg = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  float d = length(pa - ba * hseg);
  float ragged = d + uR * 0.22 * (fbm(vUv * 60.0) - 0.5);
  if (uMode < 1.5) {
    g.r = max(g.r, 1.0 - smoothstep(uR * 0.80, uR, ragged));
  } else if (uMode < 2.5) {
    g.r = min(g.r, smoothstep(uR * 0.80, uR, ragged));
  } else if (uMode < 3.5) {
    vec2 nrm = vec2(-uDir.y, uDir.x);
    float perp = dot(vUv - uB, nrm);
    float f = 1.0 - smoothstep(uR * 0.82, uR, d);
    g.g = mix(g.g, cos(6.2831853 * 105.0 * perp), f);
    g.b = max(g.b, f);
  } else if (uMode < 4.5) {
    g.a = min(1.0, g.a + 0.05 * (1.0 - smoothstep(uR * 0.3, uR, d)));
  } else {
    g.a *= smoothstep(uR * 0.5, uR, d);
  }
  fragColor = g;
}`;

// Restores saved maps (8-bit images) into the float targets.
export const GROUND_LOAD_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImg;      // R gravel, G rake pattern, B rake coverage
uniform sampler2D uMoss;     // B fallen leaves
void main() {
  vec4 a = texture(uImg, vUv);
  fragColor = vec4(a.r, a.g * 2.0 - 1.0, a.b, texture(uMoss, vUv).b);
}`;

export const STATE_LOAD_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uMoss;     // R biomass, G maturity
void main() {
  vec4 a = texture(uMoss, vUv);
  float B = a.r < 0.03 ? 0.0 : a.r;
  fragColor = vec4(B, 0.35, a.g, 1.0);
}`;

// Packs the maps into 8-bit images for saving. uWhich: 0 ground, 1 moss + leaves.
export const SNAPSHOT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uGround;
uniform sampler2D uState;
uniform float uWhich;
void main() {
  vec4 g = texture(uGround, vUv);
  vec4 s = texture(uState, vUv);
  fragColor = uWhich < 0.5 ? vec4(g.r, g.g * 0.5 + 0.5, g.b, 1.0) : vec4(s.r, s.b, g.a, 1.0);
}`;
