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
// Springy overshoot on hover-in, snappy compress on press — matches the
// shader-side spring so the whole element moves as one material.
const BUTTON_CSS = `
.${BUTTON_CLASS} {
	cursor: pointer;
	transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	will-change: transform;
}
.${BUTTON_CLASS}:hover {
	transform: translateY(-1.5px) scale(1.03);
}
.${BUTTON_CLASS}:active {
	transform: translateY(0.5px) scale(0.965);
	transition: transform 0.09s cubic-bezier(0.3, 0.7, 0.4, 1);
}
`;

interface ButtonState {
	hover: boolean;
	pressed: boolean;
	/** Spring-animated 0..1 progress values fed to the shader. */
	hoverT: number;
	hoverV: number;
	pressT: number;
	pressV: number;
	/** Pointer offset from element centre, CSS px. */
	mouseX: number;
	mouseY: number;
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

	/** MutationObserver targets can be Text/Comment nodes — never call .closest on them. */
	private static _mutationTargetIsCanvas(target: Node): boolean {
		if (!(target instanceof Element)) return false;
		if (target.tagName === 'CANVAS') return true;
		return target.closest('canvas') !== null;
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
	/** Marks every glass for a shader pass on the next frame. */
	private _globalDirty = true;
	/** Glass elements that need a WebGL re-render on the next frame. */
	private readonly _glassDirty = new Set<HTMLElement>();
	private readonly _stickyGlass = new Set<HTMLElement>();
	/** Elements flagged via markChanged(); fanned out into _glassDirty each frame. */
	private readonly _userMarkedChanged = new Set<HTMLElement>();
	private _fpsFrames = 0;
	private _fpsTime = 0;
	private _lastFrameTime = 0;

	private _observer: MutationObserver | null = null;
	private _themeObserver: MutationObserver | null = null;
	private _glassSubtreeObserver: MutationObserver | null = null;
	private _resizeObserver: ResizeObserver | null = null;
	private _activeMediaQuery: MediaQueryList | null = null;
	private _activeMediaListener: (() => void) | null = null;
	private _lastDPR = 1;
	private _lastScrollX = 0;
	private _lastScrollY = 0;
	private _resizeDebounceTimeout: any = null;
	private readonly _resizingTimeouts = new Map<HTMLElement, any>();
	private readonly _paintPadCache = new Map<HTMLElement, number>();
	private readonly _mediaLayoutCache = new Map<HTMLElement, { fit: string, pos: string }>();
	private _resolvedBodyBg: string | null = null;

	/** Memoised per-element sticky/fixed lookups — getComputedStyle walks are expensive in hot loops. */
	private readonly _stickyLookupCache = new Map<HTMLElement, boolean>();
	/** Memoised dynamic-descendant queries ([data-dynamic], video) per subtree. */
	private readonly _dynDescCache = new Map<HTMLElement, HTMLElement[]>();
	/** Memoised media-descendant queries (img, video, canvas) per wrapper. */
	private readonly _mediaDescCache = new Map<HTMLElement, HTMLElement[]>();
	/** Last-applied CSS fallback state per glass, to skip redundant style writes. */
	private readonly _cssFallbackApplied = new Map<HTMLElement, string>();
	private _headerGlassCache: Set<HTMLElement> | null = null;
	/** All ancestors of registered glass elements — O(1) contains-glass checks. */
	private _glassAncestorCache: Set<HTMLElement> | null = null;

	private _sortedChildren: HTMLElement[] = [];
	private readonly _sortedIndex = new Map<HTMLElement, number>();
	private _sortedGlassChildren: HTMLElement[] = [];
	private readonly _glassLastSize = new Map<HTMLElement, SizeEntry>();
	private readonly _glassOffsets = new Map<HTMLElement, { padLeft: number; padTop: number; borderLeft: number; borderTop: number }>();
	private readonly _buttonStates = new Map<HTMLElement, ButtonState>();
	private readonly _buttonListeners = new Map<HTMLElement, Array<() => void>>();
	private readonly _sceneTargets = new Map<HTMLElement, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>();
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
			this._markGlassesIntersecting(element);
		};
		this.renderer = new GlassRenderer();

		this.renderer.canvas.addEventListener('webglcontextrestored', () => {
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
		this._refreshSortedChildren();
		this._handleResize();
		this.capture.clear();
		this._globalDirty = true;
		this._lastDPR = window.devicePixelRatio || 1;
		this._lastScrollX = window.scrollX || window.pageXOffset;
		this._lastScrollY = window.scrollY || window.pageYOffset;

		this._listenToDPRChanges();

		this.capture.prefetchFontEmbedCSS().then(() => {
			this._globalDirty = true;
		}).catch(() => {});

		this._prewarmStaticCaptures().catch(() => {});

		window.addEventListener('resize', this._onResize);
		this.root.addEventListener('pointerdown', this._onPointerDown);
		window.addEventListener('pointermove', this._onPointerMove);
		window.addEventListener('pointerup', this._onPointerUp);

		this._observer = new MutationObserver(() => {
			this._resolvedBodyBg = null;
			this._refreshSortedChildren();
			this._globalDirty = true;
		});
		this._observer.observe(this.root, { childList: true });

		this._themeObserver = new MutationObserver(() => {
			this._resolvedBodyBg = null;
			this._globalDirty = true;
		});
		this._themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});

		let _subtreeMutationTimeout: any = null;
		this._glassSubtreeObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (LiquidGlass._mutationTargetIsCanvas(mutation.target)) {
					continue;
				}
				const owner = this._closestGlassAncestor(mutation.target);
				if (mutation.type === 'attributes' && mutation.attributeName === 'data-config') {
					if (owner) {
						this._handleConfigChange(owner);
						this._layoutCache.invalidate(owner);
						this._userMarkedChanged.add(owner);
					}
					continue;
				}
				if (owner) {
					const canvas = this.glassCanvases.get(owner);
					if (canvas && mutation.type === 'childList') {
						this._ensureDomContentAboveCanvas(owner, canvas);
					}
					this._layoutCache.invalidate(owner);
					this._userMarkedChanged.add(owner);
				}
			}
			// Mutations inside one glass can reflow siblings below it (accordion
			// expand shifts panels), which ResizeObserver misses — schedule one
			// debounced global pass per mutation burst to catch position shifts.
			if (!_subtreeMutationTimeout) {
				_subtreeMutationTimeout = setTimeout(() => {
					_subtreeMutationTimeout = null;
					this._globalDirty = true;
				}, 32);
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
		this._running = true;
		this._globalDirty = true;
		this._rafId = requestAnimationFrame(() => this._renderLoop());
	}

	private _isOwnedByThisRoot(el: HTMLElement): boolean {
		let parent = el.parentElement;
		while (parent) {
			if (parent === this.root) return true;
			if (parent.tagName === 'GLASS-CONTAINER') return false;
			parent = parent.parentElement;
		}
		return false;
	}

	registerElement(el: HTMLElement): void {
		if (this.glassSet.has(el)) return;
		if (!this.root.contains(el)) {
			console.warn('LiquidGlass: glass element must be a descendant of root, skipping.', el);
			return;
		}
		if (!this._isOwnedByThisRoot(el)) return;

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
		canvas.setAttribute('data-lg-canvas', '1');
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

		if (this._isFixedOrSticky(el)) {
			this._stickyGlass.add(el);
		}

		this._updateGlassCanvasBufferSize(el);
		this._refreshSortedChildren();
		this._globalDirty = true;
	}

	unregisterElement(el: HTMLElement): void {
		if (!this.glassSet.has(el)) return;

		this._stickyGlass.delete(el);
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

		this._glassLastSize.delete(el);
		this._glassOffsets.delete(el);
		this._sceneTargets.delete(el);
		this._glassDirty.delete(el);

		const removers = this._buttonListeners.get(el);
		if (removers) {
			for (const r of removers) r();
			this._buttonListeners.delete(el);
		}
		this._buttonStates.delete(el);
		this._cssFallbackApplied.delete(el);

		this._refreshSortedChildren();
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
		this._paintPadCache.clear();
		this._mediaLayoutCache.clear();
		this._resolvedBodyBg = null;
		this._sceneTargets.clear();
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
		this._themeObserver?.disconnect();
		this._themeObserver = null;
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
			canvas.setAttribute('data-lg-canvas', '1');
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
		let cached = this._stickyLookupCache.get(el);
		if (cached !== undefined) return cached;

		cached = false;
		let curr: HTMLElement | null = el;
		while (curr && curr !== this.root) {
			const pos = window.getComputedStyle(curr).position;
			if (pos === 'fixed' || pos === 'sticky') {
				cached = true;
				break;
			}
			curr = curr.parentElement;
		}
		this._stickyLookupCache.set(el, cached);
		return cached;
	}

	/** Glass chips inside the sticky header — excluded from page underlay sampling. */
	private _getHeaderGlassSet(): Set<HTMLElement> {
		if (this._headerGlassCache) return this._headerGlassCache;
		const set = new Set<HTMLElement>();
		const header = this.root.querySelector('.main-header');
		if (header) {
			for (const glass of this.glassSet) {
				if (header.contains(glass)) set.add(glass);
			}
		}
		this._headerGlassCache = set;
		return set;
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
			this._layoutCache.clear();
			this._globalDirty = true;
			return;
		}
		this._layoutCache.invalidate(element);
		this._userMarkedChanged.add(element);
		if (this.glassSet.has(element)) {
			const config = this._getConfig(element);
			element.style.borderRadius = `${config.cornerRadius}px`;
		}
	}

	private _setupButtonListeners(el: HTMLElement): void {
		const state: ButtonState = {
			hover: false, pressed: false,
			hoverT: 0, hoverV: 0, pressT: 0, pressV: 0,
			mouseX: 0, mouseY: 0,
		};
		this._buttonStates.set(el, state);
 
		// Hover/press only affects this button and glasses overlapping it —
		// the per-frame fan-out marks those; a global re-render is wasteful.
		const mark = () => {
			this._userMarkedChanged.add(el);
		};
		const trackPointer = (e: PointerEvent) => {
			const r = el.getBoundingClientRect();
			state.mouseX = e.clientX - (r.left + r.width * 0.5);
			state.mouseY = e.clientY - (r.top + r.height * 0.5);
		};
		const onOver = (e: PointerEvent) => { state.hover = true; trackPointer(e); mark(); };
		const onOut = () => { state.hover = false; state.pressed = false; mark(); };
		const onDown = (e: PointerEvent) => { state.pressed = true; trackPointer(e); mark(); };
		const onUp = () => { state.pressed = false; mark(); };
		const onMove = (e: PointerEvent) => {
			if (state.hover) trackPointer(e);
		};
 
		el.addEventListener('pointerover', onOver);
		el.addEventListener('pointerout', onOut);
		el.addEventListener('pointerdown', onDown);
		el.addEventListener('pointerup', onUp);
		el.addEventListener('pointercancel', onUp);
		el.addEventListener('pointermove', onMove);
 
		this._buttonListeners.set(el, [
			() => el.removeEventListener('pointerover', onOver),
			() => el.removeEventListener('pointerout', onOut),
			() => el.removeEventListener('pointerdown', onDown),
			() => el.removeEventListener('pointerup', onUp),
			() => el.removeEventListener('pointercancel', onUp),
			() => el.removeEventListener('pointermove', onMove),
		]);
	}

	/**
	 * Advance per-button hover/press springs and keep animating buttons
	 * dirty so the shader re-renders. Under-damped for a lively, iOS-like
	 * settle; press is stiffer so it feels immediate (visual haptic).
	 */
	private _advanceButtonAnimations(dt: number): void {
		for (const [el, s] of this._buttonStates) {
			const hoverTarget = s.hover ? 1 : 0;
			const pressTarget = s.pressed ? 1 : 0;

			// Semi-implicit Euler spring integration.
			const stepSpring = (t: number, v: number, target: number, k: number, c: number): [number, number] => {
				v += (k * (target - t) - c * v) * dt;
				t += v * dt;
				return [t, v];
			};
			[s.hoverT, s.hoverV] = stepSpring(s.hoverT, s.hoverV, hoverTarget, 170, 18);
			[s.pressT, s.pressV] = stepSpring(s.pressT, s.pressV, pressTarget, 480, 30);

			const settledHover = Math.abs(s.hoverT - hoverTarget) < 0.001 && Math.abs(s.hoverV) < 0.001;
			const settledPress = Math.abs(s.pressT - pressTarget) < 0.001 && Math.abs(s.pressV) < 0.001;
			if (settledHover) { s.hoverT = hoverTarget; s.hoverV = 0; }
			if (settledPress) { s.pressT = pressTarget; s.pressV = 0; }

			// Keep rendering while springs move, and while hovered at rest —
			// the travelling ripple and pointer-tracked light are time-based.
			if (!settledHover || !settledPress || s.hoverT > 0.005) {
				if (this.glassSet.has(el)) this._glassDirty.add(el);
			}
		}
	}

	// ────────────────────────────────────────────
	// Background capture warm-up
	// ────────────────────────────────────────────

	private async _prewarmStaticCaptures(): Promise<void> {
		for (const child of this._sortedChildren) {
			if (this.glassSet.has(child)) continue;
			const tag = child.tagName;
			if (tag === 'CANVAS' || tag === 'IMG' || tag === 'VIDEO') continue;
			if (child.hasAttribute('data-dynamic')) continue;
			if (this._elementContainsGlass(child)) continue;
			try {
				await this.capture.captureElement(child, false, undefined, true);
			} catch (err) {
				console.warn('LiquidGlass: prewarm capture failed:', child, err);
			}
		}
	}

	// ────────────────────────────────────────────
	// Child ordering & stacking context
	// ────────────────────────────────────────────

	/** Rebuild sorted-children plus the derived caches that depend on DOM order. */
	private _refreshSortedChildren(): void {
		this._sortedChildren = this._getSortedChildren();
		this._sortedIndex.clear();
		for (let i = 0; i < this._sortedChildren.length; i++) {
			this._sortedIndex.set(this._sortedChildren[i], i);
		}
		this._sortedGlassChildren = this._sortedChildren.filter((c) => this.glassSet.has(c));
		this._stickyLookupCache.clear();
		this._dynDescCache.clear();
		this._mediaDescCache.clear();
		this._headerGlassCache = null;
		this._glassAncestorCache = null;
	}

	private _getSortedChildren(): HTMLElement[] {
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
				const theme = document.documentElement.getAttribute('data-theme');
				if (state.pressed) {
					config.zRadius = config.zRadius * 0.85;
					config.shadowSpread = config.shadowSpread * 1.15;
				} else if (state.hover) {
					config.brightness = config.brightness + (theme === 'light' ? 0.03 : 0.04);
					config.edgeHighlight = config.edgeHighlight + 0.02;
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
		this._layoutCache.clear();
		const dpr = window.devicePixelRatio || 1;
		const rect = this.root.getBoundingClientRect();

		this.renderer.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr));

		for (const el of this.glassSet) {
			this._updateGlassCanvasBufferSize(el);
		}

		this._globalDirty = true;

		clearTimeout(this._resizeDebounceTimeout);
		this._resizeDebounceTimeout = setTimeout(() => {
			if (dpr !== this.capture.dpr) {
				this.capture.resize(dpr);
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

			this._glassDirty.add(el);
			this._globalDirty = true;

			try {
				const dpr = window.devicePixelRatio || 1;
				const rootRect = this._layoutCache.getRect(this.root);
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
				this._glassDirty.delete(el);
			} catch (err) {
				console.error('LiquidGlass: sync resize render error:', err);
			}

			const existing = this._resizingTimeouts.get(el);
			if (existing) clearTimeout(existing);

			const timeout = setTimeout(() => {
				this._resizingTimeouts.delete(el);
				this.capture.invalidateCache(el);
				this._glassDirty.add(el);
			}, 150);

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
			// Captures are element-local rasters positioned via the layout cache,
			// so scrolling only requires re-compositing sticky glass — never a
			// re-capture of the DOM underneath.
			for (const el of this._stickyGlass) {
				this._glassDirty.add(el);
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

		// Button hover/press springs — clamp dt so a background-tab pause
		// doesn't slingshot the integrator.
		const dt = Math.min((now - this._lastFrameTime) / 1000, 1 / 30);
		this._lastFrameTime = now;
		this._advanceButtonAnimations(dt);

		try {
			this._renderFrame();
		} catch (err) {
			console.error('LiquidGlass: render error:', err);
		}

		this._rafId = requestAnimationFrame(() => this._renderLoop());
	}

	private _renderFrame(): void {
		const isDragging = this._drag.active;

		// Idle fast path — bail before any layout reads (getBoundingClientRect
		// on the root every frame would keep the style/layout engine warm).
		if (!isDragging
			&& !this._globalDirty
			&& !this._hasDynamic
			&& this._glassDirty.size === 0
			&& this._userMarkedChanged.size === 0) {
			return;
		}

		const dpr = window.devicePixelRatio || 1;
		this._layoutCache.clear();
		const cache = this._layoutCache;
		const rootRect = cache.getRect(this.root);

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
			this._userMarkedChanged.clear();
		}

		if (this._globalDirty) {
			for (const el of this.glassSet) this._glassDirty.add(el);
			this._globalDirty = false;
		}

		const needsRender = this._glassDirty.size > 0
			|| this._hasDynamic
			|| isDragging;
		if (!needsRender) return;

		const dirtyTargets = new Set(this._glassDirty);
		this._glassDirty.clear();

		const renderedThisFrame: Array<{ rect: SampleRect }> = [];

		// Pass 1 — page glass so sticky navbar can sample their rendered canvases.
		for (const child of this._sortedGlassChildren) {
			if (this._isFixedOrSticky(child)) continue;
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

		// Pass 2 — sticky/fixed chrome last so it can composite pass-1 output.
		// Re-renders only when dirty (scroll, underlay change, drag, dynamic).
		for (const child of this._sortedGlassChildren) {
			if (!this._isFixedOrSticky(child)) continue;
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
		const glassCanvas = this.glassCanvases.get(child);
		const isBeingDragged = isDragging && this._drag.element === child;
		const sampleRect = this._getPixelRect(elRect, rootRect, dpr, SHADOW_PAD);

		let priorGlassChanged = false;
		for (const r of renderedThisFrame) {
			if (LiquidGlass._rectsIntersect(r.rect, sampleRect)) {
				priorGlassChanged = true;
				break;
			}
		}

		const isExplicitlyDirty = dirtyTargets.has(child);
		const hasBg = config.refraction > 0.001;

		// Dynamic-contributor scan (querySelector-heavy) only runs when the
		// cheaper dirty checks have not already decided a re-render.
		const needsShaderRender = isExplicitlyDirty || priorGlassChanged || isBeingDragged
			|| (this._hasDynamic
				&& this._glassHasDynamicContributors(child, sampleRect, rootRect, dpr, cache));

		this._applyCssMaterial(child, config, hasBg);

		if (needsShaderRender && glassCanvas) {
			const renderW = glassCanvas.width;
			const renderH = glassCanvas.height;

			if (hasBg) {
				const [sceneCanvas, sceneCtx] = this._getSceneCanvasForGlass(child);
				this._composeSceneForGlass(child, sceneCanvas, sceneCtx, sampleRect, rootRect, dpr, cache, renderW, renderH);
				this.renderer.uploadAndBlur(sceneCanvas, renderW, renderH);
			}

			const btn = this._buttonStates.get(child);
			this.renderer.clear();
			this.renderer.renderGlassPanel(
				config,
				elW,
				elH,
				dpr,
				hasBg,
				this._getThemeLift(),
				{
					time: performance.now() / 1000,
					hover: btn ? btn.hoverT : 0,
					press: btn ? btn.pressT : 0,
					mouseX: btn ? btn.mouseX * dpr : 0,
					mouseY: btn ? btn.mouseY * dpr : 0,
				},
			);

			const ctx = glassCanvas.getContext('2d')!;
			ctx.clearRect(0, 0, glassCanvas.width, glassCanvas.height);
			ctx.drawImage(
				this.renderer.canvas,
				0, 0, glassCanvas.width, glassCanvas.height,
				0, 0, glassCanvas.width, glassCanvas.height,
			);

			renderedThisFrame.push({ rect: sampleRect });
		}
	}

	/**
	 * Apply the CSS material (fallback blur or transparent passthrough).
	 * Memoised — repeated inline-style writes invalidate style caches and
	 * force browser recalcs even when values don't change.
	 */
	private _applyCssMaterial(child: HTMLElement, config: GlassConfig, hasBg: boolean): void {
		let key: string;
		if (hasBg) {
			key = 'webgl';
		} else {
			const isLight = document.documentElement.getAttribute('data-theme') === 'light';
			key = `css|${config.blurAmount}|${config.saturation}|${config.brightness}|${config.tintStrength}|${isLight}`;
		}
		if (this._cssFallbackApplied.get(child) === key) return;
		this._cssFallbackApplied.set(child, key);

		if (!hasBg) {
			// CSS fallback material — mirror the shader's iOS look:
			// heavy blur + vibrancy saturate + theme-aware milk overlay.
			const cssBlur = 6 + config.blurAmount * 54;
			const filterVal = `blur(${cssBlur}px) saturate(${170 + config.saturation * 80}%) brightness(${100 + config.brightness * 100}%)`;
			child.style.setProperty('backdrop-filter', filterVal);
			child.style.setProperty('-webkit-backdrop-filter', filterVal);
			const isLight = document.documentElement.getAttribute('data-theme') === 'light';
			child.style.backgroundColor = isLight
				? `rgba(255, 255, 255, ${config.tintStrength * 0.45 + 0.10})`
				: `rgba(46, 48, 54, ${config.tintStrength * 0.40 + 0.10})`;
		} else {
			child.style.setProperty('backdrop-filter', 'none');
			child.style.setProperty('-webkit-backdrop-filter', 'none');
			child.style.backgroundColor = 'transparent';
		}
	}

	/**
	 * Theme tone for the shader's frost layer:
	 * 1 = light material (milky white), 0 = dark material (smoky gray).
	 */
	private _getThemeLift(): number {
		const theme = document.documentElement.getAttribute('data-theme');
		return theme === 'light' ? 1.0 : 0.0;
	}

	private _resolveBodyBg(): string {
		if (this._resolvedBodyBg !== null) return this._resolvedBodyBg;

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
		return bodyBg;
	}

	private _getSceneCanvasForGlass(el: HTMLElement): [HTMLCanvasElement, CanvasRenderingContext2D] {
		let entry = this._sceneTargets.get(el);
		if (!entry) {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d')!;
			entry = { canvas, ctx };
			this._sceneTargets.set(el, entry);
		}
		return [entry.canvas, entry.ctx];
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

		if (this._isFixedOrSticky(currentGlass)) {
			this._composeSceneForStickyGlass(
				currentGlass,
				sceneCtx,
				sampleRect,
				rootRect,
				dpr,
				cache,
			);
			return;
		}

		for (const child of this._sortedChildren) {
			if (child === currentGlass) break;
			if (this.glassSet.has(child)) {
				this._drawPriorGlassToScene(child, sceneCtx, sampleRect, rootRect, dpr, cache);
				continue;
			}
			if (this._isStructuralCaptureExclusion(child)) {
				continue;
			}
			this._drawNonGlassChildToScene(child, sceneCtx, sampleRect, rootRect, dpr, cache);
		}
	}

	/** Sticky/fixed glass must sample page content underneath, not only DOM-preceding nodes. */
	private _composeSceneForStickyGlass(
		currentGlass: HTMLElement,
		sceneCtx: CanvasRenderingContext2D,
		sampleRect: SampleRect,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): void {
		const headerGlass = this._getHeaderGlassSet();
		const currentIdx = this._sortedIndex.get(currentGlass) ?? -1;

		for (const child of this._sortedChildren) {
			if (child === currentGlass) continue;

			if (this.glassSet.has(child)) {
				const isHeaderChrome = headerGlass.has(child);
				const childIdx = this._sortedIndex.get(child) ?? -1;
				const isPriorHeaderChrome = isHeaderChrome && childIdx >= 0 && childIdx < currentIdx;
				const includeUnderlay = !isHeaderChrome || isPriorHeaderChrome;

				if (includeUnderlay && this._childTouchesSample(child, sampleRect, rootRect, dpr, cache)) {
					this._drawPriorGlassToScene(child, sceneCtx, sampleRect, rootRect, dpr, cache);
				}
				continue;
			}

			if (this._isStructuralCaptureExclusion(child)) continue;
			if (!this._childTouchesSample(child, sampleRect, rootRect, dpr, cache)) continue;
			this._drawNonGlassChildToScene(
				child,
				sceneCtx,
				sampleRect,
				rootRect,
				dpr,
				cache,
				true,
			);
		}
	}

	private _isStructuralCaptureExclusion(child: HTMLElement): boolean {
		return !!(
			child.classList?.contains('customizer-drawer')
			|| child.classList?.contains('dialog-backdrop')
			|| child.classList?.contains('main-header')
		);
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

		ctx.fillStyle = this._resolveBodyBg();
		ctx.fillRect(0, 0, width, height);
	}

	private _ensureDomContentAboveCanvas(el: HTMLElement, canvas: HTMLCanvasElement): void {
		if (window.getComputedStyle(el).position === 'static') {
			el.style.position = 'relative';
		}
		el.style.isolation = 'isolate';
		canvas.style.zIndex = '0';

		for (const child of el.children) {
			if (child === canvas || !(child instanceof HTMLElement)) continue;
			if (window.getComputedStyle(child).position === 'static') {
				child.style.position = 'relative';
			}
			child.style.zIndex = '2';
		}
	}

	private _elementContainsGlass(el: HTMLElement): boolean {
		if (!this._glassAncestorCache) {
			const ancestors = new Set<HTMLElement>();
			for (const glass of this.glassSet) {
				let cur = glass.parentElement;
				while (cur && cur !== this.root) {
					ancestors.add(cur);
					cur = cur.parentElement;
				}
			}
			this._glassAncestorCache = ancestors;
		}
		return this._glassAncestorCache.has(el);
	}

	private _isInsideGlass(el: HTMLElement): boolean {
		let cur: HTMLElement | null = el;
		while (cur) {
			if (this.glassSet.has(cur)) return true;
			cur = cur.parentElement;
		}
		return false;
	}

	private _drawNonGlassChildToScene(
		child: HTMLElement,
		targetCtx: CanvasRenderingContext2D,
		sampleRect: SampleRect | null,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
		includeGlassDescendants = false,
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
				if (!(sub instanceof HTMLElement)) continue;
				if (this.glassSet.has(sub)) {
					if (includeGlassDescendants && sampleRect
						&& this._childTouchesSample(sub, sampleRect, rootRect, dpr, cache)) {
						this._drawPriorGlassToScene(sub, targetCtx, sampleRect, rootRect, dpr, cache);
					}
					continue;
				}
				this._drawNonGlassChildToScene(
					sub,
					targetCtx,
					sampleRect,
					rootRect,
					dpr,
					cache,
					includeGlassDescendants,
				);
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

		const scanAllIntersecting = this._isFixedOrSticky(currentGlass);

		for (const child of this._sortedChildren) {
			if (!scanAllIntersecting && child === currentGlass) break;
			if (child === currentGlass) continue;
			if (this.glassSet.has(child)) continue;
			if (!this._childHasDynamicContent(child)) continue;
			if (this._childTouchesSample(child, sampleRect, rootRect, dpr, cache)) {
				return true;
			}
		}
		return false;
	}

	private _childHasDynamicContent(child: HTMLElement): boolean {
		return child.hasAttribute('data-dynamic')
			|| child.tagName === 'VIDEO'
			|| this._getDynamicDescendants(child).length > 0;
	}

	/**
	 * Find img/video/canvas inside a wrapper, skipping glass canvases.
	 */
	private _getMediaDescendants(parent: HTMLElement): HTMLElement[] {
		let elements = this._mediaDescCache.get(parent);
		if (elements) return elements;

		elements = [];
		const els = parent.querySelectorAll('img, video, canvas');
		for (const el of els) {
			if (!(el instanceof HTMLElement)) continue;
			if (this._isInsideGlass(el)) continue;
			if (el.tagName === 'CANVAS') {
				let isGlassCanvas = false;
				for (const gc of this.glassCanvases.values()) {
					if (gc === el) { isGlassCanvas = true; break; }
				}
				if (isGlassCanvas) continue;
			}
			elements.push(el);
		}
		this._mediaDescCache.set(parent, elements);
		return elements;
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

	/** Cached [data-dynamic]/video descendants — subtree queries are hot-path expensive. */
	private _getDynamicDescendants(child: HTMLElement): HTMLElement[] {
		let list = this._dynDescCache.get(child);
		if (!list) {
			list = Array.from(child.querySelectorAll('[data-dynamic], video')) as HTMLElement[];
			this._dynDescCache.set(child, list);
		}
		return list;
	}

	private _childTouchesSample(
		child: HTMLElement,
		sampleRect: SampleRect,
		rootRect: DOMRect,
		dpr: number,
		cache: FrameLayoutCache,
	): boolean {
		if (this._elementTouchesSample(child, sampleRect, rootRect, dpr, cache)) return true;

		for (const el of this._getDynamicDescendants(child)) {
			if (this._elementTouchesSample(el, sampleRect, rootRect, dpr, cache)) {
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
