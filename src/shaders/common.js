// Shared GLSL: fullscreen vertex shader, hashes, noise.
export const VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Falls from 1 to 0 as x goes from a to b (a < b); avoids reversed-edge smoothstep, which is undefined.
float fall(float a, float b, float x) { return 1.0 - smoothstep(a, b, x); }
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.96875;
}
float fbm3(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = ROT * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.875;
}
// Voronoi: x = F1, y = F2, z = random id of nearest cell.
vec3 voro(vec2 p) {
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash22(ip + g) - fp;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(ip + g + 7.31); }
    else if (d < f2) { f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
`;

// World constants shared by the simulation and the renderer.
export const WORLD = /* glsl */ `
const float RS = 0.040;               // substrate relief, in uv units
const float MS = 0.016;               // full moss thickness, in uv units
const vec3 SUN = vec3(-0.60, 0.55, 0.42) / 0.9163;  // direction towards the sun
`;
