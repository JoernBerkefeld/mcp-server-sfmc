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
import { countReviewSeverities, shouldFail, type FailOnLevel } from './reviewSeverity.js';

function toolResultToText(result: CallToolResult): string {
    const parts: string[] = [];
    const contentBlocks = result.content ?? [];
    for (const block of contentBlocks) {
        if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
            parts.push(block.text);
        }
    }
    return parts.join('\n');
}

function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stdin.on('data', (c: Buffer) => {
            chunks.push(c);
        });
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

function packageVersion(): string {
    try {
        const p = path.join(projectRoot(), 'package.json');
        const index = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
        return index.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function printHelp(): void {
    // eslint-disable-next-line no-console -- intentional CLI help output
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

interface ParsedArguments {
    filePath: string | null;
    failOn: FailOnLevel;
    language?: 'ampscript' | 'ssjs' | 'html' | 'auto';
    maxProblems?: number;
    help: boolean;
}

function parseArguments(argv: string[]): ParsedArguments {
    let failOn: FailOnLevel = 'error';
    let language: ParsedArguments['language'];
    let maxProblems: number | undefined;
    let isHelp = false;
    const positional: string[] = [];

    for (let index = 0; index < argv.length; index++) {
        const a = argv[index];
        if (a === '-h' || a === '--help') {
            isHelp = true;
            continue;
        }
        if (a === '--fail-on') {
            const v = argv[++index];
            if (v !== 'error' && v !== 'warning' && v !== 'info') {
                throw new Error(
                    `--fail-on must be error, warning, or info, got: ${v ?? '(missing)'}`
                );
            }
            failOn = v;
            continue;
        }
        if (a === '--language') {
            const v = argv[++index];
            if (v !== 'ampscript' && v !== 'ssjs' && v !== 'html' && v !== 'auto') {
                throw new Error(`--language must be ampscript, ssjs, html, or auto`);
            }
            language = v;
            continue;
        }
        if (a === '--max-problems') {
            const v = argv[++index];
            const n = v ? Number(v) : NaN;
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
        help: isHelp,
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
    let parsed: ParsedArguments;
    try {
        parsed = parseArguments(process.argv.slice(2));
    } catch (ex) {
        // eslint-disable-next-line no-console -- intentional CLI error output
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
        version: packageVersion(),
    });

    try {
        await client.connect(transport);

        const arguments_: Record<string, unknown> = { diff: diffText };
        if (parsed.language !== undefined) arguments_.language = parsed.language;
        if (parsed.maxProblems !== undefined) arguments_.maxProblems = parsed.maxProblems;

        const result = await client.callTool({
            name: 'review_change',
            arguments: arguments_,
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
        // eslint-disable-next-line no-console -- intentional CLI error output
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
