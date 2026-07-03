/**
 * LiquidGlass — main orchestrator for the liquid glass effect library.
 *
 * Coordinates between:
 *   - HtmlCapture  (captures individual DOM elements into reusable canvases)
 *   - GlassRenderer (WebGL pipeline for the glass effect)
 *
 * Handles child ordering, layered compositing, floating (drag)
 * behaviour, resize, and the render loop.
 *
 * Usage:
 *   import { LiquidGlass } from 'liquidglass-ui';
 *   LiquidGlass.init({ root, glassElements });
 */

import { DEFAULTS, SHADOW_PAD } from './defaults';
import type { GlassConfig } from './defaults';
import { HtmlCapture } from './HtmlCapture';
import { GlassRenderer } from './GlassRenderer';

/** Options accepted by {@link LiquidGlass.init}. */
export interface LiquidGlassOptions {
	/** Root container element. */
	root: HTMLElement;
	/** Elements to apply the glass effect to. */
	glassElements?: NodeListOf<HTMLElement> | HTMLElement[];
	/** Override the default configuration values. */
	defaults?: Partial<GlassConfig>;
}

class FrameLayoutCache {
	private readonly docRects = new Map<HTMLElement, { docX: number; docY: number; w: number; h: number; fixed: boolean }>();
	private readonly widths = new Map<HTMLElement, number>();
	private readonly heights = new Map<HTMLElement, number>();

	getRect(el: HTMLElement): DOMRect {
		let cached = this.docRects.get(el);
		if (!cached) {
			const r = el.getBoundingClientRect();
			const fixed = window.getComputedStyle(el).position === 'fixed';
			const scrollX = fixed ? 0 : (window.scrollX || window.pageXOffset);
			const scrollY = fixed ? 0 : (window.scrollY || window.pageYOffset);
			cached = {
				docX: r.left + scrollX,
				docY: r.top + scrollY,
				w: r.width,
				h: r.height,
				fixed,
			};
			this.docRects.set(el, cached);
		}

		const scrollX = cached.fixed ? 0 : (window.scrollX || window.pageXOffset);
		const scrollY = cached.fixed ? 0 : (window.scrollY || window.pageYOffset);
		const left = cached.docX - scrollX;
		const top = cached.docY - scrollY;

		return {
			left,
			top,
			width: cached.w,
			height: cached.h,
			right: left + cached.w,
			bottom: top + cached.h,
			x: left,
			y: top,
			toJSON() { return this; }
		} as DOMRect;
	}

	getWidth(el: HTMLElement): number {
		let w = this.widths.get(el);
		if (w === undefined) {
			w = el.offsetWidth;
			this.widths.set(el, w);
		}
		return w;
	}

	getHeight(el: HTMLElement): number {
		let h = this.heights.get(el);
		if (h === undefined) {
			h = el.offsetHeight;
			this.heights.set(el, h);
		}
		return h;
	}

	clear(): void {
		this.docRects.clear();
		this.widths.clear();
		this.heights.clear();
	}

	invalidate(el: HTMLElement): void {
		this.docRects.delete(el);
		this.widths.delete(el);
		this.heights.delete(el);
	}
}

interface DragState {
	active: boolean;
	element: HTMLElement | null;
	startX: number;
	startY: number;
	origTx: number;
	origTy: number;
	baseLeft: number;
	baseTop: number;
	rootW: number;
	rootH: number;
	elW: number;
	elH: number;
	lastRect: DOMRect | null;
}

interface GlassCacheEntry {
	centerX: number;
	centerY: number;
}

interface ConfigCachedElement extends HTMLElement {
	configCache?: Partial<GlassConfig>;
	configCacheKey?: string;
}

interface SizeEntry {
	w: number;
	h: number;
}

interface ObjectFitRect {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
}

interface SampleRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

const BUTTON_CLASS = 'liquid-glass-button';
const STYLE_ID = 'liquid-glass-button-styles';
const BUTTON_CSS = `
.${BUTTON_CLASS} {
	cursor: pointer;
}
`;

interface ButtonState {
	hover: boolean;
	pressed: boolean;
}

export class LiquidGlass {
	// ────────────────────────────────────────────
	// Static entry point
	// ────────────────────────────────────────────

	static async init(options: LiquidGlassOptions): Promise<LiquidGlass> {
		const instance = new LiquidGlass(options);
		await instance._start();
		return instance;
	}

	// ────────────────────────────────────────────
	// Instance fields
	// ────────────────────────────────────────────

	readonly root: HTMLElement;
	readonly defaults: GlassConfig;
	readonly glassSet: Set<HTMLElement>;
	readonly glassCanvases: Map<HTMLElement, HTMLCanvasElement>;
	readonly capture: HtmlCapture;
	readonly renderer: GlassRenderer;

	/** Current frames-per-second (updated every frame). */
	fps = 0;

	private _running = false;
	private _rafId = 0;
	private _hasDynamic = false;
	private _capturingRoot = false;
	/**
	 * Genuinely-global dirty flag — set by events that legitimately
	 * affect every glass at once (resize, WebGL context restored,
	 * structural mutation of root, end of _start). On the next frame
	 * the entry guard promotes it into per-element dirty marks for
	 * every glass in glassSet, then clears itself.
	 */
	private _globalDirty = true;
	/**
	 * Per-element shader-render dirty set. Each entry is a glass
	 * element that needs its WebGL pipeline to re-run on the next
	 * frame. Drained at the end of _renderFrame.
	 *
	 * Mirrors _glassContentDirty (which tracks html-to-image content
	 * captures) but for the WebGL shader pass instead of the DOM
	 * raster pass — they have different triggers.
	 */
	private readonly _glassDirty = new Set<HTMLElement>();
	private readonly _stickyGlass = new Set<HTMLElement>();
	/**
	 * Elements (typically wrappers, glasses themselves, or descendants
	 * of root) explicitly marked changed via the public markChanged()
	 * API. The next frame fans each one out into _glassDirty by
	 * intersecting against every glass's sample rect, then clears
	 * the set.
	 */
	private readonly _userMarkedChanged = new Set<HTMLElement>();
	private _capturingGlassContent = false;
	/**
	 * Glass elements whose content image is stale and needs to be
	 * re-captured. Per-element rather than a single global flag so a
	 * mutation inside one glass subtree only re-captures that one
	 * element instead of every glass on the page.
	 */
	private readonly _glassContentDirty = new Set<HTMLElement>();
	private _fpsFrames = 0;
	private _fpsTime = 0;

	private _observer: MutationObserver | null = null;
	private _glassSubtreeObserver: MutationObserver | null = null;
	private _resizeObserver: ResizeObserver | null = null;
	private _activeMediaQuery: MediaQueryList | null = null;
	private _activeMediaListener: (() => void) | null = null;
	private _lastDPR = 1;
	private _lastScrollX = 0;
	private _lastScrollY = 0;
	private _resizeDebounceTimeout: any = null;
	private readonly _resizingTimeouts = new Map<HTMLElement, any>();
	private readonly _mediaDescendantsCache = new Map<HTMLElement, { elements: HTMLElement[], lastTime: number }>();
	private readonly _paintPadCache = new Map<HTMLElement, number>();
	private readonly _mediaLayoutCache = new Map<HTMLElement, { fit: string, pos: string }>();
	private _resolvedBodyBg: string | null = null;
	private readonly _dynamicContentCache = new Map<HTMLElement, boolean>();
	private readonly _rootSceneCanvas: HTMLCanvasElement;
	private readonly _rootSceneCtx: CanvasRenderingContext2D;
	private _rootSceneValid = false;

	private _sortedChildren: HTMLElement[] = [];
	private readonly _glassCache = new Map<HTMLElement, GlassCacheEntry>();
	private readonly _glassContentImages = new Map<HTMLElement, HTMLCanvasElement>();
	private readonly _glassLastSize = new Map<HTMLElement, SizeEntry>();
	private readonly _glassOffsets = new Map<HTMLElement, { padLeft: number; padTop: number; borderLeft: number; borderTop: number }>();
	private readonly _buttonStates = new Map<HTMLElement, ButtonState>();
	private readonly _buttonListeners = new Map<HTMLElement, Array<() => void>>();
	private readonly _glassSceneCanvases = new Map<HTMLElement, HTMLCanvasElement>();
	private readonly _glassSceneCtxs = new Map<HTMLElement, CanvasRenderingContext2D>();
	private readonly _glassCanvasCtxs = new Map<HTMLElement, CanvasRenderingContext2D>();
	private readonly _layoutCache = new FrameLayoutCache();

	private readonly _drag: DragState = {
		active: false,
		element: null,
		startX: 0,
		startY: 0,
		origTx: 0,
		origTy: 0,
		baseLeft: 0,
		baseTop: 0,
		rootW: 0,
		rootH: 0,
		elW: 0,
		elH: 0,
		lastRect: null,
	};

	private readonly _onResize: () => void;
	private readonly _onPointerDown: (e: PointerEvent) => void;
	private readonly _onPointerMove: (e: PointerEvent) => void;
	private readonly _onPointerUp: (e: PointerEvent) => void;

	// ────────────────────────────────────────────
	// Constructor (prefer LiquidGlass.init)
	// ────────────────────────────────────────────

	constructor({ root, glassElements, defaults = {} }: LiquidGlassOptions) {
		if (!root) throw new Error('LiquidGlass: `root` element is required.');

		this.root = root;
		this.defaults = { ...DEFAULTS, ...defaults };
		this.glassSet = new Set(Array.from(glassElements || []));
		this.glassCanvases = new Map();
		this.capture = new HtmlCapture(root);
		// When an async html-to-image re-capture finishes, mark only
		// the glasses whose sample rect intersects that element's
		// bounds — they're the only ones whose composed scene
		// actually changed. Other glasses on the page can keep
		// their existing shader output unchanged.
		this.capture.onCacheUpdate = (element) => {
			this._rootSceneValid = false;
			this._markGlassesIntersecting(element);
		};
		this.renderer = new GlassRenderer();
		this._rootSceneCanvas = document.createElement('canvas');
		this._rootSceneCtx = this._rootSceneCanvas.getContext('2d')!;

		// When the WebGL context is restored, invalidate all caches so
		// the render loop rebuilds everything on the next frame. This
		// is genuinely global — every shader output canvas was lost.
		this.renderer.canvas.addEventListener('webglcontextrestored', () => {
			this._glassCache.clear();
			this._globalDirty = true;
		});

		this._onResize = this._handleResize.bind(this);
		this._onPointerDown = this._handlePointerDown.bind(this);
		this._onPointerMove = this._handlePointerMove.bind(this);
		this._onPointerUp = this._handlePointerUp.bind(this);
	}

	// ────────────────────────────────────────────
	// Lifecycle
	// ────────────────────────────────────────────

	private async _start(): Promise<void> {
		this.root.style.userSelect = 'none';
		(this.root.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
		this._setupGlassElements();
		this._hasDynamic = this._detectDynamic();
		this._sortedChildren = this._getSortedChildren();
		this._handleResize();
		this.capture.clear();
		this._rootSceneValid = false;
		this._globalDirty = true;
		this._lastDPR = window.devicePixelRatio || 1;
		this._lastScrollX = window.scrollX || window.pageXOffset;
		this._lastScrollY = window.scrollY || window.pageYOffset;

		// Listen to device pixel ratio (browser zoom) changes dynamically
		this._listenToDPRChanges();

		// Resolve the page's @font-face rules in the background
		this.capture.prefetchFontEmbedCSS().then(() => {
			for (const el of this.glassSet) {
				this._glassContentDirty.add(el);
			}
			this._globalDirty = true;
		}).catch(() => {});

		// Start capturing glass content and static backgrounds asynchronously
		this._captureGlassContent().catch(() => {});
		this._prewarmStaticCaptures().catch(() => {});

		window.addEventListener('resize', this._onResize);
		this.root.addEventListener('pointerdown', this._onPointerDown);
		window.addEventListener('pointermove', this._onPointerMove);
		window.addEventListener('pointerup', this._onPointerUp);

		this._observer = new MutationObserver(() => {
			// Structural mutation: painting order may have shifted,
			// every glass needs to re-render.
			this._resolvedBodyBg = null;
			this._rootSceneValid = false;
			this._sortedChildren = this._getSortedChildren();
			this._globalDirty = true;
		});
		this._observer.observe(this.root, { childList: true });

		let _subtreeMutationTimeout: any = null;
		this._glassSubtreeObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				const target = mutation.target as HTMLElement;
				if (target.tagName === 'CANVAS' || target.closest('canvas')) {
					continue;
				}
				const owner = this._closestGlassAncestor(mutation.target);
				if (mutation.type === 'attributes' && mutation.attributeName === 'data-config') {
					if (owner) {
						this._handleConfigChange(owner);
						this._layoutCache.invalidate(owner);
						this._userMarkedChanged.add(owner);
						this._globalDirty = true;
					}
					continue;
				}
				if (owner) {
					this._layoutCache.invalidate(owner);
					this._glassContentDirty.add(owner);
					this._userMarkedChanged.add(owner);
				}
			}
			// Debounce the global dirty flag so rapid mutations during
			// CSS transitions (accordion open/close) are batched into
			// a single re-render instead of firing per-mutation.
			if (!_subtreeMutationTimeout) {
				_subtreeMutationTimeout = setTimeout(() => {
					_subtreeMutationTimeout = null;
					this._globalDirty = true;
				}, 16); // ~1 frame
			}
		});

		let resizeTimeout: any = null;
		this._resizeObserver = new ResizeObserver((entries) => {
			for (const entry of entries) {
				const el = entry.target as HTMLElement;
				this._layoutCache.invalidate(el);
				this._markGlassesIntersecting(el, this._layoutCache);
				if (this.glassSet.has(el)) {
					const w = entry.borderBoxSize?.[0] 
						? entry.borderBoxSize[0].inlineSize 
						: entry.contentRect.width;
					const h = entry.borderBoxSize?.[0] 
						? entry.borderBoxSize[0].blockSize 
						: entry.contentRect.height;
					this._handleGlassResize(el, w, h);
					this._glassDirty.add(el);
				}
			}

			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => {
				this._handleResize();
			}, 150);
		});
		this._resizeObserver.observe(this.root);
		for (const child of this.root.children) {
			if (child instanceof HTMLElement) {
				this._resizeObserver.observe(child);
			}
		}
		for (const el of this.glassSet) {
			this._resizeObserver.observe(el);
		}
		for (const el of this.glassSet) {
			this._glassSubtreeObserver.observe(el, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
				attributeFilter: ['data-config'],
			});
		}
		this._glassContentDirty.clear();

		this._running = true;
		this._globalDirty = true;
		this._rafId = requestAnimationFrame(() => this._renderLoop());
	}

	registerElement(el: HTMLElement): void {
		if (this.glassSet.has(el)) return;
		if (!this.root.contains(el)) {
			console.warn('LiquidGlass: glass element must be a descendant of root, skipping.', el);
			return;
		}

		const currentPosition = window.getComputedStyle(el).position;
		if (currentPosition === 'static') {
			el.style.position = 'relative';
		}
		el.style.overflow = 'visible';

		const config = this._getConfig(el);
		el.style.borderRadius = `${config.cornerRadius}px`;
		if (config.floating) {
			el.style.touchAction = 'none';
		}
		if (config.button) {
			el.classList.add(BUTTON_CLASS);
			if (!document.getElementById(STYLE_ID)) {
				const style = document.createElement('style');
				style.id = STYLE_ID;
				style.textContent = BUTTON_CSS;
				document.head.appendChild(style);
			}
			this._setupButtonListeners(el);
		}

		const canvas = document.createElement('canvas');
		canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
		el.appendChild(canvas);
		this._ensureDomContentAboveCanvas(el, canvas);

		this.glassCanvases.set(el, canvas);
		this.glassSet.add(el);
		this._resizeObserver?.observe(el);

		if (this._glassSubtreeObserver) {
			this._glassSubtreeObserver.observe(el, {
				childList: true,
				subtree: true,
				characterData: true,
				attributes: true,
				attributeFilter: ['data-config'],
			});
		}

		this._updateGlassCanvasBufferSize(el);
		this._glassContentDirty.add(el);
		this._sortedChildren = this._getSortedChildren();
		this._rootSceneValid = false;
		this._globalDirty = true;
	}

	unregisterElement(el: HTMLElement): void {
		if (!this.glassSet.has(el)) return;

		this.glassSet.delete(el);
		this._resizeObserver?.unobserve(el);
		const canvas = this.glassCanvases.get(el);
		if (canvas) {
			canvas.remove();
			this.glassCanvases.delete(el);
		}

		el.style.removeProperty('position');
		el.style.removeProperty('overflow');
		el.style.removeProperty('touch-action');
		el.classList.remove(BUTTON_CLASS);

		this._glassCache.delete(el);
		this._glassContentImages.delete(el);
		this._glassLastSize.delete(el);
		this._glassOffsets.delete(el);
		this._glassCanvasCtxs.delete(el);
		this._glassSceneCanvases.delete(el);
		this._glassSceneCtxs.delete(el);
		this._glassContentDirty.delete(el);
		this._glassDirty.delete(el);

		const removers = this._buttonListeners.get(el);
		if (removers) {
			for (const r of removers) r();
			this._buttonListeners.delete(el);
		}
		this._buttonStates.delete(el);

		this._sortedChildren = this._getSortedChildren();
		this._rootSceneValid = false;
		this._globalDirty = true;
	}

	destroy(): void {
		this._running = false;
		cancelAnimationFrame(this._rafId);
		clearTimeout(this._resizeDebounceTimeout);
		for (const t of this._resizingTimeouts.values()) {
			clearTimeout(t);
		}
		this._resizingTimeouts.clear();
		this._mediaDescendantsCache.clear();
		this._paintPadCache.clear();
		this._mediaLayoutCache.clear();
		this._dynamicContentCache.clear();
		this._resolvedBodyBg = null;
		this._glassSceneCanvases.clear();
		this._glassSceneCtxs.clear();
		this._glassCanvasCtxs.clear();
		this._layoutCache.clear();

		this.root.style.removeProperty('user-select');
		this.root.style.removeProperty('-webkit-user-select');

		window.removeEventListener('resize', this._onResize);
		if (this._activeMediaQuery && this._activeMediaListener) {
			this._activeMediaQuery.removeEventListener('change', this._activeMediaListener);
			this._activeMediaQuery = null;
			this._activeMediaListener = null;
		}
		this.root.removeEventListener('pointerdown', this._onPointerDown);
		window.removeEventListener('pointermove', this._onPointerMove);
		window.removeEventListener('pointerup', this._onPointerUp);

		this._observer?.disconnect();
		this._observer = null;
		this._glassSubtreeObserver?.disconnect();
		this._glassSubtreeObserver = null;
		this._resizeObserver?.disconnect();
		this._resizeObserver = null;

		for (const [el, canvas] of this.glassCanvases) {
			canvas.remove();
			el.style.removeProperty('position');
			el.style.removeProperty('overflow');
			el.style.removeProperty('touch-action');
			el.classList.remove(BUTTON_CLASS);
		}
		this.glassCanvases.clear();
		this._glassCache.clear();
		this._glassContentImages.clear();
		this._glassLastSize.clear();
		this._glassOffsets.clear();

		for (const removers of this._buttonListeners.values()) {
			for (const r of removers) r();
		}
		this._buttonListeners.clear();
		this._buttonStates.clear();

		document.getElementById(STYLE_ID)?.remove();

		this.capture.destroy();
		this.renderer.destroy();
	}

	// ────────────────────────────────────────────
	// Glass element setup
	// ────────────────────────────────────────────

	private _setupGlassElements(): void {
		let needsButtonStyles = false;

		for (const el of this.glassSet) {
			// Glass elements must be descendants of the root.
			if (!this.root.contains(el)) {
				console.warn('LiquidGlass: glass element must be a descendant of root, skipping.', el);
				this.glassSet.delete(el);
				continue;
			}

			const currentPosition = window.getComputedStyle(el).position;
			if (currentPosition === 'static') {
				el.style.position = 'relative';
			}
			el.style.overflow = 'visible';

			const config = this._getConfig(el);
			el.style.borderRadius = `${config.cornerRadius}px`;

			// Prevent browser from hijacking pointer events for
			// scroll/pan on floating (draggable) glass elements.
			if (config.floating) {
				el.style.touchAction = 'none';
			}

			// Button mode — cursor + hover/press shader-state listeners
			if (config.button) {
				el.classList.add(BUTTON_CLASS);
				needsButtonStyles = true;
				this._setupButtonListeners(el);
			}

			const canvas = document.createElement('canvas');
			canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;';
			el.appendChild(canvas);
			this._ensureDomContentAboveCanvas(el, canvas);

			this.glassCanvases.set(el, canvas);

			const isSticky = this._isFixedOrSticky(el);
			if (isSticky) {
				this._stickyGlass.add(el);
			}
		}

		// Inject button styles once if any glass element uses button mode
		if (needsButtonStyles && !document.getElementById(STYLE_ID)) {
			const style = document.createElement('style');
			style.id = STYLE_ID;
			style.textContent = BUTTON_CSS;
			document.head.appendChild(style);
		}

	}

	private _isFixedOrSticky(el: HTMLElement): boolean {
		let curr: HTMLElement | null = el;
		while (curr && curr !== this.root) {
			const pos = window.getComputedStyle(curr).position;
			if (pos === 'fixed' || pos === 'sticky') {
				return true;
			}
			curr = curr.parentElement;
		}
		return false;
	}

	/**
	 * Walk up from a mutation target until we hit a glass element
	 * registered on this instance. Returns null if the node isn't
	 * inside any glass subtree (shouldn't normally happen since the
	 * observers are scoped to glass elements, but the mutation target
	 * may be a Text node or detached during a removal).
	 */
	private _closestGlassAncestor(node: Node): HTMLElement | null {
		let cur: Node | null = node;
		while (cur) {
			if (cur.nodeType === 1 && this.glassSet.has(cur as HTMLElement)) {
				return cur as HTMLElement;
			}
			cur = cur.parentNode;
		}
		return null;
	}

	/**
	 * Mark a glass element (and any glass that visually depends on it
	 * via z-order overlap) as needing a shader re-render on the next
	 * frame.
	 *
	 * `rectOverride` lets callers pass a rect that differs from the
	 * element's current bounding box — useful for drag, where we
	 * want to invalidate both the *old* and *new* footprints in the
	 * same call so glasses behind the dragged panel can clear its
	 * trail and glasses ahead can pick up its new shadow.
	 */


	/**
	 * Mark every glass element whose sample rect intersects the given
	 * element's bounding rect, regardless of stacking order. Used by
	 * the async cache-update callback (a wrapper's pixels just got
	 * fresh, so any glass that samples them needs to re-render) and
	 * by the public markChanged() API for elements outside the glass
	 * set.
	 */
	private _markGlassesIntersecting(element: HTMLElement, cache?: FrameLayoutCache): void {
		const localCache = cache || new FrameLayoutCache();
		const rootRect = localCache.getRect(this.root);
		const dpr = window.devicePixelRatio || 1;
		const elementBox = this._getPixelRect(
			localCache.getRect(element), rootRect, dpr,
			this.glassSet.has(element) ? SHADOW_PAD : 0,
		);
		for (const glass of this.glassSet) {
			const sampleRect = this._getPixelRect(
				localCache.getRect(glass), rootRect, dpr, SHADOW_PAD,
			);
			if (LiquidGlass._rectsIntersect(elementBox, sampleRect)) {
				this._glassDirty.add(glass);
			}
		}
	}

	/**
	 * Public API: mark an element (or all glass elements when called
	 * with no arguments) as needing a shader re-render on the next
	 * frame. Useful for content the library can't observe on its own —
	 * a `<canvas>` whose pixels you just updated, an `<img>` you just
	 * swapped via JS, a wrapper whose CSS background-image you just
	 * changed, etc.
	 *
	 * For elements registered via `data-dynamic`, the library already
	 * treats them as always-dirty and re-renders affected glasses
	 * every frame; calling markChanged() on them is a no-op but is
	 * harmless.
	 *
	 * @param element The element that changed visually. Pass nothing
	 * (or `undefined`) to mark every glass on this instance dirty.
	 */
	markChanged(element?: HTMLElement): void {
		if (!element) {
			this.capture.clear();
			this._resolvedBodyBg = null;
			this._dynamicContentCache.clear();
			this._layoutCache.clear();
			this._rootSceneValid = false;
			this._globalDirty = true;
			return;
		}
		this._dynamicContentCache.delete(element);
		this._layoutCache.invalidate(element);
		this._rootSceneValid = false;
		this._userMarkedChanged.add(element);
		if (this.glassSet.has(element)) {
			const config = this._getConfig(element);
			element.style.borderRadius = `${config.cornerRadius}px`;
		}
	}

	private _setupButtonListeners(el: HTMLElement): void {
		const state: ButtonState = { hover: false, pressed: false };
		this._buttonStates.set(el, state);
 
		const mark = () => {
			this._userMarkedChanged.add(el);
			this._globalDirty = true;
		};
		const onOver = () => { state.hover = true; mark(); };
		const onOut = () => { state.hover = false; state.pressed = false; mark(); };
		const onDown = () => { state.pressed = true; mark(); };
		const onUp = () => { state.pressed = false; mark(); };
 
		el.addEventListener('pointerover', onOver);
		el.addEventListener('pointerout', onOut);
		el.addEventListener('pointerdown', onDown);
		el.addEventListener('pointerup', onUp);
		el.addEventListener('pointercancel', onUp);
 
		this._buttonListeners.set(el, [
			() => el.removeEventListener('pointerover', onOver),
			() => el.removeEventListener('pointerout', onOut),
			() => el.removeEventListener('pointerdown', onDown),
			() => el.removeEventListener('pointerup', onUp),
			() => el.removeEventListener('pointercancel', onUp),
		]);
	}

	// ────────────────────────────────────────────
	// Glass content pre-capture
	// ────────────────────────────────────────────

	/**
	 * Re-capture the DOM content (text, icons, etc.) of glass elements
	 * whose subtrees have been mutated since the last capture, hiding
	 * the injected shader canvas so it isn't included.
	 *
	 * Pass `targets = null` to capture every glass element (used at
	 * init and on resize); pass a Set to capture only specific ones.
	 *
	 * Guarded against concurrent execution: if a capture is already
	 * running, the affected elements stay in `_glassContentDirty` and
	 * the next render-loop tick picks them up.
	 */
	private async _captureGlassContent(
		targets: Set<HTMLElement> | null = null,
	): Promise<void> {
		if (this._capturingGlassContent) return;
		this._capturingGlassContent = true;
		try {
			for (const [el, glassCanvas] of this.glassCanvases) {
				if (targets && !targets.has(el)) continue;
				const rect = el.getBoundingClientRect();
				const img = await this.capture.captureToCanvas(
					el,
					rect.width,
					rect.height,
					[glassCanvas],
				);
				if (img) {
					this._glassContentImages.set(el, img);
				}
			}
		} finally {
			this._capturingGlassContent = false;
		}
	}

	private async _prewarmStaticCaptures(): Promise<void> {
		for (const child of this._sortedChildren) {
			if (this.glassSet.has(child)) continue;
			const tag = child.tagName;
			if (tag === 'CANVAS' || tag === 'IMG' || tag === 'VIDEO') continue;
			if (child.hasAttribute('data-dynamic')) continue;
			try {
				await this.capture.captureElement(child, false);
			} catch (err) {
				console.warn('LiquidGlass: prewarm capture failed:', child, err);
			}
		}
	}

	// ────────────────────────────────────────────
	// Child ordering & stacking context
	// ────────────────────────────────────────────

	private _getSortedChildren(): HTMLElement[] {
		this._dynamicContentCache.clear();
		// Gather direct children of the root and all registered glass elements
		const directChildren = Array.from(this.root.children) as HTMLElement[];
		const glassElements = Array.from(this.glassSet);
		const allElements = Array.from(new Set([...directChildren, ...glassElements]));

		// Sort elements by DOM position and sibling z-index
		allElements.sort((a, b) => {
			if (a === b) return 0;

			// If they share the same parent, sort by z-index
			if (a.parentElement === b.parentElement) {
				const styleA = window.getComputedStyle(a);
				const styleB = window.getComputedStyle(b);
				const zA = parseInt(styleA.zIndex, 10) || 0;
				const zB = parseInt(styleB.zIndex, 10) || 0;
				if (zA !== zB) return zA - zB;
			}

			const position = a.compareDocumentPosition(b);
			if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
				return -1;
			}
			if (position & Node.DOCUMENT_POSITION_PRECEDING) {
				return 1;
			}
			return 0;
		});

		return allElements;
	}

	/**
	 * Returns true when the element forms a CSS stacking context — i.e.
	 * when its z-index participates in painting order. Mirrors the spec:
	 * https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Stacking_context
	 *
	 * Used by `_getSortedChildren` to decide painting order for the
	 * local scene assembly. The set of triggers needs to match the
	 * browser's actual stacking model — otherwise overlays end up
	 * painted before the background image and get erased.
	 */
	private static _formsStackingContext(
		style: CSSStyleDeclaration,
		isFlexOrGridParent: boolean,
	): boolean {
		if (style.position !== 'static') return true;
		if (isFlexOrGridParent && style.zIndex !== 'auto') return true;
		if (parseFloat(style.opacity) < 1) return true;
		if (style.transform !== 'none' && style.transform !== '') return true;
		if (style.filter !== 'none' && style.filter !== '') return true;
		if (style.perspective !== 'none' && style.perspective !== '') return true;
		if (style.clipPath !== 'none' && style.clipPath !== '') return true;
		if (style.mixBlendMode !== 'normal' && style.mixBlendMode !== '') return true;
		if (style.isolation === 'isolate') return true;

		const bf = style.backdropFilter
			|| (style as unknown as { webkitBackdropFilter?: string }).webkitBackdropFilter;
		if (bf && bf !== 'none') return true;

		const mask = style.maskImage
			|| (style as unknown as { webkitMaskImage?: string }).webkitMaskImage;
		if (mask && mask !== 'none') return true;

		const contain = style.contain;
		if (contain && /\b(layout|paint|strict|content)\b/.test(contain)) return true;

		if (style.willChange) {
			const triggers = new Set([
				'transform', 'opacity', 'filter', 'backdrop-filter',
				'perspective', 'clip-path', 'mask', 'mask-image',
				'isolation', 'mix-blend-mode',
			]);
			const tokens = style.willChange.split(',').map(t => t.trim());
			for (const t of tokens) {
				if (triggers.has(t)) return true;
			}
		}

		return false;
	}

	private _detectDynamic(): boolean {
		// Check the entire subtree for data-dynamic elements
		// (video with data-dynamic, etc.).
		const dynEls = this.root.querySelectorAll('[data-dynamic]');
		for (const el of dynEls) {
			if (!this.glassSet.has(el as HTMLElement)) {
				return true;
			}
		}
		// Also: any video element is implicitly dynamic (live frames).
		const videos = this.root.querySelectorAll('video');
		for (const vid of videos) {
			if (!this.glassSet.has(vid as unknown as HTMLElement)) {
				return true;
			}
		}
		return false;
	}

	private _handleConfigChange(el: HTMLElement): void {
		const cachedEl = el as ConfigCachedElement;
		const oldConfig = { ...this.defaults, ...(cachedEl.configCache || {}) };

		// Clear cache key to force a fresh parse in _getConfig
		cachedEl.configCacheKey = undefined;
		const newConfig = this._getConfig(el);

		// Handle floating transition
		if (newConfig.floating !== oldConfig.floating) {
			if (newConfig.floating) {
				el.style.touchAction = 'none';
			} else {
				el.style.removeProperty('touch-action');
			}
		}

		// Handle button transition
		if (newConfig.button !== oldConfig.button) {
			if (newConfig.button) {
				if (!this._buttonListeners.has(el)) {
					el.classList.add(BUTTON_CLASS);
					if (!document.getElementById(STYLE_ID)) {
						const style = document.createElement('style');
						style.id = STYLE_ID;
						style.textContent = BUTTON_CSS;
						document.head.appendChild(style);
					}
					this._setupButtonListeners(el);
				}
			} else {
				el.classList.remove(BUTTON_CLASS);
				const removers = this._buttonListeners.get(el);
				if (removers) {
					for (const r of removers) r();
					this._buttonListeners.delete(el);
				}
				this._buttonStates.delete(el);
			}
		}
	}

	private _getConfig(el: HTMLElement): GlassConfig {
		const cachedEl = el as ConfigCachedElement;
		const configKey = el.dataset.config ?? '';

		if (cachedEl.configCacheKey !== configKey) {
			let perElement: Partial<GlassConfig> = {};
			if (configKey) {
				try {
					const parsed = JSON.parse(configKey);
					if (parsed && typeof parsed === 'object') {
						perElement = parsed as Partial<GlassConfig>;
					} else {
						console.warn('LiquidGlass: data-config must decode to an object for element:', el);
					}
				} catch (_e) {
					console.warn('LiquidGlass: invalid JSON in data-config for element:', el);
				}
			}
			cachedEl.configCache = perElement;
			cachedEl.configCacheKey = configKey;
		}

		const config = { ...this.defaults, ...(cachedEl.configCache || {}) };

		if (config.button) {
			const state = this._buttonStates.get(el);
			if (state) {
				if (state.pressed) {
					config.zRadius = config.zRadius * 0.8;
					config.shadowSpread = config.shadowSpread * 1.2;
					// brightness reset to original (no hover boost)
				} else if (state.hover) {
					config.brightness = config.brightness + 0.2;
				}
			}
		}

		return config;
	}

	// ────────────────────────────────────────────
	// Resize
	// ────────────────────────────────────────────

	private _handleResize(): void {
		this._resolvedBodyBg = null;
		this._dynamicContentCache.clear();
		this._layoutCache.clear();
		this._rootSceneValid = false;
		const dpr = window.devicePixelRatio || 1;
		const rect = this.root.getBoundingClientRect();

		// Resize the WebGL scene viewport immediately
		this.renderer.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr));

		for (const el of this.glassSet) {
			this._updateGlassCanvasBufferSize(el);
		}

		this._glassCache.clear();
		this._globalDirty = true;

		// Debounce full capture cache invalidation and recapture
		// so zooming (which fires continuous resize/DPR changes)
		// doesn't freeze the thread with synchronous html-to-image calls.
		clearTimeout(this._resizeDebounceTimeout);
		this._resizeDebounceTimeout = setTimeout(() => {
			if (dpr !== this.capture.dpr) {
				this.capture.resize(dpr);
			}
			for (const el of this.glassSet) {
				this._glassContentDirty.add(el);
			}
			this._globalDirty = true;
		}, 300);
	}

	private _updateGlassCanvasCSSSize(el: HTMLElement, w?: number, h?: number): void {
		const canvas = this.glassCanvases.get(el);
		if (!canvas) return;
		const elW = w !== undefined ? w : el.offsetWidth;
		const elH = h !== undefined ? h : el.offsetHeight;
		const padW = SHADOW_PAD * 2;
		const padH = SHADOW_PAD * 2;

		let offsets = this._glassOffsets.get(el);
		if (!offsets) {
			const style = window.getComputedStyle(el);
			offsets = {
				padLeft: parseFloat(style.paddingLeft) || 0,
				padTop: parseFloat(style.paddingTop) || 0,
				borderLeft: parseFloat(style.borderLeftWidth) || 0,
				borderTop: parseFloat(style.borderTopWidth) || 0,
			};
			this._glassOffsets.set(el, offsets);
		}

		canvas.style.left = `${-SHADOW_PAD - offsets.borderLeft}px`;
		canvas.style.top = `${-SHADOW_PAD - offsets.borderTop}px`;
		canvas.style.width = `${elW + padW}px`;
		canvas.style.height = `${elH + padH}px`;
	}

	private _updateGlassCanvasBufferSize(el: HTMLElement, w?: number, h?: number): void {
		const canvas = this.glassCanvases.get(el);
		if (!canvas) return;

		const dpr = window.devicePixelRatio || 1;
		const elW = w !== undefined ? Math.round(w) : Math.round(el.offsetWidth);
		const elH = h !== undefined ? Math.round(h) : Math.round(el.offsetHeight);
		const padW = SHADOW_PAD * 2;
		const padH = SHADOW_PAD * 2;

		let offsets = this._glassOffsets.get(el);
		if (!offsets) {
			const style = window.getComputedStyle(el);
			offsets = {
				padLeft: parseFloat(style.paddingLeft) || 0,
				padTop: parseFloat(style.paddingTop) || 0,
				borderLeft: parseFloat(style.borderLeftWidth) || 0,
				borderTop: parseFloat(style.borderTopWidth) || 0,
			};
			this._glassOffsets.set(el, offsets);
		}

		canvas.width = Math.round((elW + padW) * dpr);
		canvas.height = Math.round((elH + padH) * dpr);
		canvas.style.cssText = [
			'position:absolute',
			`left:${-SHADOW_PAD - offsets.borderLeft}px`,
			`top:${-SHADOW_PAD - offsets.borderTop}px`,
			`width:${elW + padW}px`,
			`height:${elH + padH}px`,
			'pointer-events:none',
			'z-index:0'
		].join(';') + ';';
		this._ensureDomContentAboveCanvas(el, canvas);
		this._glassLastSize.set(el, { w: elW, h: elH });
	}

	private _handleGlassResize(el: HTMLElement, w: number, h: number): void {
		const last = this._glassLastSize.get(el);
		if (!last
			|| Math.abs(last.w - w) > 0.5
			|| Math.abs(last.h - h) > 0.5
		) {
			this._layoutCache.invalidate(el);
			// Update CSS style size immediately for smooth visual tracking
			this._updateGlassCanvasCSSSize(el, w, h);
			
			// Update the WebGL canvas buffer size immediately to match the new size,
			// preventing blurry/low-quality stretching during transition animations.
			this._updateGlassCanvasBufferSize(el, w, h);

			// Temporarily update last size so we don't spam CSS updates
			this._glassLastSize.set(el, { w, h });

			this._glassCache.delete(el);
			this._glassDirty.add(el);
			this._rootSceneValid = false;
			this._globalDirty = true;

			// Force a synchronous render of this resized glass element immediately
			// to prevent the canvas from flashing clear/transparent for one frame
			// (since setting canvas.width/height clears the buffer).
			try {
				const dpr = window.devicePixelRatio || 1;
				const rootRect = this._layoutCache.getRect(this.root);
				this._prepareRootSceneCanvas(rootRect, dpr, this._layoutCache);
				
				const dirtyTargets = new Set<HTMLElement>([el]);
				const renderedThisFrame: Array<{ rect: SampleRect }> = [];
				this._renderGlassElement(
					el,
					rootRect,
					dpr,
					this._drag.active,
					dirtyTargets,
					renderedThisFrame,
					this._layoutCache,
				);
				// Remove from dirty set so the upcoming RAF loop doesn't double-render it
				this._glassDirty.delete(el);
			} catch (err) {
				console.error('LiquidGlass: sync resize render error:', err);
			}

			// Debounce full capture cache invalidation and recapture
			// since html-to-image DOM cloning is too heavy to run at 60/120fps.
			const existing = this._resizingTimeouts.get(el);
			if (existing) clearTimeout(existing);

			const timeout = setTimeout(() => {
				this._resizingTimeouts.delete(el);
				this.capture.invalidateCache(el);
				this._glassContentDirty.add(el);
				this._glassDirty.add(el);
			}, 150); // Wait 150ms after size stops changing to recapture HTML

			this._resizingTimeouts.set(el, timeout);
		}
	}

	private _listenToDPRChanges(): void {
		if (typeof window === 'undefined') return;

		const currentDPR = window.devicePixelRatio || 1;
		const mediaQuery = window.matchMedia(`(resolution: ${currentDPR}dppx)`);
		const listener = () => {
			this._handleResize();
			this._listenToDPRChanges();
		};

		mediaQuery.addEventListener('change', listener, { once: true });
		this._activeMediaQuery = mediaQuery;
		this._activeMediaListener = listener;
	}

	// ────────────────────────────────────────────
	// Floating (drag) behaviour — Pointer Events
	// ────────────────────────────────────────────

	/** Parse the current translate(x, y) values from an element's transform. */
	private static _getTranslateXY(el: HTMLElement): [number, number] {
		const style = getComputedStyle(el);
		const matrix = style.transform;
		if (!matrix || matrix === 'none') return [0, 0];
		// matrix(a, b, c, d, tx, ty)
		const m = matrix.match(/matrix\(([^)]+)\)/);
		if (m) {
			const parts = m[1].split(',').map(Number);
			return [parts[4] || 0, parts[5] || 0];
		}
		return [0, 0];
	}

	private _handlePointerDown(e: PointerEvent): void {
		// Iterate all glass elements in reverse stacking order (topmost first).
		for (let i = this._sortedChildren.length - 1; i >= 0; i--) {
			const el = this._sortedChildren[i];
			if (!this.glassSet.has(el)) continue;

			const config = this._getConfig(el);
			if (!config.floating) continue;

			const rect = el.getBoundingClientRect();
			// Use the CSS box size (offsetWidth/Height) for hit testing,
			// but use the bounding rect position (which is correct for
			// elements positioned via CSS, grid, etc.).
			const elW = el.offsetWidth;
			const elH = el.offsetHeight;
			// The visual position includes the shadow canvas overflow.
			// Compute the element's true visual origin by centering the
			// offset size within the bounding rect.
			const visualLeft = rect.left + (rect.width - elW) / 2;
			const visualTop = rect.top + (rect.height - elH) / 2;

			if (
				e.clientX >= visualLeft && e.clientX <= visualLeft + elW &&
				e.clientY >= visualTop && e.clientY <= visualTop + elH
			) {
				const [tx, ty] = LiquidGlass._getTranslateXY(el);
				this._drag.active = true;
				this._drag.element = el;
				this._drag.startX = e.clientX;
				this._drag.startY = e.clientY;
				this._drag.origTx = tx;
				this._drag.origTy = ty;

				const rootRect = this.root.getBoundingClientRect();
				this._drag.rootW = rootRect.width;
				this._drag.rootH = rootRect.height;
				this._drag.elW = elW;
				this._drag.elH = elH;
				this._drag.baseLeft = visualLeft - rootRect.left - tx;
				this._drag.baseTop = visualTop - rootRect.top - ty;
				this._drag.lastRect = null;
				
				el.style.cursor = 'grabbing';
				el.setPointerCapture(e.pointerId);
				e.preventDefault();
				break;
			}
		}
	}

	private _handlePointerMove(e: PointerEvent): void {
		if (!this._drag.active) {
			for (const el of this.glassSet) {
				const config = this._getConfig(el);
				if (!config.floating) continue;
				const rect = el.getBoundingClientRect();
				const elW = el.offsetWidth;
				const elH = el.offsetHeight;
				const visualLeft = rect.left + (rect.width - elW) / 2;
				const visualTop = rect.top + (rect.height - elH) / 2;
				if (
					e.clientX >= visualLeft && e.clientX <= visualLeft + elW &&
					e.clientY >= visualTop && e.clientY <= visualTop + elH
				) {
					el.style.cursor = 'grab';
				} else {
					el.style.cursor = '';
				}
			}
			return;
		}

		const el = this._drag.element!;
		const dx = e.clientX - this._drag.startX;
		const dy = e.clientY - this._drag.startY;
		let newTx = this._drag.origTx + dx;
		let newTy = this._drag.origTy + dy;

		const baseLeft = this._drag.baseLeft;
		const baseTop = this._drag.baseTop;
		const rootW = this._drag.rootW;
		const rootH = this._drag.rootH;
		const elW = this._drag.elW;
		const elH = this._drag.elH;

		const margin = 10;
		const posLeft = baseLeft + newTx;
		const posTop = baseTop + newTy;
		const maxLeft = rootW - elW - margin;
		const maxTop = rootH - elH - margin;
		if (posLeft < margin) newTx += margin - posLeft;
		if (posTop < margin) newTy += margin - posTop;
		if (posLeft > maxLeft) newTx -= posLeft - maxLeft;
		if (posTop > maxTop) newTy -= posTop - maxTop;

		el.style.transform = `translate(${newTx}px, ${newTy}px)`;
		this._userMarkedChanged.add(el);
		this._globalDirty = true;
	}

	private _handlePointerUp(_e: PointerEvent): void {
		if (!this._drag.active) return;
		const dragged = this._drag.element!;
		dragged.style.cursor = '';
		this._drag.active = false;
		this._drag.element = null;
		
		this._userMarkedChanged.add(dragged);
		this._globalDirty = true;
	}

	// ────────────────────────────────────────────
	// Render loop
	// ────────────────────────────────────────────

	private _renderLoop(): void {
		if (!this._running) return;

		// Detect resolution (DPR / Zoom) changes on the fly
		const currentDPR = window.devicePixelRatio || 1;
		if (currentDPR !== this._lastDPR) {
			this._lastDPR = currentDPR;
			this._handleResize();
		}

		// Element positions relative to the root container are scroll-invariant, so
		// refracted backgrounds do not need a full re-render on scroll. Only refresh
		// sticky layout so sample rects stay accurate when sticky offsets change.
		const scrollX = window.scrollX || window.pageXOffset;
		const scrollY = window.scrollY || window.pageYOffset;
		if (scrollX !== this._lastScrollX || scrollY !== this._lastScrollY) {
			this._lastScrollX = scrollX;
			this._lastScrollY = scrollY;
			for (const el of this._stickyGlass) {
				this._layoutCache.invalidate(el);
			}
		}

		// FPS tracking
		const now = performance.now();
		this._fpsFrames++;
		if (now - this._fpsTime >= 1000) {
			this.fps = this._fpsFrames;
			this._fpsFrames = 0;
			this._fpsTime = now;
		}



		if (this._glassContentDirty.size > 0 && !this._capturingGlassContent) {
			// Snapshot the dirty set before draining: any mutations
			// that arrive while the async capture is in flight stay
			// in the live set and are picked up on the next tick.
			const targets = new Set(this._glassContentDirty);
			this._glassContentDirty.clear();
			this._captureGlassContent(targets);
		}

		try {
			this._renderFrame();
		} catch (err) {
			console.error('LiquidGlass: render error:', err);
		}

		this._rafId = requestAnimationFrame(() => this._renderLoop());
	}

	private _renderFrame(): void {
		const dpr = window.devicePixelRatio || 1;
		const cache = this._layoutCache;
		const rootRect = cache.getRect(this.root);
		const isDragging = this._drag.active;

		// Process active dragging footprint invalidation using the layout cache
		if (isDragging && this._drag.element) {
			const el = this._drag.element;
			cache.invalidate(el);
			this._markGlassesIntersecting(el, cache);
			if (this._drag.lastRect) {
				const elementBox = this._getPixelRect(
					this._drag.lastRect, rootRect, dpr, SHADOW_PAD
				);
				for (const glass of this.glassSet) {
					const sampleRect = this._getPixelRect(
						cache.getRect(glass), rootRect, dpr, SHADOW_PAD,
					);
					if (LiquidGlass._rectsIntersect(elementBox, sampleRect)) {
						this._glassDirty.add(glass);
					}
				}
			}
			this._drag.lastRect = cache.getRect(el);
		}

		// 1. Fan out user markChanged() calls into per-glass dirty marks.
		if (this._userMarkedChanged.size > 0) {
			for (const el of this._userMarkedChanged) {
				this._markGlassesIntersecting(el, cache);
			}
			this._rootSceneValid = false;
			this._userMarkedChanged.clear();
		}

		// 2. Promote any global dirty into per-element dirties so the
		//    rest of the loop only ever consults `_glassDirty`.
		if (this._globalDirty) {
			for (const el of this.glassSet) this._glassDirty.add(el);
			this._rootSceneValid = false;
			this._globalDirty = false;
		}

		const needsRender = this._glassDirty.size > 0
			|| this._hasDynamic
			|| isDragging;
		if (!needsRender) return;

		// Rebuild root scene canvas only if there is a refracting glass panel
		let needsBgScene = false;
		for (const child of this.glassSet) {
			const cfg = this._getConfig(child);
			if (cfg.refraction > 0.001) {
				needsBgScene = true;
				break;
			}
		}

		if (needsBgScene) {
			this._prepareRootSceneCanvas(rootRect, dpr, cache);
		}

		// 3. Snapshot + drain the dirty set so anything added during
		//    this frame's work (e.g. async cache landings) is picked
		//    up on the next frame instead of getting clobbered.
		const dirtyTargets = new Set(this._glassDirty);
		this._glassDirty.clear();

		// 4. Track which glass elements actually re-rendered this
		//    frame, with their sample rect, so later glasses in the
		//    z-order can detect "a prior glass that I overlap just
		//    re-rendered → I need to refresh too."
		const renderedThisFrame: Array<{ rect: SampleRect }> = [];

		for (const child of this._sortedChildren) {
			if (!this.glassSet.has(child)) continue;
			this._renderGlassElement(
				child,
				rootRect,
				dpr,
				isDragging,
				dirtyTargets,
				renderedThisFrame,
				cache,
			);
		}
	}

	/**
	 * Render a single glass element by composing just the scene region
	 * that can affect it, then running the shader over that local input.
	 *
	 * Whether the shader actually re-runs depends on:
	 *   - explicit dirty mark for this element (in `dirtyTargets`),
	 *   - any earlier glass in z-order that re-rendered this frame
	 *     and whose rect intersects this glass's sample rect,
	 *   - this glass having moved since last frame (position cache),
	 *   - this glass having dynamic contributors in its sample (video,
	 *     data-dynamic),
	 *   - or active drag involving this element.
	 *
	 * On render, an entry is pushed to `renderedThisFrame` so later
	 * glasses can check whether they need to refresh too.
	 */
	private _renderGlassElement(
		child: HTMLElement,
		rootRect: DOMRect,
		dpr: number,
		isDragging: boolean,
		dirtyTargets: Set<HTMLElement>,
		renderedThisFrame: Array<{ rect: SampleRect }>,
		cache: FrameLayoutCache,
	): void {
		const config = this._getConfig(child);
		const elRect = cache.getRect(child);
		const elW = cache.getWidth(child);
		const elH = cache.getHeight(child);
		if (elW <= 0 || elH <= 0) return;
		const centerX = (elRect.left - rootRect.left) + elRect.width / 2;
		const centerY = (elRect.top - rootRect.top) + elRect.height / 2;
		const glassCanvas = this.glassCanvases.get(child);
		const isBeingDragged = isDragging && this._drag.element === child;
		const sampleRect = this._getPixelRect(elRect, rootRect, dpr, SHADOW_PAD);

		const cached = this._glassCache.get(child);
		const posChanged = !cached
			|| Math.abs(cached.centerX - centerX) > 0.5
			|| Math.abs(cached.centerY - centerY) > 0.5;
		const hasDynamicContributors = this._hasDynamic
			&& this._glassHasDynamicContributors(child, sampleRect, rootRect, dpr, cache);

		// Did any earlier-rendered glass actually overlap this glass's
		// sample rect? Replaces the old monotonic `bgChanged` boolean
		// with a per-element intersection check.
		let priorGlassChanged = false;
		for (const r of renderedThisFrame) {
			if (LiquidGlass._rectsIntersect(r.rect, sampleRect)) {
				priorGlassChanged = true;
				break;
			}
		}

		const isExplicitlyDirty = dirtyTargets.has(child);

		const needsShaderRender = isDragging
			? (isBeingDragged || isExplicitlyDirty || priorGlassChanged || hasDynamicContributors)
			: (!cached || posChanged || isExplicitlyDirty || priorGlassChanged || hasDynamicContributors);

		const hasBg = config.refraction > 0.001;

		if (!hasBg) {
			const cssBlur = config.blurAmount * 80;
			const filterVal = `blur(${cssBlur}px) saturate(${100 + config.saturation * 100}%) brightness(${100 + config.brightness * 100}%)`;
			child.style.setProperty('backdrop-filter', filterVal);
			child.style.setProperty('-webkit-backdrop-filter', filterVal);
			child.style.backgroundColor = `rgba(255, 255, 255, ${config.tintStrength * 0.1 + 0.03})`;
		} else {
			child.style.setProperty('backdrop-filter', 'none');
			child.style.setProperty('-webkit-backdrop-filter', 'none');
			child.style.backgroundColor = 'transparent';
		}

		if (needsShaderRender && glassCanvas) {
			const renderW = glassCanvas.width;
			const renderH = glassCanvas.height;

			if (hasBg) {
				const [sceneCanvas, sceneCtx] = this._getSceneCanvasForGlass(child);
				this._composeSceneForGlass(child, sceneCanvas, sceneCtx, sampleRect, rootRect, dpr, cache, renderW, renderH);
				this.renderer.uploadAndBlur(sceneCanvas, renderW, renderH);
			}

			this.renderer.clear();
			this.renderer.renderGlassPanel(
				config,
				elW,
				elH,
				dpr,
				hasBg,
			);

			let ctx = this._glassCanvasCtxs.get(child);
			if (!ctx) {
				ctx = glassCanvas.getContext('2d')!;
				this._glassCanvasCtxs.set(child, ctx);
			}
			ctx.clearRect(0, 0, glassCanvas.width, glassCanvas.height);
			ctx.drawImage(
				this.renderer.canvas,
				0, 0, glassCanvas.width, glassCanvas.height,
				0, 0, glassCanvas.width, glassCanvas.height,
			);

			this._glassCache.set(child, { centerX, centerY });
			renderedThisFrame.push({ rect: sampleRect });
		}
	}

	/**
	 * Build the local input scene for a glass panel by walking only the
	 * contributors that paint before it in the stacking order.
	 */
	private _prepareRootSceneCanvas(
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): void {
		const width = Math.round(rootRect.width * dpr);
		const height = Math.round(rootRect.height * dpr);

		if (this._rootSceneCanvas.width !== width || this._rootSceneCanvas.height !== height) {
			this._rootSceneCanvas.width = width;
			this._rootSceneCanvas.height = height;
			this._rootSceneValid = false;
		}

		if (this._hasDynamic) {
			this._rootSceneValid = false;
		}

		if (!this._rootSceneValid) {
			this._rootSceneCtx.clearRect(0, 0, width, height);

			if (this._resolvedBodyBg === null) {
				let bodyBg = '#0b0c10';
				if (typeof window !== 'undefined') {
					const rootStyle = window.getComputedStyle(document.documentElement);
					const bgVar = rootStyle.getPropertyValue('--bg-primary').trim();
					if (bgVar && bgVar !== 'rgba(0, 0, 0, 0)' && bgVar !== 'transparent') {
						bodyBg = bgVar;
					} else {
						const computed = window.getComputedStyle(document.body).backgroundColor;
						if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') {
							bodyBg = computed;
						}
					}
				}
				this._resolvedBodyBg = bodyBg;
			}
			this._rootSceneCtx.fillStyle = this._resolvedBodyBg;
			this._rootSceneCtx.fillRect(0, 0, width, height);

			// Live media (img/video/canvas) is drawn first so glass always has real
			// pixels behind it without waiting for async html-to-image captures.
			this._drawRootMedia(this._rootSceneCtx, rootRect, dpr, cache);

			for (const child of this._sortedChildren) {
				if (this.glassSet.has(child)) continue;
				if (child.classList && (
					child.classList.contains('left-sidebar') ||
					child.classList.contains('right-sidebar') ||
					child.classList.contains('customizer-drawer') ||
					child.classList.contains('dialog-backdrop')
				)) {
					continue;
				}
				this._drawNonGlassChildToScene(child, this._rootSceneCtx, null, rootRect, dpr, cache);
			}
			this._rootSceneValid = true;
		}
	}

	private _ensureDomContentAboveCanvas(el: HTMLElement, canvas: HTMLCanvasElement): void {
		for (const child of el.children) {
			if (child === canvas || !(child instanceof HTMLElement)) continue;
			const style = window.getComputedStyle(child);
			if (style.position === 'static') {
				child.style.position = 'relative';
			}
			child.style.zIndex = '1';
		}
	}

	private _elementContainsGlass(el: HTMLElement): boolean {
		for (const glass of this.glassSet) {
			if (glass !== el && el.contains(glass)) return true;
		}
		return false;
	}

	private _isInsideGlass(el: HTMLElement): boolean {
		let cur: HTMLElement | null = el;
		while (cur) {
			if (this.glassSet.has(cur)) return true;
			cur = cur.parentElement;
		}
		return false;
	}

	private _drawRootMedia(
		targetCtx: CanvasRenderingContext2D,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): void {
		const mediaEls = this.root.querySelectorAll('img, video, canvas');
		for (const node of mediaEls) {
			if (!(node instanceof HTMLElement)) continue;
			if (this._isInsideGlass(node)) continue;
			if (node.tagName === 'CANVAS') {
				let isGlassCanvas = false;
				for (const gc of this.glassCanvases.values()) {
					if (gc === node) { isGlassCanvas = true; break; }
				}
				if (isGlassCanvas) continue;
			}
			this._drawMediaElement(node, targetCtx, null, rootRect, dpr, cache);
		}
	}

	private _getSceneCanvasForGlass(el: HTMLElement): [HTMLCanvasElement, CanvasRenderingContext2D] {
		let canvas = this._glassSceneCanvases.get(el);
		let ctx = this._glassSceneCtxs.get(el);
		if (!canvas || !ctx) {
			canvas = document.createElement('canvas');
			ctx = canvas.getContext('2d')!;
			this._glassSceneCanvases.set(el, canvas);
			this._glassSceneCtxs.set(el, ctx);
		}
		return [canvas, ctx];
	}

	private _composeSceneForGlass(
		currentGlass: HTMLElement,
		sceneCanvas: HTMLCanvasElement,
		sceneCtx: CanvasRenderingContext2D,
		sampleRect: SampleRect,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
		targetW: number,
		targetH: number,
	): void {
		this._prepareSceneCanvas(sceneCanvas, sceneCtx, targetW, targetH);

		// Crop from the pre-rendered full-screen background.
		// Handle out-of-bound crop coordinates (e.g., negative padding at screen edges)
		// by calculating the overlap region and drawing it with correct offsets,
		// preventing the browser from stretching/shifting the clipped canvas source.
		const srcW = this._rootSceneCanvas.width;
		const srcH = this._rootSceneCanvas.height;

		let sx = sampleRect.x;
		let sy = sampleRect.y;
		let sw = sampleRect.w;
		let sh = sampleRect.h;

		let dx = 0;
		let dy = 0;
		let dw = targetW;
		let dh = targetH;

		const scaleX = targetW / sampleRect.w;
		const scaleY = targetH / sampleRect.h;

		if (sx < 0) {
			dx = -sx * scaleX;
			sw += sx;
			sx = 0;
			dw -= dx;
		}
		if (sy < 0) {
			dy = -sy * scaleY;
			sh += sy;
			sy = 0;
			dh -= dy;
		}

		if (sx + sw > srcW) {
			const diff = (sx + sw) - srcW;
			sw -= diff;
			dw -= diff * scaleX;
		}
		if (sy + sh > srcH) {
			const diff = (sy + sh) - srcH;
			sh -= diff;
			dh -= diff * scaleY;
		}

		if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
			sceneCtx.drawImage(
				this._rootSceneCanvas,
				sx, sy, sw, sh,
				dx, dy, dw, dh
			);
		}

		// Draw any prior overlapping glass panels
		for (const child of this._sortedChildren) {
			if (child === currentGlass) break;
			if (this.glassSet.has(child)) {
				this._drawPriorGlassToScene(child, sceneCtx, sampleRect, rootRect, dpr, cache);
			}
		}
	}

	private _prepareSceneCanvas(
		canvas: HTMLCanvasElement,
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
	): void {
		if (canvas.width !== width || canvas.height !== height) {
			canvas.width = width;
			canvas.height = height;
		} else {
			ctx.clearRect(0, 0, width, height);
		}

		if (this._resolvedBodyBg === null) {
			let bodyBg = '#0b0c10';
			if (typeof window !== 'undefined') {
				const rootStyle = window.getComputedStyle(document.documentElement);
				const bgVar = rootStyle.getPropertyValue('--bg-primary').trim();
				if (bgVar && bgVar !== 'rgba(0, 0, 0, 0)' && bgVar !== 'transparent') {
					bodyBg = bgVar;
				} else {
					const computed = window.getComputedStyle(document.body).backgroundColor;
					if (computed && computed !== 'rgba(0, 0, 0, 0)' && computed !== 'transparent') {
						bodyBg = computed;
					}
				}
			}
			this._resolvedBodyBg = bodyBg;
		}
		ctx.fillStyle = this._resolvedBodyBg;
		ctx.fillRect(0, 0, width, height);
	}

	private _drawNonGlassChildToScene(
		child: HTMLElement,
		targetCtx: CanvasRenderingContext2D,
		sampleRect: SampleRect | null,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): void {
		const tag = child.tagName;

		if (tag === 'CANVAS' || tag === 'IMG' || tag === 'VIDEO') {
			this._drawMediaElement(child, targetCtx, sampleRect, rootRect, dpr, cache);
			return;
		}

		if (sampleRect && !this._elementTouchesSample(child, sampleRect, rootRect, dpr, cache)) {
			return;
		}

		this._captureMediaDescendants(child, targetCtx, sampleRect, rootRect, dpr, cache);

		// Wrappers that contain glass must not be captured wholesale — that
		// rasterises on-glass text into the background and it gets blurred by
		// refraction. Walk children instead and only capture glass-free subtrees.
		if (this._elementContainsGlass(child)) {
			for (const sub of child.children) {
				if (sub instanceof HTMLElement && !this.glassSet.has(sub)) {
					this._drawNonGlassChildToScene(sub, targetCtx, sampleRect, rootRect, dpr, cache);
				}
			}
			return;
		}

		const isDynamic = child.hasAttribute('data-dynamic');
		const childRect = cache.getRect(child);
		this.capture.captureElement(child, isDynamic, childRect, true);
		const rect = this._getPixelRect(childRect, rootRect, dpr);
		const dx = sampleRect ? rect.x - sampleRect.x : rect.x;
		const dy = sampleRect ? rect.y - sampleRect.y : rect.y;
		this.capture.drawCachedElement(
			child,
			targetCtx,
			dx,
			dy,
			rect.w,
			rect.h,
		);
	}

	private _glassHasDynamicContributors(
		currentGlass: HTMLElement,
		sampleRect: SampleRect,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): boolean {
		// A glass element marked data-dynamic on its own root counts
		// as always-dirty: forces every-frame shader re-runs.
		if (this._childHasDynamicContent(currentGlass)) return true;

		for (const child of this._sortedChildren) {
			if (child === currentGlass) break;
			if (this.glassSet.has(child)) continue;
			if (!this._childHasDynamicContent(child)) continue;
			if (this._childTouchesSample(child, sampleRect, rootRect, dpr, cache)) {
				return true;
			}
		}
		return false;
	}

	private _childHasDynamicContent(child: HTMLElement): boolean {
		let cached = this._dynamicContentCache.get(child);
		if (cached === undefined) {
			cached = child.hasAttribute('data-dynamic')
				|| child.tagName === 'VIDEO'
				|| child.querySelector('[data-dynamic], video') !== null;
			this._dynamicContentCache.set(child, cached);
		}
		return cached;
	}



	/**
	 * Recursively find and draw all img/video/canvas elements inside
	 * a wrapper, skipping any glass elements and their injected canvases.
	 */
	private _getMediaDescendants(parent: HTMLElement): HTMLElement[] {
		let entry = this._mediaDescendantsCache.get(parent);
		const now = performance.now();
		if (!entry || now - entry.lastTime > 500) {
			const elements: HTMLElement[] = [];
			const els = parent.querySelectorAll('img, video, canvas');
			for (const el of els) {
				if (el instanceof HTMLElement) {
					if (this._isInsideGlass(el)) continue;
					let isGlassCanvas = false;
					for (const gc of this.glassCanvases.values()) {
						if (gc === el) { isGlassCanvas = true; break; }
					}
					if (!isGlassCanvas) {
						elements.push(el);
					}
				}
			}
			entry = { elements, lastTime: now };
			this._mediaDescendantsCache.set(parent, entry);
		}
		return entry.elements;
	}

	private _captureMediaDescendants(
		parent: HTMLElement,
		targetCtx: CanvasRenderingContext2D,
		sampleRect: SampleRect | null,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): void {
		const mediaEls = this._getMediaDescendants(parent);
		for (const el of mediaEls) {
			this._drawMediaElement(el, targetCtx, sampleRect, rootRect, dpr, cache);
		}
	}

	/** Draw a single img/video/canvas into a local scene canvas. */
	private _drawMediaElement(
		el: HTMLElement,
		targetCtx: CanvasRenderingContext2D,
		sampleRect: SampleRect | null,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): boolean {
		const tag = el.tagName;
		const r = cache.getRect(el);
		if (sampleRect && !this._elementTouchesSample(el, sampleRect, rootRect, dpr, cache)) return false;
		const rect = this._getPixelRect(r, rootRect, dpr);
		const dx = sampleRect ? rect.x - sampleRect.x : rect.x;
		const dy = sampleRect ? rect.y - sampleRect.y : rect.y;
		const dw = rect.w;
		const dh = rect.h;

		// Hidden / collapsed media element — nothing to draw, but
		// drawImage with zero dimensions throws InvalidStateError, so
		// short-circuit.
		if (dw <= 0 || dh <= 0) return false;

		if (tag === 'CANVAS') {
			const liveCanvas = el as HTMLCanvasElement;
			if (liveCanvas.width <= 0 || liveCanvas.height <= 0) return false;
			targetCtx.drawImage(liveCanvas, dx, dy, dw, dh);
			return true;
		} else if (tag === 'IMG') {
			const img = el as HTMLImageElement;
			if (!img.complete || img.naturalWidth === 0) return false;
			this._drawMediaFitted(
				targetCtx,
				img,
				img.naturalWidth,
				img.naturalHeight,
				el,
				r,
				dx,
				dy,
				dw,
				dh,
			);
			return true;
		} else if (tag === 'VIDEO') {
			const vid = el as HTMLVideoElement;
			// readyState 0 = HAVE_NOTHING (no data at all — skip).
			// readyState >= 1 = HAVE_METADATA (dimensions known; during
			// seeking the readyState may drop to 1, but drawImage still
			// draws the last decoded frame, which is far better than a
			// white hole in the glass effect).
			if (vid.readyState < 1) return false;
			try {
				this._drawMediaFitted(
					targetCtx,
					vid,
					vid.videoWidth,
					vid.videoHeight,
					el,
					r,
					dx,
					dy,
					dw,
					dh,
				);
			} catch {
				// Broken source, revoked blob URL, or decoder error —
				// skip gracefully rather than crashing the render loop.
				return false;
			}
			return true;
		}
		return false;
	}

	/** Draw an img or video onto a local scene canvas, respecting object-fit. */
	private _drawMediaFitted(
		targetCtx: CanvasRenderingContext2D,
		mediaEl: HTMLImageElement | HTMLVideoElement,
		natW: number,
		natH: number,
		child: HTMLElement,
		r: DOMRect,
		dx: number,
		dy: number,
		dw: number,
		dh: number,
	): void {
		if (natW && natH) {
			let layout = this._mediaLayoutCache.get(child);
			if (!layout) {
				const computed = getComputedStyle(child);
				layout = {
					fit: computed.objectFit || 'fill',
					pos: computed.objectPosition || '50% 50%'
				};
				this._mediaLayoutCache.set(child, layout);
			}
			const src = LiquidGlass._objectFitRect(natW, natH, r.width, r.height, layout.fit, layout.pos);
			targetCtx.drawImage(mediaEl, src.sx, src.sy, src.sw, src.sh, dx, dy, dw, dh);
		} else {
			targetCtx.drawImage(mediaEl, dx, dy, dw, dh);
		}
	}

	private _drawPriorGlassToScene(
		child: HTMLElement,
		targetCtx: CanvasRenderingContext2D,
		sampleRect: SampleRect,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): void {
		const glassCanvas = this.glassCanvases.get(child);
		const elRect = cache.getRect(child);
		if (glassCanvas) {
			const shaderRect = this._getPixelRect(elRect, rootRect, dpr, SHADOW_PAD);
			if (LiquidGlass._rectsIntersect(shaderRect, sampleRect)) {
				targetCtx.drawImage(
					glassCanvas,
					0,
					0,
					glassCanvas.width,
					glassCanvas.height,
					shaderRect.x - sampleRect.x,
					shaderRect.y - sampleRect.y,
					shaderRect.w,
					shaderRect.h,
				);
			}
		}
	}

	private _getPixelRect(
		rect: DOMRect,
		rootRect: DOMRect,
		dpr: number,
		pad = 0,
	): SampleRect {
		return {
			x: Math.round((rect.left - rootRect.left - pad) * dpr),
			y: Math.round((rect.top - rootRect.top - pad) * dpr),
			w: Math.round((rect.width + pad * 2) * dpr),
			h: Math.round((rect.height + pad * 2) * dpr),
		};
	}

	private _childTouchesSample(
		child: HTMLElement,
		sampleRect: SampleRect,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): boolean {
		if (this._elementTouchesSample(child, sampleRect, rootRect, dpr, cache)) return true;

		for (const el of child.querySelectorAll('[data-dynamic], video')) {
			if (this._elementTouchesSample(el as HTMLElement, sampleRect, rootRect, dpr, cache)) {
				return true;
			}
		}
		return false;
	}

	private _elementTouchesSample(
		element: HTMLElement,
		sampleRect: SampleRect,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): boolean {
		const pad = this._getPaintOverflowPad(element);
		const bounds = this._getPixelRect(cache.getRect(element), rootRect, dpr, pad);
		return LiquidGlass._rectsIntersect(bounds, sampleRect);
	}

	private _getPaintOverflowPad(element: HTMLElement): number {
		if (this.glassSet.has(element)) return SHADOW_PAD;

		let pad = this._paintPadCache.get(element);
		if (pad === undefined) {
			const style = getComputedStyle(element);
			const backdropFilter = style.backdropFilter
				|| (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter;
			const maskImage = style.maskImage
				|| (style as CSSStyleDeclaration & { webkitMaskImage?: string }).webkitMaskImage;

			const paintsOutsideBounds =
				(style.boxShadow && style.boxShadow !== 'none')
				|| (style.textShadow && style.textShadow !== 'none')
				|| (style.filter && style.filter !== 'none')
				|| (backdropFilter && backdropFilter !== 'none')
				|| (maskImage && maskImage !== 'none')
				|| (style.mixBlendMode && style.mixBlendMode !== 'normal');

			pad = paintsOutsideBounds ? SHADOW_PAD : 0;
			this._paintPadCache.set(element, pad);
		}
		return pad;
	}

	private static _rectsIntersect(a: SampleRect, b: SampleRect): boolean {
		return a.x < b.x + b.w
			&& a.x + a.w > b.x
			&& a.y < b.y + b.h
			&& a.y + a.h > b.y;
	}

	/** Compute the source rectangle for drawImage that replicates CSS object-fit / object-position. */
	static _objectFitRect(
		natW: number,
		natH: number,
		boxW: number,
		boxH: number,
		fit: string,
		pos: string,
	): ObjectFitRect {
		let sx = 0, sy = 0, sw = natW, sh = natH;

		if (fit === 'fill' || (fit === 'scale-down' && natW <= boxW && natH <= boxH)) {
			return { sx, sy, sw, sh };
		}

		const parts = pos.split(/\s+/);
		const parseFrac = (v: string, total: number): number => {
			v = v.trim().toLowerCase();
			if (v === 'center' || v === '50%') return 0.5;
			if (v === 'left' || v === 'top' || v === '0%') return 0;
			if (v === 'right' || v === 'bottom' || v === '100%') return 1;
			if (v.endsWith('%')) return parseFloat(v) / 100;
			const val = parseFloat(v);
			return isNaN(val) ? 0.5 : val / total;
		};
		const fx = parseFrac(parts[0] || '50%', boxW);
		const fy = parseFrac(parts[1] || parts[0] || '50%', boxH);

		if (fit === 'cover') {
			const scale = Math.max(boxW / natW, boxH / natH);
			sw = boxW / scale;
			sh = boxH / scale;
			sx = (natW - sw) * fx;
			sy = (natH - sh) * fy;
		} else if (fit === 'contain' || fit === 'scale-down') {
			return { sx: 0, sy: 0, sw: natW, sh: natH };
		} else if (fit === 'none') {
			sw = boxW;
			sh = boxH;
			sx = (natW - sw) * fx;
			sy = (natH - sh) * fy;
		}

		sx = Math.max(0, Math.min(sx, natW - 1));
		sy = Math.max(0, Math.min(sy, natH - 1));
		sw = Math.min(sw, natW - sx);
		sh = Math.min(sh, natH - sy);

		return { sx, sy, sw, sh };
	}
}
