#!/usr/bin/env node
/**
 * liquidglass-ui CLI
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const args = process.argv.slice(2);
const command = args[0];
const flags = parseFlags(args.slice(1));

function parseFlags(argv) {
	const f = { cwd: process.cwd(), yes: false, overwrite: false, force: false };
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '-y' || a === '--yes') f.yes = true;
		else if (a === '-o' || a === '--overwrite') f.overwrite = true;
		else if (a === '-f' || a === '--force') f.force = true;
		else if (a === '-c' || a === '--cwd') f.cwd = resolve(argv[++i] ?? '.');
		else if (!a.startsWith('-')) rest.push(a);
	}
	f.rest = rest;
	return f;
}

function log(msg) { console.log(msg); }
function warn(msg) { console.warn(`⚠ ${msg}`); }
function ok(msg) { console.log(`✔ ${msg}`); }

function readPkg(cwd) {
	const p = join(cwd, 'package.json');
	if (!existsSync(p)) return null;
	try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function isSelfPackage(cwd) {
	const pkg = readPkg(cwd);
	return pkg?.name === 'liquidglass-ui';
}

function hasLiquidGlassInstalled(cwd) {
	return existsSync(join(cwd, 'node_modules/liquidglass-ui/package.json'));
}

function ensureDistBuilt() {
	if (existsSync(join(PACKAGE_ROOT, 'dist/index.js'))) return;
	log('Building liquidglass-ui dist…');
	execSync('npm run build:lib', { cwd: PACKAGE_ROOT, stdio: 'inherit' });
}

function resolveLiquidGlassSpec(cwd) {
	if (isSelfPackage(cwd)) return null;
	if (hasLiquidGlassInstalled(cwd)) return null;
	// Local development: install from CLI package root via file: protocol
	if (cwd !== PACKAGE_ROOT && existsSync(join(PACKAGE_ROOT, 'package.json'))) {
		return `file:${PACKAGE_ROOT}`;
	}
	return 'liquidglass-ui';
}

function loadRegistry() {
	return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'registry/registry.json'), 'utf8'));
}

function loadComponentsJson(cwd) {
	const p = join(cwd, 'components.json');
	if (!existsSync(p)) return null;
	return JSON.parse(readFileSync(p, 'utf8'));
}

function detectPackageManager(cwd) {
	if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
	if (existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))) return 'bun';
	if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
	return 'npm';
}

function runInstall(cwd, pm, packages) {
	const filtered = packages.filter(Boolean);
	if (!filtered.length) return;
	const cmd = {
		pnpm: `pnpm add ${filtered.join(' ')}`,
		npm: `npm install ${filtered.join(' ')}`,
		yarn: `yarn add ${filtered.join(' ')}`,
		bun: `bun add ${filtered.join(' ')}`,
	}[pm];
	log(`\nInstalling (${pm}): ${filtered.join(', ')}`);
	try {
		execSync(cmd, { cwd, stdio: 'inherit' });
	} catch (err) {
		warn(`Install failed. Install manually:\n  ${cmd}`);
		if (filtered.some((p) => p.startsWith('file:'))) {
			log(`  Or from npm after publish: npm install liquidglass-ui`);
		}
	}
}

function detectFramework(cwd) {
	if (existsSync(join(cwd, 'next.config.ts')) || existsSync(join(cwd, 'next.config.js')) || existsSync(join(cwd, 'next.config.mjs'))) {
		return { name: 'next', rsc: true };
	}
	if (existsSync(join(cwd, 'vite.config.ts')) || existsSync(join(cwd, 'vite.config.js'))) {
		return { name: 'vite', rsc: false };
	}
	if (existsSync(join(cwd, 'astro.config.mjs')) || existsSync(join(cwd, 'astro.config.ts'))) {
		return { name: 'astro', rsc: false };
	}
	return { name: 'react', rsc: false };
}

function defaultAliases() {
	return {
		components: '@/components',
		utils: '@/lib/utils',
		glass: '@/components/glass',
		lib: '@/lib',
		hooks: '@/hooks',
	};
}

function defaultCssPath(cwd, framework) {
	if (framework.name === 'next') return 'src/app/globals.css';
	if (existsSync(join(cwd, 'src/index.css'))) return 'src/index.css';
	return 'src/app.css';
}

function glassCssImports(cwd) {
	return [
		'@import "tailwindcss";',
		'@import "liquidglass-ui/styles/glass-theme.css";',
		'@import "liquidglass-ui/styles/glass-ui.css";',
	];
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

function copyRegistryFile(srcRel, destAbs, overwrite) {
	const src = join(PACKAGE_ROOT, 'registry/files', srcRel);
	if (!existsSync(src)) {
		warn(`Registry file missing: ${srcRel}`);
		return false;
	}
	if (existsSync(destAbs) && !overwrite) {
		warn(`Skipped (exists): ${relative(flags.cwd, destAbs)}`);
		return false;
	}
	ensureDir(dirname(destAbs));
	copyFileSync(src, destAbs);
	ok(`Added ${relative(flags.cwd, destAbs)}`);
	return true;
}

function destPathForRegistryFile(cwd, rel) {
	if (rel.startsWith('components/glass/')) {
		return join(cwd, 'src/components/glass', rel.replace('components/glass/', ''));
	}
	if (rel.startsWith('lib/')) return join(cwd, 'src', rel);
	if (rel.startsWith('types/')) return join(cwd, 'src', rel);
	if (rel.startsWith('vanilla/')) return join(cwd, 'public', rel.replace('vanilla/', 'glass-'));
	return join(cwd, 'src', rel);
}

function writeGlassProvider(cwd, framework) {
	const providerPath = join(cwd, 'src/lib/glass-provider.tsx');
	if (existsSync(providerPath) && !flags.overwrite) return;

	if (framework.name === 'next') {
		writeFileSync(providerPath, `'use client';

/** Registers WebGL custom elements — import once in root layout. */
import 'liquidglass-ui/elements';

export function GlassProvider({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}
`);
		ok('Created src/lib/glass-provider.tsx');
		return;
	}

	writeFileSync(join(cwd, 'src/lib/glass-init.ts'), `/** Registers WebGL custom elements — import once at app entry. */
import 'liquidglass-ui/elements';
`);
	ok('Created src/lib/glass-init.ts');
}

function resolveItemDeps(registry, names) {
	const byName = Object.fromEntries(registry.items.map((i) => [i.name, i]));
	const out = [];
	const seen = new Set();
	function visit(name) {
		if (seen.has(name)) return;
		const item = byName[name];
		if (!item) { warn(`Unknown component: ${name}`); return; }
		for (const dep of item.registryDependencies ?? []) visit(dep);
		if (!seen.has(name)) { seen.add(name); out.push(item); }
	}
	for (const n of names) visit(n);
	return out;
}

function cmdInit() {
	const cwd = flags.cwd;
	ensureDistBuilt();

	const configPath = join(cwd, 'components.json');
	if (existsSync(configPath) && !flags.force) {
		warn('components.json already exists. Use --force to overwrite.');
	} else {
		const framework = detectFramework(cwd);
		const config = {
			$schema: './node_modules/liquidglass-ui/registry/schema.json',
			style: 'default',
			framework: framework.name,
			rsc: framework.rsc,
			tsx: true,
			tailwind: {
				config: '',
				css: defaultCssPath(cwd, framework),
				baseColor: 'neutral',
				cssVariables: true,
			},
			aliases: defaultAliases(),
		};
		writeFileSync(configPath, JSON.stringify(config, null, '\t') + '\n');
		ok('Created components.json');
	}

	const framework = detectFramework(cwd);
	const cssPath = loadComponentsJson(cwd)?.tailwind?.css ?? defaultCssPath(cwd, framework);
	const cssAbs = join(cwd, cssPath);
	ensureDir(dirname(cssAbs));

	const imports = glassCssImports(cwd);
	let css = existsSync(cssAbs) ? readFileSync(cssAbs, 'utf8') : '';
	for (const line of imports) {
		if (!css.includes(line)) css = `${line}\n${css}`;
	}
	writeFileSync(cssAbs, css);
	ok(`Updated ${cssPath}`);

	copyRegistryFile('lib/utils.ts', join(cwd, 'src/lib/utils.ts'), flags.overwrite || !existsSync(join(cwd, 'src/lib/utils.ts')));

	const postcssPath = join(cwd, 'postcss.config.mjs');
	if (!existsSync(postcssPath)) {
		writeFileSync(postcssPath, `const config = {\n\tplugins: {\n\t\t'@tailwindcss/postcss': {},\n\t},\n};\nexport default config;\n`);
		ok('Created postcss.config.mjs');
	}

	writeGlassProvider(cwd, framework);

	const pm = detectPackageManager(cwd);
	const deps = [
		resolveLiquidGlassSpec(cwd),
		'tailwindcss',
		'@tailwindcss/postcss',
		'clsx',
		'tailwind-merge',
	].filter((d) => d !== null);

	if (!isSelfPackage(cwd)) {
		runInstall(cwd, pm, deps);
	} else {
		ok('Self-package — skipped liquidglass-ui install');
	}

	log('\nGlassUI initialized.');
	log(`  ${pm} exec liquidglass-ui add glass-chip glass-header`);
	log('  Import in layout: import { GlassProvider } from "@/lib/glass-provider"');
}

function cmdAdd() {
	const cwd = flags.cwd;
	ensureDistBuilt();

	const config = loadComponentsJson(cwd);
	if (!config) {
		warn('Run `liquidglass-ui init` first.');
		process.exit(1);
	}

	const names = flags.rest;
	if (!names.length) {
		warn('Usage: liquidglass-ui add <component> [component...]');
		process.exit(1);
	}

	const registry = loadRegistry();
	const items = resolveItemDeps(registry, names);
	const allDeps = new Set();

	for (const item of items) {
		log(`\nAdding ${item.name}…`);
		for (const file of item.files) {
			copyRegistryFile(file.path, destPathForRegistryFile(cwd, file.path), flags.overwrite);
		}
		for (const d of item.dependencies ?? []) {
			if (d !== 'liquidglass-ui') allDeps.add(d);
		}
	}

	const spec = resolveLiquidGlassSpec(cwd);
	if (spec) allDeps.add(spec);

	if (!isSelfPackage(cwd) && allDeps.size) {
		runInstall(cwd, detectPackageManager(cwd), [...allDeps]);
	}

	log('\nDone.');
	log('  import "liquidglass-ui/elements"  — once at app entry');
	log(`  import { GlassChip } from "${config.aliases?.glass ?? '@/components/glass'}"`);
}

function cmdList() {
	const registry = loadRegistry();
	log('\nAvailable components:\n');
	for (const item of registry.items) {
		log(`  ${item.name.padEnd(22)} ${item.description}`);
	}
}

function cmdInfo() {
	const cwd = flags.cwd;
	const config = loadComponentsJson(cwd);
	const pm = detectPackageManager(cwd);
	log('\nGlassUI project info\n');
	log(`  Package manager:  ${pm}`);
	log(`  Framework:        ${detectFramework(cwd).name}`);
	log(`  Self-package:     ${isSelfPackage(cwd) ? 'yes' : 'no'}`);
	log(`  liquidglass-ui:   ${hasLiquidGlassInstalled(cwd) ? 'installed' : 'not installed'}`);
	if (config) {
		log(`  CSS:              ${config.tailwind?.css}`);
		log(`  Glass alias:      ${config.aliases?.glass}`);
	}
	const pkg = require(join(PACKAGE_ROOT, 'package.json'));
	log(`  CLI version:      ${pkg.version}`);
}

function cmdHelp() {
	log(`
liquidglass-ui — Liquid glass component library

Commands:
  init              Initialize project (components.json, Tailwind, glass CSS)
  add <names...>    Add components from registry
  list              List available components
  info              Show project info

Options: -c/--cwd  -o/--overwrite  -f/--force  -y/--yes

Package managers: pnpm, npm, yarn, bun

Examples:
  pnpm dlx liquidglass-ui@latest init
  npx liquidglass-ui@latest add glass-chip glass-header
  bunx liquidglass-ui@latest add glass-widget vanilla-starter

Local (unpublished):
  node /path/to/liquidglass-ui/cli/index.mjs init -c ./my-app
  cd my-app && npm install file:/path/to/liquidglass-ui

Vanilla HTML:
  import 'liquidglass-ui/elements';
  <glass-panel blur-amount="0.62" refraction="0.6">Hello</glass-panel>

React:
  import { GlassChip, buildGlassProps } from 'liquidglass-ui/react';
`);
}

try {
	switch (command) {
		case 'init':
		case 'create': cmdInit(); break;
		case 'add': cmdAdd(); break;
		case 'list':
		case 'search': cmdList(); break;
		case 'info': cmdInfo(); break;
		case undefined:
		case 'help':
		case '-h':
		case '--help': cmdHelp(); break;
		default:
			warn(`Unknown command: ${command}`);
			cmdHelp();
			process.exit(1);
	}
} catch (err) {
	console.error(err);
	process.exit(1);
}
