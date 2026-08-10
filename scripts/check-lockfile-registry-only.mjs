/* eslint-disable no-console -- CLI check reports lockfile findings to the developer */
/**
 * Generated copy - source of truth: repo-root scripts/check-lockfile-registry-only.mjs
 * Do not hand-edit; update the canonical script and re-copy into each package.
 *
 * Fails when package-lock.json resolves any dependency from the local filesystem
 * instead of the npm registry (or another normal remote URL).
 *
 * Enforced cases (see .cursor/rules/release-tracking.mdc -> "package-lock.json - registry-only"):
 *   - any package node with `"link": true`
 *   - any `resolved` value that is not an http(s) URL (relative path, bare path,
 *     `file:`, or a Windows drive path)
 *   - any dependency spec starting with `file:`, `link:`, or `workspace:`
 *
 * Runs against the package-lock.json next to this script's package root, so the
 * same file works when copied into each independent sub-project repo.
 *
 * Exit codes:
 *   0 - lockfile is registry-only (or absent)
 *   1 - at least one local/link resolution found
 *
 * Run from the package root: node scripts/check-lockfile-registry-only.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const lockPath = path.join(packageRoot, 'package-lock.json');

/**
 * Returns true when a `resolved` value points at the local filesystem rather
 * than a remote registry / URL.
 * @param {string} resolved - The `resolved` field from a lockfile node
 * @returns {boolean} True when the value is a local/relative/file path
 */
function isLocalResolved(resolved) {
    if (typeof resolved !== 'string' || resolved.length === 0) {
        return false;
    }
    // Remote forms are allowed: https:, http:, git+..., ssh URLs, etc.
    if (/^(https?:|git\+|git:|ssh:)/.test(resolved)) {
        return false;
    }
    // Everything else is treated as local: file:, ../, ./, bare paths, C:\...
    return true;
}

/**
 * Returns true when a dependency spec resolves from the local tree / workspace.
 * @param {string} spec - A version/range string from a dependencies map
 * @returns {boolean} True when the spec starts with file:, link:, or workspace:
 */
function isLocalSpec(spec) {
    return typeof spec === 'string' && /^(file:|link:|workspace:)/.test(spec);
}

/**
 * Scans a lockfileVersion 2/3 `packages` map for local resolutions.
 * @param {object} packages - The lockfile `packages` map
 * @param {string[]} findings - Accumulator for human-readable findings
 * @returns {void}
 */
function scanPackages(packages, findings) {
    for (const [packagePath, node] of Object.entries(packages)) {
        if (!node || typeof node !== 'object') {
            continue;
        }
        // The root project node ("") legitimately has no resolved/link.
        if (node.link === true) {
            findings.push(`"link": true at packages["${packagePath}"]`);
        }
        if (isLocalResolved(node.resolved)) {
            findings.push(`local "resolved" at packages["${packagePath}"]: ${node.resolved}`);
        }
        for (const dependencyMap of [
            'dependencies',
            'devDependencies',
            'optionalDependencies',
            'peerDependencies',
        ]) {
            const dependencies = node[dependencyMap];
            if (dependencies && typeof dependencies === 'object') {
                for (const [name, spec] of Object.entries(dependencies)) {
                    if (isLocalSpec(spec)) {
                        findings.push(
                            `local ${dependencyMap} spec at packages["${packagePath}"].${name}: ${spec}`
                        );
                    }
                }
            }
        }
    }
}

/**
 * Recursively scans a lockfileVersion-1 style `dependencies` tree.
 * @param {object} dependencies - A dependencies map keyed by package name
 * @param {string} trail - Human-readable path to the current node
 * @param {string[]} findings - Accumulator for human-readable findings
 * @returns {void}
 */
function scanV1(dependencies, trail, findings) {
    for (const [name, node] of Object.entries(dependencies)) {
        if (!node || typeof node !== 'object') {
            continue;
        }
        const here = `${trail}${name}`;
        if (isLocalResolved(node.resolved)) {
            findings.push(`local "resolved" at ${here}: ${node.resolved}`);
        }
        if (isLocalSpec(node.version)) {
            findings.push(`local "version" at ${here}: ${node.version}`);
        }
        if (node.dependencies && typeof node.dependencies === 'object') {
            scanV1(node.dependencies, `${here} > `, findings);
        }
    }
}

/**
 * Runs the lockfile purity check and sets process.exitCode on failure.
 * @returns {void}
 */
function main() {
    if (!fs.existsSync(lockPath)) {
        // No lockfile to check - nothing to enforce.
        return;
    }

    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const findings = [];

    if (lock.packages && typeof lock.packages === 'object') {
        scanPackages(lock.packages, findings);
    }
    if (lock.dependencies && typeof lock.dependencies === 'object') {
        scanV1(lock.dependencies, '', findings);
    }

    if (findings.length > 0) {
        console.error(`[check-lockfile] ${path.basename(lockPath)} is not registry-only:`);
        for (const finding of findings) {
            console.error(`  - ${finding}`);
        }
        console.error(
            "Fix package.json (use registry semver ranges), delete node_modules, then run 'npm install --no-workspaces'."
        );
        process.exitCode = 1;
    }
}

main();
