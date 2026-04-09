#!/usr/bin/env node
/**
 * sfmc-review-diff — CI helper: spawn mcp-server-sfmc and call review_change on a unified diff.
 */

import { readFileSync } from 'node:fs';
import { stdin } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type FailOnLevel = 'error' | 'warning' | 'info';

export interface SeverityCounts {
    errors: number;
    warnings: number;
    infos: number;
}

/**
 * Counts diagnostic lines emitted by the review_change tool (see src/index.ts).
 * @param output
 */
export function countReviewSeverities(output: string): SeverityCounts {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const line of output.split('\n')) {
        if (line.startsWith('🔴 ERROR')) errors += 1;
        else if (line.startsWith('🟡 WARNING')) warnings += 1;
        else if (line.startsWith('🔵 INFO')) infos += 1;
    }
    return { errors, warnings, infos };
}

/**
 * Whether the CLI should exit with code 1 given counts and --fail-on policy.
 * @param counts
 * @param failOn
 */
export function shouldFail(counts: SeverityCounts, failOn: FailOnLevel): boolean {
    if (counts.errors > 0) return true;
    if ((failOn === 'warning' || failOn === 'info') && counts.warnings > 0) return true;
    if (failOn === 'info' && counts.infos > 0) return true;
    return false;
}

function toolResultToText(result: CallToolResult): string {
    const parts: string[] = [];
    for (const block of result.content ?? []) {
        if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
            parts.push(block.text);
        }
    }
    return parts.join('\n');
}

function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stdin.on('data', (c: Buffer) => chunks.push(c));
        stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        stdin.on('error', reject);
    });
}

function projectRoot(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/cli -> package root
    return path.join(here, '..', '..');
}

function serverEntryPath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.join(here, '..', 'index.js');
}

function pkgVersion(): string {
    try {
        const p = path.join(projectRoot(), 'package.json');
        const j = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
        return j.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function printHelp(): void {
    console.log(`sfmc-review-diff — run MCP review_change on a unified diff (stdin or file).

Usage:
  sfmc-review-diff [options] [file]
  git diff base...HEAD | sfmc-review-diff [options]

Options:
  --fail-on <error|warning|info>  Minimum severity that fails the process (default: error)
  --language <ampscript|ssjs|html|auto>  Passed to review_change (default: auto)
  --max-problems <n>               Max diagnostics (default: 50)
  -h, --help                       Show this help

Exit codes:
  0  No failing severity per --fail-on (including "no added lines" / clean review)
  1  Review findings matched the failure policy, MCP error, or I/O error
`);
}

interface ParsedArgs {
    filePath: string | null;
    failOn: FailOnLevel;
    language?: 'ampscript' | 'ssjs' | 'html' | 'auto';
    maxProblems?: number;
    help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
    let failOn: FailOnLevel = 'error';
    let language: ParsedArgs['language'];
    let maxProblems: number | undefined;
    let help = false;
    const positional: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') {
            help = true;
            continue;
        }
        if (a === '--fail-on') {
            const v = argv[++i];
            if (v !== 'error' && v !== 'warning' && v !== 'info') {
                throw new Error(
                    `--fail-on must be error, warning, or info, got: ${v ?? '(missing)'}`
                );
            }
            failOn = v;
            continue;
        }
        if (a === '--language') {
            const v = argv[++i];
            if (v !== 'ampscript' && v !== 'ssjs' && v !== 'html' && v !== 'auto') {
                throw new Error(`--language must be ampscript, ssjs, html, or auto`);
            }
            language = v;
            continue;
        }
        if (a === '--max-problems') {
            const v = argv[++i];
            const n = v ? Number.parseInt(v, 10) : Number.NaN;
            if (!Number.isFinite(n) || n < 1) {
                throw new Error(`--max-problems must be a positive integer`);
            }
            maxProblems = n;
            continue;
        }
        if (a.startsWith('-')) {
            throw new Error(`Unknown option: ${a}`);
        }
        positional.push(a);
    }

    if (positional.length > 1) {
        throw new Error('At most one file argument is allowed');
    }

    return {
        filePath: positional[0] ?? null,
        failOn,
        language,
        maxProblems,
        help,
    };
}

function isExecutedDirectly(): boolean {
    const runPath = process.argv[1];
    if (!runPath) return false;
    try {
        return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(runPath);
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    let parsed: ParsedArgs;
    try {
        parsed = parseArgs(process.argv.slice(2));
    } catch (ex) {
        console.error(String(ex instanceof Error ? ex.message : ex));
        process.exit(1);
    }

    if (parsed.help) {
        printHelp();
        process.exit(0);
    }

    const diffText = parsed.filePath ? readFileSync(parsed.filePath, 'utf8') : await readStdin();

    const serverPath = serverEntryPath();
    const cwd = projectRoot();

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        cwd,
    });

    const client = new Client({
        name: 'sfmc-review-diff',
        version: pkgVersion(),
    });

    try {
        await client.connect(transport);

        const args: Record<string, unknown> = { diff: diffText };
        if (parsed.language !== undefined) args.language = parsed.language;
        if (parsed.maxProblems !== undefined) args.maxProblems = parsed.maxProblems;

        const result = await client.callTool({
            name: 'review_change',
            arguments: args,
        });

        const text = toolResultToText(result as CallToolResult);
        process.stdout.write(text);
        if (!text.endsWith('\n')) process.stdout.write('\n');

        if (result.isError) {
            process.exit(1);
        }

        const counts = countReviewSeverities(text);
        if (shouldFail(counts, parsed.failOn)) {
            process.exit(1);
        }
        process.exit(0);
    } catch (ex) {
        console.error(String(ex instanceof Error ? ex.message : ex));
        process.exit(1);
    } finally {
        try {
            await client.close();
        } catch {
            /* ignore */
        }
    }
}

if (isExecutedDirectly()) {
    void main();
}
