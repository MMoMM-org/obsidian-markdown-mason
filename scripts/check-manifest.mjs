import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(__dirname, '..', 'manifest.json');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const failures = [];

if (manifest.isDesktopOnly !== true) {
	failures.push(`isDesktopOnly must be true (got: ${manifest.isDesktopOnly})`);
}

if (manifest.id.toLowerCase().includes('obsidian')) {
	failures.push(`id must not contain "obsidian" (got: "${manifest.id}")`);
}

if (!manifest.description.endsWith('.')) {
	failures.push(`description must end with "." (got: "${manifest.description}")`);
}

if (/\bobsidian\b/i.test(manifest.description)) {
	failures.push(`description must not contain the word "Obsidian" (got: "${manifest.description}")`);
}

if (failures.length > 0) {
	console.error('manifest.json compliance failures:');
	for (const msg of failures) {
		console.error(`  - ${msg}`);
	}
	process.exit(1);
}

console.log('manifest.json passed all compliance checks.');
