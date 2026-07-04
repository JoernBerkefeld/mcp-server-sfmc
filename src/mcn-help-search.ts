/**
 * Full-text search over bundled Marketing Cloud Next developer API docs
 * (mirrored from docs/developer.salesforce/marketing/marketing-cloud-growth).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface McnHelpChunk {
    id: string;
    file: string;
    relativePath: string;
    heading: string;
    body: string;
}

interface BundledPayload {
    generatedAt?: string;
    sourceDir?: string;
    chunkCount?: number;
    chunks: McnHelpChunk[];
}

/**
 * @returns {string}
 */
function packageRoot(): string {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * @returns {string}
 */
export function bundledMcnHelpPath(): string {
    return path.join(packageRoot(), 'bundled', 'mcn-help', 'chunks.json');
}

/**
 * @returns {McnHelpChunk[]}
 */
export function loadChunks(): McnHelpChunk[] {
    const p = bundledMcnHelpPath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as BundledPayload;
    return Array.isArray(data.chunks) ? data.chunks : [];
}

const cacheRef: { chunks: McnHelpChunk[] | null } = { chunks: null };

/**
 * @returns {McnHelpChunk[]}
 */
export function getMcnChunks(): McnHelpChunk[] {
    if (!cacheRef.chunks) cacheRef.chunks = loadChunks();
    return cacheRef.chunks;
}

/** Reset cache (tests). */
export function clearMcnHelpCache(): void {
    cacheRef.chunks = null;
}

export interface McnSearchHit {
    score: number;
    chunk: McnHelpChunk;
}

function tokenize(q: string): string[] {
    return q
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/)
        .filter((t) => t.length > 1);
}

/**
 * Rank chunks by simple term overlap + heading bonus.
 * @param query
 * @param limit
 */
export function searchMcnHelp(query: string, limit: number): McnSearchHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const chunks = getMcnChunks();
    const hits: McnSearchHit[] = [];

    for (const chunk of chunks) {
        const hay = `${chunk.heading}\n${chunk.body}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
            if (hay.includes(t)) score += 2;
            if (chunk.heading.toLowerCase().includes(t)) score += 3;
            if (chunk.file.toLowerCase().includes(t)) score += 1;
            if (chunk.relativePath.toLowerCase().includes(t)) score += 1;
        }
        if (score > 0) hits.push({ score, chunk });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, Math.max(1, limit));
}

/**
 * @returns {{ chunkCount: number; fileCount: number }}
 */
export function getMcnHelpStats(): { chunkCount: number; fileCount: number } {
    const chunks = getMcnChunks();
    const files = new Set(chunks.map((c) => c.relativePath));
    return { chunkCount: chunks.length, fileCount: files.size };
}
