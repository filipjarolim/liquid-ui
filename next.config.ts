import path from 'node:path';
import type { NextConfig } from 'next';

const root = __dirname;
const alias = (sub: string) => path.join(root, sub);

const nextConfig: NextConfig = {
	// Relative aliases — Turbopack rejects absolute paths for resolveAlias.
	turbopack: {
		resolveAlias: {
			'liquidglass-ui': './dist/index.js',
			'liquidglass-ui/elements': './dist/elements.js',
			'liquidglass-ui/react': './dist/react.js',
			'liquidglass-ui/styles/glass-theme.css': './styles/glass-theme.css',
			'liquidglass-ui/styles/glass-ui.css': './styles/glass-ui.css',
		},
	},
	webpack(config) {
		config.resolve.alias = {
			...config.resolve.alias,
			'liquidglass-ui': alias('dist/index.js'),
			'liquidglass-ui/elements': alias('dist/elements.js'),
			'liquidglass-ui/react': alias('dist/react.js'),
			'liquidglass-ui/styles/glass-theme.css': alias('styles/glass-theme.css'),
			'liquidglass-ui/styles/glass-ui.css': alias('styles/glass-ui.css'),
		};
		return config;
	},
};

export default nextConfig;
