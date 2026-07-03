import { defineConfig } from 'tsup';

export default defineConfig({
	entry: {
		index: 'src/index.ts',
		elements: 'src/elements.ts',
		react: 'src/react.ts',
	},
	format: ['esm'],
	dts: {
		resolve: true,
	},
	tsconfig: 'tsconfig.build.json',
	splitting: false,
	sourcemap: true,
	clean: true,
	external: ['react', 'react-dom', 'html-to-image'],
	target: 'es2020',
});
