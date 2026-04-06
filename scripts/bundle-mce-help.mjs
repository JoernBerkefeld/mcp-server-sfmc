/**
 * Builds a searchable JSON index from local Salesforce Help mirrors under
 * docs/help.salesforce/mce (Marketing Cloud Engagement operational docs).
 *
 * Usage: node scripts/bundle-mce-help.mjs
 * Override source: MCE_HELP_DOCS=/path/to/mce
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');

const OUT_DIR = path.join(packageRoot, 'bundled', 'mce-help');
const OUT_FILE = path.join(OUT_DIR, 'chunks.json');

const SOURCE_CANDIDATES = [
    process.env.MCE_HELP_DOCS,
    path.join(packageRoot, '..', 'docs', 'help.salesforce', 'mce'),
].filter(Boolean);

const MAX_BODY = 12000;

/** @typedef {'marketing_cloud_engagement' | 'marketing_cloud_next'} ProductScope */

/**
 * @param {string} relPath posix-style relative path from mce root
 * @returns {ProductScope}
 */
function inferProductScope(relPath) {
    const p = relPath.replace(/\\/g, '/').toLowerCase();
    if (p.includes('/02-marketing-cloud-next-for-engagement/')) {
        return 'marketing_cloud_next';
    }
    return 'marketing_cloud_engagement';
}

/**
 * @param {ProductScope} scope
 * @returns {string}
 */
function humanProductLabel(scope) {
    return scope === 'marketing_cloud_next'
        ? 'Marketing Cloud Next (distinct product; Salesforce migration/upsell path from Engagement)'
        : 'Marketing Cloud Engagement (MCE; Email Studio, Journey Builder, Automation Studio, etc.)';
}

/**
 * Strip YAML frontmatter if present.
 * @param {string} text
 */
function stripFrontmatter(text) {
    if (!text.startsWith('---\n')) return text;
    const end = text.indexOf('\n---\n', 4);
    if (end === -1) return text;
    return text.slice(end + 5).trimStart();
}

/**
 * @param {string} fullPath
 * @param {string} relPath
 */
function chunkMarkdownFile(fullPath, relPath) {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const text = stripFrontmatter(raw);
    const productScope = inferProductScope(relPath);
    const productLabel = humanProductLabel(productScope);
    const fileBase = path.basename(relPath);

    /** @type {Array<{ id: string; file: string; relativePath: string; heading: string; body: string; productScope: ProductScope; productLabel: string }>} */
    const chunks = [];
    const parts = text.split(/\n(?=#{2,3}\s+)/);
    let i = 0;
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const lines = trimmed.split('\n');
        const first = lines[0] ?? '';
        const headingMatch = first.match(/^#{2,3}\s+(.+)/);
        const heading = headingMatch ? headingMatch[1].trim() : fileBase.replace(/\.md$/i, '');
        let body = headingMatch ? lines.slice(1).join('\n').trim() : trimmed;
        if (!body && !headingMatch) continue;
        if (body.length > MAX_BODY) {
            body = `${body.slice(0, MAX_BODY)}\n\n…`;
        }
        const id = `${relPath.replace(/\\/g, '/')}#${i++}`;
        chunks.push({
            id,
            file: fileBase,
            relativePath: relPath.replace(/\\/g, '/'),
            heading,
            body,
            productScope,
            productLabel,
        });
    }
    return chunks;
}

/**
 * @param {string} dir
 * @param {string} relBase
 * @returns {string[]}
 */
function listMarkdownFiles(dir, relBase = '') {
    /** @type {string[]} */
    const out = [];
    if (!fs.existsSync(dir)) return out;
    const names = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of names) {
        const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            out.push(...listMarkdownFiles(full, rel));
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
            out.push(full);
        }
    }
    return out;
}

function main() {
    let sourceDir = '';
    for (const c of SOURCE_CANDIDATES) {
        if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
            sourceDir = c;
            break;
        }
    }
    if (!sourceDir) {
        process.stderr.write(
            'bundle-mce-help: no source directory found. Set MCE_HELP_DOCS or place docs at ' +
                path.join('docs', 'help.salesforce', 'mce') +
                ' relative to the monorepo root.\n',
        );
        process.exit(1);
    }

    const files = listMarkdownFiles(sourceDir);
    if (files.length === 0) {
        process.stderr.write(`bundle-mce-help: no .md files under ${sourceDir}\n`);
        process.exit(1);
    }

    /** @type {Array<{ id: string; file: string; relativePath: string; heading: string; body: string; productScope: ProductScope; productLabel: string }>} */
    const all = [];
    for (const full of files.sort()) {
        const rel = path.relative(sourceDir, full);
        all.push(...chunkMarkdownFile(full, rel));
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const monorepoRoot = path.join(packageRoot, '..');
    let sourceDirRecorded = sourceDir.replace(/\\/g, '/');
    try {
        const rel = path.relative(monorepoRoot, sourceDir);
        if (rel && !rel.startsWith('..')) {
            sourceDirRecorded = rel.replace(/\\/g, '/');
        }
    } catch {
        /* keep absolute */
    }
    const payload = {
        generatedAt: new Date().toISOString(),
        sourceDir: sourceDirRecorded,
        chunkCount: all.length,
        chunks: all,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload), 'utf8');
    const mb = (Buffer.byteLength(JSON.stringify(payload), 'utf8') / (1024 * 1024)).toFixed(2);
    process.stderr.write(
        `bundle-mce-help: wrote ${all.length} chunks from ${files.length} files (${mb} MiB) -> ${path.relative(packageRoot, OUT_FILE)}\n`,
    );
}

main();
