#!/usr/bin/env node
/**
 * Sync src/components/glass → registry/files/components/glass
 * so CLI `add` always ships the latest component sources.
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src/components/glass');
const dest = join(root, 'registry/files/components/glass');

if (!existsSync(src)) {
	console.error('sync-registry: src/components/glass not found');
	process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true, force: true });

// utils + types
cpSync(join(root, 'src/lib/utils.ts'), join(root, 'registry/files/lib/utils.ts'), { force: true });
mkdirSync(join(root, 'registry/files/types'), { recursive: true });
cpSync(join(root, 'src/types/liquidglass.d.ts'), join(root, 'registry/files/types/liquidglass.d.ts'), { force: true });

console.log('✔ registry synced from src');
