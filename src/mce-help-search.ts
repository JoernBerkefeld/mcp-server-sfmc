/**
 * Full-text search over bundled Marketing Cloud Engagement help excerpts
 * (mirrored Salesforce Help Markdown under docs/help.salesforce/mce).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type MceProductScope = 'marketing_cloud_engagement' | 'marketing_cloud_next';

export interface MceHelpChunk {
    id: string;
    file: string;
    relativePath: string;
    heading: string;
    body: string;
    productScope: MceProductScope;
    productLabel: string;
}

interface BundledPayload {
    generatedAt?: string;
    sourceDir?: string;
    chunkCount?: number;
    chunks: MceHelpChunk[];
}

function packageRoot(): string {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

export function bundledMceHelpPath(): string {
    return path.join(packageRoot(), 'bundled', 'mce-help', 'chunks.json');
}

export function loadChunks(): MceHelpChunk[] {
    const p = bundledMceHelpPath();
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw) as BundledPayload;
    return Array.isArray(data.chunks) ? data.chunks : [];
}

let cache: MceHelpChunk[] | null = null;

export function getChunks(): MceHelpChunk[] {
    if (!cache) cache = loadChunks();
    return cache;
}

/** Reset cache (tests). */
export function clearMceHelpCache(): void {
    cache = null;
}

export interface MceSearchHit {
    score: number;
    chunk: MceHelpChunk;
}

export type MceProductFocus = 'any' | 'engagement' | 'next';

function tokenize(q: string): string[] {
    return q
        .toLowerCase()
        .split(/[^a-z0-9_./-]+/)
        .filter((t) => t.length > 1);
}

function matchesFocus(chunk: MceHelpChunk, focus: MceProductFocus): boolean {
    if (focus === 'any') return true;
    if (focus === 'engagement') return chunk.productScope === 'marketing_cloud_engagement';
    return chunk.productScope === 'marketing_cloud_next';
}

/**
 * Rank chunks by simple term overlap + heading bonus (same idea as mcdev wiki search).
 */
export function searchMceHelp(query: string, limit: number, productFocus: MceProductFocus = 'any'): MceSearchHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];

    const chunks = getChunks();
    const hits: MceSearchHit[] = [];

    for (const chunk of chunks) {
        if (!matchesFocus(chunk, productFocus)) continue;
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

export function getMceHelpStats(): { chunkCount: number; engagementChunks: number; nextChunks: number } {
    const chunks = getChunks();
    let engagementChunks = 0;
    let nextChunks = 0;
    for (const c of chunks) {
        if (c.productScope === 'marketing_cloud_next') nextChunks++;
        else engagementChunks++;
    }
    return { chunkCount: chunks.length, engagementChunks, nextChunks };
}
