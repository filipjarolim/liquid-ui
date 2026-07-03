export const DEFAULT_GLASS_CONFIG = {
	blur: 0.62,
	refraction: 0.6,
	chroma: 0.04,
	'edge-highlight': 0.55,
	specular: 0.3,
	fresnel: 0.35,
	distortion: 0,
	'corner-radius': 28,
	'z-radius': 30,
	opacity: 1,
	saturation: 0,
	brightness: 0,
	'shadow-opacity': 0.3,
	'shadow-spread': 14,
	'bevel-mode': 0,
	// Frost tint amount — the tint *color* adapts to the active theme in the
	// shader (milky white in light mode, smoky gray in dark mode).
	tint: 0.55,
} as const;

/** Tuned for chrome over the page ambient backdrop — less milk, more refraction. */
export const HEADER_GLASS_CONFIG = {
	...DEFAULT_GLASS_CONFIG,
	blur: 0.55,
	refraction: 0.72,
	'edge-highlight': 0.6,
	specular: 0.32,
	tint: 0.38,
} as const;

export const CONFIG_STORAGE_KEY = 'glass-ui-config-v2';

export const GLASS_ROOT_IDS = ['glass-preview-root', 'glass-page-root'] as const;

export function refreshAllGlass(): void {
	for (const id of GLASS_ROOT_IDS) {
		const el = document.getElementById(id) as HTMLElement & {
			instance?: { markChanged: (target?: HTMLElement) => void };
		};
		el?.instance?.markChanged();
	}
}

export function buildGlassProps(
	values: Record<string, number>,
	overrides: Record<string, string | number | boolean> = {},
) {
	return {
		'blur-amount': values['blur'],
		refraction: values['refraction'],
		chroma: values['chroma'],
		'edge-highlight': values['edge-highlight'],
		specular: values['specular'],
		fresnel: values['fresnel'],
		distortion: values['distortion'],
		'corner-radius': values['corner-radius'],
		'z-radius': values['z-radius'],
		opacity: values['opacity'],
		saturation: values['saturation'],
		brightness: values['brightness'],
		'shadow-opacity': values['shadow-opacity'],
		'shadow-spread': values['shadow-spread'],
		'bevel-mode': values['bevel-mode'],
		tint: values['tint'] ?? DEFAULT_GLASS_CONFIG.tint,
		...overrides,
	};
}

export function buildHeaderGlassProps(
	overrides: Record<string, string | number | boolean> = {},
) {
	return buildGlassProps(
		HEADER_GLASS_CONFIG as unknown as Record<string, number>,
		{ tint: HEADER_GLASS_CONFIG.tint, ...overrides },
	);
}
