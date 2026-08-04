/**
 * Builds a searchable JSON index from the mirrored Marketing Cloud Next
 * developer API docs under docs/developer.salesforce/marketing/marketing-cloud-growth.
 *
 * Usage: node scripts/bundle-mcn-help.mjs
 * Override source: MCN_HELP_DOCS=/path/to/marketing-cloud-growth
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');

const OUT_DIR = path.join(packageRoot, 'bundled', 'mcn-help');
const OUT_FILE = path.join(OUT_DIR, 'chunks.json');

const SOURCE_CANDIDATES = [
    process.env.MCN_HELP_DOCS,
    path.join(
        packageRoot,
        '..',
        'docs',
        'developer.salesforce',
        'marketing',
        'marketing-cloud-growth'
    ),
].filter(Boolean);

const MAX_BODY = 12_000;

/**
 * Strip YAML frontmatter if present.
 * @param {string} text
 * @returns {string}
 */
function stripFrontmatter(text) {
    if (!text.startsWith('---\n')) return text;
    const end = text.indexOf('\n---\n', 4);
    if (end === -1) return text;
    return text.slice(end + 5).trimStart();
}

/**
 * Split a Markdown file into H2/H3-level chunks.
 * @param {string} fullPath
 * @param {string} relPath posix-style relative path from source root
 * @returns {Array<{ id: string; file: string; relativePath: string; heading: string; body: string }>}
 */
function chunkMarkdownFile(fullPath, relPath) {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const text = stripFrontmatter(raw);
    const fileBase = path.basename(relPath);

    const chunks = [];
    const parts = text.split(/\n(?=#{2,3}\s+)/);
    let index = 0;
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
        const id = `${relPath.replaceAll('\\', '/')}#${index++}`;
        chunks.push({
            id,
            file: fileBase,
            relativePath: relPath.replaceAll('\\', '/'),
            heading,
            body,
        });
    }
    return chunks;
}

/**
 * Recursively list all Markdown files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function listMarkdownFiles(dir) {
    /**
     * @type {string[]}
     */
    const out = [];
    if (!fs.existsSync(dir)) return out;
    const names = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of names) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            out.push(...listMarkdownFiles(full));
        } else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
            out.push(full);
        }
    }
    return out;
}

function main() {
    let sourceDir = '';
    for (const c of SOURCE_CANDIDATES) {
        if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) {
            sourceDir = c;
            break;
        }
    }
    if (!sourceDir) {
        process.stderr.write(
            'bundle-mcn-help: no source directory found. Set MCN_HELP_DOCS or place docs at ' +
                path.join('docs', 'developer.salesforce', 'marketing', 'marketing-cloud-growth') +
                ' relative to the monorepo root.\n'
        );
        process.exit(1);
    }

    const files = listMarkdownFiles(sourceDir);
    if (files.length === 0) {
        process.stderr.write(`bundle-mcn-help: no .md files under ${sourceDir}\n`);
        process.exit(1);
    }

    const all = [];
    const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
    for (const full of sortedFiles) {
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
        /*
        keep absolute
        */
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
        `bundle-mcn-help: wrote ${all.length} chunks from ${files.length} files (${mb} MiB) -> ${path.relative(packageRoot, OUT_FILE)}\n`
    );
}

main();
