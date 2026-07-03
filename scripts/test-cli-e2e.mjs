#!/usr/bin/env node
/**
 * End-to-end CLI smoke test in a temp directory.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'cli/index.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'liquidglass-cli-'));

try {
	execSync('npm run build:lib', { cwd: root, stdio: 'inherit' });

	// Minimal Next.js marker so init creates glass-provider.tsx
	execSync(`printf '%s\\n' "export default {}" > "${join(tmp, 'next.config.ts')}"`, { shell: true });

	execSync(`node "${cli}" init -c "${tmp}" -f`, { stdio: 'inherit' });
	execSync(`node "${cli}" add glass-chip glass-header -c "${tmp}"`, { stdio: 'inherit' });

	const chip = join(tmp, 'src/components/glass/GlassChip.tsx');
	const provider = join(tmp, 'src/lib/glass-provider.tsx');
	for (const f of [chip, provider, join(tmp, 'components.json')]) {
		if (!existsSync(f)) throw new Error(`missing ${f}`);
	}
	console.log('\n✔ CLI e2e OK');
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
