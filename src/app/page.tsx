"use client";

import { useEffect, useRef, useState } from "react";

interface PlaygroundParam {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
}

const pgParams: PlaygroundParam[] = [
	{ key: 'blur',            label: 'Blur Amount',       min: 0, max: 1,    step: 0.01 },
	{ key: 'refraction',      label: 'Refraction',        min: 0, max: 2,    step: 0.01 },
	{ key: 'edge-highlight',   label: 'Edge Highlight',    min: 0, max: 1,    step: 0.01 },
	{ key: 'corner-radius',    label: 'Corner Radius',     min: 0, max: 100,  step: 1 },
	{ key: 'opacity',         label: 'Opacity',           min: 0, max: 1,    step: 0.01 },
	{ key: 'shadow-opacity',   label: 'Shadow Opacity',    min: 0, max: 1,    step: 0.01 },
];

const DEFAULT_CONFIG = {
	blur: 0.25,
	refraction: 0.60,
	chroma: 0.05,
	'edge-highlight': 0.08,
	specular: 0.35,
	fresnel: 1.00,
	distortion: 0.00,
	'corner-radius': 24,
	'z-radius': 30,
	opacity: 1.00,
	saturation: 0.00,
	brightness: 0.00,
	'shadow-opacity': 0.25,
	'shadow-spread': 12,
	'bevel-mode': 0,
};

const MagneticButton = ({ children, className, style, mounted, ...props }: any) => {
	const ref = useRef<any>(null);
	const [transform, setTransform] = useState("translate3d(0px, 0px, 0px)");

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!ref.current) return;
		const rect = ref.current.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const deltaX = e.clientX - centerX;
		const deltaY = e.clientY - centerY;
		const pullX = deltaX * 0.35;
		const pullY = deltaY * 0.35;
		setTransform(`translate3d(${pullX}px, ${pullY}px, 0px) scale(1.05)`);
	};

	const handleMouseLeave = () => {
		setTransform("translate3d(0px, 0px, 0px)");
	};

	const Tag = mounted ? 'glass-button' : 'button';

	return (
		<Tag
			ref={ref}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			style={{
				...style,
				transform: transform,
				transition: transform === "translate3d(0px, 0px, 0px)" ? "transform 0.5s cubic-bezier(0.25, 1, 0.5, 1)" : "transform 0.1s ease-out",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				cursor: "pointer",
			}}
			className={className}
			{...props}
		>
			<span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
				{children}
			</span>
		</Tag>
	);
};

export default function ShowcasePage() {
	// Mounted state for SSR hydration safety
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	const Container = (mounted ? 'glass-container' : 'div') as any;
	const Panel = (mounted ? 'glass-panel' : 'div') as any;
	const Button = (mounted ? 'glass-button' : 'button') as any;

	// Component selection ("accordion", "button", "card", "input", "dialog")
	const [currentComponent, setCurrentComponent] = useState("accordion");
	const [previewTab, setPreviewTab] = useState("preview"); // "preview" | "code"

	// LocalStorage-backed Customizer configuration
	const [pgValues, setPgValues] = useState<Record<string, number>>(DEFAULT_CONFIG);
	const [customizerOpen, setCustomizerOpen] = useState(false);
	const [activeAccordion, setActiveAccordion] = useState<number | null>(0);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [theme, setTheme] = useState<'dark' | 'light'>('dark');
	const [installTab, setInstallTab] = useState("pnpm");

	useEffect(() => {
		if (typeof window !== 'undefined') {
			const savedTheme = localStorage.getItem('glass-ui-theme');
			if (savedTheme === 'light' || savedTheme === 'dark') {
				setTheme(savedTheme);
				document.documentElement.setAttribute('data-theme', savedTheme);
			} else {
				const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
				const initialTheme = prefersLight ? 'light' : 'dark';
				setTheme(initialTheme);
				document.documentElement.setAttribute('data-theme', initialTheme);
			}

			// Trigger a refresh after components finish mounting and initializing WebGL
			requestAnimationFrame(() => {
				const containerEl = document.getElementById('page-root') as any;
				if (containerEl && containerEl.instance) {
					containerEl.instance.markChanged();
				}
			});
		}
	}, []);

	const toggleTheme = () => {
		const nextTheme = theme === 'dark' ? 'light' : 'dark';
		setTheme(nextTheme);
		document.documentElement.setAttribute('data-theme', nextTheme);
		localStorage.setItem('glass-ui-theme', nextTheme);

		// Force background elements recapture under the new theme styling
		requestAnimationFrame(() => {
			const containerEl = document.getElementById('page-root') as any;
			if (containerEl && containerEl.instance) {
				containerEl.instance.markChanged();
			}
		});
	};
	
	// Load config from localStorage on mount
	useEffect(() => {
		if (typeof window !== 'undefined') {
			const saved = localStorage.getItem('glass-ui-config');
			if (saved) {
				try {
					const parsed = JSON.parse(saved);
					setPgValues((prev) => ({ ...prev, ...parsed }));
				} catch (e) {
					console.error("Failed to parse saved config:", e);
				}
			}
		}
	}, []);

	// Save config to localStorage on change
	const updateConfig = (key: string, value: number) => {
		const updated = { ...pgValues, [key]: value };
		setPgValues(updated);
		localStorage.setItem('glass-ui-config', JSON.stringify(updated));
	};

	const resetConfig = () => {
		setPgValues(DEFAULT_CONFIG);
		localStorage.setItem('glass-ui-config', JSON.stringify(DEFAULT_CONFIG));
	};

	// Code templates based on currentComponent
	const getCodeTemplate = () => {
		switch (currentComponent) {
			case "accordion":
				return `<!-- Custom Elements Usage -->
<glass-container>
  <!-- Background asset -->
  <img src="/background.png" class="background" />

  <!-- Accordion Row -->
  <glass-panel blur-amount="${pgValues['blur']}" refraction="${pgValues['refraction']}" corner-radius="16">
    <div class="accordion-trigger">What are your shipping options?</div>
    <div class="accordion-content">We offer standard and express shipping...</div>
  </glass-panel>
</glass-container>`;
			case "button":
				return `<!-- Interactive Glass Button -->
<glass-container>
  <glass-button 
    blur-amount="${pgValues['blur']}" 
    refraction="${pgValues['refraction']}"
    corner-radius="16" 
    shadow-opacity="0.2"
  >
    Deploy App
  </glass-button>
</glass-container>`;
			case "card":
				return `<!-- Draggable Refractive Cards -->
<glass-container>
  <glass-panel 
    floating="true" 
    blur-amount="${pgValues['blur']}" 
    refraction="${pgValues['refraction']}" 
    corner-radius="24"
  >
    <h3>Frosted Lens</h3>
    <p>Drag me over the background images.</p>
  </glass-panel>
</glass-container>`;
			case "input":
				return `<!-- Forms and Inputs -->
<glass-container>
  <glass-panel blur-amount="${pgValues['blur']}" corner-radius="12">
    <input type="text" placeholder="Search components..." class="glass-input" />
  </glass-panel>
</glass-container>`;
			case "dialog":
				return `<!-- Refractive Dialog Overlay -->
<glass-container id="dialog-overlay">
  <!-- Dialog box centered in the viewport -->
  <glass-panel 
    blur-amount="${pgValues['blur']}" 
    refraction="${pgValues['refraction']}" 
    corner-radius="28" 
    z-radius="60"
  >
    <h2>Interactive Modal</h2>
    <p>Refracts the entire viewport behind it!</p>
    <button>Close</button>
  </glass-panel>
</glass-container>`;
			default:
				return "";
		}
	};

	return (
		<Container id="page-root" style={{ minHeight: "100vh", position: "relative" }}>
			{/* Custom Scoped CSS Stylesheet */}
			<style>{`
				:root {
					--navbar-height: 64px;
					--sidebar-width: 240px;
					--right-sidebar-width: 220px;
				}

				body {
					background-color: var(--bg-primary);
					color: var(--text-primary);
					overflow-y: scroll;
					transition: background-color 0.3s, color 0.3s;
				}

				/* Springy background blobs styling */
				.blobs-wrapper {
					position: fixed;
					inset: 0;
					z-index: 0;
					pointer-events: none;
					overflow: hidden;
				}

				.bg-blob {
					position: absolute;
					width: 480px;
					height: 480px;
					border-radius: 50%;
					filter: blur(80px);
					opacity: 0.45;
					mix-blend-mode: screen;
				}

				.blob-indigo {
					background: radial-gradient(circle, rgba(99, 102, 241, 0.8) 0%, rgba(99, 102, 241, 0) 70%);
					top: 10%;
					left: 20%;
					transform: translate(calc(var(--mx) * 140px), calc(var(--my) * 140px));
					transition: transform 0.8s cubic-bezier(0.1, 0.8, 0.25, 1);
				}

				.blob-teal {
					background: radial-gradient(circle, rgba(20, 184, 166, 0.7) 0%, rgba(20, 184, 166, 0) 70%);
					bottom: 15%;
					right: 15%;
					transform: translate(calc(var(--mx) * -180px), calc(var(--my) * -180px));
					transition: transform 1.2s cubic-bezier(0.1, 0.8, 0.25, 1);
				}

				.blob-pink {
					background: radial-gradient(circle, rgba(236, 72, 153, 0.6) 0%, rgba(236, 72, 153, 0) 70%);
					top: 40%;
					right: 35%;
					transform: translate(calc(var(--mx) * 90px), calc(var(--my) * -90px));
					transition: transform 1s cubic-bezier(0.1, 0.8, 0.25, 1);
				}

				.blob-amber {
					background: radial-gradient(circle, rgba(245, 158, 11, 0.55) 0%, rgba(245, 158, 11, 0) 70%);
					bottom: 25%;
					left: 10%;
					transform: translate(calc(var(--mx) * -80px), calc(var(--my) * 120px));
					transition: transform 1.4s cubic-bezier(0.1, 0.8, 0.25, 1);
				}

				/* Layout Layout */
				.layout-grid {
					display: grid;
					grid-template-columns: var(--sidebar-width) 1fr var(--right-sidebar-width);
					min-height: calc(100vh - var(--navbar-height));
					max-width: 1400px;
					margin: 0 auto;
					position: relative;
					z-index: 1;
				}

				.left-sidebar {
					position: sticky;
					top: var(--navbar-height);
					height: calc(100vh - var(--navbar-height));
					padding: 2rem 1.5rem;
					border-right: 1px solid var(--border-color);
					overflow-y: auto;
				}

				.right-sidebar {
					position: sticky;
					top: var(--navbar-height);
					height: calc(100vh - var(--navbar-height));
					padding: 2rem 1.5rem;
					border-left: 1px solid var(--border-color);
					overflow-y: auto;
				}

				[style*="--is-capturing"] .left-sidebar,
				[style*="--is-capturing"] .right-sidebar {
					position: absolute !important;
					top: 0 !important;
					height: auto !important;
				}

				.main-pane {
					padding: 2.5rem 3.5rem;
					max-width: 820px;
					margin: 0 auto;
					width: 100%;
				}

				/* Navigation lists */
				.nav-group-title {
					font-size: 0.75rem;
					font-weight: 700;
					text-transform: uppercase;
					letter-spacing: 0.1em;
					color: var(--text-secondary);
					margin-bottom: 0.75rem;
				}

				.nav-list {
					list-style: none;
					display: flex;
					flex-direction: column;
					gap: 0.35rem;
					margin-bottom: 2rem;
				}

				.nav-item {
					font-size: 0.9rem;
					color: var(--text-muted);
					cursor: pointer;
					padding: 0.4rem 0.6rem;
					border-radius: 8px;
					transition: all 0.2s;
				}

				.nav-item:hover {
					color: var(--text-primary);
					background-color: var(--border-color);
				}

				.nav-item.active {
					color: var(--text-primary);
					background-color: var(--bg-tertiary);
					font-weight: 600;
					box-shadow: inset 0 0 10px var(--glow-color);
				}

				/* Glass Tab System */
				.tab-bar-glass {
					display: inline-flex;
					padding: 0.25rem;
					border: 1px solid var(--border-color);
					border-radius: 12px;
					margin-bottom: 1.5rem;
					background-color: var(--bg-tertiary);
				}

				.tab-btn-glass {
					padding: 0.5rem 1.25rem;
					border-radius: 9px;
					font-size: 0.85rem;
					font-weight: 600;
					color: var(--text-muted);
					cursor: pointer;
					transition: all 0.2s;
					border: none;
					background: none;
				}

				.tab-btn-glass:hover {
					color: var(--text-primary);
				}

				.tab-btn-glass.active {
					color: var(--text-primary);
					background-color: var(--bg-secondary);
					box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
				}

				/* Interactive Preview Card */
				.preview-box {
					border: 1px solid var(--border-color);
					border-radius: 20px;
					background-color: var(--bg-secondary);
					padding: 3.5rem;
					display: flex;
					align-items: center;
					justify-content: center;
					min-height: 380px;
					position: relative;
					overflow: hidden;
					margin-bottom: 2.5rem;
					box-shadow: 0 20px 40px rgba(0, 0, 0, 0.05);
				}

				.preview-bg-image {
					position: absolute;
					inset: 0;
					width: 100%;
					height: 100%;
					object-fit: cover;
					opacity: 0.35;
					z-index: 0;
					pointer-events: none;
				}

				/* Component Showcase Stylings */
				.showcase-accordion {
					width: 100%;
					max-width: 460px;
					display: flex;
					flex-direction: column;
					gap: 0.75rem;
					z-index: 1;
				}

				.accordion-row-panel {
					width: 100%;
					overflow: hidden;
				}

				.accordion-header {
					padding: 1.25rem 1.5rem;
					font-weight: 600;
					font-size: 0.95rem;
					cursor: pointer;
					display: flex;
					justify-content: space-between;
					align-items: center;
					user-select: none;
				}

				.accordion-content {
					max-height: 0;
					overflow: hidden;
					padding: 0 1.5rem;
					color: var(--text-secondary);
					font-size: 0.88rem;
					line-height: 1.6;
					transition: max-height 0.4s cubic-bezier(0.16, 1, 0.3, 1), padding 0.4s;
				}

				.accordion-row-panel.open .accordion-content {
					max-height: 160px;
					padding-bottom: 1.25rem;
				}

				.accordion-chevron {
					transition: transform 0.3s;
				}

				.accordion-row-panel.open .accordion-chevron {
					transform: rotate(180deg);
				}

				/* Settings Panel Drawer */
				.customizer-drawer {
					position: fixed;
					top: 0;
					right: 0;
					bottom: 0;
					width: 100%;
					max-width: 380px;
					height: 100vh;
					z-index: 1000;
					border-left: 1px solid var(--border-color);
					transform: translateX(100%);
					transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
					display: flex;
					flex-direction: column;
				}

				.customizer-drawer.open {
					transform: translateX(0);
				}

				.customizer-header {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: 1.5rem;
					border-bottom: 1px solid var(--border-color);
				}

				.customizer-body {
					flex: 1;
					overflow-y: auto;
					padding: 1.5rem;
					display: flex;
					flex-direction: column;
					gap: 1.5rem;
				}

				/* Showcase buttons */
				.btn-grid {
					display: grid;
					grid-template-columns: repeat(2, 1fr);
					gap: 1.25rem;
					z-index: 1;
					width: 100%;
					max-width: 440px;
				}

				.showcase-btn {
					padding: 0.9rem 1.5rem;
					border: 1px solid var(--border-color);
					font-size: 0.9rem;
					color: var(--text-primary);
					transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
				}

				.showcase-btn:active {
					transform: scale(0.96);
				}

				.showcase-btn:hover .arrow-icon {
					transform: translateX(4px);
				}

				/* Showcase Cards */
				.card-grid {
					display: grid;
					grid-template-columns: repeat(2, 1fr);
					gap: 1.5rem;
					z-index: 1;
					width: 100%;
				}

				.showcase-card {
					padding: 2rem;
					border: 1px solid var(--border-color);
					color: var(--text-primary);
					text-align: left;
				}

				.showcase-card h3 {
					font-size: 1.15rem;
					margin-bottom: 0.5rem;
				}

				.showcase-card p {
					font-size: 0.85rem;
					color: var(--text-secondary);
				}

				/* Showcase Inputs */
				.input-form {
					display: flex;
					flex-direction: column;
					gap: 1.25rem;
					z-index: 1;
					width: 100%;
					max-width: 400px;
				}

				.input-group {
					display: flex;
					flex-direction: column;
					gap: 0.5rem;
				}

				.input-group label {
					font-size: 0.8rem;
					font-weight: 600;
					color: var(--text-secondary);
				}

				.showcase-input-panel {
					border: 1px solid var(--border-color);
					padding: 0.15rem 0.25rem;
				}

				.showcase-input {
					width: 100%;
					background: none;
					border: none;
					outline: none;
					padding: 0.65rem 0.9rem;
					color: var(--text-primary);
					font-family: inherit;
					font-size: 0.9rem;
				}

				/* Interactive Dialog Modal */
				.dialog-backdrop {
					position: fixed;
					inset: 0;
					background-color: rgba(0, 0, 0, 0.5);
					backdrop-filter: blur(4px);
					z-index: 2000;
					display: flex;
					align-items: center;
					justify-content: center;
					padding: 1.5rem;
					animation: fadeIn 0.3s;
				}

				.dialog-pane {
					width: 100%;
					max-width: 480px;
					border: 1px solid var(--border-color);
					padding: 2.5rem;
					text-align: center;
					box-shadow: 0 30px 60px rgba(0, 0, 0, 0.2);
					animation: scaleUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.15);
				}

				.code-block-pane {
					position: relative;
					border-radius: 12px;
					background-color: var(--bg-tertiary) !important;
					border: 1px solid var(--border-color);
					margin: 0;
					font-size: 0.85rem;
				}

				@keyframes fadeIn {
					from { opacity: 0; }
					to { opacity: 1; }
				}

				@keyframes scaleUp {
					from { transform: scale(0.92); opacity: 0; }
					to { transform: scale(1); opacity: 1; }
				}

				/* Responsive Media Queries */
				@media (max-width: 1024px) {
					.layout-grid {
						grid-template-columns: 200px 1fr;
					}
					.right-sidebar {
						display: none;
					}
				}

				@media (max-width: 768px) {
					.layout-grid {
						grid-template-columns: 1fr;
					}
					.left-sidebar {
						position: static;
						height: auto;
						width: 100%;
						padding: 0.75rem 1rem;
						border-right: none;
						border-bottom: 1px solid var(--border-color);
						overflow-x: auto;
						display: flex;
						gap: 0.5rem;
						white-space: nowrap;
						-webkit-overflow-scrolling: touch;
					}
					.left-sidebar .nav-group-title {
						display: none;
					}
					.left-sidebar .nav-list:first-of-type {
						display: none;
					}
					.left-sidebar .nav-list {
						display: flex;
						flex-direction: row;
						margin-bottom: 0;
						gap: 0.5rem;
					}
					.main-pane {
						padding: 1.5rem 1.25rem;
					}
					.btn-grid, .card-grid {
						grid-template-columns: 1fr;
					}
					.preview-box {
						padding: 2rem 1.25rem;
						min-height: 320px;
					}
				}

				@media (max-width: 640px) {
					.header-nav {
						display: none !important;
					}
					.main-header {
						padding: 1rem 1.25rem !important;
					}
				}
			`}</style>



			{/* Main Sticky Header */}
			<header 
				className="main-header" 
				style={{
					height: "var(--navbar-height)",
					position: "sticky",
					top: 0,
					zIndex: 100,
					borderBottom: "1px solid var(--border-color)",
					padding: "0 2rem",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					width: "100%"
				}}
			>
				<div className="header-logo">
					<span className="logo-orb"></span>
					<span>GlassUI <span className="badge">v1.1 WebGL</span></span>
				</div>
				
				<nav className="header-nav" style={{ display: "flex", gap: "1.5rem" }}>
					<a href="#home" className="nav-link" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Home</a>
					<a href="#installation" className="nav-link" onClick={(e) => { e.preventDefault(); document.getElementById('installation')?.scrollIntoView({ behavior: 'smooth' }); }}>Docs</a>
					<a href="#showcase" className="nav-link" onClick={(e) => { e.preventDefault(); document.getElementById('showcase')?.scrollIntoView({ behavior: 'smooth' }); }}>Components</a>
					<a href="#customize" className="nav-link" onClick={(e) => { e.preventDefault(); setCustomizerOpen(true); }}>Customize</a>
				</nav>

				<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
					{/* Fake search box */}
					<Panel 
						{...(mounted ? {
							"blur-amount": pgValues["blur"] * 0.5,
							"corner-radius": 8
						} : {})}
						onClick={() => setCustomizerOpen(true)}
						style={{
							border: "1px solid var(--border-color)",
							display: "flex",
							alignItems: "center",
							padding: "0.35rem 0.75rem",
							background: "var(--bg-tertiary)",
							cursor: "pointer"
						}}
					>
						<span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Search variables...</span>
					</Panel>

					{/* star count */}
					<Button 
						className="demo-button" 
						{...(mounted ? {
							"blur-amount": pgValues["blur"],
							"corner-radius": 8,
							"shadow-opacity": 0.1
						} : {})}
						onClick={() => alert("Thank you for starring GlassUI! ✨")}
						style={{
							border: "1px solid var(--border-color)",
							fontSize: "0.8rem",
							padding: "0.4rem 0.8rem",
							cursor: "pointer"
						}}
					>
						★ 11.7k
					</Button>

					{/* Theme Switcher Toggle */}
					<Button
						{...(mounted ? {
							"blur-amount": pgValues["blur"],
							"corner-radius": 8,
							"shadow-opacity": 0.1
						} : {})}
						onClick={toggleTheme}
						style={{
							border: "1px solid var(--border-color)",
							padding: "0.4rem",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							cursor: "pointer"
						}}
						title="Toggle Theme"
					>
						{theme === 'light' ? (
							<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
								<path d="M12 3c.132 0 .263 0 .393.007a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 2.999z"/>
							</svg>
						) : (
							<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
								<path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0-7a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 1 1-2 0v-2a1 1 0 0 1 1-1zM5.636 5.636a1 1 0 0 1 1.414 0l1.414 1.414a1 1 0 1 1-1.414 1.414L5.636 7.05a1 1 0 0 1 0-1.414zm11.314 11.314a1 1 0 0 1 1.414 0l1.414 1.414a1 1 0 1 1-1.414 1.414l-1.414-1.414a1 1 0 0 1 0-1.414zM3 11a1 1 0 1 1 0 2H1a1 1 0 1 1 0-2h2zm16 0a1 1 0 1 1 0 2h-2a1 1 0 1 1 0-2h2zM7.05 18.364a1 1 0 0 1 0 1.414l-1.414 1.414a1 1 0 1 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0zm11.314-11.314a1 1 0 0 1 0 1.414l-1.414 1.414a1 1 0 1 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0z"/>
							</svg>
						)}
					</Button>

					{/* Customizer Panel toggle */}
					<Button
						{...(mounted ? {
							"blur-amount": pgValues["blur"],
							"corner-radius": 8,
							"shadow-opacity": 0.1
						} : {})}
						onClick={() => setCustomizerOpen(true)}
						style={{
							border: "1px solid var(--border-color)",
							padding: "0.4rem",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							cursor: "pointer"
						}}
						title="Open Settings"
					>
						<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
							<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
						</svg>
					</Button>
				</div>
			</header>

			{/* Three-Column Documentation Layout */}
			<div className="layout-grid">
				
				{/* Left Sidebar */}
				<aside className="left-sidebar">
					<div className="nav-group-title">Getting Started</div>
					<ul className="nav-list">
						<li className="nav-item" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Introduction</li>
						<li className="nav-item" onClick={() => document.getElementById('installation')?.scrollIntoView({ behavior: 'smooth' })}>Installation</li>
						<li className="nav-item" onClick={() => document.getElementById('usage')?.scrollIntoView({ behavior: 'smooth' })}>Usage</li>
					</ul>

					<div className="nav-group-title">Components</div>
					<ul className="nav-list">
						<li 
							className={`nav-item ${currentComponent === "accordion" ? "active" : ""}`}
							onClick={() => { setCurrentComponent("accordion"); setPreviewTab("preview"); }}
						>
							Accordion
						</li>
						<li 
							className={`nav-item ${currentComponent === "button" ? "active" : ""}`}
							onClick={() => { setCurrentComponent("button"); setPreviewTab("preview"); }}
						>
							Button
						</li>
						<li 
							className={`nav-item ${currentComponent === "card" ? "active" : ""}`}
							onClick={() => { setCurrentComponent("card"); setPreviewTab("preview"); }}
						>
							Card
						</li>
						<li 
							className={`nav-item ${currentComponent === "input" ? "active" : ""}`}
							onClick={() => { setCurrentComponent("input"); setPreviewTab("preview"); }}
						>
							Input
						</li>
						<li 
							className={`nav-item ${currentComponent === "dialog" ? "active" : ""}`}
							onClick={() => { setCurrentComponent("dialog"); setPreviewTab("preview"); }}
						>
							Dialog
						</li>
					</ul>
				</aside>

				{/* Center Content Pane */}
				<main className="main-pane" id="showcase">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
						<div>
							<h1 style={{ fontSize: "2.5rem", fontWeight: 800, textTransform: "capitalize", marginBottom: "0.5rem" }}>
								{currentComponent}
							</h1>
							<p style={{ color: "#94a3b8", fontSize: "1.1rem", lineHeight: "1.6" }}>
								{currentComponent === "accordion" && "A vertically stacked set of interactive headings that each reveal a section of content."}
								{currentComponent === "button" && "Interactive buttons that support physical glass light refractions, specular highlights, and active clicks."}
								{currentComponent === "card" && "Glass panels designed to frame content, support mouse hover scales, and physics-based drag gestures."}
								{currentComponent === "input" && "Refractive inputs, dropdowns, and form control fields mapped directly into the WebGL backdrop."}
								{currentComponent === "dialog" && "A modal window overlay that floats above the primary view, refracting the layout underneath."}
							</p>
						</div>
						
						<Button 
							{...(mounted ? {
								"blur-amount": pgValues["blur"],
								"corner-radius": 8,
								"shadow-opacity": 0.1
							} : {})}
							style={{
								border: "1px solid rgba(255,255,255,0.06)",
								fontSize: "0.8rem",
								padding: "0.4rem 0.8rem",
								display: "flex",
								alignItems: "center",
								gap: "0.4rem"
							}}
						>
							Copy Page
						</Button>
					</div>

					{/* Tab selection for Preview / Code */}
					<div className="tab-bar-glass">
						<button 
							className={`tab-btn-glass ${previewTab === "preview" ? "active" : ""}`}
							onClick={() => setPreviewTab("preview")}
						>
							Preview
						</button>
						<button 
							className={`tab-btn-glass ${previewTab === "code" ? "active" : ""}`}
							onClick={() => setPreviewTab("code")}
						>
							Code
						</button>
					</div>

					{/* Live Component Preview Card */}
					<div className="preview-box">
						{/* Background image to highlight WebGL refraction */}
						<img src="/background-3.avif" alt="" className="preview-bg-image" />

						{previewTab === "preview" ? (
							<div id="component-container-root" style={{ width: "100%", display: "flex", justifyContent: "center", zIndex: 1 }}>
								
								{/* Accordion Showcase */}
								{currentComponent === "accordion" && (
									<div className="showcase-accordion">
										{[
											{ q: "What are your shipping options?", a: "We offer standard (5-7 days), express (2-3 days), and overnight shipping. Free shipping on international orders." },
											{ q: "What is your return policy?", a: "You can return any unused item within 30 days of purchase for a full refund. No questions asked." },
											{ q: "How can I contact customer support?", a: "Our support team is available 24/7 via live chat or email at support@glassui.dev." }
										].map((item, idx) => (
											<Panel 
												key={idx}
												className={`accordion-row-panel ${activeAccordion === idx ? "open" : ""}`}
												{...(mounted ? {
													"blur-amount": pgValues["blur"],
													refraction: pgValues["refraction"],
													chroma: pgValues["chroma"],
													"edge-highlight": pgValues["edge-highlight"],
													specular: pgValues["specular"],
													fresnel: pgValues["fresnel"],
													distortion: pgValues["distortion"],
													"corner-radius": pgValues["corner-radius"],
													"z-radius": pgValues["z-radius"],
													opacity: pgValues["opacity"],
													saturation: pgValues["saturation"],
													brightness: pgValues["brightness"],
													"shadow-opacity": pgValues["shadow-opacity"],
													"shadow-spread": pgValues["shadow-spread"],
													"bevel-mode": pgValues["bevel-mode"]
												} : {})}
											>
												<div className="accordion-header" onClick={() => setActiveAccordion(activeAccordion === idx ? null : idx)}>
													<span>{item.q}</span>
													<svg className="accordion-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
														<polyline points="6 9 12 15 18 9"></polyline>
													</svg>
												</div>
												<div className="accordion-content">
													{item.a}
												</div>
											</Panel>
										))}
									</div>
								)}

								{/* Button Showcase */}
								{currentComponent === "button" && (
									<div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "2.5rem", zIndex: 1 }}>
										{/* Section 1: Interactive Buttons */}
										<div>
											<h4 style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-secondary)", marginBottom: "1rem" }}>
												Refractive Control Buttons
											</h4>
											<div className="btn-grid">
												<Button 
													className="showcase-btn"
													{...(mounted ? {
														"blur-amount": pgValues["blur"],
														refraction: pgValues["refraction"],
														chroma: pgValues["chroma"],
														"edge-highlight": pgValues["edge-highlight"],
														"corner-radius": pgValues["corner-radius"],
														"shadow-opacity": pgValues["shadow-opacity"]
													} : {})}
													style={{
														display: "inline-flex",
														alignItems: "center",
														justifyContent: "center",
														gap: "0.5rem",
														cursor: "pointer"
													}}
													onClick={() => alert("Welcome to GlassUI! Get Started triggered. 🚀")}
												>
													Get Started
													<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transition: "transform 0.2s" }} className="arrow-icon">
														<line x1="5" y1="12" x2="19" y2="12"></line>
														<polyline points="12 5 19 12 12 19"></polyline>
													</svg>
												</Button>
												<Button 
													className="showcase-btn"
													{...(mounted ? {
														"blur-amount": pgValues["blur"],
														refraction: pgValues["refraction"],
														chroma: pgValues["chroma"],
														"edge-highlight": pgValues["edge-highlight"],
														"corner-radius": pgValues["corner-radius"],
														"shadow-opacity": pgValues["shadow-opacity"],
														brightness: -0.15
													} : {})}
													style={{
														display: "inline-flex",
														alignItems: "center",
														justifyContent: "center",
														gap: "0.5rem",
														cursor: "pointer"
													}}
													onClick={() => window.open("https://github.com", "_blank")}
												>
													<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
														<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
													</svg>
													GitHub Source
												</Button>
											</div>
										</div>

										{/* Section 2: Magnetic Icon Buttons */}
										<div>
											<h4 style={{ fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-secondary)", marginBottom: "1rem" }}>
												Magnetic Icon Controls
											</h4>
											<div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
												<MagneticButton 
													mounted={mounted}
													className="showcase-btn"
													{...({
														"blur-amount": pgValues["blur"],
														refraction: pgValues["refraction"],
														chroma: pgValues["chroma"],
														"edge-highlight": pgValues["edge-highlight"],
														"corner-radius": 99,
														"shadow-opacity": pgValues["shadow-opacity"]
													} as any)}
													style={{
														width: "48px",
														height: "48px",
														padding: 0,
														borderRadius: "50%",
														cursor: "pointer"
													}}
													onClick={() => setCustomizerOpen(true)}
													title="Open Settings"
												>
													<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
														<path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.44.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
													</svg>
												</MagneticButton>

												<MagneticButton 
													mounted={mounted}
													className="showcase-btn"
													{...({
														"blur-amount": pgValues["blur"],
														refraction: pgValues["refraction"],
														chroma: pgValues["chroma"],
														"edge-highlight": pgValues["edge-highlight"],
														"corner-radius": 99,
														"shadow-opacity": pgValues["shadow-opacity"]
													} as any)}
													style={{
														width: "48px",
														height: "48px",
														padding: 0,
														borderRadius: "50%",
														cursor: "pointer"
													}}
													onClick={() => alert("Notification center opened! 🔔")}
													title="Notifications"
												>
													<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
														<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"></path>
													</svg>
												</MagneticButton>

												<MagneticButton 
													mounted={mounted}
													className="showcase-btn"
													{...({
														"blur-amount": pgValues["blur"],
														refraction: pgValues["refraction"],
														chroma: pgValues["chroma"],
														"edge-highlight": pgValues["edge-highlight"],
														"corner-radius": 99,
														"shadow-opacity": pgValues["shadow-opacity"]
													} as any)}
													style={{
														width: "48px",
														height: "48px",
														padding: 0,
														borderRadius: "50%",
														cursor: "pointer"
													}}
													onClick={() => alert("Message center opened! ✉️")}
													title="Inbox"
												>
													<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
														<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
														<polyline points="22,6 12,13 2,6"></polyline>
													</svg>
												</MagneticButton>
											</div>
										</div>
									</div>
								)}

								{/* Card Showcase */}
								{currentComponent === "card" && (
									<div className="card-grid">
										<Panel 
											className="showcase-card"
											{...(mounted ? {
												"blur-amount": pgValues["blur"],
												refraction: pgValues["refraction"],
												chroma: pgValues["chroma"],
												"edge-highlight": pgValues["edge-highlight"],
												"corner-radius": pgValues["corner-radius"],
												"shadow-opacity": pgValues["shadow-opacity"]
											} : {})}
										>
											<h3>Frosted Card</h3>
											<p>A static glass panel with border shadows and sharp edge reflection.</p>
										</Panel>
										<Panel 
											className="showcase-card"
											{...(mounted ? {
												floating: true,
												"blur-amount": pgValues["blur"],
												refraction: pgValues["refraction"] * 1.3,
												chroma: pgValues["chroma"],
												"edge-highlight": pgValues["edge-highlight"] * 1.5,
												"corner-radius": pgValues["corner-radius"],
												"shadow-opacity": pgValues["shadow-opacity"]
											} : {})}
										>
											<h3>Drag Me (Refractive)</h3>
											<p>This panel uses spring-physics drag mapping to slide over elements underneath.</p>
										</Panel>
									</div>
								)}

								{/* Input Showcase */}
								{currentComponent === "input" && (
									<div className="input-form">
										<div className="input-group">
											<label>Email Address</label>
											<Panel 
												className="showcase-input-panel"
												{...(mounted ? {
													"blur-amount": pgValues["blur"] * 0.5,
													"corner-radius": 10
												} : {})}
											>
												<input type="text" className="showcase-input" placeholder="you@glassui.dev" />
											</Panel>
										</div>
										<div className="input-group">
											<label>Password</label>
											<Panel 
												className="showcase-input-panel"
												{...(mounted ? {
													"blur-amount": pgValues["blur"] * 0.5,
													"corner-radius": 10
												} : {})}
											>
												<input type="password" className="showcase-input" placeholder="••••••••••••" />
											</Panel>
										</div>
									</div>
								)}

								{/* Dialog Showcase */}
								{currentComponent === "dialog" && (
									<div>
										<Button 
											className="showcase-btn"
											{...(mounted ? {
												"blur-amount": pgValues["blur"],
												refraction: pgValues["refraction"],
												"corner-radius": 12,
												"shadow-opacity": 0.2
											} : {})}
											onClick={() => setDialogOpen(true)}
										>
											Open Dialog Window
										</Button>
									</div>
								)}

							</div>
						) : (
							<div style={{ width: "100%", zIndex: 1, textAlign: "left" }}>
								<pre className="code-block-pane"><code style={{ fontFamily: "var(--font-mono)", color: "#cbd5e1" }}>{getCodeTemplate()}</code></pre>
							</div>
						)}
					</div>

					{/* Installation Section */}
					<h2 id="installation" style={{ fontSize: "1.65rem", fontWeight: 700, marginBottom: "1rem" }}>Installation</h2>
					<div className="tab-bar-glass" style={{ marginBottom: "1rem" }}>
						<button className={`tab-btn-glass ${installTab === "pnpm" ? "active" : ""}`} onClick={() => setInstallTab("pnpm")}>pnpm</button>
						<button className={`tab-btn-glass ${installTab === "npm" ? "active" : ""}`} onClick={() => setInstallTab("npm")}>npm</button>
						<button className={`tab-btn-glass ${installTab === "yarn" ? "active" : ""}`} onClick={() => setInstallTab("yarn")}>yarn</button>
					</div>

					<div style={{ width: "100%", zIndex: 1, textAlign: "left", marginBottom: "2.5rem" }}>
						<pre className="code-block-pane"><code style={{ fontFamily: "var(--font-mono)", color: "#38bdf8" }}>
							{installTab === "pnpm" && `pnpm dlx liquidglass-ui@latest add ${currentComponent}`}
							{installTab === "npm" && `npx liquidglass-ui@latest add ${currentComponent}`}
							{installTab === "yarn" && `yarn dlx liquidglass-ui@latest add ${currentComponent}`}
						</code></pre>
					</div>

					{/* Usage Section */}
					<h2 id="usage" style={{ fontSize: "1.65rem", fontWeight: 700, marginBottom: "1rem" }}>Usage</h2>
					<p style={{ color: "#94a3b8", fontSize: "0.95rem", lineHeight: "1.6", marginBottom: "1.5rem" }}>
						Import the component inside your client-side files and wrap them within a <code>glass-container</code> node:
					</p>

					<div style={{ width: "100%", zIndex: 1, textAlign: "left" }}>
						<pre className="code-block-pane"><code style={{ fontFamily: "var(--font-mono)", color: "#cbd5e1" }}>{`import { ${currentComponent.charAt(0).toUpperCase() + currentComponent.slice(1)} } from 'liquidglass-ui';

export default function App() {
  return (
    <glass-container>
      <${currentComponent.charAt(0).toUpperCase() + currentComponent.slice(1)} />
    </glass-container>
  );
}`}</code></pre>
					</div>
				</main>

				{/* Right Sidebar */}
				<aside className="right-sidebar">
					<div className="nav-group-title" style={{ marginBottom: "1rem" }}>On This Page</div>
					<ul className="nav-list" style={{ gap: "0.5rem" }}>
						<li className="nav-item" style={{ fontSize: "0.85rem", padding: 0 }} onClick={() => document.getElementById('installation')?.scrollIntoView({ behavior: 'smooth' })}>Installation</li>
						<li className="nav-item" style={{ fontSize: "0.85rem", padding: 0 }} onClick={() => document.getElementById('usage')?.scrollIntoView({ behavior: 'smooth' })}>Usage</li>
					</ul>

					{/* secondary call card */}
					<Panel 
						{...(mounted ? {
							"blur-amount": pgValues["blur"],
							refraction: pgValues["refraction"] * 0.5,
							"corner-radius": 16,
							"shadow-opacity": 0.15
						} : {})}
						style={{
							marginTop: "3rem",
							padding: "1.25rem",
							border: "1px solid rgba(255,255,255,0.06)",
							background: "rgba(255,255,255,0.01)"
						}}
					>
						<h4 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.5rem" }}>WebGL Refractions</h4>
						<p style={{ fontSize: "0.75rem", color: "#64748b", lineHeight: "1.4", marginBottom: "1rem" }}>
							Tweak the settings panel variables to adjust chromatic aberration, edge reflections, and blur.
						</p>
						<Button 
							{...(mounted ? {
								"blur-amount": pgValues["blur"],
								"corner-radius": 8
							} : {})}
							onClick={() => setCustomizerOpen(true)}
							style={{
								width: "100%",
								fontSize: "0.75rem",
								padding: "0.5rem 0",
								border: "1px solid rgba(255,255,255,0.08)",
								cursor: "pointer"
							}}
						>
							Open Settings Panel
						</Button>
					</Panel>
				</aside>
			</div>

			{/* Settings Customizer Slide-over Panel */}
			{customizerOpen && (
				<div 
					className="dialog-backdrop" 
					style={{ justifyContent: "flex-end", padding: 0 }}
					onClick={() => setCustomizerOpen(false)}
				>
					<Panel 
						className={`customizer-drawer ${customizerOpen ? "open" : ""}`}
						onClick={(e: React.MouseEvent) => e.stopPropagation()}
						{...(mounted ? {
							"blur-amount": pgValues["blur"] * 1.5,
							refraction: pgValues["refraction"] * 0.4,
							chroma: pgValues["chroma"] * 0.5,
							"edge-highlight": pgValues["edge-highlight"],
							"corner-radius": 0,
							"z-radius": 20,
							"shadow-opacity": 0.25
						} : {})}
						style={{
							backgroundColor: theme === 'light' ? "rgba(255,255,255,0.75)" : "rgba(10,12,18,0.7)"
						}}
					>
						<div className="customizer-header">
							<h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Theme Customizer</h3>
							<Button 
								{...(mounted ? {
									"blur-amount": pgValues["blur"],
									"corner-radius": 6
								} : {})}
								onClick={() => setCustomizerOpen(false)}
								style={{
									border: "1px solid rgba(255,255,255,0.08)",
									padding: "0.3rem 0.6rem",
									fontSize: "0.75rem",
									cursor: "pointer"
								}}
							>
								Close
							</Button>
						</div>

						<div className="customizer-body">
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
								<span style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Restore default options</span>
								<Button 
									{...(mounted ? {
										"blur-amount": pgValues["blur"],
										"corner-radius": 6
									} : {})}
									onClick={resetConfig}
									style={{
										border: "1px solid rgba(255,255,255,0.08)",
										padding: "0.3rem 0.75rem",
										fontSize: "0.75rem",
										cursor: "pointer"
									}}
								>
									Reset
								</Button>
							</div>

							{pgParams.map((p) => (
								<div className="slider-control" key={p.key} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
									<div className="slider-info" style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
										<span className="slider-label" style={{ color: "#94a3b8" }}>{p.label}</span>
										<span className="slider-value" style={{ color: "#06b6d4", fontFamily: "var(--font-mono)" }}>{pgValues[p.key]}</span>
									</div>
									<input 
										type="range"
										min={p.min}
										max={p.max}
										step={p.step}
										value={pgValues[p.key]}
										onChange={(e) => updateConfig(p.key, parseFloat(e.target.value))}
										style={{ width: "100%", height: "4px" }}
									/>
								</div>
							))}
						</div>
					</Panel>
				</div>
			)}



			{/* Main Footer */}
			<footer 
				style={{
					borderTop: "1px solid var(--border-color)",
					padding: "2rem",
					textAlign: "center",
					fontSize: "0.85rem",
					color: "var(--text-muted)",
					position: "relative",
					zIndex: 1,
					background: "var(--bg-secondary)"
				}}
			>
				<p>GlassUI Component Library • Built with WebGL2 and Next.js</p>
			</footer>
			{/* Dialog Modal (Rendered at root container level to align scroll backdrop layers and prevent stale sibling clones) */}
			{dialogOpen && (
				<div className="dialog-backdrop" onClick={() => setDialogOpen(false)}>
					<Panel 
						className="dialog-pane" 
						onClick={(e: React.MouseEvent) => e.stopPropagation()}
						{...(mounted ? {
							"blur-amount": pgValues["blur"] * 1.5,
							refraction: pgValues["refraction"] * 1.2,
							chroma: pgValues["chroma"] * 1.4,
							"edge-highlight": pgValues["edge-highlight"],
							specular: pgValues["specular"],
							fresnel: pgValues["fresnel"],
							"corner-radius": 24,
							"z-radius": 50,
							"shadow-opacity": 0.4
						} : {})}
					>
						<h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.75rem" }}>Glass UI Modal</h2>
						<p style={{ color: "#94a3b8", fontSize: "0.9rem", lineHeight: "1.6", marginBottom: "2rem" }}>
							This dialog component overlays the viewport, applying high-fidelity physical refraction and aberration to any layout underneath.
						</p>
						<Button 
							{...(mounted ? {
								"blur-amount": pgValues["blur"],
								"corner-radius": 8
							} : {})}
							style={{
								border: "1px solid rgba(255,255,255,0.08)",
								padding: "0.6rem 1.5rem",
								fontSize: "0.85rem"
							}}
							onClick={() => setDialogOpen(false)}
						>
							Close Modal
						</Button>
					</Panel>
				</div>
			)}
		</Container>
	);
}
