import { GlassChip, GlassRoot, buildGlassProps, DEFAULT_GLASS_CONFIG } from 'liquidglass-ui/react';

const pg = buildGlassProps(DEFAULT_GLASS_CONFIG as unknown as Record<string, number>);

export default function App() {
	return (
		<GlassRoot id="glass-page-root" className="min-h-screen p-8">
			<div className="mx-auto flex max-w-lg flex-col gap-6">
				<h1 className="text-2xl font-semibold">LiquidGlass — Vite + React</h1>
				<p className="text-sm opacity-80">
					Consuming <code>liquidglass-ui</code> from <code>file:../..</code>
				</p>
				<GlassChip {...pg} className="rounded-2xl px-6 py-4">
					<span>Glass chip from liquidglass-ui/react</span>
				</GlassChip>
			</div>
		</GlassRoot>
	);
}
