import { NOISE, WORLD } from './common.js';

// State texture: R biomass (thickness), G surface water, B maturity, A hydration (greenness).

export const INIT_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSub;
uniform vec2 uSimScale;
uniform float uSeed;
uniform float uSeedMoss;
${NOISE}
void main() {
  vec4 sub = texture(uSub, vUv);
  float cavn = smoothstep(0.42, 0.68, sub.g);
  float B = 0.0;
  for (int i = 0; i < 40; i++) {
    vec2 c = 0.5 + (hash22(vec2(float(i) * 3.7 + uSeed, uSeed * 1.9)) - 0.5) * uSimScale * 0.92;
    float r = 0.010 + 0.040 * hash12(vec2(float(i), uSeed + 4.0));
    float d = length(vUv - c) + 0.030 * (fbm(vUv * 22.0 + uSeed) - 0.5);
    B = max(B, fall(r * 0.3, r, d));
  }
  B *= 0.32 * smoothstep(0.3, 0.6, cavn + 0.4 * sub.b) * smoothstep(0.2, 0.45, sub.b) * uSeedMoss;
  float W = 0.10 + 0.30 * cavn + 0.15 * sub.a;
  fragColor = vec4(B, W, B > 0.01 ? 0.35 : 0.0, 1.0);
}`;

export const SIM_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uState;
uniform sampler2D uSub;
uniform vec2 uTexel;
uniform float uSeed;
uniform float uDt;
uniform float uHumidity;
uniform float uLight;
uniform float uRain;
uniform vec2 uBrushA;
uniform vec2 uBrushB;
uniform float uBrushR;
uniform float uBrushMode;   // 0 none, 1 sow, 2 mist, 3 dry, 4 scrape, 5 clear (under a placed object)
${NOISE}
${WORLD}

const float FLOW = 5.0;       // downhill water transport
const float DIFF = 0.10;      // capillary spreading
const float DEW = 0.0040;     // condensation / fog drip
const float EVAP = 0.023;     // evaporation
const float GROW = 0.006;     // logistic thickening
const float CREEP = 0.020;    // lateral shoot extension
const float CONTACT = 0.035;   // colonisation of a neighbouring bare cell
const float SPORE = 0.00004;  // long-range spore establishment
const float AGE = 0.0016;
const float DIE = 0.0010;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec4 s = texture(uState, vUv);
  vec4 sub = texture(uSub, vUv);
  float B = s.r, W = s.g, M = s.b, Hy = s.a;
  float h = sub.r;
  float cavn = smoothstep(0.42, 0.68, sub.g);
  float por = sub.b, damp = sub.a;
  vec2 cell = gl_FragCoord.xy;
  float r1 = hash12(cell + uSeed * vec2(37.0, 17.0));
  float r2 = hash12(cell * 1.37 + uSeed * vec2(11.0, 53.0));

  // ---- neighbourhood ----
  float sumB = 0.0, maxB = 0.0, wsum = 0.0, inflow = 0.0, outflow = 0.0, lapW = 0.0;
  vec2 grad = vec2(0.0);
  float myLevel = h + W * 0.06;
  float myHold = 1.0 - 0.8 * smoothstep(0.0, 0.6, B);     // moss cushions hold water like a sponge
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec2 o = vec2(float(i), float(j));
    float wg = (i != 0 && j != 0) ? 0.7071 : 1.0;
    vec4 n = texture(uState, vUv + o * uTexel);
    float hn = texture(uSub, vUv + o * uTexel).r;
    sumB += wg * n.r; wsum += wg; maxB = max(maxB, n.r);
    float dl = clamp((hn + n.g * 0.06) - myLevel, -0.02, 0.02);   // capped so cliffs stay stable
    if (dl > 0.0) inflow += wg * dl * n.g * (1.0 - 0.8 * smoothstep(0.0, 0.6, n.r));
    else outflow += wg * (-dl) * W * myHold;
    lapW += wg * (n.g - W);
    grad += o * wg * hn;
  }
  float nb = sumB / wsum;
  grad /= 4.83 * uTexel.x;         // approx dh/duv
  vec3 N = normalize(vec3(-grad * RS, 1.0));
  float expo = clamp(dot(N, SUN) * 1.6, 0.0, 1.0);
  float sun = uLight * expo;

  // ---- water ----
  float Bs = smoothstep(0.0, 0.6, B);
  W += uDt * (FLOW * (inflow - outflow) + DIFF * lapW / wsum);
  float dew = DEW * uHumidity * uHumidity * (0.3 + 0.7 * cavn) * (0.5 + min(damp, 1.2));
  float evap = EVAP * (0.3 + 0.7 * sun) * (1.0 - 0.6 * cavn) * (1.0 - 0.7 * Bs) * (1.3 - uHumidity) * (1.25 - 0.75 * min(damp, 1.2));
  W += uDt * (dew * (1.0 - W) - evap * W);
  W += uRain * 0.02 * (0.5 + r1);

  // ---- habitat ----
  float moist = smoothstep(0.10, 0.42, W);
  float lightF = 0.35 + 0.65 * smoothstep(0.0, 0.35, uLight);
  float S = moist * (1.0 - 0.6 * sun * (1.0 - moist)) * clamp(por * 1.3, 0.0, 1.0) * lightF;
  float K = clamp(0.22 + 0.45 * cavn + 0.38 * moist, 0.15, 1.0);

  // ---- hydration: fast to rehydrate, slow to dry out (poikilohydry) ----
  float tgt = smoothstep(0.06, 0.30, W);
  Hy += uDt * (tgt > Hy ? 0.06 : 0.005) * (tgt - Hy);

  // ---- moss ----
  if (B < 0.02) {
    // Contact colonisation: a stochastic front (Eden growth) biased by habitat.
    float p = CONTACT * S * clamp(nb * 3.0, 0.0, 1.0) * smoothstep(0.03, 0.12, maxB);
    // Spore rain from mature, sporophyte-bearing moss: heavy-tailed dispersal kernel.
    vec2 rr = hash22(cell * 0.73 + uSeed * vec2(5.0, 91.0));
    float ang = 6.2831853 * rr.x;
    float dist = (6.0 + 320.0 * rr.y * rr.y * rr.y) * uTexel.x;
    vec4 src = texture(uState, vUv + vec2(cos(ang), sin(ang)) * dist + vec2(0.25, -0.1) * dist);
    float fert = smoothstep(0.55, 0.85, src.b) * smoothstep(0.25, 0.55, src.r) * src.a;
    p += SPORE * fert * S * (0.4 + 0.6 * cavn);
    if (r1 < p * uDt) { B = 0.03; M = 0.0; Hy = max(Hy, tgt); }
  } else {
    B += uDt * (GROW * S * Hy * B * (1.0 - B / K) + CREEP * S * max(0.0, nb - B));
    B -= uDt * DIE * (1.0 - Hy) * (0.3 + sun) * (1.0 - moist) * B;
    M += uDt * AGE * Hy * (0.3 + 0.7 * S) * (1.0 - M);
  }

  // ---- brush ----
  if (uBrushMode > 0.5) {
    float d = segDist(vUv, uBrushA, uBrushB);
    float ragged = d + uBrushR * 0.25 * (vnoise(vUv * 90.0) - 0.5);
    float f = fall(uBrushR * 0.25, uBrushR, ragged);
    if (uBrushMode < 1.5) {            // sow spores (carried in a breath of mist)
      if (B < 0.02 && r2 < 0.05 * f * (0.5 + cavn)) { B = 0.035; M = 0.0; Hy = 1.0; }
      W += 0.012 * f * (1.0 - W);
    } else if (uBrushMode < 2.5) {     // mist
      W += 0.06 * f * (1.0 - W) * (0.6 + 0.8 * r2);
    } else if (uBrushMode < 3.5) {     // warm, dry light
      W -= 0.10 * f * W;
      Hy -= 0.03 * f * Hy;
    } else if (uBrushMode < 4.5) {     // scrape
      B -= 0.12 * f * (0.5 + r2);
      W -= 0.02 * f * W;
    } else {
      B *= 1.0 - fall(uBrushR * 0.85, uBrushR, d);
    }
  }

  if (damp > 1.5) { W = 1.0; B = 0.0; }                    // open water: a spring for its surroundings
  if (B < 0.006) { B = 0.0; M = 0.0; }
  fragColor = vec4(clamp(B, 0.0, 1.0), clamp(W, 0.0, 1.0), clamp(M, 0.0, 1.0), clamp(Hy, 0.0, 1.0));
}`;

// Averages moss cover over the visible part of the surface for the on-screen readout.
export const STATS_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uState;
uniform vec2 uSimScale;
void main() {
  float cov = 0.0, wet = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
    vec2 uv = (vUv + o / 32.0 - 0.5) * uSimScale + 0.5;
    vec4 s = texture(uState, uv);
    cov += smoothstep(0.04, 0.10, s.r);
    wet += s.g;
  }
  fragColor = vec4(cov / 16.0, wet / 16.0, 0.0, 1.0);
}`;
