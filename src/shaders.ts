/**
 * GLSL shader sources for the liquid glass effect.
 *
 * All shaders target WebGL 1 (GLSL ES 1.0) for maximum compatibility.
 * The rendering pipeline has three stages:
 *   1. Blit — copy / UV-transform a texture (used for background upload & downsample)
 *   2. Blur — 9-tap Gaussian blur in a single direction (run H then V, multiple passes)
 *   3. Glass — the core liquid-glass composite (refraction, specular, shadow, etc.)
 */

// ──────────────────────────────────────────────
// Full-screen quad vertex shader (used by blit & blur)
// ──────────────────────────────────────────────
export const VS_QUAD = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
	v_uv = a_pos * 0.5 + 0.5;
	gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// ──────────────────────────────────────────────
// Blit with UV scale + offset (background cover-mode transform)
// ──────────────────────────────────────────────
export const FS_BLIT = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_scale;
uniform vec2 u_offset;
varying vec2 v_uv;
void main() {
	gl_FragColor = texture2D(u_tex, v_uv * u_scale + u_offset);
}`;

// ──────────────────────────────────────────────
// 9-tap Gaussian blur (single direction)
// ──────────────────────────────────────────────
export const FS_BLUR = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_dir;
varying vec2 v_uv;
void main() {
	vec4 s  = texture2D(u_tex, v_uv) * 0.22702703;
	s += texture2D(u_tex, v_uv + u_dir * 1.38461538) * 0.31621622;
	s += texture2D(u_tex, v_uv - u_dir * 1.38461538) * 0.31621622;
	s += texture2D(u_tex, v_uv + u_dir * 3.23076923) * 0.07027027;
	s += texture2D(u_tex, v_uv - u_dir * 3.23076923) * 0.07027027;
	gl_FragColor = s;
}`;

// ──────────────────────────────────────────────
// Glass panel vertex shader
// Positions the panel quad in NDC and computes per-fragment
// local-pixel coordinates and background-texture UVs.
// ──────────────────────────────────────────────
export const VS_GLASS = `
attribute vec2 a_pos;
uniform vec2 u_center;   // panel centre in root-pixel coords (top-left origin)
uniform vec2 u_size;     // panel size in px
uniform vec2 u_res;      // root element size in px
uniform float u_pad;     // shadow padding in px
varying vec2 v_localPx;
varying vec2 v_screenUV;

void main() {
	vec2 total = u_size + vec2(u_pad * 2.0);
	v_localPx = a_pos * total;                       // px from panel centre
	vec2 px = u_center + a_pos * total;              // screen px (DOM)
	v_screenUV = vec2(px.x / u_res.x, 1.0 - px.y / u_res.y);
	vec2 ndc = (px / u_res) * 2.0 - 1.0;
	ndc.y = -ndc.y;
	gl_Position = vec4(ndc, 0.0, 1.0);
}`;


// ──────────────────────────────────────────────
// Glass panel fragment shader — the core liquid-glass effect
//
// Implements:
//   • Rounded-rect SDF with pill-bevel height field
//   • Dual-surface (biconvex) refraction
//   • Chromatic aberration (dispersion)
//   • Edge-weighted sampling of the pre-blurred background
//   • Fresnel, specular (multi-light Blinn-Phong), edge highlight
//   • Cool glass tint, saturation, brightness
//   • Drop shadow with offset
//   • Anti-aliased panel mask
// ──────────────────────────────────────────────
export const FS_GLASS = `
precision highp float;

uniform sampler2D u_bgTex;
uniform sampler2D u_blurTex;
uniform vec2 u_size;           // panel px
uniform float u_radius;        // corner radius px
uniform vec2 u_res;

uniform float u_refract;
uniform float u_chroma;
uniform float u_edgeHL;
uniform float u_spec;
uniform float u_fresnel;
uniform float u_distort;
uniform float u_alpha;
uniform float u_sat;
uniform float u_tint;
uniform float u_zRadius;
uniform float u_brightness;
uniform float u_shadowAlpha;
uniform float u_shadowSpread;
uniform float u_shadowOffY;
uniform float u_bevelMode;
uniform float u_blurAmount;
uniform float u_dpr;
uniform float u_hasBg;
uniform float u_themeLift;
uniform float u_time;      // seconds — drives liquid flow while animating
uniform float u_hover;     // 0..1 spring-animated hover progress
uniform float u_press;     // 0..1 spring-animated press progress
uniform vec2 u_mouse;      // pointer offset from panel centre (device px)

varying vec2 v_localPx;
varying vec2 v_screenUV;

// Rounded-rect signed distance
float rrSDF(vec2 p, vec2 b, float r) {
	vec2 q = abs(p) - b + vec2(r);
	return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0))) - r;
}

// Polynomial smooth maximum for crease smoothing
float smax(float a, float b, float k) {
	float h = max(k - abs(a - b), 0.0) / k;
	return max(a, b) + h * h * k * 0.25;
}

// Smooth rounded-rect signed distance
float smoothSDF(vec2 p, vec2 b, float r, float k) {
	vec2 q = abs(p) - b + vec2(r);
	return min(smax(q.x, q.y, k), 0.0) + length(max(q, vec2(0.0))) - r;
}

// Bevel height field.
// Both modes use the same half-circle profile (smooth peak at centre,
// steep at edges).  The difference is in the refraction model:
//   mode 0 = biconvex pill — light refracts at both surfaces (entry + exit).
//   mode 1 = dome (plano-convex) — flat bottom, so only exit refraction.
// d = distance inside from edge (-sdf), zR = z-radius of the bevel.
float bevelHeight(float d, float zR) {
	if (d <= 0.0) return 0.0;
	if (d >= zR) return zR;
	return sqrt(d * (2.0 * zR - d));
}

// Quintic smootherstep — zero 1st AND 2nd derivative at both ends,
// so fades driven by it leave no visible band (C2 continuity).
float sstep5(float a, float b, float x) {
	float t = clamp((x - a) / (b - a), 0.0, 1.0);
	return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise — C1 interpolated, no per-pixel grit.
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash(i);
	float b = hash(i + vec2(1.0, 0.0));
	float c = hash(i + vec2(0.0, 1.0));
	float d = hash(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
	vec2 half_ = u_size * 0.5;
	float r = min(u_radius, min(half_.x, half_.y));
	float sdf = rrSDF(v_localPx, half_, r);

	// ── Shadow (outside panel, offset by shadowOffY) ──
	if (sdf > 0.0) {
		float sdfShadow = rrSDF(v_localPx - vec2(0.0, u_shadowOffY), half_, r);
		float d = max(sdfShadow - 1.0, 0.0);
		float spread = max(u_shadowSpread, 1.0);
		float falloff = 1.0 / (spread * spread);
		float outerShadow = exp(-d * d * falloff) * 0.55;
		float contactShadow = exp(-d * 0.08 / max(spread * 0.04, 0.01)) * 0.3;
		float shadow = (outerShadow + contactShadow) * u_shadowAlpha;
		gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
		return;
	}

	// ── Anti-aliased mask (crisp ~1.5px feather, fully inside the edge
	//    so it never overlaps the shadow branch above) ──
	float maxD = min(half_.x, half_.y);
	float zR = min(u_zRadius, maxD);
	float k = max(zR * 0.8, 4.0);
	float sdfSmooth = smoothSDF(v_localPx, half_, r, k);
	float mask = 1.0 - smoothstep(-1.5, -0.1, sdf);

	float inside = max(-sdf, 0.0);
	float insideSmooth = max(-sdfSmooth, 0.0);
	float edge = smoothstep(maxD * 0.35, 0.0, insideSmooth);

	// ── Surface normal (top surface) via bevel height field ──
	float e = 2.0;
	float dC = -sdfSmooth;
	float dR = -smoothSDF(v_localPx + vec2(e, 0.0), half_, r, k);
	float dL = -smoothSDF(v_localPx - vec2(e, 0.0), half_, r, k);
	float dU = -smoothSDF(v_localPx + vec2(0.0, e), half_, r, k);
	float dD = -smoothSDF(v_localPx - vec2(0.0, e), half_, r, k);
	float hC = bevelHeight(dC, zR);
	float hR = bevelHeight(dR, zR);
	float hL = bevelHeight(dL, zR);
	float hU = bevelHeight(dU, zR);
	float hD = bevelHeight(dD, zR);
	vec2 hGrad = vec2(hR - hL, hU - hD) / (2.0 * e);
	float depth = smoothstep(0.0, zR, insideSmooth);

	// Refraction strength follows the bevel profile: zero at the rim and
	// in the flat centre, peaking on the curved shoulder — no separate
	// flat/refracted blend band that causes a visible ring.
	float edgeBand = max(zR * 0.5, 18.0);
	float rimSuppress = smoothstep(0.0, edgeBand, insideSmooth);
	float coreStrength = smoothstep(0.0, zR, hC);
	float refrStrength = rimSuppress * coreStrength;
	refrStrength = refrStrength * refrStrength * (3.0 - 2.0 * refrStrength);

	// C2 junction fade — the circular bevel meets the flat interior with a
	// curvature break that reads as a visible ring. Ease the bevel gradient
	// out over the top of the shoulder with a smootherstep so the bend
	// dissolves into the interior with no perceptible border.
	// Starting at 0.3 (instead of 0.5) gives the fade more room so the
	// refraction handoff to the liquid interior is imperceptible.
	float bevelT = clamp(dC / max(zR, 1.0), 0.0, 1.0);
	float junctionFade = 1.0 - sstep5(0.3, 1.0, bevelT);

	// ── Liquid interior ──
	// The flat centre gets a gentle convex lens plus a pointer-following
	// bulge, so refraction continues smoothly from the shoulder through
	// the middle of the glass instead of dying at the bevel.
	float lensAmp = zR * (0.10 + 0.14 * u_hover + 0.30 * u_press);
	vec2 lensGrad = -2.0 * lensAmp * v_localPx / (half_ * half_ + vec2(1.0));

	float sigma = max(min(half_.x, half_.y) * 0.6, 40.0);
	vec2 dm = v_localPx - u_mouse;
	float bump = exp(-dot(dm, dm) / (2.0 * sigma * sigma));
	float bumpAmp = zR * (0.20 * u_hover + 0.34 * u_press);
	vec2 bumpGrad = (-dm / (sigma * sigma)) * bump * bumpAmp;

	// Soft travelling ripple while hovered — the surface feels alive.
	vec2 ripGrad = vec2(
		sin(v_localPx.y * 0.045 + u_time * 2.6),
		cos(v_localPx.x * 0.045 - u_time * 2.2)
	) * (zR * 0.02) * u_hover;

	vec2 liquidGrad = lensGrad + bumpGrad + ripGrad;

	// Soften surface normals at the rim where the height field gradient spikes.
	vec2 hGradSoft = (hGrad * junctionFade + liquidGrad) * rimSuppress;
	vec3 N = normalize(vec3(-hGradSoft, 1.0));

	// ── Refraction ──
	vec2 pxToUV = vec2(1.0) / u_res;
	float ior = 1.5;
	float refrPow = 1.0 - 1.0 / ior;
	float thickness = hC * 2.0;
	float thickNorm = thickness / max(zR * 2.0, 1.0);
	vec2 refrPx;
	if (u_bevelMode < 0.5) {
		// Biconvex: physically-based dual-surface refraction
		vec2 exitRefr = hGradSoft * refrPow;
		vec2 entryRefr = hGradSoft * refrPow;
		vec2 throughRefr = entryRefr * thickNorm * 0.5;
		refrPx = (exitRefr + entryRefr + throughRefr) * u_refract * (30.0 * u_dpr);
		vec2 centerDir = -v_localPx / max(half_, vec2(1.0));
		refrPx += centerDir * u_refract * (4.0 * u_dpr) * depth * coreStrength;
	} else {
		// Dome (plano-convex): uniform magnification by contracting UV toward center.
		refrPx = -v_localPx * u_refract * depth * 0.35 * coreStrength;
	}
	refrPx *= refrStrength;
	vec2 refr = refrPx * pxToUV;

	// ── Organic distortion — two octaves of smooth value noise, slowly
	//    drifting so the glass reads as a liquid surface, never gritty ──
	vec2 ns = v_localPx * 0.022 + vec2(u_time * 0.18, -u_time * 0.13);
	float n1 = vnoise(ns) - 0.5;
	float n2 = vnoise(ns * 2.3 + vec2(41.0, 17.0)) - 0.5;
	vec2 flow = vec2(n1 + n2 * 0.4, vnoise(ns + vec2(9.0, 63.0)) - 0.5 + n2 * 0.3);
	float distortAmt = u_distort + 0.25 * u_hover + 0.15 * u_press;
	vec2 micro = flow * distortAmt * (10.0 * u_dpr) * pxToUV * refrStrength;

	// ── Chromatic aberration ──
	// In the bevel zone the surface normal is tilted, giving strong rainbow
	// fringing that looks great. But where the bevel meets the flat interior
	// N.xy drops to near-zero, creating a hard ring.
	// Fix: blend from normal-driven CA (bevel) to a radially-outward phantom CA
	// (flat interior) that decays smoothly toward the panel centre.
	float caS = u_chroma * (18.0 * u_dpr) * (edge * 0.7 + 0.3) * 2.0 * refrStrength;

	// Normalised outward-from-centre direction (matches N.xy direction convention).
	vec2 radialOut = v_localPx / max(length(v_localPx), 0.5);

	// bevelBlend: 0 inside the bevel, smoothly rises to 1 as we cross the
	// bevel shoulder into the flat interior.
	float bevelBlend = sstep5(0.5, 1.0, bevelT);

	// Flat-interior amplitude: inherits chromatic strength but decays
	// quadratically toward the panel centre so the tail is invisible there.
	float caFlatAmp = u_chroma * (10.0 * u_dpr) * refrStrength
	                * (1.0 - sstep5(0.35, 1.0, insideSmooth / max(maxD, 1.0)));

	// Blend: bevel CA → flat CA across the shoulder transition.
	vec2 caD = mix(N.xy * caS, radialOut * caFlatAmp, bevelBlend) * pxToUV;
	vec2 sampleUV = v_screenUV + refr + micro;

	vec3 sharpCol = vec3(
		texture2D(u_bgTex,  sampleUV + caD).r,
		texture2D(u_bgTex,  sampleUV).g,
		texture2D(u_bgTex,  sampleUV - caD).b
	);
	float lodBias = u_blurAmount * 3.5;
	vec3 blurCol = vec3(
		texture2D(u_blurTex, sampleUV + caD, lodBias).r,
		texture2D(u_blurTex, sampleUV, lodBias).g,
		texture2D(u_blurTex, sampleUV - caD, lodBias).b
	);
	// Blur mix scales with blurAmount; the refracting shoulder keeps a
	// touch more sharpness so bent content stays legible (iOS look).
	float edgeMix = min(u_blurAmount * 1.05, 0.94) * (1.0 - edge * 0.18);
	vec3 col = mix(sharpCol, blurCol, edgeMix);

	// ── Vibrancy — saturate what shows through the material (iOS
	//    backdrop-style saturate boost, scaled by how frosted we are) ──
	float vibLum = dot(col, vec3(0.299, 0.587, 0.114));
	float vibrancy = 1.0 + (0.45 + 0.35 * u_blurAmount) + u_sat * 0.8;
	col = clamp(mix(vec3(vibLum), col, vibrancy), 0.0, 1.0);

	// ── Frost / milk layer (the core iOS material feel) ──
	// u_themeLift carries the theme tone: 1 = light material (milky white),
	// 0 = dark material (smoky gray). Amount driven by tintStrength.
	// Press adds a touch more frost — the material visibly "engages" (haptic).
	vec3 milk = mix(vec3(0.125, 0.135, 0.165), vec3(0.985, 0.99, 1.0), u_themeLift);
	float frostAmt = clamp(u_tint, 0.0, 1.0) * (0.30 + 0.26 * u_blurAmount);
	frostAmt = min(frostAmt + 0.10 * u_press + 0.03 * u_hover, 1.0);
	col = mix(col, milk, frostAmt);

	col *= 1.0 + u_brightness + 0.05 * u_hover + 0.07 * u_press;

	// ── Fresnel ──
	float fres = pow(1.0 - abs(N.z), 4.0) * u_fresnel;

	// ── Specular highlights (multi-light Blinn-Phong) ──
	vec3 V = vec3(0.0, 0.0, 1.0);
	// Key light drifts toward the pointer on hover — the highlight follows
	// the finger like a light source moving over real glass.
	vec2 mouseDir = u_mouse / max(max(half_.x, half_.y), 1.0);
	vec3 L1 = normalize(vec3(0.4 + mouseDir.x * 0.45 * u_hover, 0.7 - mouseDir.y * 0.45 * u_hover, 1.0));
	vec3 H1 = normalize(L1 + V);
	float sp1 = pow(max(dot(N, H1), 0.0), 90.0);
	vec3 L2 = normalize(vec3(-0.3, -0.5, 1.0));
	vec3 H2 = normalize(L2 + V);
	float sp2 = pow(max(dot(N, H2), 0.0), 50.0) * 0.3;
	vec3 L3 = normalize(vec3(0.1, 0.3, 1.0));
	float spB = pow(max(dot(N, L3), 0.0), 6.0) * 0.1;
	vec3 L4 = normalize(vec3(0.0, 0.9, 0.4));
	vec3 H4 = normalize(L4 + V);
	float sp4 = pow(max(dot(N, H4), 0.0), 120.0) * 0.6;
	float specBoost = 1.0 + 0.55 * u_hover + 0.85 * u_press;
	float totalSpec = (sp1 + sp2 + spB + sp4) * u_spec * specBoost;

	// ── Inner rim stroke (~1.5px, top-lit like iOS) ──
	float strokeBand = smoothstep(0.0, 1.0, inside) * (1.0 - smoothstep(1.5, 3.2, inside));
	float topBias = 0.5 - 0.5 * (v_localPx.y / half_.y);
	float edgeHL = clamp(u_edgeHL, 0.0, 1.0);
	float rimStroke = strokeBand * (0.20 + 0.50 * topBias * topBias) * edgeHL
		* (1.0 + 0.5 * u_hover + 0.6 * u_press);

	// ── Soft sheen hugging the top edge (broad, subtle) ──
	float sheen = smoothstep(16.0, 0.0, insideSmooth) * (0.3 + 0.7 * topBias) * 0.06 * edgeHL;

	vec3 fin = vec3(0.0);
	float alpha = 0.0;

	if (u_hasBg > 0.5) {
		// Highlights dim over already-bright backgrounds so nothing blows out.
		float baseLum = dot(col, vec3(0.299, 0.587, 0.114));
		float hiScale = mix(1.0, 0.35, smoothstep(0.55, 0.9, baseLum));
		fin = col
			+ vec3(1.0) * totalSpec * 0.45 * hiScale
			+ vec3(1.0) * rimStroke * (0.45 + 0.55 * hiScale)
			+ vec3(1.0) * sheen * hiScale
			+ vec3(1.0) * fres * 0.06 * hiScale;
		fin = min(fin, vec3(1.0));
		alpha = mask * u_alpha;
	} else {
		// Transparent-background fallback: render only the lighting layers.
		float hl = totalSpec * 0.35 + rimStroke * 0.8 + sheen + fres * 0.05;
		fin = vec3(1.0) * hl;
		alpha = mask * min(hl, 1.0);
	}

	gl_FragColor = vec4(fin, alpha);
}`;
