"use client";

import { useEffect, useRef, useState } from "react";
import {
	CONFIG_STORAGE_KEY,
	DEFAULT_GLASS_CONFIG,
	GlassContent,
	GlassHeader,
	GlassRoot,
	GlassAppIcon,
	GlassListWidget,
	GlassMusicWidget,
	GlassTabBar,
	GlassToggle,
	refreshAllGlass,
	ShowcaseGlassButton,
	ShowcaseGlassPanel,
	buildGlassProps,
	useGlassMount,
} from "@/components/glass";

interface PlaygroundParam {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
}

const pgParams: PlaygroundParam[] = [
	{ key: "blur",           label: "Blur Amount",    min: 0, max: 1,   step: 0.01 },
	{ key: "refraction",     label: "Refraction",     min: 0, max: 2,   step: 0.01 },
	{ key: "edge-highlight", label: "Edge Highlight", min: 0, max: 1,   step: 0.01 },
	{ key: "corner-radius",  label: "Corner Radius",  min: 0, max: 100, step: 1 },
	{ key: "opacity",        label: "Opacity",        min: 0, max: 1,   step: 0.01 },
	{ key: "shadow-opacity", label: "Shadow Opacity", min: 0, max: 1,   step: 0.01 },
];

const DEFAULT_CONFIG = { ...DEFAULT_GLASS_CONFIG };

const KENDRICK_NOT_LIKE_US = {
	title: "Not Like Us",
	subtitle: "Kendrick Lamar",
	artSrc: "https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/31/3a/3f/313a3fbc-bb8f-80c7-b5a2-e226869a38cd/24UMGIM51924.rgb.jpg/300x300bb.jpg",
	audioSrc: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/b6/6b/8c/b66b8c42-8c82-242b-4ef1-3655d19ac1aa/mzaf_1950801191699299821.plus.aac.p.m4a",
};

const COMPONENTS = [
	{ id: "accordion", label: "Accordion", badge: null, description: "Vertically stacked headings that reveal content on click." },
	{ id: "button",    label: "Button",    badge: null, description: "Physical glass buttons with spring physics and specular highlights." },
	{ id: "card",      label: "Card",      badge: null, description: "Refractive panels with drag gestures and bevel edge glow." },
	{ id: "input",     label: "Input",     badge: null, description: "Glass-frosted form fields with backdrop blur." },
	{ id: "dialog",    label: "Dialog",    badge: null, description: "Full-viewport modal overlay with lens distortion." },
	{ id: "widgets",   label: "Widgets",   badge: "New", description: "iOS home-screen style glass widgets — music, list, icons." },
];

const FEATURES = [
	{
		icon: (
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75">
				<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
			</svg>
		),
		title: "WebGL2 shaders",
		desc: "Two-pass render with real refraction, chromatic aberration, and dynamic bevel junction fades.",
	},
	{
		icon: (
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75">
				<polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
			</svg>
		),
		title: "Framework agnostic",
		desc: "Custom Elements work in React, Vue, Svelte, Astro, or plain HTML. React bindings optional.",
	},
	{
		icon: (
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75">
				<circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
			</svg>
		),
		title: "Tailwind v4 theming",
		desc: "CSS variables-driven light/dark tokens. Drop in @theme inline overrides to match your brand.",
	},
	{
		icon: (
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75">
				<rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
			</svg>
		),
		title: "shadcn-style CLI",
		desc: "Copy components directly into your project. No black-box package, you own the source.",
	},
	{
		icon: (
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75">
				<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
			</svg>
		),
		title: "Spring physics",
		desc: "Every interaction — hover, press, drag — is driven by configurable spring-physics curves.",
	},
	{
		icon: (
			<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75">
				<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			</svg>
		),
		title: "Performance first",
		desc: "Dirty-rect re-render, sticky header fast-path, no capture.clear() on scroll. 60 fps.",
	},
];

const BACKGROUNDS = [
	{ id: "cape-town",      label: "Table Mountain",  src: "/bg-cape-town.jpg",      accent: "#6b8fa3" },
	{ id: "lions-head",     label: "Lion's Head",     src: "/bg-lions-head.jpg",     accent: "#7a9b6e" },
	{ id: "cape-point",     label: "Cape Point",      src: "/bg-cape-point.jpg",     accent: "#8a7c6d" },
	{ id: "drakensberg",    label: "Drakensberg",     src: "/bg-drakensberg.jpg",    accent: "#6e8b9c" },
	{ id: "chapmans-peak",  label: "Chapman's Peak",  src: "/bg-chapmans-peak.jpg",  accent: "#9c8b6e" },
];

const PROP_ROWS = [
	{ prop: "blur-amount",     type: "number", default: "0.62", desc: "Backdrop blur strength (0–1)" },
	{ prop: "refraction",      type: "number", default: "0.6",  desc: "Lens refraction intensity" },
	{ prop: "edge-highlight",  type: "number", default: "0.55", desc: "Bevel edge brightness" },
	{ prop: "corner-radius",   type: "number", default: "28",   desc: "Corner radius in px" },
	{ prop: "chroma",          type: "number", default: "0.04", desc: "Chromatic aberration amount" },
	{ prop: "specular",        type: "number", default: "0.3",  desc: "Pointer-tracking specular highlight" },
	{ prop: "tint",            type: "number", default: "0.55", desc: "Frost tint (adapts to light/dark theme)" },
	{ prop: "shadow-opacity",  type: "number", default: "0.3",  desc: "Drop shadow opacity" },
];

const MagneticButton = ({ children, className, style, mounted, ...props }: any) => {
	// Use a wrapper span for the magnetic ref so getBoundingClientRect() is
	// always available and doesn't conflict with the custom-element internals.
	const wrapRef = useRef<HTMLSpanElement>(null);
	const [transform, setTransform] = useState("translate3d(0px,0px,0px)");
	const handleMouseMove = (e: React.MouseEvent) => {
		if (!wrapRef.current) return;
		const r = wrapRef.current.getBoundingClientRect();
		const px = (e.clientX - r.left - r.width / 2) * 0.35;
		const py = (e.clientY - r.top - r.height / 2) * 0.35;
		setTransform(`translate3d(${px}px,${py}px,0) scale(1.05)`);
	};
	const handleMouseLeave = () => setTransform("translate3d(0px,0px,0px)");
	const Tag = mounted ? "glass-button" : "button";
	// Only pass glass-specific attrs when the custom element is mounted; native
	// <button> would receive invalid DOM attributes and React would warn.
	const glassProps = mounted ? props : {};
	return (
		<span ref={wrapRef} style={{ display: "inline-flex" }}
			onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
			<Tag
				style={{ ...style, transform, transition: transform === "translate3d(0px,0px,0px)" ? "transform 0.5s cubic-bezier(0.22,1,0.36,1)" : "transform 0.15s ease-out", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
				className={className} {...glassProps}>
				<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
					<GlassContent inline>{children}</GlassContent>
				</span>
			</Tag>
		</span>
	);
};

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
	const copy = () => {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			timerRef.current = setTimeout(() => setCopied(false), 1800);
		}).catch(() => {});
	};
	return (
		<button type="button" className="copy-btn" onClick={copy} aria-label="Copy to clipboard">
			{copied ? (
				<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
			) : (
				<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
			)}
			{copied ? "Copied!" : "Copy"}
		</button>
	);
}

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
	return (
		<div className="code-block-wrap">
			<CopyButton text={code} />
			<pre className="code-block-pane"><code data-lang={lang} style={{ fontFamily: "var(--font-mono)", color: "var(--code-text)" }}>{code}</code></pre>
		</div>
	);
}

export default function ShowcasePage() {
	const mounted = useGlassMount();
	const [currentComponent, setCurrentComponent] = useState("accordion");
	const [previewTab, setPreviewTab] = useState("preview");
	const [pgValues, setPgValues] = useState<Record<string, number>>(DEFAULT_CONFIG);
	const [customizerOpen, setCustomizerOpen] = useState(false);
	const [activeAccordion, setActiveAccordion] = useState<number | null>(0);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [theme, setTheme] = useState<"dark" | "light">("dark");
	const [installTab, setInstallTab] = useState("pnpm");
	const [glassFxEnabled, setGlassFxEnabled] = useState(true);
	const [bgIndex, setBgIndex] = useState(0);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const savedBg = localStorage.getItem("glass-ui-bg");
		if (savedBg !== null) {
			const idx = parseInt(savedBg, 10);
			if (!isNaN(idx) && idx >= 0 && idx < BACKGROUNDS.length) setBgIndex(idx);
		}
	}, []);

	const changeBg = (idx: number) => {
		setBgIndex(idx);
		localStorage.setItem("glass-ui-bg", String(idx));
		// Kick the glass engine immediately — handles cached/instant images.
		requestAnimationFrame(() => refreshAllGlass());
	};

	// Called by <img onLoad> — by now the browser has fully decoded the new
	// pixels, so the scene composition will pick up the correct bitmap.
	const onBgLoaded = () => requestAnimationFrame(() => refreshAllGlass());

	useEffect(() => {
		if (typeof window === "undefined") return;
		const saved = localStorage.getItem("glass-ui-theme");
		const t = saved === "light" || saved === "dark" ? saved : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
		setTheme(t);
		document.documentElement.setAttribute("data-theme", t);
		requestAnimationFrame(() => refreshAllGlass());
	}, []);

	const toggleTheme = () => {
		const next = theme === "dark" ? "light" : "dark";
		setTheme(next);
		document.documentElement.setAttribute("data-theme", next);
		localStorage.setItem("glass-ui-theme", next);
		requestAnimationFrame(() => refreshAllGlass());
	};

	useEffect(() => {
		if (!mounted) return;
		requestAnimationFrame(() => refreshAllGlass());
	}, [pgValues, theme, mounted, glassFxEnabled, bgIndex]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			const saved = localStorage.getItem(CONFIG_STORAGE_KEY);
			if (saved) setPgValues((p) => ({ ...p, ...JSON.parse(saved) }));
		} catch {}
	}, []);

	const updateConfig = (key: string, value: number) => {
		const updated = { ...pgValues, [key]: value };
		setPgValues(updated);
		localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));
	};
	const resetConfig = () => {
		setPgValues(DEFAULT_CONFIG);
		localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(DEFAULT_CONFIG));
	};

	const fxValues = glassFxEnabled ? pgValues : { ...pgValues, refraction: 0, blur: 0 };

	const getInstallCmd = (pm: string, suffix: string) => {
		const map: Record<string, string> = { pnpm: `pnpm dlx liquidglass-ui@latest ${suffix}`, npm: `npx liquidglass-ui@latest ${suffix}`, yarn: `yarn dlx liquidglass-ui@latest ${suffix}`, bun: `bunx liquidglass-ui@latest ${suffix}` };
		return map[pm] ?? "";
	};

	const getCodeTemplate = () => {
		switch (currentComponent) {
			case "accordion": return `<glass-container>\n  <glass-panel blur-amount="${pgValues["blur"]}" refraction="${pgValues["refraction"]}" corner-radius="16">\n    <div class="accordion-trigger">What are your shipping options?</div>\n    <div class="accordion-content">We offer standard and express shipping…</div>\n  </glass-panel>\n</glass-container>`;
			case "button":    return `<glass-button\n  blur-amount="${pgValues["blur"]}"\n  refraction="${pgValues["refraction"]}"\n  corner-radius="16"\n  shadow-opacity="0.2"\n>\n  Deploy App\n</glass-button>`;
			case "card":      return `<glass-panel\n  floating="true"\n  blur-amount="${pgValues["blur"]}"\n  refraction="${pgValues["refraction"]}"\n  corner-radius="24"\n>\n  <h3>Frosted Lens</h3>\n  <p>Drag me over the background.</p>\n</glass-panel>`;
			case "input":     return `<glass-panel blur-amount="${pgValues["blur"]}" corner-radius="12">\n  <input type="text" placeholder="Search components…" class="glass-input" />\n</glass-panel>`;
			case "dialog":    return `<glass-panel\n  blur-amount="${pgValues["blur"]}"\n  refraction="${pgValues["refraction"]}"\n  corner-radius="28"\n  z-radius="60"\n>\n  <h2>Interactive Modal</h2>\n  <p>Refracts the entire viewport behind it!</p>\n</glass-panel>`;
			case "widgets":   return `import { GlassMusicWidget, GlassListWidget, GlassAppIcon } from 'liquidglass-ui/react';\n\n<GlassMusicWidget\n  pgValues={config}\n  artSrc="/album.avif"\n  title="Not Like Us"\n  subtitle="Kendrick Lamar"\n  audioSrc={previewUrl}\n/>\n\n<GlassListWidget\n  pgValues={config}\n  title="Reminders"\n  items={["Buy groceries", "Water plants"]}\n/>\n\n<GlassAppIcon pgValues={config} label="Photos">\n  <PhotosGlyph />\n</GlassAppIcon>`;
			default: return "";
		}
	};

	const currentMeta = COMPONENTS.find((c) => c.id === currentComponent)!;

	return (
		<div id="page-root">
			<GlassRoot id="glass-page-root" className="page-glass-root">
				{/* ── Header ── */}
				<GlassHeader
					pgValues={fxValues}
					logo={<><span className="logo-orb" /><span>LiquidGlass <span className="badge">v1.2.0</span></span></>}
					navItems={[
						{ label: "Home",       href: "#home",         onClick: (e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); } },
						{ label: "Docs",       href: "#installation", onClick: (e) => { e.preventDefault(); document.getElementById("installation")?.scrollIntoView({ behavior: "smooth" }); } },
						{ label: "Components", href: "#showcase",     onClick: (e) => { e.preventDefault(); document.getElementById("showcase")?.scrollIntoView({ behavior: "smooth" }); } },
						{ label: "GitHub",     href: "https://github.com/liquidglass-ui/liquidglass-ui", onClick: (e) => { e.preventDefault(); window.open("https://github.com/liquidglass-ui/liquidglass-ui", "_blank"); } },
					]}
					onSearchClick={() => setCustomizerOpen(true)}
					onStarClick={() => window.open("https://github.com/liquidglass-ui/liquidglass-ui", "_blank")}
					onThemeToggle={toggleTheme}
					onSettingsClick={() => setCustomizerOpen(true)}
					themeIcon={theme === "light" ? (
						<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 3c.132 0 .263 0 .393.007a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 2.999z" /></svg>
					) : (
						<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0-7a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0v-2a1 1 0 0 1 1-1zM5.636 5.636a1 1 0 0 1 1.414 0l1.414 1.414a1 1 0 1 1-1.414 1.414L5.636 7.05a1 1 0 0 1 0-1.414zm11.314 11.314a1 1 0 0 1 1.414 0l1.414 1.414a1 1 0 1 1-1.414 1.414l-1.414-1.414a1 1 0 0 1 0-1.414zM3 11a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2h2zm16 0a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2h2zM7.05 18.364a1 1 0 0 1 0 1.414l-1.414 1.414a1 1 0 1 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0zm11.314-11.314a1 1 0 0 1 0 1.414l-1.414 1.414a1 1 0 1 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0z" /></svg>
					)}
				/>

				{/* ── Hero ── */}
				<section className="hero-section" id="home">
				{/* Background image sits behind everything */}
				<img src={BACKGROUNDS[bgIndex].src} alt="" className="hero-bg" onLoad={onBgLoaded} />
					<div className="hero-overlay" />
					{/* Content is a plain stacking context above the bg */}
					<div className="hero-content">
						<div className="hero-pill">
							<span className="hero-pill-dot" />
							<span>iOS 26 liquid glass for the Web</span>
						</div>
						<h1 className="hero-title">
							Physics-based glass<br />
							<span className="hero-title-accent">for every framework</span>
						</h1>
						<p className="hero-subtitle">
							WebGL2 custom elements with real refraction, chromatic aberration, and spring physics.
							Works in React, Vue, Svelte, Astro, or plain HTML.
						</p>
						<div className="hero-cta-row">
							{/* Wrap the glass button in a small GlassRoot so it has a capture surface */}
						<GlassRoot id="glass-hero-btn" className="hero-btn-glass-root">
							<ShowcaseGlassButton
								pgValues={fxValues}
								className="hero-btn-primary"
									overrides={{ "corner-radius": 12, "shadow-opacity": 0.2 }}
									onClick={() => document.getElementById("installation")?.scrollIntoView({ behavior: "smooth" })}
								>
									Get started
									<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: "0.5rem" }}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
								</ShowcaseGlassButton>
							</GlassRoot>
							<a href="https://github.com/liquidglass-ui/liquidglass-ui" target="_blank" rel="noopener noreferrer" className="hero-btn-ghost">
								<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" style={{ marginRight: "0.5rem" }}><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
								GitHub
							</a>
						</div>
						<div className="hero-meta-row">
							<span className="hero-meta-chip">MIT License</span>
							<span className="hero-meta-chip">WebGL2</span>
							<span className="hero-meta-chip">TypeScript</span>
							<span className="hero-meta-chip">Zero runtime deps</span>
						</div>
					</div>
				</section>

				{/* ── Features strip ── */}
				<section className="features-section">
					<div className="features-grid">
						{FEATURES.map((f) => (
							<div key={f.title} className="feature-card">
								<div className="feature-icon">{f.icon}</div>
								<h3 className="feature-title">{f.title}</h3>
								<p className="feature-desc">{f.desc}</p>
							</div>
						))}
					</div>
				</section>

				{/* ── Docs three-column layout ── */}
				<div className="layout-grid" id="showcase">
					{/* Left Sidebar */}
					<aside className="left-sidebar">
						<div className="sidebar-section">
							<div className="nav-group-title">Getting Started</div>
							<ul className="nav-list">
								<li className="nav-item"><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Introduction</button></li>
								<li className="nav-item"><a href="#installation" onClick={(e) => { e.preventDefault(); document.getElementById("installation")?.scrollIntoView({ behavior: "smooth" }); }}>Installation</a></li>
								<li className="nav-item"><a href="#usage" onClick={(e) => { e.preventDefault(); document.getElementById("usage")?.scrollIntoView({ behavior: "smooth" }); }}>Usage</a></li>
								<li className="nav-item"><a href="#api" onClick={(e) => { e.preventDefault(); document.getElementById("api")?.scrollIntoView({ behavior: "smooth" }); }}>API Reference</a></li>
							</ul>
						</div>
						<div className="sidebar-section">
							<div className="nav-group-title">Components</div>
							<ul className="nav-list">
								{COMPONENTS.map((c) => (
									<li key={c.id}
										className={`nav-item ${currentComponent === c.id ? "active" : ""}`}>
										<button type="button" onClick={() => { setCurrentComponent(c.id); setPreviewTab("preview"); }}>
											<span>{c.label}</span>
											{c.badge && <span className="nav-badge">{c.badge}</span>}
										</button>
									</li>
								))}
							</ul>
						</div>
						<div className="sidebar-section">
							<div className="nav-group-title">More</div>
							<ul className="nav-list">
								<li className="nav-item nav-item-external">
									<a href="https://github.com/filipjarolim/liquid-ui/releases" target="_blank" rel="noopener noreferrer">
										Changelog
										<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
									</a>
								</li>
								<li className="nav-item nav-item-external">
									<a href="https://github.com/filipjarolim/liquid-ui/issues" target="_blank" rel="noopener noreferrer">
										GitHub Issues
										<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.5 }}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
									</a>
								</li>
							</ul>
						</div>
					</aside>

					{/* Main content */}
					<main className="main-pane">
						{/* Component header */}
						<div className="component-header">
							<div className="component-header-left">
								<div className="component-breadcrumb">Components</div>
								<h1 className="component-title">{currentMeta.label}</h1>
								<p className="component-desc">{currentMeta.description}</p>
							</div>
							<div className="component-header-actions">
								{currentMeta.badge && <span className="component-badge-new">{currentMeta.badge}</span>}
							</div>
						</div>

						{/* Preview / Code tabs */}
						<GlassTabBar
							tabs={[{ id: "preview", label: "Preview" }, { id: "code", label: "Code" }]}
							active={previewTab}
							onChange={setPreviewTab}
							pgValues={pgValues}
						/>
						<div className="preview-toolbar">
							<GlassToggle label="Live glass effects" checked={glassFxEnabled} onChange={setGlassFxEnabled} pgValues={pgValues} />
							<button type="button" className="toolbar-btn" onClick={() => setCustomizerOpen(true)}>
								<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" /></svg>
								Customize
							</button>
						</div>

						<div className="preview-box glass-on-image">
							{previewTab === "preview" ? (
								<GlassRoot id="glass-preview-root" className="preview-glass-root">
									<img src={BACKGROUNDS[bgIndex].src} alt="" className="preview-bg-image" onLoad={onBgLoaded} />
									<div id="component-container-root" className="preview-glass-content">

										{currentComponent === "accordion" && (
											<div className="showcase-accordion">
												{[
													{ q: "What are your shipping options?",       a: "We offer standard (5–7 days), express (2–3 days), and overnight shipping. Free shipping on international orders." },
													{ q: "What is your return policy?",          a: "Return any unused item within 30 days of purchase for a full refund — no questions asked." },
													{ q: "How can I contact customer support?",  a: "Our support team is available 24/7 via live chat or email at support@glassui.dev." },
												].map((item, idx) => (
													<ShowcaseGlassPanel key={idx} className={`accordion-row-panel ${activeAccordion === idx ? "open" : ""}`} pgValues={fxValues}>
														<button type="button" className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === idx ? null : idx)} aria-expanded={activeAccordion === idx}>
															<span>{item.q}</span>
															<svg className="accordion-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
														</button>
														<div className="accordion-content">{item.a}</div>
													</ShowcaseGlassPanel>
												))}
											</div>
										)}

										{currentComponent === "button" && (
											<div style={{ display: "flex", flexDirection: "column", gap: "2.5rem", zIndex: 1, width: "100%" }}>
												<div>
													<p className="preview-section-label">Refractive Buttons</p>
													<div className="btn-grid">
														<ShowcaseGlassButton className="showcase-btn" pgValues={fxValues} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }} onClick={() => alert("Get Started 🚀")}>
															Get Started
															<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" className="arrow-icon"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
														</ShowcaseGlassButton>
														<ShowcaseGlassButton className="showcase-btn" pgValues={fxValues} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }} onClick={() => window.open("https://github.com", "_blank")}>
															<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
															GitHub Source
														</ShowcaseGlassButton>
													</div>
												</div>
												<div>
													<p className="preview-section-label">Magnetic Icon Buttons</p>
													<div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
														{[
															{ title: "Settings", icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" /></svg>, onClick: () => setCustomizerOpen(true) },
															{ title: "Notifications", icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" /></svg>, onClick: () => {} },
															{ title: "Messages", icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>, onClick: () => {} },
															{ title: "Search", icon: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>, onClick: () => {} },
														].map((btn) => (
															<MagneticButton key={btn.title} mounted={mounted} className="showcase-btn" {...(buildGlassProps(fxValues, { "corner-radius": 99 }) as any)} style={{ width: 48, height: 48, padding: 0, borderRadius: "50%", cursor: "pointer" }} onClick={btn.onClick} title={btn.title}>
																{btn.icon}
															</MagneticButton>
														))}
													</div>
												</div>
											</div>
										)}

										{currentComponent === "card" && (
											<div className="card-grid">
												<ShowcaseGlassPanel className="showcase-card" pgValues={fxValues}>
													<h3>Frosted Card</h3>
													<p>A static glass panel with border shadows and sharp edge reflection.</p>
												</ShowcaseGlassPanel>
												<ShowcaseGlassPanel className="showcase-card" pgValues={fxValues} overrides={{ floating: true, refraction: fxValues["refraction"] * 1.3, "edge-highlight": fxValues["edge-highlight"] * 1.5 }}>
													<h3>Drag Me</h3>
													<p>Spring-physics drag — slide over the background to see refractive lensing.</p>
												</ShowcaseGlassPanel>
											</div>
										)}

										{currentComponent === "input" && (
											<div className="input-form">
												{[{ label: "Email Address", type: "text", ph: "you@glassui.dev" }, { label: "Password", type: "password", ph: "••••••••••••" }, { label: "Project name", type: "text", ph: "my-glass-app" }].map(({ label, type, ph }) => (
													<div key={label} className="input-group">
														<label>{label}</label>
														<ShowcaseGlassPanel className="showcase-input-panel" pgValues={fxValues} overrides={{ "blur-amount": fxValues["blur"] * 0.5, "corner-radius": 10 }}>
															<input type={type} className="showcase-input" placeholder={ph} />
														</ShowcaseGlassPanel>
													</div>
												))}
											</div>
										)}

										{currentComponent === "dialog" && (
											<ShowcaseGlassButton className="showcase-btn" pgValues={fxValues} overrides={{ "corner-radius": 12, "shadow-opacity": 0.2 }} onClick={() => setDialogOpen(true)}>
												Open Dialog Window
											</ShowcaseGlassButton>
										)}

										{currentComponent === "widgets" && (
											<div className="widget-showcase">
												<div className="widget-grid">
													<GlassMusicWidget pgValues={fxValues} artSrc={KENDRICK_NOT_LIKE_US.artSrc} title={KENDRICK_NOT_LIKE_US.title} subtitle={KENDRICK_NOT_LIKE_US.subtitle} audioSrc={KENDRICK_NOT_LIKE_US.audioSrc} />
													<GlassListWidget pgValues={fxValues} title="Reminders" items={["Buy groceries", "Water the Monstera", "Ship v1.3 🚀"]} />
												</div>
												<div className="app-icon-row">
													{[
														{ label: "Photos",    onClick: () => {}, icon: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><circle cx="12" cy="12" r="2.6" /><path d="M12 2.5a3.2 3.2 0 0 1 3.2 3.2c0 .5-.12.97-.33 1.39A5.5 5.5 0 0 0 12 6.9a5.5 5.5 0 0 0-2.87.19 3.14 3.14 0 0 1-.33-1.39A3.2 3.2 0 0 1 12 2.5zm6.7 3.87a3.2 3.2 0 0 1 1.6 2.77 3.2 3.2 0 0 1-1.6 2.77c-.43.25-.9.38-1.37.4a5.5 5.5 0 0 0-1.6-2.4 5.5 5.5 0 0 0 1.6-2.4c.47.02.94.15 1.37.4zm-13.4 0c.43-.25.9-.38 1.37-.4a5.5 5.5 0 0 0 1.6 2.4 5.5 5.5 0 0 0-1.6 2.4 3.13 3.13 0 0 1-1.37-.4 3.2 3.2 0 0 1-1.6-2.77 3.2 3.2 0 0 1 1.6-2.77zm13.4 8.5a3.2 3.2 0 0 1-1.6 2.77c-.43.25-.9.38-1.37.4a5.5 5.5 0 0 0-1.6-2.4 5.5 5.5 0 0 0 1.6-2.4c.47.02.94.15 1.37.4a3.2 3.2 0 0 1 1.6 2.77zm-13.4 2.77a3.2 3.2 0 0 1-1.6-2.77 3.2 3.2 0 0 1 1.6-2.77c.43-.25.9-.38 1.37-.4a5.5 5.5 0 0 0 1.6 2.4 5.5 5.5 0 0 0-1.6 2.4 3.13 3.13 0 0 1-1.37-.4zm10.03 1.5a3.2 3.2 0 0 1-3.2 3.2 3.2 3.2 0 0 1-3.2-3.2c0-.5.12-.97.33-1.39a5.5 5.5 0 0 0 2.87.2 5.5 5.5 0 0 0 2.87-.2c.21.42.33.9.33 1.39z" opacity="0.85" /></svg> },
														{ label: "Games",    onClick: () => {}, icon: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M13.4 2.5c3.6.6 6.9 3.9 7.5 7.5.3 2-.1 3.9-1.2 5.4l-3.1-3.1c.3-1.3 0-2.7-1-3.7s-2.4-1.3-3.7-1L8.8 4.5c1.5-1.1 3.4-1.6 4.6-2zM7.3 5.9l3 3c-.3 1.3 0 2.7 1 3.7s2.4 1.3 3.7 1l3 3c-1.5 1.1-3.4 1.5-5.4 1.2-3.6-.6-6.9-3.9-7.5-7.5-.3-2 .1-3.9 1.2-5.4h1zM5 16.2l2.8 2.8-1.8 1.8c-.5.5-1.3.5-1.8 0l-1-1c-.5-.5-.5-1.3 0-1.8L5 16.2z" /><circle cx="14" cy="10" r="1.8" /></svg> },
														{ label: "Podcasts", onClick: () => {}, icon: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><circle cx="12" cy="10" r="2.4" /><path d="M12 14.2c1.5 0 2.6 1 2.4 2.2l-.6 4a1.8 1.8 0 0 1-3.6 0l-.6-4c-.2-1.2.9-2.2 2.4-2.2zm4.8-.4a5.6 5.6 0 1 0-9.6 0 .9.9 0 0 1-1.5 1A7.4 7.4 0 1 1 19.4 12c0 1.05-.4 2.02-1.1 2.83a.9.9 0 0 1-1.5-1.03z" opacity="0.9" /></svg> },
														{ label: "FaceTime", onClick: () => {}, icon: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><rect x="2" y="6" width="13" height="12" rx="3" /><path d="M16.5 10.2l4-2.6a1 1 0 0 1 1.5.85v7.1a1 1 0 0 1-1.5.85l-4-2.6v-3.6z" /></svg> },
													].map((icon) => (
														<GlassAppIcon key={icon.label} pgValues={fxValues} label={icon.label} onClick={icon.onClick}>{icon.icon}</GlassAppIcon>
													))}
												</div>
											</div>
										)}
									</div>
								</GlassRoot>
							) : (
								<div className="code-view">
									<CodeBlock code={getCodeTemplate()} lang="jsx" />
								</div>
							)}
						</div>

						{/* ── Installation ── */}
						<section className="doc-section" id="installation">
							<h2 className="doc-heading">Installation</h2>
							<p className="doc-text">Initialize your project once, then add any component. The CLI copies source files directly into your codebase — no black-box packages.</p>
							<div className="pm-tabs">
								{["pnpm", "npm", "yarn", "bun"].map((pm) => (
									<button key={pm} type="button" className={`tab-btn-glass ${installTab === pm ? "active" : ""}`} onClick={() => setInstallTab(pm)}>{pm}</button>
								))}
							</div>
							<div className="install-steps">
								<div className="install-step">
									<div className="install-step-num">1</div>
									<div className="install-step-body">
										<p className="install-step-label">Initialize project config</p>
										<CodeBlock code={getInstallCmd(installTab, "init")} />
									</div>
								</div>
								<div className="install-step">
									<div className="install-step-num">2</div>
									<div className="install-step-body">
										<p className="install-step-label">Add the component you need</p>
										<CodeBlock code={getInstallCmd(installTab, `add ${currentComponent === "widgets" ? "glass-music-widget glass-list-widget glass-app-icon" : currentComponent}`)} />
									</div>
								</div>
								<div className="install-step">
									<div className="install-step-num">3</div>
									<div className="install-step-body">
										<p className="install-step-label">Wrap your layout in GlassProvider</p>
										<CodeBlock code={`import { GlassProvider } from '@/lib/glass-provider';\n\nexport default function Layout({ children }) {\n  return <GlassProvider>{children}</GlassProvider>;\n}`} lang="jsx" />
									</div>
								</div>
							</div>
						</section>

						{/* ── Usage ── */}
						<section className="doc-section" id="usage">
							<h2 className="doc-heading">Usage</h2>
							<p className="doc-text">Custom elements work in any framework without React. Import the side-effect once at app entry:</p>
							<CodeBlock code={`// Any framework — registers <glass-panel>, <glass-button>, <glass-container>\nimport 'liquidglass-ui/elements';\n\n// React bindings (optional)\nimport { GlassChip, GlassRoot, buildGlassProps } from 'liquidglass-ui/react';`} lang="js" />
							<p className="doc-text" style={{ marginTop: "1.5rem" }}>Add theme tokens to your global CSS:</p>
							<CodeBlock code={`@import "tailwindcss";\n@import "liquidglass-ui/styles/glass-theme.css";\n@import "liquidglass-ui/styles/glass-ui.css";`} lang="css" />
							<p className="doc-text" style={{ marginTop: "1.5rem" }}>Vanilla HTML example:</p>
							<CodeBlock code={`<glass-container>\n  <img src="/bg.avif" class="background" />\n  <glass-panel\n    blur-amount="0.62"\n    refraction="0.6"\n    corner-radius="28"\n    tint="0.55"\n  >\n    Hello, liquid glass.\n  </glass-panel>\n</glass-container>`} lang="html" />
						</section>

						{/* ── API Reference ── */}
						<section className="doc-section" id="api">
							<h2 className="doc-heading">API Reference</h2>
							<p className="doc-text">All glass elements share these HTML attributes / React props. Values are floats unless stated.</p>
							<div className="api-table-wrap">
								<table className="api-table">
									<thead>
										<tr>
											<th>Attribute</th>
											<th>Type</th>
											<th>Default</th>
											<th>Description</th>
										</tr>
									</thead>
									<tbody>
										{PROP_ROWS.map((row) => (
											<tr key={row.prop}>
												<td><code className="prop-name">{row.prop}</code></td>
												<td><span className="prop-type">{row.type}</span></td>
												<td><code className="prop-default">{row.default}</code></td>
												<td className="prop-desc">{row.desc}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</section>
					</main>

					{/* Right Sidebar */}
					<aside className="right-sidebar">
						<div className="nav-group-title">On This Page</div>
						<ul className="toc-list">
							{[
								{ id: "showcase",     label: "Preview" },
								{ id: "installation", label: "Installation" },
								{ id: "usage",        label: "Usage" },
								{ id: "api",          label: "API Reference" },
							].map(({ id, label }) => (
								<li key={id} className="toc-item" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}>{label}</li>
							))}
						</ul>

						<div className="right-card">
							<div className="right-card-icon">
								<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="3" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" /></svg>
							</div>
							<h4 className="right-card-title">Customize shaders</h4>
							<p className="right-card-body">Tweak blur, refraction, chromatic aberration, and bevel in real-time.</p>
							<button type="button" className="right-card-btn" onClick={() => setCustomizerOpen(true)}>Open Settings</button>
						</div>

						<div className="right-card" style={{ marginTop: "1rem" }}>
							<div className="right-card-icon">
								<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
							</div>
							<h4 className="right-card-title">Open source</h4>
							<p className="right-card-body">MIT licensed. Star on GitHub or open an issue.</p>
							<a href="https://github.com/liquidglass-ui/liquidglass-ui" target="_blank" rel="noopener noreferrer" className="right-card-btn">View on GitHub</a>
						</div>
					</aside>
				</div>

				{/* ── Footer ── */}
				<footer className="site-footer">
					<div className="footer-inner">
						<div className="footer-brand">
							<span className="logo-orb" style={{ width: 20, height: 20 }} />
							<span className="footer-brand-name">LiquidGlass</span>
							<span className="footer-brand-version">v1.2.0</span>
						</div>
						<div className="footer-links">
						<div className="footer-col">
							<div className="footer-col-title">Docs</div>
							<a className="footer-link" href="#installation" onClick={(e) => { e.preventDefault(); document.getElementById("installation")?.scrollIntoView({ behavior: "smooth" }); }}>Installation</a>
							<a className="footer-link" href="#usage" onClick={(e) => { e.preventDefault(); document.getElementById("usage")?.scrollIntoView({ behavior: "smooth" }); }}>Usage</a>
							<a className="footer-link" href="#api" onClick={(e) => { e.preventDefault(); document.getElementById("api")?.scrollIntoView({ behavior: "smooth" }); }}>API Reference</a>
						</div>
						<div className="footer-col">
							<div className="footer-col-title">Components</div>
							{COMPONENTS.slice(0, 4).map((c) => (
								<a key={c.id} className="footer-link" href={`#${c.id}`} onClick={(e) => { e.preventDefault(); setCurrentComponent(c.id); document.getElementById("showcase")?.scrollIntoView({ behavior: "smooth" }); }}>{c.label}</a>
							))}
							</div>
							<div className="footer-col">
								<div className="footer-col-title">Resources</div>
								<a className="footer-link" href="https://github.com/liquidglass-ui/liquidglass-ui" target="_blank" rel="noopener">GitHub</a>
								<a className="footer-link" href="https://github.com/liquidglass-ui/liquidglass-ui/issues" target="_blank" rel="noopener">Issues</a>
								<a className="footer-link" href="https://github.com/liquidglass-ui/liquidglass-ui/releases" target="_blank" rel="noopener">Changelog</a>
							</div>
						</div>
					</div>
					<div className="footer-bottom">
						<span>Built with WebGL2, Next.js, and Tailwind v4.</span>
						<span>MIT License © 2026 LiquidGlass contributors.</span>
					</div>
				</footer>
			</GlassRoot>

		{/* Settings Drawer */}
		{customizerOpen && (
			<div className="customizer-overlay" onClick={() => setCustomizerOpen(false)}>
				<div className={`customizer-drawer ${customizerOpen ? "open" : ""}`} onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ backgroundColor: "var(--bg-secondary)" }}>
					<div className="customizer-header">
						<div>
							<h3 style={{ fontSize: "1rem", fontWeight: 700 }}>Customize</h3>
							<p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>Background & shader parameters</p>
						</div>
						<div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
							<button type="button" className="header-control-plain" onClick={resetConfig} style={{ padding: "0.3rem 0.75rem", fontSize: "0.75rem" }}>Reset</button>
							<button type="button" className="header-control-plain" onClick={() => setCustomizerOpen(false)} style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}>✕</button>
						</div>
					</div>
					<div className="customizer-body">
						{/* Background picker */}
						<div className="customizer-section-title">Background</div>
						<div className="bg-picker">
							{BACKGROUNDS.map((bg, idx) => (
								<button
									key={bg.id}
									type="button"
									className={`bg-swatch ${bgIndex === idx ? "active" : ""}`}
									onClick={() => changeBg(idx)}
									title={bg.label}
								>
									<img src={bg.src} alt={bg.label} />
									<span className="bg-swatch-label">{bg.label}</span>
								</button>
							))}
						</div>
						{/* Shader sliders */}
						<div className="customizer-section-title" style={{ marginTop: "1.25rem" }}>Shader</div>
						{pgParams.map((p) => (
							<div className="slider-control" key={p.key}>
								<div className="slider-info">
									<span className="slider-label">{p.label}</span>
									<span className="slider-value">{pgValues[p.key]}</span>
								</div>
								<input type="range" min={p.min} max={p.max} step={p.step} value={pgValues[p.key]} onChange={(e) => updateConfig(p.key, parseFloat(e.target.value))} style={{ width: "100%", height: "4px" }} />
							</div>
						))}
					</div>
				</div>
			</div>
		)}

			{/* Dialog */}
			{dialogOpen && (
				<div className="dialog-backdrop" onClick={() => setDialogOpen(false)}>
					<div className="dialog-pane" onClick={(e: React.MouseEvent) => e.stopPropagation()} style={{ backgroundColor: "var(--bg-secondary)" }}>
						<h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.75rem" }}>Glass UI Modal</h2>
						<p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: "1.6", marginBottom: "2rem" }}>This dialog overlays the viewport, applying high-fidelity physical refraction and lens distortion to everything underneath.</p>
						<button type="button" className="header-control-plain" style={{ padding: "0.6rem 1.5rem", fontSize: "0.85rem" }} onClick={() => setDialogOpen(false)}>Close Modal</button>
					</div>
				</div>
			)}
		</div>
	);
}
