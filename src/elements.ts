import { LiquidGlass } from './LiquidGlass';
import type { GlassConfig } from './defaults';

// Map of HTML attributes to GlassConfig keys
const ATTRIBUTE_MAP: Record<string, keyof GlassConfig> = {
	'blur-amount': 'blurAmount',
	'refraction': 'refraction',
	'chroma': 'chromAberration',
	'edge-highlight': 'edgeHighlight',
	'specular': 'specular',
	'fresnel': 'fresnel',
	'distortion': 'distortion',
	'corner-radius': 'cornerRadius',
	'z-radius': 'zRadius',
	'opacity': 'opacity',
	'saturation': 'saturation',
	'tint': 'tintStrength',
	'brightness': 'brightness',
	'shadow-opacity': 'shadowOpacity',
	'shadow-spread': 'shadowSpread',
	'shadow-offset-y': 'shadowOffsetY',
	'floating': 'floating',
	'button': 'button',
	'bevel-mode': 'bevelMode',
};

function getConfigFromAttributes(el: HTMLElement): Partial<GlassConfig> {
	const config: Partial<GlassConfig> = {};
	for (const [attr, configKey] of Object.entries(ATTRIBUTE_MAP)) {
		if (el.hasAttribute(attr)) {
			const val = el.getAttribute(attr);
			if (val === null) continue;

			// Handle boolean values (e.g. floating, button)
			if (val === '' || val === 'true') {
				(config as any)[configKey] = true;
			} else if (val === 'false') {
				(config as any)[configKey] = false;
			} else {
				const num = parseFloat(val);
				(config as any)[configKey] = isNaN(num) ? val : num;
			}
		}
	}
	return config;
}

const SSR_HTMLElement = (typeof window !== 'undefined' ? HTMLElement : class {}) as typeof HTMLElement;

/** Glass elements owned by this container — excludes panels inside nested glass-containers. */
function getOwnedGlassElements(container: HTMLElement): HTMLElement[] {
	const all = Array.from(
		container.querySelectorAll('glass-panel, glass-button'),
	) as HTMLElement[];
	return all.filter((el) => {
		let parent = el.parentElement;
		while (parent) {
			if (parent === container) return true;
			if (parent.tagName === 'GLASS-CONTAINER') return false;
			parent = parent.parentElement;
		}
		return false;
	});
}

export class GlassContainer extends SSR_HTMLElement {
	private _lgInstance: LiquidGlass | null = null;
	private _observer: MutationObserver | null = null;
	private _pendingElements = new Set<HTMLElement>();

	get instance(): LiquidGlass | null {
		return this._lgInstance;
	}

	registerPending(el: HTMLElement) {
		if (this._lgInstance) {
			this._lgInstance.registerElement(el);
		} else {
			this._pendingElements.add(el);
		}
	}

	unregisterPending(el: HTMLElement) {
		this._pendingElements.delete(el);
		if (this._lgInstance) {
			this._lgInstance.unregisterElement(el);
		}
	}

	async connectedCallback() {
		// Set default position: relative if static
		const style = window.getComputedStyle(this);
		if (style.position === 'static') {
			this.style.position = 'relative';
		}

		// Wait a tick for children to be parsed
		await new Promise((resolve) => requestAnimationFrame(resolve));

		const glassElements = getOwnedGlassElements(this);

		// Initialize LiquidGlass targeting this container
		this._lgInstance = await LiquidGlass.init({
			root: this,
			glassElements: [], // Elements will be registered below
		});

		// Merge parsed elements and early-connected pending elements
		const allToRegister = new Set<HTMLElement>([
			...glassElements,
			...Array.from(this._pendingElements)
		]);

		for (const el of allToRegister) {
			if (this.contains(el)) {
				this._lgInstance.registerElement(el);
			}
		}
		this._pendingElements.clear();

		// Listen for added or removed glass panels/buttons dynamically in the entire subtree
		this._observer = new MutationObserver((mutations) => {
			if (!this._lgInstance) return;

			for (const mutation of mutations) {
				mutation.addedNodes.forEach((node) => {
					if (!(node instanceof HTMLElement)) return;
					const added = node.tagName === 'GLASS-PANEL' || node.tagName === 'GLASS-BUTTON'
						? [node]
						: Array.from(node.querySelectorAll('glass-panel, glass-button')) as HTMLElement[];
					for (const el of added) {
						if (getOwnedGlassElements(this).includes(el)) {
							this._lgInstance!.registerElement(el);
						}
					}
				});

				mutation.removedNodes.forEach((node) => {
					if (!(node instanceof HTMLElement)) return;
					const removed = node.tagName === 'GLASS-PANEL' || node.tagName === 'GLASS-BUTTON'
						? [node]
						: Array.from(node.querySelectorAll('glass-panel, glass-button')) as HTMLElement[];
					for (const el of removed) {
						this._lgInstance!.unregisterElement(el);
					}
				});
			}
		});

		this._observer.observe(this, { childList: true, subtree: true });
	}

	disconnectedCallback() {
		this._observer?.disconnect();
		this._lgInstance?.destroy();
		this._lgInstance = null;
		this._pendingElements.clear();
	}
}

export class GlassPanel extends SSR_HTMLElement {
	static get observedAttributes() {
		return Object.keys(ATTRIBUTE_MAP);
	}

	connectedCallback() {
		this.syncConfig();

		// Notify container to register after a tick to ensure stylesheets are applied
		requestAnimationFrame(() => {
			const container = this.closest('glass-container') as any;
			if (container && typeof container.registerPending === 'function') {
				container.registerPending(this);
			}
		});
	}

	disconnectedCallback() {
		const container = this.closest('glass-container') as any;
		if (container && typeof container.unregisterPending === 'function') {
			container.unregisterPending(this);
		}
	}

	attributeChangedCallback() {
		this.syncConfig();
		// Only notify when already registered — avoids wasted work during initial attribute hydration.
		const container = this.closest('glass-container') as GlassContainer;
		if (container?.instance?.glassSet?.has(this)) {
			container.instance.markChanged(this);
		}
	}

	private syncConfig() {
		const config = getConfigFromAttributes(this);
		this.dataset.config = JSON.stringify(config);
	}
}

export class GlassButton extends GlassPanel {
	connectedCallback() {
		// Set button: true in its config if not explicitly set otherwise
		if (!this.hasAttribute('button')) {
			this.setAttribute('button', 'true');
		}
		super.connectedCallback();
	}
}

// Register custom elements (guarded for HMR to prevent registration crashes)
if (typeof window !== 'undefined') {
	if (!customElements.get('glass-container')) {
		customElements.define('glass-container', GlassContainer);
	}
	if (!customElements.get('glass-panel')) {
		customElements.define('glass-panel', GlassPanel);
	}
	if (!customElements.get('glass-button')) {
		customElements.define('glass-button', GlassButton);
	}
}
