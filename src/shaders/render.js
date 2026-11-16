import { NOISE, WORLD } from './common.js';

export const RENDER_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uState;
uniform sampler2D uSub;
uniform vec2 uRes;
uniform vec2 uSimScale;
uniform vec2 uStateSize;
uniform float uTime;
uniform float uLight;
uniform float uRain;
uniform float uType;
${NOISE}
${WORLD}

vec4 cubic(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}
// Smooth (B-spline) lookup so the simulation grid never shows through.
vec4 texBicubic(sampler2D tex, vec2 uv, vec2 size) {
  vec2 tc = uv * size - 0.5;
  vec2 f = fract(tc);
  tc -= f;
  vec4 xc = cubic(f.x), yc = cubic(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 off = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  vec4 s0 = texture(tex, off.xz), s1 = texture(tex, off.yz);
  vec4 s2 = texture(tex, off.xw), s3 = texture(tex, off.yw);
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

// One moss shoot seen from above: a tiny rosette. x = dome height, y = id, z = distance to centre.
vec3 tuft(vec2 p, float star) {
  vec2 ip = floor(p), fp = fract(p);
  float md = 8.0, id = 0.0; vec2 mr = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash22(ip + g) - fp;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; id = hash12(ip + g + 17.3); }
  }
  float d = sqrt(md);
  float dome = 1.0 - smoothstep(0.0, 0.80, d);
  dome = sqrt(dome);            // flatter-topped rosette rather than a bead
  float leaves = 0.5 + 0.5 * cos(atan(mr.y, mr.x) * (5.0 + floor(id * 4.0)) + id * 40.0);
  dome *= mix(1.0, 0.30 + 0.70 * leaves, star * smoothstep(0.06, 0.40, d));
  return vec3(dome * (0.55 + 0.45 * id), id, d);
}

// Globals describing the moss at the last evaluated point.
float gCov, gDome, gId, gSp, gClump, gDist;

float mossH(vec2 p, float B) {
  gSp = smoothstep(0.40, 0.60, vnoise(p * 5.3 + 11.0) + 0.25 * (vnoise(p * 23.0) - 0.5));
  vec3 t1 = tuft(p * 210.0, 1.0);    // coarse star moss (sugigoke-like)
  vec3 t2 = tuft(p * 460.0, 0.0);    // fine velvet cushion moss
  gDome = mix(t2.x, t1.x, gSp);
  gId = mix(t2.y, t1.y, step(0.5, gSp));
  gDist = mix(t2.z, t1.z, step(0.5, gSp));
  gClump = fbm3(p * 34.0);
  float edge = B + (gDome - 0.45) * 0.10 + (gClump - 0.5) * 0.10;
  gCov = smoothstep(0.035, 0.10, edge);
  float thick = B * (0.45 + 1.1 * gClump);
  return gCov * (thick * MS + gDome * mix(0.0011, 0.0024, gSp) * (0.45 + 0.55 * smoothstep(0.04, 0.4, B)));
}

float rockMicro(vec2 p) {
  vec2 q = mix(p, vec2(p.x * 3.0, p.y * 0.35), uType);
  return 0.0020 * (fbm(q * 210.0) - 0.5) + 0.0007 * (vnoise(q * 800.0) - 0.5);
}

float coarseH(vec2 p) {
  float b = texture(uState, p).r;
  return texture(uSub, p).r * RS + smoothstep(0.03, 0.12, b) * b * MS * 1.1;
}

// Sunlight falling through a canopy: overlapping soft discs (pinhole images of the sun).
float flecks(vec2 p, float f, float t, float keep) {
  vec2 ip = floor(p * f), fp = fract(p * f);
  float a = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 hsh = hash22(ip + g + f);
    vec2 c = g + 0.5 + 0.38 * sin(hsh * 6.2831 + t * (0.25 + 0.3 * hsh.yx));
    float r = 0.22 + 0.40 * hash12(ip + g + 3.1 * f);
    float on = step(1.0 - keep, hash12(ip + g + 9.7));
    float breathe = 0.75 + 0.25 * sin(t * (0.5 + hsh.x) + hsh.y * 20.0);
    a += on * breathe * fall(r * 0.45, r, length(c - fp));
  }
  return a;
}
float komorebi(vec2 p, float t) {
  vec2 q = p + 0.010 * vec2(sin(t * 0.55 + p.y * 5.0), cos(t * 0.42 + p.x * 4.0));
  float canopy = fbm3(q * 1.9 + vec2(t * 0.015, -t * 0.008));
  float th = mix(0.78, 0.30, uLight);
  float open = smoothstep(th - 0.12, th + 0.22, canopy);
  float keep = mix(0.25, 0.85, uLight);
  float f = flecks(q, 4.2, t, keep) + 0.7 * flecks(q + 3.7, 8.5, t * 1.3, keep * 0.8);
  return clamp(f * (0.25 + 0.9 * open) + 0.55 * smoothstep(th + 0.12, th + 0.40, canopy), 0.0, 1.0);
}

void main() {
  vec2 p = (vUv - 0.5) * uSimScale + 0.5;
  float px = uSimScale.x / uRes.x;
  float e = max(px, 0.00050);

  vec4 st = texBicubic(uState, p, uStateSize);
  float Bx = texBicubic(uState, p + vec2(e, 0.0), uStateSize).r;
  float By = texBicubic(uState, p + vec2(0.0, e), uStateSize).r;
  vec4 sub = texture(uSub, p);
  float B = max(st.r, 0.0), W = st.g, M = st.b, Hy = st.a;
  float cav = sub.g;
  float cavn = smoothstep(0.42, 0.68, cav);

  // ---- surface height and normal ----
  float hx = texture(uSub, p + vec2(e, 0.0)).r * RS + rockMicro(p + vec2(e, 0.0)) * (1.0 - 0.0) + mossH(p + vec2(e, 0.0), Bx);
  float hy = texture(uSub, p + vec2(0.0, e)).r * RS + rockMicro(p + vec2(0.0, e)) + mossH(p + vec2(0.0, e), By);
  float hm = mossH(p, B);
  float h0 = sub.r * RS + rockMicro(p) + hm;
  float cov = gCov, dome = gDome, id = gId, sp = gSp, clump = gClump;
  // moss smothers the rock's micro relief
  vec3 N = normalize(vec3(-(hx - h0) / e, -(hy - h0) / e, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Hv = normalize(SUN + V);

  // ---- soft shadow along the sun ray ----
  float sh = 1.0;
  {
    vec2 dir = normalize(SUN.xy);
    float tanE = SUN.z / length(SUN.xy);
    float hStart = sub.r * RS + B * cov * MS * 1.1 + 0.0006;
    float t = 0.0025 + 0.002 * hash12(gl_FragCoord.xy);
    for (int i = 0; i < 12; i++) {
      float hh = coarseH(p + dir * t);
      sh = min(sh, 10.0 * (hStart + t * tanE - hh) / t + 1.0);
      t *= 1.42;
    }
    sh = smoothstep(0.0, 1.0, sh);
  }
  float mask = komorebi(p, uTime);
  float sunI = mask * sh;

  // ---- substrate colour ----
  float g1 = fbm(p * 6.0 + 2.0), g2 = fbm(p * 44.0 + 5.0);
  vec3 stone = mix(vec3(0.150, 0.150, 0.150), vec3(0.330, 0.325, 0.300), g1);
  stone *= 0.75 + 0.5 * g2;
  float speck = vnoise(p * 1100.0 + 13.0);
  stone = mix(stone, vec3(0.52, 0.50, 0.46), smoothstep(0.80, 0.90, speck) * 0.45);
  stone = mix(stone, vec3(0.05, 0.05, 0.055), fall(0.10, 0.20, speck) * 0.5);
  stone = mix(stone, stone * vec3(1.25, 0.98, 0.72), 0.6 * smoothstep(0.50, 0.80, fbm(p * 3.0 + 20.0)));
  float lichen = smoothstep(0.60, 0.64, fbm(p * 8.0 + 40.0) + 0.16 * (fbm(p * 70.0) - 0.5)) * (1.0 - cavn);
  stone = mix(stone, vec3(0.50, 0.56, 0.47) * (0.7 + 0.5 * g2), lichen * 0.65);
  float lichen2 = smoothstep(0.70, 0.73, fbm(p * 13.0 + 80.0) + 0.1 * (g2 - 0.5)) * (1.0 - cavn);
  stone = mix(stone, vec3(0.62, 0.50, 0.16) * (0.7 + 0.5 * g2), lichen2 * 0.5);

  float fib = fbm(vec2(p.x * 150.0, p.y * 9.0));
  vec3 bark = mix(vec3(0.115, 0.062, 0.040), vec3(0.36, 0.20, 0.115), smoothstep(0.2, 0.8, sub.r * 1.2 + 0.25 * (fib - 0.5)));
  bark *= 0.7 + 0.6 * fib;
  bark = mix(bark, vec3(0.40, 0.38, 0.33), 0.35 * smoothstep(0.55, 0.75, fbm(vec2(p.x * 30.0, p.y * 4.0) + 9.0)));
  bark = mix(bark, vec3(0.45, 0.52, 0.42) * (0.7 + 0.5 * g2), lichen * 0.45);

  vec3 rock = mix(stone, bark, uType);
  rock *= mix(1.0, 0.42, smoothstep(0.50, 0.85, cav));          // grime gathers in hollows
  rock *= mix(0.80, 1.12, smoothstep(0.30, 0.50, cav) * (1.0 - smoothstep(0.5, 0.7, cav)));
  // green algal / protonemal film where moss is just arriving
  float film = smoothstep(0.0, 0.07, B) * (1.0 - cov);
  rock = mix(rock, vec3(0.10, 0.17, 0.045), film * 0.75);
  rock *= 1.0 - 0.45 * film;                                    // contact shadow under the moss edge
  float wetR = smoothstep(0.12, 0.60, W);
  rock *= mix(1.0, 0.50, wetR);
  rock = mix(rock, rock * vec3(0.90, 1.0, 0.92), wetR * 0.5);

  // ---- moss colour ----
  vec3 young = vec3(0.36, 0.58, 0.045);
  vec3 mature = vec3(0.085, 0.31, 0.035);
  vec3 old = vec3(0.045, 0.16, 0.035);
  vec3 dry = vec3(0.36, 0.30, 0.10);
  float thin = 1.0 - smoothstep(0.05, 0.35, B);
  vec3 mc = mix(young, mature, smoothstep(0.03, 0.55, M) * (1.0 - 0.35 * thin));
  mc = mix(mc, old, smoothstep(0.62, 1.0, M) * 0.75);
  mc *= mix(vec3(0.82, 1.0, 0.98), vec3(1.22, 1.10, 0.70), sp);       // two species
  mc *= 0.72 + 0.56 * id;
  mc.r += (hash12(vec2(id * 91.0, 3.0)) - 0.5) * 0.05;
  mc = mix(dry * (0.65 + 0.6 * id), mc, smoothstep(0.15, 0.85, Hy));
  float tip = smoothstep(0.15, 0.95, dome);
  mc *= mix(0.30, 1.18, tip);                                         // bright tips, dark depths
  mc = mix(mc, mc * vec3(1.20, 1.12, 0.80), tip * tip * 0.35);
  // copper sporophyte capsules on mature moss
  float sporo = step(0.86, hash12(vec2(id * 57.0, 9.0))) * smoothstep(0.62, 0.85, M) * fall(0.05, 0.16, gDist) * sp;
  mc = mix(mc, vec3(0.62, 0.22, 0.05), sporo * 0.9);

  // ---- lighting ----
  float ndl = max(dot(N, SUN), 0.0);
  vec3 sunCol = vec3(1.0, 0.87, 0.64) * 4.6;
  vec3 skyCol = vec3(0.22, 0.34, 0.30) * (0.55 + 0.75 * uLight);
  float aoR = mix(0.35, 1.0, fall(0.42, 0.75, cav));
  float aoM = mix(0.40, 1.0, tip) * mix(0.75, 1.0, clump);
  float amb = 0.65 + 0.35 * N.z;

  // rock
  float glossR = mix(18.0, 140.0, wetR);
  float specR = pow(max(dot(N, Hv), 0.0), glossR) * mix(0.04, 0.9, wetR);
  vec3 colR = rock * (skyCol * aoR * amb + sunCol * sunI * ndl) + sunCol * sunI * specR * 0.35 + skyCol * specR * 0.25;

  // moss: soft wrapped diffuse, light bleeding through the leaves, fuzzy rim
  float wrap = pow(clamp((dot(N, SUN) + 0.45) / 1.45, 0.0, 1.0), 1.4);
  float rim = pow(1.0 - N.z, 1.5);
  vec3 transl = vec3(0.50, 0.85, 0.10) * (0.20 + 0.5 * rim + 0.35 * thin) * smoothstep(0.2, 0.9, Hy);
  vec3 colM = mc * (skyCol * aoM * amb * 1.25 + sunCol * sunI * (wrap * 0.85 + 0.0))
            + mc * transl * sunCol * sunI * 0.55
            + vec3(0.55, 0.8, 0.3) * rim * skyCol * 0.25 * aoM;
  // dew: tiny twinkling beads on wet shoots
  float wetM = smoothstep(0.30, 0.75, W);
  float bead = step(0.93, hash12(vec2(id * 13.0, 41.0))) * fall(0.02, 0.13, gDist);
  float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 3.0 * id) + id * 80.0);
  colM += bead * wetM * (sunCol * sunI * 1.6 * tw + skyCol * 1.2);
  colM += pow(max(dot(N, Hv), 0.0), 40.0) * wetM * 0.25 * sunCol * sunI;

  vec3 col = mix(colR, colM, cov);

  // ---- rain: little ring splashes ----
  if (uRain > 0.01) {
    vec2 rp = p * 30.0 + 0.4 * vec2(vnoise(p * 9.0), vnoise(p * 9.0 + 5.0));
    vec2 ri = floor(rp);
    float ph = fract(uTime * (0.9 + 0.8 * hash12(ri + 2.0)) + hash12(ri) * 7.0);
    vec2 rc = hash22(ri + floor(uTime * 0.9 + hash12(ri) * 7.0)) * 0.6 + 0.2;
    float rd = length(fract(rp) - rc);
    float live = step(0.55, hash12(ri + 11.0 + floor(uTime * 0.9 + hash12(ri) * 7.0)));
    float ring = live * fall(0.0, 0.022, abs(rd - ph * 0.22)) * (1.0 - ph) * (1.0 - ph) * (1.0 - ph);
    col += ring * uRain * (skyCol * 0.9 + sunCol * sunI * 0.15);
    col *= 1.0 - 0.18 * uRain;
  }

  // ---- lens ----
  vec2 vc = vUv - 0.5;
  col *= 1.0 - 0.75 * smoothstep(0.25, 0.95, length(vc) * 1.25);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.012 * (0.3 + col);
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

export const MOTE_VERT = /* glsl */ `
in vec3 position;
in vec4 aRnd;
uniform float uTime;
uniform float uPx;
uniform float uAspect;
out float vA;
void main() {
  float t = uTime * (0.012 + 0.02 * aRnd.x);
  vec2 q = position.xy + vec2(sin(t * 6.0 + aRnd.y * 40.0) * 0.06 + t * 0.6, cos(t * 5.0 + aRnd.z * 40.0) * 0.05 + t * 0.25);
  q = fract(q * 0.5 + 0.5) * 2.0 - 1.0;
  vA = (0.5 + 0.5 * sin(uTime * (0.3 + aRnd.w) + aRnd.x * 50.0)) * (0.3 + 0.7 * aRnd.z);
  gl_Position = vec4(q, 0.0, 1.0);
  gl_PointSize = (1.5 + 6.0 * aRnd.w * aRnd.w) * uPx;
}`;

export const MOTE_FRAG = /* glsl */ `
precision highp float;
in float vA;
out vec4 fragColor;
uniform float uLight;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(0.0, 0.5, d);
  fragColor = vec4(vec3(1.0, 0.92, 0.70) * a * a * vA * (0.10 + 0.5 * uLight), 1.0);
}`;
