import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Resolve the local package via package.json exports (file:../.. dependency).
const pkgRoot = path.resolve(__dirname, '../..');

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		preserveSymlinks: true,
		dedupe: ['react', 'react-dom'],
	},
	server: {
		fs: { allow: [pkgRoot] },
	},
});
