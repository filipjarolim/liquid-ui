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

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
		float outerShadow = exp(-d * d * falloff) * 0.65;
		float contactShadow = exp(-d * 0.08 / max(spread * 0.04, 0.01)) * 0.35;
		float shadow = (outerShadow + contactShadow) * u_shadowAlpha;
		gl_FragColor = vec4(0.0, 0.0, 0.0, shadow);
		return;
	}

	// ── Anti-aliased mask ──
	float mask = 1.0 - smoothstep(-1.5, 0.5, sdf);

	float maxD = min(half_.x, half_.y);
	float inside = -sdf;
	float edge = smoothstep(maxD * 0.35, 0.0, inside);

	// ── Surface normal (top surface) via bevel height field ──
	float zR = min(u_zRadius, maxD);
	float k = max(zR * 0.8, 4.0); // Smooth width proportional to bevel radius
	float e = 2.0;
	float dC = -smoothSDF(v_localPx, half_, r, k);
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
	vec3 N = normalize(vec3(-hGrad, 1.0));

	float depth = smoothstep(0.0, zR, inside);

	// ── Refraction ──
	vec2 pxToUV = vec2(1.0) / u_res;
	float ior = 1.5;
	float refrPow = 1.0 - 1.0 / ior;
	float thickness = hC * 2.0;
	float thickNorm = thickness / max(zR * 2.0, 1.0);
	vec2 refrPx;
	if (u_bevelMode < 0.5) {
		// Biconvex: physically-based dual-surface refraction
		vec2 exitRefr = hGrad * refrPow;
		vec2 entryRefr = hGrad * refrPow;
		vec2 throughRefr = entryRefr * thickNorm * 0.5;
		refrPx = (exitRefr + entryRefr + throughRefr) * u_refract * (30.0 * u_dpr);
		vec2 centerDir = -v_localPx / max(half_, vec2(1.0));
		refrPx += centerDir * u_refract * (4.0 * u_dpr) * depth;
	} else {
		// Dome (plano-convex): uniform magnification by contracting UV toward center.
		// Each pixel samples from closer to center → content appears larger.
		refrPx = -v_localPx * u_refract * depth * 0.35;
	}
	vec2 refr = refrPx * pxToUV;

	// ── Micro-distortion noise ──
	vec2 ns = v_localPx * 0.08;
	vec2 micro = (vec2(hash(ns), hash(ns + vec2(37.0))) - 0.5) * u_distort * (4.0 * u_dpr) * pxToUV;

	// ── Chromatic aberration ──
	float caS = u_chroma * (18.0 * u_dpr) * (edge * 0.7 + 0.3) * 2.0;
	vec2 caD = N.xy * caS * pxToUV;
	vec2 base = v_screenUV + refr + micro;

	vec3 sharp = vec3(
		texture2D(u_bgTex,  base + caD).r,
		texture2D(u_bgTex,  base).g,
		texture2D(u_bgTex,  base - caD).b
	);
	float lodBias = u_blurAmount * 3.5;
	vec3 blur = vec3(
		texture2D(u_blurTex, base + caD, lodBias).r,
		texture2D(u_blurTex, base, lodBias).g,
		texture2D(u_blurTex, base - caD, lodBias).b
	);
	// Blur mix scales linearly with blurAmount — low values stay mostly sharp.
	float edgeMix = min(u_blurAmount * 0.85, 0.75) * (1.0 - edge * 0.25);
	vec3 col = mix(sharp, blur, edgeMix);

	// ── Brightness ──
	col *= 1.0 + u_brightness;

	// ── Saturation ──
	float lum = dot(col, vec3(0.299, 0.587, 0.114));
	col = mix(vec3(lum), col, 1.0 + u_sat);

	// ── Cool glass tint ──
	col = mix(col, col * vec3(0.92, 0.95, 1.05), u_tint);
	// No body attenuation to keep the glass color completely neutral and matching the background.

	// No default backing tint to keep the glass completely clean and clear.

	// ── Fresnel ──
	float fres = pow(1.0 - abs(N.z), 4.0) * u_fresnel;

	// ── Specular highlights (multi-light Blinn-Phong) ──
	vec3 V = vec3(0.0, 0.0, 1.0);
	vec3 L1 = normalize(vec3(0.4, 0.7, 1.0));
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
	float totalSpec = (sp1 + sp2 + spB + sp4) * u_spec;

	// ── Inner border / stroke highlight (subtle — CSS handles hard borders) ──
	float borderWidth = 1.0;
	float innerStroke = smoothstep(-borderWidth - 0.5, -borderWidth, sdf)
	                  * (1.0 - smoothstep(-0.5, 0.0, sdf));
	float topBias = 0.5 + 0.5 * (-v_localPx.y / half_.y);
	innerStroke *= (0.3 + 0.4 * topBias);

	// ── Edge highlight & inner glow ──
	float rim = edge * u_edgeHL * 0.12;
	float innerGlow = smoothstep(4.0, 0.0, -sdf) * u_edgeHL * 0.06;

	// ── Environment-like reflection (fake) ──
	float envRefl = (N.y * 0.5 + 0.5) * fres * 0.02;

	// ── Composite ──
	vec3 fin = vec3(0.0);
	float alpha = 0.0;

	if (u_hasBg > 0.5) {
		fin = col;
		// Highlights are kept very subtle to prevent light glass in dark mode
		fin += vec3(totalSpec * 0.35);
		fin += vec3((rim + innerGlow) * 0.35);
		fin += vec3(innerStroke * u_edgeHL * 0.1);
		fin += vec3(envRefl * 0.35);
		fin = mix(fin, vec3(1.0), fres * 0.008);
		alpha = mask * u_alpha;
	} else {
		// Only render highlights on transparent background
		vec3 specColor = vec3(1.0);
		vec3 rimColor = vec3(1.0);
		vec3 strokeColor = vec3(1.0);
		fin = specColor * (totalSpec * 0.35) + rimColor * ((rim + innerGlow) * 0.35) + strokeColor * (innerStroke * u_edgeHL * 0.25);
		alpha = mask * (totalSpec * 0.35 + (rim + innerGlow) * 0.35 + innerStroke * u_edgeHL * 0.25);
	}

	gl_FragColor = vec4(fin, alpha);
}`;
