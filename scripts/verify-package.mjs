#!/usr/bin/env node
/**
 * Verify the published package surface resolves and dist is present.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
	'dist/index.js',
	'dist/index.d.ts',
	'dist/elements.js',
	'dist/elements.d.ts',
	'dist/react.js',
	'dist/react.d.ts',
	'styles/glass-theme.css',
	'styles/glass-ui.css',
	'registry/registry.json',
	'cli/index.mjs',
];

let ok = true;
for (const f of required) {
	const p = join(root, f);
	if (!existsSync(p)) {
		console.error(`✗ missing ${f}`);
		ok = false;
	} else {
		console.log(`✔ ${f}`);
	}
}

if (!ok) process.exit(1);
console.log('\nPackage surface OK');
