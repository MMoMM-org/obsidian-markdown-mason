import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Pure validation function — no I/O, no side effects.
 * @param {unknown} manifest
 * @returns {string[]} List of failure messages; empty means compliant.
 */
export function checkManifest(manifest) {
	const failures = [];

	if (typeof manifest.id !== 'string') {
		failures.push('id is missing or not a string');
	} else if (manifest.id.toLowerCase().includes('obsidian')) {
		failures.push(`id must not contain 'obsidian' (got: "${manifest.id}")`);
	}

	// author must NOT contain an email address — the submission bot rejects it
	if (typeof manifest.author === 'string' && /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(manifest.author)) {
		failures.push(`author must not contain an email address (got: "${manifest.author}"); use authorUrl for contact`);
	}

	if (typeof manifest.description !== 'string') {
		failures.push('description is missing or not a string');
	} else {
		if (manifest.description.length > 250) {
			failures.push(`description must be 250 characters or fewer (got: ${manifest.description.length})`);
		}
		if (!manifest.description.endsWith('.')) {
			failures.push(`description must end with '.' (got: "${manifest.description}")`);
		}
		if (/\bobsidian\b/i.test(manifest.description)) {
			failures.push(`description must not contain the word 'Obsidian' (got: "${manifest.description}")`);
		}
		if (/^this is a plugin/i.test(manifest.description.trim())) {
			failures.push(`description must not start with "This is a plugin" (got: "${manifest.description}")`);
		}
	}

	if (manifest.isDesktopOnly !== true) {
		failures.push(`isDesktopOnly must be true (got: ${manifest.isDesktopOnly})`);
	}

	return failures;
}

// CLI entry point — only runs when invoked directly, not when imported.
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : null;

if (invokedFile === currentFile) {
	const __dirname = dirname(currentFile);
	const manifestPath = resolve(__dirname, '..', 'manifest.json');

	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	} catch (err) {
		console.error(`Failed to parse manifest.json: ${err.message}`);
		process.exit(1);
	}

	const failures = checkManifest(manifest);

	if (failures.length > 0) {
		console.error('manifest.json compliance failures:');
		for (const msg of failures) {
			console.error(`  - ${msg}`);
		}
		process.exit(1);
	}

	console.log('manifest.json passed all compliance checks.');
}
