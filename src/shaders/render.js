import { NOISE, WORLD } from './common.js';

export const RENDER_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uState;
uniform sampler2D uSub;
uniform sampler2D uTex0;     // height, gravel, object rotation, object seed
uniform sampler2D uTex1;     // rock, wood, carved, water
uniform sampler2D uGround;   // A = fallen leaves
uniform vec2 uRes;
uniform vec2 uSimScale;
uniform vec2 uStateSize;
uniform float uTime;
uniform float uLight;
uniform float uRain;
uniform vec3 uSun;           // direction towards the sun or moon
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform float uMist;
uniform float uNight;
uniform vec4 uLamps[4];      // x, y, radius, lit
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
  float dome = sqrt(1.0 - smoothstep(0.0, 0.80, d));     // flat-topped rosette rather than a bead
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

// Fine relief of the bare material: grit on stone, pebbles in gravel, fibres on wood.
float micro(vec2 p, float gravel, float wood, float ang) {
  float c = cos(ang), s = sin(ang);
  vec2 q = vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
  float grit = 0.0020 * (fbm(p * 210.0) - 0.5) + 0.0007 * (vnoise(p * 800.0) - 0.5);
  float peb = 0.0016 * (vnoise(p * 520.0) - 0.5) + 0.0010 * (vnoise(p * 1100.0) - 0.5);
  float fibre = 0.0022 * (fbm(vec2(q.x * 24.0, q.y * 260.0)) - 0.5);
  return mix(mix(grit, peb, gravel), fibre, wood);
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

// A fallen maple leaf in a jittered grid cell. Returns coverage; rgb in col.
float mapleShape(vec2 d, float size, float rot) {
  float a = atan(d.y, d.x) - rot;
  float r = length(d) / size;
  float lobes = pow(abs(cos(a * 3.5)), 1.7);
  float R = (0.30 + 0.70 * lobes) * (0.72 + 0.28 * cos(a));
  return 1.0 - smoothstep(R - 0.10, R, r);
}
vec4 leafLayer(vec2 p, float freq, float salt, vec2 shadowOff, out float shadow) {
  vec2 lp = p * freq + salt;
  vec2 ip = floor(lp), fp = fract(lp);
  vec4 best = vec4(0.0);
  shadow = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 cell = ip + g;
    vec2 h = hash22(cell + salt);
    vec2 c = g + 0.2 + 0.6 * h;
    float dens = texture(uGround, (cell + 0.2 + 0.6 * h - salt) / freq).a;
    float k = hash12(cell + 3.3 + salt);
    if (k > dens * 0.9) continue;
    float size = 0.34 + 0.22 * hash12(cell + 8.1);
    float rot = 6.2831 * hash12(cell + 1.7);
    float cov = mapleShape(fp - c, size, rot);
    shadow = max(shadow, mapleShape(fp - c + shadowOff * freq, size, rot));
    if (cov > best.a) {
      float hue = hash12(cell + 5.9);
      vec3 col = mix(vec3(0.50, 0.035, 0.020), vec3(0.80, 0.13, 0.025), smoothstep(0.0, 0.4, hue));
      col = mix(col, vec3(0.88, 0.36, 0.04), smoothstep(0.45, 0.7, hue));
      col = mix(col, vec3(0.84, 0.62, 0.10), smoothstep(0.8, 0.95, hue));
      float a = atan(fp.y - c.y, fp.x - c.x) - rot;
      col *= 0.80 + 0.35 * pow(abs(cos(a * 3.5)), 6.0);          // veins along each lobe
      best = vec4(col, cov);
    }
  }
  return best;
}

void main() {
  vec2 p = (vUv - 0.5) * uSimScale + 0.5;
  float px = uSimScale.x / uRes.x;
  float e = max(px, 0.00050);
  vec3 SUNV = normalize(uSun);

  vec4 st = texBicubic(uState, p, uStateSize);
  float Bx = texBicubic(uState, p + vec2(e, 0.0), uStateSize).r;
  float By = texBicubic(uState, p + vec2(0.0, e), uStateSize).r;
  vec4 sub = texture(uSub, p);
  vec4 t0 = texture(uTex0, p);
  vec4 mw = texture(uTex1, p);
  float B = max(st.r, 0.0), W = st.g, M = st.b, Hy = st.a;
  float cav = sub.g;
  float cavn = smoothstep(0.42, 0.68, cav);
  float gravel = t0.g, ang = t0.b, oseed = t0.a;
  float obj = clamp(mw.r + mw.g + mw.b + mw.a, 0.0, 1.0);
  float soil = (1.0 - gravel) * (1.0 - obj);

  // ---- surface height and normal ----
  float hx = texture(uSub, p + vec2(e, 0.0)).r * RS + micro(p + vec2(e, 0.0), gravel, mw.g, ang) + mossH(p + vec2(e, 0.0), Bx);
  float hy = texture(uSub, p + vec2(0.0, e)).r * RS + micro(p + vec2(0.0, e), gravel, mw.g, ang) + mossH(p + vec2(0.0, e), By);
  float hm = mossH(p, B);
  float h0 = sub.r * RS + micro(p, gravel, mw.g, ang) + hm;
  float cov = gCov * (1.0 - mw.a), dome = gDome, id = gId, sp = gSp, clump = gClump;
  vec3 N = normalize(vec3(-(hx - h0) / e, -(hy - h0) / e, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Hv = normalize(SUNV + V);

  // ---- soft shadow along the sun ray ----
  float sh = 1.0;
  {
    vec2 dir = normalize(SUNV.xy);
    float tanE = SUNV.z / length(SUNV.xy);
    float hStart = sub.r * RS + B * cov * MS * 1.1 + 0.0006;
    float t = 0.0025 + 0.002 * hash12(gl_FragCoord.xy);
    for (int i = 0; i < 13; i++) {
      float hh = coarseH(p + dir * t);
      sh = min(sh, 10.0 * (hStart + t * tanE - hh) / t + 1.0);
      t *= 1.42;
    }
    sh = smoothstep(0.0, 1.0, sh);
  }
  float mask = mix(komorebi(p, uTime), 0.55, uNight * 0.6);
  float sunI = mask * sh;

  // ---- materials ----
  vec2 sp2 = p + oseed * 3.7;                       // each stone carries its own markings
  float g1 = fbm(sp2 * 6.0 + 2.0), g2 = fbm(p * 44.0 + 5.0);
  float speck = vnoise(p * 1100.0 + 13.0);
  float lichen = smoothstep(0.60, 0.64, fbm(sp2 * 8.0 + 40.0) + 0.16 * (fbm(p * 70.0) - 0.5)) * (1.0 - cavn);
  float lichen2 = smoothstep(0.70, 0.73, fbm(sp2 * 13.0 + 80.0) + 0.1 * (g2 - 0.5)) * (1.0 - cavn);

  // weathered field stone
  vec3 stone = mix(vec3(0.150, 0.150, 0.150), vec3(0.330, 0.325, 0.300), g1);
  stone *= (0.75 + 0.5 * g2) * (0.78 + 0.5 * fract(oseed * 7.1));
  stone *= mix(vec3(0.92, 0.97, 1.06), vec3(1.14, 1.03, 0.88), fract(oseed * 13.7));
  stone = mix(stone, vec3(0.52, 0.50, 0.46), smoothstep(0.80, 0.90, speck) * 0.45);
  stone = mix(stone, vec3(0.05, 0.05, 0.055), fall(0.10, 0.20, speck) * 0.5);
  stone = mix(stone, stone * vec3(1.25, 0.98, 0.72), 0.6 * smoothstep(0.50, 0.80, fbm(sp2 * 3.0 + 20.0)));
  stone = mix(stone, vec3(0.50, 0.56, 0.47) * (0.7 + 0.5 * g2), lichen * 0.65);
  stone = mix(stone, vec3(0.62, 0.50, 0.16) * (0.7 + 0.5 * g2), lichen2 * 0.5);

  // carved granite
  vec3 carved = vec3(0.36, 0.36, 0.35) * (0.80 + 0.40 * g2);
  carved = mix(carved, vec3(0.60, 0.60, 0.58), smoothstep(0.78, 0.90, speck) * 0.5);
  carved = mix(carved, vec3(0.06), fall(0.10, 0.22, speck) * 0.55);
  carved *= 0.72 + 0.45 * fbm(sp2 * 5.0 + 11.0);                    // rain staining
  carved = mix(carved, vec3(0.50, 0.56, 0.47) * (0.7 + 0.5 * g2), lichen * 0.35);

  // bark, fibres running along the limb
  float ca = cos(ang), sa = sin(ang);
  vec2 wq = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y);
  float fib = fbm(vec2(wq.x * 9.0, wq.y * 150.0));
  float plates = fbm(vec2(wq.x * 14.0, wq.y * 55.0) + oseed * 9.0);
  vec3 bark = mix(vec3(0.115, 0.062, 0.040), vec3(0.36, 0.20, 0.115), smoothstep(0.25, 0.75, plates + 0.25 * (fib - 0.5)));
  bark *= 0.7 + 0.6 * fib;
  bark = mix(bark, vec3(0.40, 0.38, 0.33), 0.35 * smoothstep(0.55, 0.75, fbm(vec2(wq.x * 4.0, wq.y * 30.0) + 9.0)));
  bark = mix(bark, vec3(0.45, 0.52, 0.42) * (0.7 + 0.5 * g2), lichen * 0.45);

  // forest soil: dark humus flecked with needles
  vec3 earth = mix(vec3(0.040, 0.029, 0.021), vec3(0.110, 0.078, 0.050), fbm(p * 30.0 + 3.0));
  earth *= 0.75 + 0.5 * fbm(p * 4.0 + 8.0);
  earth *= 0.7 + 0.6 * g2;
  float needle = smoothstep(0.80, 0.86, vnoise(vec2(p.x * 900.0 + 40.0 * vnoise(p * 60.0), p.y * 170.0)));
  earth = mix(earth, vec3(0.30, 0.20, 0.10), needle * 0.5);

  // pale river gravel
  vec3 pv = voro(p * 520.0);
  vec3 grav = mix(vec3(0.40, 0.39, 0.37), vec3(0.68, 0.66, 0.61), pv.z);
  grav = mix(grav, vec3(0.50, 0.44, 0.36), step(0.85, fract(pv.z * 7.3)) * 0.6);
  grav *= 0.62 + 0.38 * smoothstep(0.0, 0.25, pv.y - pv.x);

  vec3 rock = mix(earth, grav, gravel);
  rock = mix(rock, stone, mw.r);
  rock = mix(rock, bark, mw.g);
  rock = mix(rock, carved, mw.b);
  float hard = clamp(mw.r + mw.b + mw.g, 0.0, 1.0);
  rock *= mix(1.0, 0.42, smoothstep(0.50, 0.85, cav) * mix(0.55, 1.0, hard));     // grime gathers in hollows
  rock *= mix(0.80, 1.12, smoothstep(0.30, 0.50, cav) * (1.0 - smoothstep(0.5, 0.7, cav)));
  // green algal / protonemal film where moss is just arriving
  float film = smoothstep(0.0, 0.07, B) * (1.0 - cov);
  rock = mix(rock, vec3(0.10, 0.17, 0.045), film * 0.75);
  rock *= 1.0 - 0.45 * film;                                    // contact shadow under the moss edge
  float wetR = smoothstep(0.12, 0.60, W);
  rock *= mix(1.0, mix(0.50, 0.72, soil), wetR);
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
  mc *= mix(0.30, 1.18, tip);                                          // bright tips, dark depths
  mc = mix(mc, mc * vec3(1.20, 1.12, 0.80), tip * tip * 0.35);
  // copper sporophyte capsules on mature moss
  float sporo = step(0.86, hash12(vec2(id * 57.0, 9.0))) * smoothstep(0.62, 0.85, M) * fall(0.05, 0.16, gDist) * sp;
  mc = mix(mc, vec3(0.62, 0.22, 0.05), sporo * 0.9);

  // ---- lighting ----
  float ndl = max(dot(N, SUNV), 0.0);
  vec3 sunCol = uSunCol;
  vec3 skyCol = uSkyCol * (0.55 + 0.75 * uLight);
  float aoR = mix(0.35, 1.0, fall(0.42, 0.75, cav));
  float aoM = mix(0.40, 1.0, tip) * mix(0.75, 1.0, clump);
  float amb = 0.62 + 0.38 * N.z + 0.24 * dot(N.xy, vec2(-0.316, 0.949));   // open sky to one side keeps form readable in shade

  // lantern light pooling on the ground after dark
  vec3 lamp = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 L = uLamps[i];
    float d = length(p - L.xy) / max(L.z, 1e-4);
    float flick = 0.88 + 0.12 * sin(uTime * (5.0 + float(i)) + float(i) * 2.0) * sin(uTime * 2.3 + float(i));
    lamp += L.w * flick * vec3(1.0, 0.56, 0.20) * 2.6 * smoothstep(0.75, 1.15, d) / (1.0 + d * d * 0.55) * fall(2.0, 6.5, d);
  }
  lamp *= uNight;

  float glossR = mix(18.0, 140.0, wetR);
  float specR = pow(max(dot(N, Hv), 0.0), glossR) * mix(0.04, 0.9, wetR) * mix(0.3, 1.0, hard);
  vec3 colR = rock * (skyCol * aoR * amb + sunCol * sunI * ndl + lamp * aoR) + sunCol * sunI * specR * 0.35 + skyCol * specR * 0.25;

  // moss: soft wrapped diffuse, light bleeding through the leaves, fuzzy rim
  float wrap = pow(clamp((dot(N, SUNV) + 0.45) / 1.45, 0.0, 1.0), 1.4);
  float rim = pow(1.0 - N.z, 1.5);
  vec3 transl = vec3(0.50, 0.85, 0.10) * (0.20 + 0.5 * rim + 0.35 * thin) * smoothstep(0.2, 0.9, Hy);
  vec3 colM = mc * (skyCol * aoM * amb * 1.25 + sunCol * sunI * wrap * 0.85 + lamp * aoM)
            + mc * transl * sunCol * sunI * 0.55
            + vec3(0.55, 0.8, 0.3) * rim * skyCol * 0.25 * aoM;
  // dew: tiny twinkling beads on wet shoots
  float wetM = smoothstep(0.30, 0.75, W);
  float bead = step(0.93, hash12(vec2(id * 13.0, 41.0))) * fall(0.02, 0.13, gDist);
  float tw = 0.55 + 0.45 * sin(uTime * (1.5 + 3.0 * id) + id * 80.0);
  colM += bead * wetM * (sunCol * sunI * 1.6 * tw + skyCol * 1.2);
  colM += pow(max(dot(N, Hv), 0.0), 40.0) * wetM * 0.25 * sunCol * sunI;

  vec3 col = mix(colR, colM, cov);

  // ---- still water in a basin ----
  if (mw.a > 0.001) {
    vec2 wp = p * 90.0;
    vec3 wN = normalize(vec3(
      0.10 * (vnoise(wp + uTime * 0.35) - vnoise(wp + vec2(1.3, 0.0) - uTime * 0.28)),
      0.10 * (vnoise(wp.yx + 7.0 - uTime * 0.31) - vnoise(wp.yx + vec2(0.0, 1.3) + uTime * 0.25)), 1.0));
    float reflectCanopy = komorebi(p + wN.xy * 0.25 + 0.31, uTime * 0.7);
    vec3 water = vec3(0.012, 0.030, 0.028) + skyCol * (0.35 + 0.9 * reflectCanopy);
    water += sunCol * sh * mask * pow(max(dot(wN, Hv), 0.0), 220.0) * 2.5;
    water += lamp * 0.25;
    col = mix(col, water, mw.a);
  }

  // ---- fallen maple leaves ----
  float nearLeaves = texture(uGround, p).a + texture(uGround, p + vec2(0.03, 0.0)).a + texture(uGround, p - vec2(0.03, 0.0)).a
                   + texture(uGround, p + vec2(0.0, 0.03)).a + texture(uGround, p - vec2(0.0, 0.03)).a;
  if (nearLeaves > 0.004) {
    vec2 so = -normalize(SUNV.xy) * 0.0022;
    float s1, s2;
    vec4 l1 = leafLayer(p, 36.0, 0.0, so, s1);
    vec4 l2 = leafLayer(p, 31.0, 17.3, so, s2);
    vec4 leaf = l2.a > 0.5 ? l2 : l1;
    leaf.a = max(l1.a, l2.a);
    col *= 1.0 - 0.55 * max(s1, s2) * (1.0 - leaf.a) * (0.4 + 0.6 * sunI);
    vec3 lc = leaf.rgb * (skyCol * 1.3 + sunCol * sunI * (0.42 + 0.30 * ndl) + lamp)
            + leaf.rgb * vec3(1.0, 0.5, 0.2) * sunCol * sunI * 0.10;
    lc *= mix(1.0, 0.6, wetR);
    col = mix(col, lc, leaf.a);
  }

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

  // ---- drifting ground mist ----
  if (uMist > 0.005) {
    float m = fbm3(p * 2.6 + vec2(uTime * 0.020, uTime * 0.008)) * fbm3(p * 5.0 - vec2(uTime * 0.012, 0.0) + 9.0);
    m = smoothstep(0.12, 0.55, m) * uMist;
    col = mix(col, (skyCol * 1.5 + sunCol * mask * 0.10), m * 0.75);
  }

  // ---- lens ----
  vec2 vc = vUv - 0.5;
  col *= 1.0 - 0.75 * smoothstep(0.25, 0.95, length(vc) * 1.25);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.012 * (0.3 + col);
  fragColor = vec4(max(col, 0.0), 1.0);
}`;

// Drifting points: pollen by day, fireflies by night.
export const MOTE_VERT = /* glsl */ `
in vec3 position;
in vec4 aRnd;
uniform float uTime;
uniform float uPx;
uniform float uSpeed;
uniform float uSize;
out float vA;
void main() {
  float t = uTime * (0.012 + 0.02 * aRnd.x) * uSpeed;
  vec2 q = position.xy + vec2(sin(t * 6.0 + aRnd.y * 40.0) * 0.06 + t * 0.6, cos(t * 5.0 + aRnd.z * 40.0) * 0.05 + t * 0.25);
  q = fract(q * 0.5 + 0.5) * 2.0 - 1.0;
  float blink = 0.5 + 0.5 * sin(uTime * (0.3 + aRnd.w) * (uSpeed > 1.5 ? 2.2 : 1.0) + aRnd.x * 50.0);
  vA = (uSpeed > 1.5 ? smoothstep(0.35, 0.9, blink) : blink) * (0.3 + 0.7 * aRnd.z);
  gl_Position = vec4(q, 0.0, 1.0);
  gl_PointSize = (1.5 + 6.0 * aRnd.w * aRnd.w) * uPx * uSize;
}`;

export const MOTE_FRAG = /* glsl */ `
precision highp float;
in float vA;
out vec4 fragColor;
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = 1.0 - smoothstep(0.0, 0.5, d);
  fragColor = vec4(uColor * a * a * vA, 1.0);
}`;

// Cherry petals tumbling across the garden.
export const PETAL_VERT = /* glsl */ `
in vec3 position;
in vec4 aRnd;
uniform float uTime;
uniform float uPx;
out float vRot;
out float vTone;
void main() {
  float t = uTime * (0.020 + 0.022 * aRnd.x);
  vec2 q = position.xy + vec2(t * 1.1 + 0.08 * sin(t * 9.0 + aRnd.y * 30.0), -t * 0.8 + 0.06 * cos(t * 7.0 + aRnd.z * 30.0));
  q = fract(q * 0.5 + 0.5) * 2.0 - 1.0;
  vRot = uTime * (0.4 + aRnd.w) + aRnd.y * 20.0;
  vTone = aRnd.z;
  gl_Position = vec4(q, 0.0, 1.0);
  gl_PointSize = (9.0 + 9.0 * aRnd.w) * uPx;
}`;

export const PETAL_FRAG = /* glsl */ `
precision highp float;
in float vRot;
in float vTone;
out vec4 fragColor;
uniform vec3 uTint;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  d = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  d.y /= 0.35 + 0.65 * abs(sin(vRot * 0.7));        // tumbling: the petal foreshortens as it turns
  float r = length(d * vec2(1.0, 1.55) + vec2(0.0, 0.05));
  float notch = smoothstep(0.02, 0.07, length(d - vec2(0.42, 0.0)));
  float a = (1.0 - smoothstep(0.34, 0.40, r)) * notch;
  vec3 col = mix(vec3(1.0, 0.72, 0.80), vec3(1.0, 0.90, 0.93), vTone) * uTint;
  fragColor = vec4(col, a * 0.92);
}`;
