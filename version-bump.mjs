import { readFileSync, writeFileSync } from "node:fs";

// Invoked by semantic-release's @semantic-release/exec prepareCmd, after
// @semantic-release/npm has written the computed version into package.json.
//
// We read the target version from package.json on disk (authoritative) rather
// than process.env.npm_package_version, which is unset when semantic-release
// runs this via `node version-bump.mjs`.
const targetVersion = JSON.parse(readFileSync("package.json", "utf8")).version;

if (!targetVersion) {
	throw new Error("version-bump: package.json has no version field");
}

// Stamp the target version into manifest.json, preserving minAppVersion and the
// existing tab-indent + trailing-newline format the compliance check expects.
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

// versions.json maps every released plugin version to the minAppVersion it
// requires, so Obsidian can pick the newest plugin build a given app version
// supports. Add the entry for this release if missing.
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
if (versions[targetVersion] !== minAppVersion) {
	versions[targetVersion] = minAppVersion;
	writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);
}
