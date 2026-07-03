/**
 * GlassRenderer — WebGL rendering pipeline for the liquid glass effect.
 *
 * Manages a single offscreen WebGL canvas, shader programs, and a fixed-size
 * blur FBO. Each panel render uploads the local scene crop, builds a mipmap
 * pyramid for fast frosted blur, and shades the glass into the offscreen canvas.
 */

import { VS_QUAD, FS_BLIT, VS_GLASS, FS_GLASS } from './shaders';
import { SHADOW_PAD } from './defaults';
import type { GlassConfig } from './defaults';

interface FBO {
	fbo: WebGLFramebuffer;
	tex: WebGLTexture;
	w: number;
	h: number;
}

type UniformMap = Record<string, WebGLUniformLocation | null>;

/** Fixed blur texture resolution — decoupled from panel size for stable perf. */
const BLUR_FBO_SIZE = 512;

export class GlassRenderer {
	readonly canvas: HTMLCanvasElement;
	readonly gl: WebGL2RenderingContext | WebGLRenderingContext;

	private blitP!: WebGLProgram;
	private blitU!: UniformMap;
	private glassP!: WebGLProgram;
	private glassU!: UniformMap;

	private quadBuf!: WebGLBuffer;
	private panelBuf!: WebGLBuffer;

	private blurFBO: FBO | null = null;

	private bgTex: WebGLTexture | null = null;
	private bgTexWidth = 0;
	private bgTexHeight = 0;

	width = 0;
	height = 0;

	contextLost = false;

	private _onContextLost: (e: Event) => void;
	private _onContextRestored: () => void;

	constructor() {
		this.canvas = document.createElement('canvas');
		this.canvas.style.display = 'none';
		document.body.appendChild(this.canvas);

		let gl = this.canvas.getContext('webgl2', {
			alpha: true,
			premultipliedAlpha: false,
			antialias: false,
			preserveDrawingBuffer: true,
		}) as WebGLRenderingContext | WebGL2RenderingContext | null;

		if (!gl) {
			gl = this.canvas.getContext('webgl', {
				alpha: true,
				premultipliedAlpha: false,
				antialias: false,
				preserveDrawingBuffer: true,
			});
		}

		if (!gl) {
			throw new Error('LiquidGlass: WebGL is not supported in this browser.');
		}
		this.gl = gl;

		this._initPrograms();
		this._initBuffers();

		this._onContextLost = (e: Event) => {
			e.preventDefault();
			this.contextLost = true;
			console.warn('LiquidGlass: WebGL context lost.');
		};
		this._onContextRestored = () => {
			console.info('LiquidGlass: WebGL context restored — reinitialising.');
			this.contextLost = false;
			this._initPrograms();
			this._initBuffers();
			if (this.blurFBO) {
				this._freeFBO(this.blurFBO);
			}
			this.blurFBO = null;
			this.bgTex = null;
			this.bgTexWidth = 0;
			this.bgTexHeight = 0;
		};
		this.canvas.addEventListener('webglcontextlost', this._onContextLost);
		this.canvas.addEventListener('webglcontextrestored', this._onContextRestored);
	}

	// ────────────────────────────────────────────
	// Initialisation
	// ────────────────────────────────────────────

	private _initPrograms(): void {
		this.blitP = this._link(VS_QUAD, FS_BLIT);
		this.blitU = this._uloc(this.blitP, ['u_tex', 'u_scale', 'u_offset']);

		this.glassP = this._link(VS_GLASS, FS_GLASS);
		this.glassU = this._uloc(this.glassP, [
			'u_bgTex', 'u_blurTex', 'u_center', 'u_size', 'u_radius',
			'u_res', 'u_pad', 'u_refract', 'u_chroma',
			'u_edgeHL', 'u_spec', 'u_fresnel', 'u_distort', 'u_alpha',
			'u_sat', 'u_tint', 'u_zRadius', 'u_brightness',
			'u_shadowAlpha', 'u_shadowSpread', 'u_shadowOffY',
			'u_bevelMode', 'u_blurAmount', 'u_dpr', 'u_hasBg'
		]);
	}

	private _initBuffers(): void {
		const gl = this.gl;

		this.quadBuf = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

		this.panelBuf = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.panelBuf);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
	}

	// ────────────────────────────────────────────
	// Resize
	// ────────────────────────────────────────────

	resize(width: number, height: number): void {
		this.width = width;
		this.height = height;
		if (this.blurFBO) {
			this._freeFBO(this.blurFBO);
		}
		this.blurFBO = null;
		this.canvas.width = 1;
		this.canvas.height = 1;
	}

	// ────────────────────────────────────────────
	// Background upload
	// ────────────────────────────────────────────

	uploadAndBlur(sourceCanvas: HTMLCanvasElement, width: number, height: number): void {
		if (this.contextLost) return;
		const gl = this.gl;
		if (!this._setActiveSize(width, height)) return;
		const W = this.width;
		const H = this.height;

		if (!this.blurFBO) {
			this.blurFBO = this._makeFBO(BLUR_FBO_SIZE, BLUR_FBO_SIZE, true);
		}

		if (!this.bgTex) {
			this.bgTex = gl.createTexture();
			this.bgTexWidth = 0;
			this.bgTexHeight = 0;
		}
		gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true as unknown as number);
		if (this.bgTexWidth === W && this.bgTexHeight === H) {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
		} else {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
			this.bgTexWidth = W;
			this.bgTexHeight = H;
		}
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false as unknown as number);

		// Downscale into the blur FBO, then build mipmaps for LOD-biased sampling.
		const blur = this.blurFBO;
		gl.bindFramebuffer(gl.FRAMEBUFFER, blur.fbo);
		gl.viewport(0, 0, blur.w, blur.h);
		gl.useProgram(this.blitP);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
		gl.uniform1i(this.blitU.u_tex, 0);
		gl.uniform2f(this.blitU.u_scale, 1, 1);
		gl.uniform2f(this.blitU.u_offset, 0, 0);
		this._drawQuad(this.blitP, this.quadBuf);

		gl.bindTexture(gl.TEXTURE_2D, blur.tex);
		gl.generateMipmap(gl.TEXTURE_2D);
	}

	// ────────────────────────────────────────────
	// Glass panel rendering
	// ────────────────────────────────────────────

	renderGlassPanel(
		config: GlassConfig,
		width: number,
		height: number,
		dpr: number,
		hasBg = true,
	): void {
		if (this.contextLost) return;
		if (!hasBg) {
			if (!this._setActiveSize(width * dpr, height * dpr)) return;
		}
		const gl = this.gl;
		const W = this.width;
		const H = this.height;

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.useProgram(this.glassP);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
		gl.uniform1i(this.glassU.u_bgTex, 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, (hasBg && this.blurFBO) ? this.blurFBO.tex : this.bgTex);
		gl.uniform1i(this.glassU.u_blurTex, 1);

		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, W, H);
		gl.uniform2f(this.glassU.u_res, W, H);

		gl.uniform2f(this.glassU.u_center, W * 0.5, H * 0.5);
		gl.uniform2f(this.glassU.u_size, width * dpr, height * dpr);

		gl.uniform1f(this.glassU.u_radius, config.cornerRadius * dpr);
		gl.uniform1f(this.glassU.u_pad, SHADOW_PAD * dpr);
		gl.uniform1f(this.glassU.u_refract, config.refraction);
		gl.uniform1f(this.glassU.u_chroma, config.chromAberration);
		gl.uniform1f(this.glassU.u_edgeHL, config.edgeHighlight);
		gl.uniform1f(this.glassU.u_spec, config.specular);
		gl.uniform1f(this.glassU.u_fresnel, config.fresnel);
		gl.uniform1f(this.glassU.u_distort, config.distortion);
		gl.uniform1f(this.glassU.u_alpha, config.opacity);
		gl.uniform1f(this.glassU.u_sat, config.saturation);
		gl.uniform1f(this.glassU.u_tint, config.tintStrength);
		gl.uniform1f(this.glassU.u_zRadius, config.zRadius * dpr);
		gl.uniform1f(this.glassU.u_brightness, config.brightness);
		gl.uniform1f(this.glassU.u_shadowAlpha, config.shadowOpacity);
		gl.uniform1f(this.glassU.u_shadowSpread, config.shadowSpread * dpr);
		gl.uniform1f(this.glassU.u_shadowOffY, config.shadowOffsetY * dpr);
		gl.uniform1f(this.glassU.u_bevelMode, config.bevelMode);
		gl.uniform1f(this.glassU.u_blurAmount, config.blurAmount);
		gl.uniform1f(this.glassU.u_dpr, dpr);
		gl.uniform1f(this.glassU.u_hasBg, hasBg ? 1.0 : 0.0);

		this._drawQuad(this.glassP, this.panelBuf);
		gl.disable(gl.BLEND);
	}

	clear(): void {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.width, this.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}

	destroy(): void {
		this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
		this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
		if (!this.contextLost) {
			const gl = this.gl;
			if (this.blurFBO) {
				this._freeFBO(this.blurFBO);
			}
			if (this.bgTex) gl.deleteTexture(this.bgTex);
			gl.deleteBuffer(this.quadBuf);
			gl.deleteBuffer(this.panelBuf);
			gl.deleteProgram(this.blitP);
			gl.deleteProgram(this.glassP);
		}
		this.canvas.remove();
	}

	// ────────────────────────────────────────────
	// FBO management
	// ────────────────────────────────────────────

	private _setActiveSize(w: number, h: number): boolean {
		if (w <= 0 || h <= 0) return false;

		this.width = w;
		this.height = h;

		// Keep the offscreen canvas exactly panel-sized so 2D readback matches the WebGL viewport.
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
		}

		return true;
	}

	private _makeFBO(w: number, h: number, useMipmap = false): FBO {
		const gl = this.gl;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, useMipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		const fbo = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);

		return { fbo, tex, w, h };
	}

	private _freeFBO(fboObj: FBO | null): void {
		if (!fboObj) return;
		const gl = this.gl;
		gl.deleteFramebuffer(fboObj.fbo);
		gl.deleteTexture(fboObj.tex);
	}

	// ────────────────────────────────────────────
	// Shader helpers
	// ────────────────────────────────────────────

	private _compile(src: string, type: number): WebGLShader | null {
		const gl = this.gl;
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			console.error('LiquidGlass shader compile error:', gl.getShaderInfoLog(s), src);
			return null;
		}
		return s;
	}

	private _link(vsSrc: string, fsSrc: string): WebGLProgram {
		const gl = this.gl;
		const p = gl.createProgram()!;
		gl.attachShader(p, this._compile(vsSrc, gl.VERTEX_SHADER)!);
		gl.attachShader(p, this._compile(fsSrc, gl.FRAGMENT_SHADER)!);
		gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
			console.error('LiquidGlass program link error:', gl.getProgramInfoLog(p));
		}
		return p;
	}

	private _uloc(prog: WebGLProgram, names: string[]): UniformMap {
		const gl = this.gl;
		const u: UniformMap = {};
		for (const n of names) {
			u[n] = gl.getUniformLocation(prog, n);
		}
		return u;
	}

	private _drawQuad(prog: WebGLProgram, buf: WebGLBuffer): void {
		const gl = this.gl;
		const loc = gl.getAttribLocation(prog, 'a_pos');
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}
}
