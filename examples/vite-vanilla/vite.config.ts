import path from 'node:path';
import { defineConfig } from 'vite';

const pkgRoot = path.resolve(__dirname, '../..');

export default defineConfig({
	resolve: {
		preserveSymlinks: true,
	},
	server: {
		fs: { allow: [pkgRoot] },
	},
});
