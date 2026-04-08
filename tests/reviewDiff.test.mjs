/**
 * sfmc-review-diff CLI — severity parsing and optional integration with MCP server.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { countReviewSeverities, shouldFail } from '../dist/cli/reviewDiff.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliJs = path.join(repoRoot, 'dist', 'cli', 'reviewDiff.js');

describe('countReviewSeverities / shouldFail', () => {
    test('counts emoji-prefixed lines', () => {
        const text = [
            '## SFMC Code Review — AMPSCRIPT changes',
            '🔴 ERROR (diff line 12): unknown function',
            '🟡 WARNING (diff line 13): style',
            '🔵 INFO (diff line 14): note',
        ].join('\n');
        const c = countReviewSeverities(text);
        assert.equal(c.errors, 1);
        assert.equal(c.warnings, 1);
        assert.equal(c.infos, 1);
    });

    test('shouldFail respects fail-on', () => {
        const eOnly = { errors: 1, warnings: 0, infos: 0 };
        assert.equal(shouldFail(eOnly, 'error'), true);
        const wOnly = { errors: 0, warnings: 1, infos: 0 };
        assert.equal(shouldFail(wOnly, 'error'), false);
        assert.equal(shouldFail(wOnly, 'warning'), true);
        assert.equal(shouldFail(wOnly, 'info'), true);
        const iOnly = { errors: 0, warnings: 0, infos: 1 };
        assert.equal(shouldFail(iOnly, 'error'), false);
        assert.equal(shouldFail(iOnly, 'warning'), false);
        assert.equal(shouldFail(iOnly, 'info'), true);
    });
});

describe('sfmc-review-diff integration (MCP subprocess)', () => {
    test('exits 1 when added AMPscript references unknown function', async () => {
        const badDiff = [
            'diff --git a/t.amp b/t.amp',
            '--- a/t.amp',
            '+++ b/t.amp',
            '@@ -1 +1 @@',
            '-%%[ SET @a = 1 ]%%',
            '+%%[ SET @x = TotallyUnknownFunc123() ]%%',
            '',
        ].join('\n');

        const code = await runCliWithStdin(badDiff, []);
        assert.equal(code, 1);
    });

    test('exits 0 when diff has no added lines (removals only)', async () => {
        const removalsOnly = [
            'diff --git a/README.md b/README.md',
            '--- a/README.md',
            '+++ b/README.md',
            '@@ -2,3 +2,2 @@',
            ' keep',
            '-removed',
            ' keep2',
            '',
        ].join('\n');
        const code = await runCliWithStdin(removalsOnly, []);
        assert.equal(code, 0);
    });
});

/**
 * @param {string} stdinText
 * @param {string[]} extraArgs
 * @returns {Promise<number>} exit code
 */
function runCliWithStdin(stdinText, extraArgs) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliJs, ...extraArgs], {
            cwd: repoRoot,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr?.on('data', (c) => {
            stderr += c.toString();
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === null) {
                reject(new Error(`spawn closed with null code; stderr: ${stderr}`));
                return;
            }
            resolve(code);
        });
        child.stdin?.write(stdinText);
        child.stdin?.end();
    });
}
