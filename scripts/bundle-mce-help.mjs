/**
 * Builds a searchable JSON index from local Salesforce Help mirrors under
 * docs/help.salesforce/marketing (all Marketing Cloud product docs).
 *
 * Usage: node scripts/bundle-mce-help.mjs
 * Override source: MCE_HELP_DOCS=/path/to/marketing
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
    path.join(packageRoot, '..', 'docs', 'help.salesforce', 'marketing'),
    path.join(packageRoot, '..', 'docs', 'help.salesforce', 'mce'),
].filter(Boolean);

const MAX_BODY = 12000;

/**
 * @typedef {'marketing_cloud_engagement'
 *   | 'marketing_cloud_next'
 *   | 'marketing_cloud_personalization'
 *   | 'marketing_cloud_account_engagement'
 *   | 'marketing_cloud_intelligence'
 *   | 'loyalty_management'
 *   | 'salesforce_personalization'} ProductScope
 */

/** Maps top-level folder names to product scope tokens. */
const FOLDER_TO_SCOPE = {
    'marketing-cloud-engagement': 'marketing_cloud_engagement',
    'marketing-cloud-next': 'marketing_cloud_next',
    'marketing-cloud-personalization': 'marketing_cloud_personalization',
    'marketing-cloud-account-engagement': 'marketing_cloud_account_engagement',
    'marketing-cloud-intelligence': 'marketing_cloud_intelligence',
    'loyalty-management': 'loyalty_management',
    'salesforce-personalization': 'salesforce_personalization',
};

/**
 * @param {string} relPath posix-style relative path from source root
 * @returns {ProductScope}
 */
function inferProductScope(relPath) {
    const p = relPath.replaceAll('\\', '/').toLowerCase();
    const topFolder = p.split('/')[0];
    if (FOLDER_TO_SCOPE[topFolder]) {
        return FOLDER_TO_SCOPE[topFolder];
    }
    // Legacy mce tree: detect Next by subfolder name
    if (p.includes('/02-marketing-cloud-next-for-engagement/')) {
        return 'marketing_cloud_next';
    }
    return 'marketing_cloud_engagement';
}

/** @type {Record<ProductScope, string>} */
const PRODUCT_LABELS = {
    marketing_cloud_engagement:
        'Marketing Cloud Engagement (MCE; Email Studio, Journey Builder, Automation Studio, Content Builder, Mobile Studio)',
    marketing_cloud_next:
        'Marketing Cloud Next (distinct product; Salesforce migration/upsell path from Engagement)',
    marketing_cloud_personalization:
        'Marketing Cloud Personalization (formerly Interaction Studio; real-time personalisation and A/B testing)',
    marketing_cloud_account_engagement:
        'Marketing Cloud Account Engagement (formerly Pardot; B2B marketing automation)',
    marketing_cloud_intelligence:
        'Marketing Cloud Intelligence (formerly Datorama; cross-channel analytics and data pipelines)',
    loyalty_management:
        'Loyalty Management (Salesforce Loyalty Management; loyalty programs, referral marketing, member engagement)',
    salesforce_personalization:
        'Salesforce Personalization (next-generation real-time personalisation engine, successor to MC Personalization)',
};

/**
 * @param {ProductScope} scope
 * @returns {string}
 */
function humanProductLabel(scope) {
    return PRODUCT_LABELS[scope] ?? scope;
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
        const id = `${relPath.replaceAll('\\', '/')}#${i++}`;
        chunks.push({
            id,
            file: fileBase,
            relativePath: relPath.replaceAll('\\', '/'),
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
                ' relative to the monorepo root.\n'
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
    let sourceDirRecorded = sourceDir.replaceAll('\\', '/');
    try {
        const rel = path.relative(monorepoRoot, sourceDir);
        if (rel && !rel.startsWith('..')) {
            sourceDirRecorded = rel.replaceAll('\\', '/');
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
        `bundle-mce-help: wrote ${all.length} chunks from ${files.length} files (${mb} MiB) -> ${path.relative(packageRoot, OUT_FILE)}\n`
    );
}

main();
