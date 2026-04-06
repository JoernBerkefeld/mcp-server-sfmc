#!/usr/bin/env node
/**
 * mcp-server-sfmc
 *
 * MCP server exposing SFMC language intelligence (AMPscript, SSJS, GTL) as
 * Model Context Protocol tools, resources, and prompts. Intended for use
 * with AI assistants (GitHub Copilot, GitLab Duo, Cursor, Claude, Windsurf)
 * to enable accurate SFMC code generation and review.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    sfmcLanguageService,
    validateAmpscript,
    validateSsjs,
    validateGtlBlocks,
    type SfmcSettings,
} from 'sfmc-language-lsp';
import {
    getChunks,
    getMceHelpStats,
    searchMceHelp,
    type MceProductFocus,
} from './mce-help-search.js';

function projectPackageRoot(): string {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

const pkg = JSON.parse(fs.readFileSync(path.join(projectPackageRoot(), 'package.json'), 'utf8')) as {
    version: string;
};

// ---------------------------------------------------------------------------
// Server instance
// ---------------------------------------------------------------------------

const server = new McpServer({
    name: 'mcp-server-sfmc',
    version: pkg.version,
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const defaultSettings: SfmcSettings = { maxNumberOfProblems: 100 };

type LanguageId = 'ampscript' | 'ssjs' | 'html';

function detectLanguage(code: string, hint?: LanguageId): 'ampscript' | 'ssjs' {
    if (hint === 'ssjs') return 'ssjs';
    if (hint === 'ampscript') return 'ampscript';
    // HTML: check for dominant content
    if (hint === 'html') {
        const hasSsjs = /<script[^>]+runat=['"]?server/i.test(code);
        const hasAmpscript = /%%\[|%%=/.test(code);
        if (hasSsjs && !hasAmpscript) return 'ssjs';
        return 'ampscript';
    }
    // Auto-detect
    if (/%%\[|%%=|<script[^>]+language=['"]?ampscript/i.test(code)) return 'ampscript';
    if (/<script[^>]+runat=['"]?server/i.test(code) || /Platform\.(Load|Function|Variable)/i.test(code)) return 'ssjs';
    return 'ampscript';
}

function formatDiagnostics(diagnostics: ReturnType<typeof validateAmpscript>): string {
    if (diagnostics.length === 0) return 'No issues found.';
    return diagnostics
        .map((d) => {
            const sev = d.severity === 1 ? 'ERROR' : d.severity === 2 ? 'WARNING' : 'INFO';
            const loc = `line ${d.range.start.line + 1}, col ${d.range.start.character + 1}`;
            return `[${sev}] ${loc}: ${d.message}`;
        })
        .join('\n');
}

// ---------------------------------------------------------------------------
// Tool: validate_ampscript
// ---------------------------------------------------------------------------

server.tool(
    'validate_ampscript',
    'Validate AMPscript code for syntax errors, unknown functions, arity mismatches, and style issues. ' +
    'Returns a list of diagnostics with line numbers and severity.',
    {
        code: z.string().describe('The AMPscript code to validate. May include HTML context.'),
        maxProblems: z.number().int().min(1).max(500).optional()
            .describe('Maximum number of problems to return (default 100).'),
    },
    ({ code, maxProblems }) => {
        const settings: SfmcSettings = { maxNumberOfProblems: maxProblems ?? 100 };
        const diagnostics = validateAmpscript(code, settings);
        return {
            content: [{ type: 'text', text: formatDiagnostics(diagnostics) }],
        };
    },
);

// ---------------------------------------------------------------------------
// Tool: validate_ssjs
// ---------------------------------------------------------------------------

server.tool(
    'validate_ssjs',
    'Validate SSJS (Server-Side JavaScript) code for unsupported ES6+ syntax, missing Platform.Load, ' +
    'and incorrect usage patterns. Returns diagnostics with line numbers.',
    {
        code: z.string().describe('The SSJS code to validate. May include <script runat="server"> tags.'),
        maxProblems: z.number().int().min(1).max(500).optional()
            .describe('Maximum number of problems to return (default 100).'),
    },
    ({ code, maxProblems }) => {
        const settings: SfmcSettings = { maxNumberOfProblems: maxProblems ?? 100 };
        const diagnostics = validateSsjs(code, settings);
        return {
            content: [{ type: 'text', text: formatDiagnostics(diagnostics) }],
        };
    },
);

// ---------------------------------------------------------------------------
// Tool: validate_sfmc_html
// ---------------------------------------------------------------------------

server.tool(
    'validate_sfmc_html',
    'Validate an HTML file that contains embedded AMPscript and/or SSJS blocks. ' +
    'Checks both languages and GTL template syntax.',
    {
        code: z.string().describe('HTML source that may contain %%[ ]%%, %%= =%%,  <script runat="server">, or {{ }} blocks.'),
        maxProblems: z.number().int().min(1).max(500).optional()
            .describe('Maximum number of problems to return (default 100).'),
    },
    ({ code, maxProblems }) => {
        const limit = maxProblems ?? 100;
        const settings: SfmcSettings = { maxNumberOfProblems: limit };
        const ampDiags = validateAmpscript(code, settings);
        const ssjsDiags = validateSsjs(code, settings);
        const gtlDiags: ReturnType<typeof validateAmpscript> = [];
        validateGtlBlocks(code, gtlDiags, limit);
        const all = [...ampDiags, ...ssjsDiags, ...gtlDiags].sort(
            (a, b) => a.range.start.line - b.range.start.line,
        );
        return {
            content: [{ type: 'text', text: formatDiagnostics(all) }],
        };
    },
);

// ---------------------------------------------------------------------------
// Tool: lookup_ampscript_function
// ---------------------------------------------------------------------------

server.tool(
    'lookup_ampscript_function',
    'Look up the signature, parameters, description, and examples for an AMPscript function by name. ' +
    'Case-insensitive. Returns null if the function is not found.',
    {
        name: z.string().describe('The AMPscript function name, e.g. "Lookup", "DateAdd", "IIf".'),
    },
    ({ name }) => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction(name);
        if (!fn) {
            return { content: [{ type: 'text', text: `AMPscript function "${name}" not found.` }] };
        }

        const params = fn.params
            .map((p: { name: string; type?: string; optional?: boolean; description?: string }) => {
                const req = p.optional ? '(optional)' : '(required)';
                return `  - ${p.name}: ${p.type ?? 'any'} ${req}${p.description ? ' — ' + p.description : ''}`;
            })
            .join('\n');

        const examples = fn.example ? '\n\nExample:\n' + fn.example : '';

        const text = `## ${fn.name}\n\n` +
            `**Category:** ${fn.category ?? 'Unknown'}\n\n` +
            `**Description:** ${fn.description ?? ''}\n\n` +
            `**Parameters:**\n${params || '  (none)'}` +
            examples;

        return { content: [{ type: 'text', text }] };
    },
);

// ---------------------------------------------------------------------------
// Tool: lookup_ssjs_function
// ---------------------------------------------------------------------------

server.tool(
    'lookup_ssjs_function',
    'Look up the signature, parameters, and description for an SSJS function or method. ' +
    'Searches Platform functions, WSProxy methods, HTTP methods, and global functions. Case-insensitive.',
    {
        name: z.string().describe('The function or method name, e.g. "Lookup", "retrieve", "Get". May include namespace like "Platform.Function.Lookup".'),
    },
    ({ name }) => {
        // Strip namespace prefix for lookup
        const bare = name.replace(/^(Platform\.(Function|Variable|Response|Request|ClientBrowser|Recipient|DateTime)\.|WSProxy\.|HTTP\.|Script\.Util\.|Function\.|Variable\.|Response\.|Request\.)/i, '');
        const fn = sfmcLanguageService.lookupSsjsFunction(bare);
        if (!fn) {
            return { content: [{ type: 'text', text: `SSJS function/method "${name}" not found.` }] };
        }

        const params = (fn.params ?? [])
            .map((p: { name: string; type?: string; required?: boolean; optional?: boolean; description?: string }) => {
                const isOptional = p.optional || p.required === false;
                const req = isOptional ? '(optional)' : '(required)';
                return `  - ${p.name}: ${p.type ?? 'any'} ${req}${p.description ? ' — ' + p.description : ''}`;
            })
            .join('\n');

        const text = `## ${fn.name}\n\n` +
            `**Description:** ${fn.description ?? ''}\n\n` +
            `**Parameters:**\n${params || '  (none)'}\n\n` +
            `**Returns:** ${fn.returnType ?? 'void'}`;

        return { content: [{ type: 'text', text }] };
    },
);

// ---------------------------------------------------------------------------
// Tool: review_change
// ---------------------------------------------------------------------------

server.tool(
    'review_change',
    'Review a code diff for SFMC (AMPscript, SSJS, or HTML) quality issues. ' +
    'Extracts added/changed lines from the diff and validates them. ' +
    'Returns structured feedback with line-level diagnostics and style suggestions.',
    {
        diff: z.string().describe('A unified diff (git diff format) containing the changed code.'),
        language: z.enum(['ampscript', 'ssjs', 'html', 'auto']).optional()
            .describe('Language of the changed file. Defaults to "auto" for automatic detection.'),
        maxProblems: z.number().int().min(1).max(200).optional()
            .describe('Maximum number of problems to report (default 50).'),
    },
    ({ diff, language = 'auto', maxProblems = 50 }) => {
        // Extract added lines from the unified diff
        const addedLines: string[] = [];
        let lineNum = 0;
        const lineMap: number[] = []; // maps index in addedLines to original diff line number

        for (const line of diff.split('\n')) {
            lineNum++;
            if (line.startsWith('+') && !line.startsWith('+++')) {
                addedLines.push(line.slice(1));
                lineMap.push(lineNum);
            }
        }

        if (addedLines.length === 0) {
            return { content: [{ type: 'text', text: 'No added lines found in the diff.' }] };
        }

        const addedCode = addedLines.join('\n');
        const detectedLang = language === 'auto'
            ? detectLanguage(addedCode)
            : (language as LanguageId) === 'html'
                ? detectLanguage(addedCode, 'html')
                : language as 'ampscript' | 'ssjs';

        const settings: SfmcSettings = { maxNumberOfProblems: maxProblems };
        const doc = { text: addedCode, languageId: detectedLang, uri: 'diff' };
        const diagnostics = sfmcLanguageService.validate(doc, settings);

        if (diagnostics.length === 0) {
            return { content: [{ type: 'text', text: `No issues found in the ${detectedLang.toUpperCase()} changes.` }] };
        }

        const output = [`## SFMC Code Review — ${detectedLang.toUpperCase()} changes\n`];
        for (const d of diagnostics) {
            const sev = d.severity === 1 ? '🔴 ERROR' : d.severity === 2 ? '🟡 WARNING' : '🔵 INFO';
            const origLine = lineMap[d.range.start.line] ?? d.range.start.line + 1;
            output.push(`${sev} (diff line ${origLine}): ${d.message}`);
        }

        return { content: [{ type: 'text', text: output.join('\n') }] };
    },
);

// ---------------------------------------------------------------------------
// Tool: suggest_fix
// ---------------------------------------------------------------------------

server.tool(
    'suggest_fix',
    'Generate a corrected version of SFMC code based on validation diagnostics. ' +
    'Returns the original code with inline fix suggestions or a corrected replacement.',
    {
        code: z.string().describe('The SFMC code snippet to fix.'),
        language: z.enum(['ampscript', 'ssjs', 'html', 'auto']).optional()
            .describe('Language of the code. Defaults to "auto".'),
        issueDescription: z.string().optional()
            .describe('Optional human description of the specific issue to fix.'),
    },
    ({ code, language = 'auto', issueDescription }) => {
        const detectedLang = language === 'auto' ? detectLanguage(code) : detectLanguage(code, language as LanguageId);
        const settings: SfmcSettings = { maxNumberOfProblems: 50 };
        const doc = { text: code, languageId: detectedLang, uri: 'fix-target' };
        const diagnostics = sfmcLanguageService.validate(doc, settings);

        const lines = code.split('\n');
        const suggestions: string[] = [];

        for (const d of diagnostics) {
            const lineText = lines[d.range.start.line] ?? '';
            suggestions.push(
                `Line ${d.range.start.line + 1}: ${d.message}\n` +
                `  Code: ${lineText.trim()}\n` +
                `  Fix: ${getFixSuggestion(d.message, lineText, detectedLang)}`,
            );
        }

        if (suggestions.length === 0) {
            const extra = issueDescription ? ` Issue reported: "${issueDescription}"` : '';
            return { content: [{ type: 'text', text: `No validation issues detected.${extra}` }] };
        }

        const header = issueDescription
            ? `## Fix Suggestions for: ${issueDescription}\n`
            : `## Fix Suggestions\n`;

        return { content: [{ type: 'text', text: header + suggestions.join('\n\n') }] };
    },
);

/** Generate a human-readable fix hint for common diagnostics. */
function getFixSuggestion(message: string, line: string, lang: 'ampscript' | 'ssjs'): string {
    const m = message.toLowerCase();
    if (m.includes("'let'") || m.includes("'const'")) return 'Replace `let`/`const` with `var`.';
    if (m.includes('arrow function')) return 'Replace `() =>` with `function() {}`.';
    if (m.includes('template literal')) return 'Replace `` `${x}` `` with `"" + x + ""`.';
    if (m.includes('platform.load')) return 'Add `Platform.Load("core", "1.1.5");` before using Core library objects.';
    if (m.includes('unclosed')) return 'Add the matching closing delimiter.';
    if (m.includes('// ')) return 'AMPscript does not support `//` comments. Use `/* comment */` instead.';
    if (m.includes('html comment')) return 'Remove the `<!-- -->` wrapper; use `/* comment */` inside AMPscript.';
    if (m.includes('unknown function')) {
        const fnMatch = message.match(/"([^"]+)"/);
        if (fnMatch) return `Check spelling — did you mean a known AMPscript function? ("${fnMatch[1]}")`;
    }
    if (m.includes('expects')) return 'Check the number and types of arguments against the function signature.';
    if (lang === 'ssjs' && line.includes('Platform.Load')) return 'Use the correct version string, e.g. "1.1.5".';
    return 'Review the relevant SFMC documentation for the correct syntax.';
}

// ---------------------------------------------------------------------------
// Tool: get_ampscript_completions
// ---------------------------------------------------------------------------

server.tool(
    'get_ampscript_completions',
    'Return a list of AMPscript function names, keywords, and variable names available at a given position in the code.',
    {
        code: z.string().describe('The full AMPscript document text.'),
        line: z.number().int().min(0).describe('Zero-based line number of the cursor position.'),
        character: z.number().int().min(0).describe('Zero-based character offset within the line.'),
    },
    ({ code, line, character }) => {
        const doc = { text: code, languageId: 'ampscript' as const, uri: 'completions' };
        const items = sfmcLanguageService.getCompletions(doc, { line, character });
        const formatted = items
            .slice(0, 50)
            .map((item) => {
                const label = typeof item.label === 'string' ? item.label : (item.label as { label: string }).label;
                return `- ${label}${item.detail ? ` — ${item.detail}` : ''}`;
            })
            .join('\n');
        const total = items.length;
        return {
            content: [{
                type: 'text',
                text: total === 0
                    ? 'No completions at this position (cursor is outside an AMPscript block).'
                    : `${total} completions available (showing up to 50):\n\n${formatted}`,
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Tool: get_ssjs_completions
// ---------------------------------------------------------------------------

server.tool(
    'get_ssjs_completions',
    'Return a list of SSJS Platform functions, WSProxy methods, and other SFMC-specific identifiers available for completion.',
    {
        filter: z.string().optional()
            .describe('Optional prefix filter, e.g. "Platform.Function" or "WSProxy".'),
    },
    ({ filter }) => {
        const items = sfmcLanguageService.getSsjsCompletionCatalog();
        const filtered = filter
            ? items.filter((item) => {
                const label = typeof item.label === 'string' ? item.label : (item.label as { label: string }).label;
                return label.toLowerCase().startsWith(filter.toLowerCase());
            })
            : items;

        const formatted = filtered
            .slice(0, 80)
            .map((item) => {
                const label = typeof item.label === 'string' ? item.label : (item.label as { label: string }).label;
                return `- ${label}${item.detail ? ` — ${item.detail}` : ''}`;
            })
            .join('\n');

        return {
            content: [{
                type: 'text',
                text: filtered.length === 0
                    ? `No SSJS completions matching "${filter}".`
                    : `${filtered.length} SSJS completions${filter ? ` matching "${filter}"` : ''} (showing up to 80):\n\n${formatted}`,
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Tool: format_sfmc_code (basic, no prettier integration needed)
// ---------------------------------------------------------------------------

server.tool(
    'format_sfmc_code',
    'Apply basic formatting conventions to AMPscript or SSJS code. ' +
    'Normalises keyword casing, whitespace around operators, and indentation hints.',
    {
        code: z.string().describe('The SFMC code to format.'),
        language: z.enum(['ampscript', 'ssjs']).describe('The language of the code.'),
    },
    ({ code, language }) => {
        let formatted = code;

        if (language === 'ampscript') {
            // Normalise AMPscript block keywords to uppercase
            formatted = formatted
                .replace(/\b(if|elseif|else|endif|for|to|downto|step|next|set|var|do|output)\b/gi, (m) => m.toUpperCase())
                .replace(/\bAND\b/gi, 'AND')
                .replace(/\bOR\b/gi, 'OR')
                .replace(/\bNOT\b/gi, 'NOT');
        } else {
            // SSJS: normalise Platform.Load to use double quotes
            formatted = formatted.replace(/Platform\.Load\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g, 'Platform.Load("$1", "$2")');
        }

        return { content: [{ type: 'text', text: formatted }] };
    },
);

// ---------------------------------------------------------------------------
// Tool: search_mce_help
// ---------------------------------------------------------------------------

const MCE_HELP_TOOL_DESC =
    'Search bundled Salesforce Help excerpts for Marketing Cloud **operational** tasks (setup, business units, ' +
    'Journey Builder, Automation Studio, campaigns, tenants, etc.). Uses a local mirror of help under ' +
    '`docs/help.salesforce/mce`. Results are tagged as **Marketing Cloud Engagement** vs **Marketing Cloud Next** ' +
    '(a separate product Salesforce positions as a future path; do not conflate with classic Engagement unless the doc says so). ' +
    'Prefer `product_focus: engagement` for classic MCE questions; use `next` when the user explicitly asks about Next or migration.';

server.tool(
    'search_mce_help',
    MCE_HELP_TOOL_DESC,
    {
        query: z.string().describe('Keywords or question text (e.g. "enable business unit", "new child account").'),
        limit: z.number().int().min(1).max(25).optional().describe('Max results (default 10).'),
        product_focus: z.enum(['any', 'engagement', 'next']).optional()
            .describe(
                'Limit to Marketing Cloud Engagement docs (`engagement`), Marketing Cloud Next-only sections (`next`), ' +
                'or search everything (`any`, default).',
            ),
    },
    ({ query, limit = 10, product_focus = 'any' }) => {
        const focus = product_focus as MceProductFocus;
        const hits = searchMceHelp(query, limit, focus);
        if (hits.length === 0) {
            const stats = getMceHelpStats();
            const hint =
                stats.chunkCount === 0
                    ? 'Bundled help index missing. Run `npm run bundle-mce-help` from the package folder with ' +
                      '`docs/help.salesforce/mce` present, or set `MCE_HELP_DOCS` to that tree.'
                    : `No matches for this query with product_focus="${focus}". Try broader keywords or product_focus="any".`;
            return { content: [{ type: 'text', text: hint }] };
        }
        const lines = hits.map((h, i) => {
            const excerpt = h.chunk.body.replace(/\s+/g, ' ').slice(0, 520);
            return (
                `### ${i + 1}. ${h.chunk.relativePath} — ${h.chunk.heading}\n` +
                `**Product:** ${h.chunk.productLabel}\n` +
                `**Score:** ${h.score}\n\n` +
                `${excerpt}${h.chunk.body.length > 520 ? '…' : ''}\n`
            );
        });
        return {
            content: [{ type: 'text', text: lines.join('\n---\n\n') }],
        };
    },
);

// ---------------------------------------------------------------------------
// Resource: ampscript-function-catalog
// ---------------------------------------------------------------------------

server.resource(
    'ampscript-function-catalog',
    'sfmc://ampscript/functions',
    async () => {
        const functions = sfmcLanguageService.getAllAmpscriptFunctions();
        const lines = functions.map((fn) => {
            const paramList = fn.params.map((p: { name: string; type?: string; optional?: boolean }) =>
                p.optional ? `[${p.name}: ${p.type ?? 'any'}]` : `${p.name}: ${p.type ?? 'any'}`,
            ).join(', ');
            return `${fn.name}(${paramList}) — ${fn.description ?? ''}`;
        });
        return {
            contents: [{
                uri: 'sfmc://ampscript/functions',
                mimeType: 'text/plain',
                text: `# AMPscript Function Catalog (${functions.length} functions)\n\n` + lines.join('\n'),
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Resource: ssjs-function-catalog
// ---------------------------------------------------------------------------

server.resource(
    'ssjs-function-catalog',
    'sfmc://ssjs/functions',
    async () => {
        const functions = sfmcLanguageService.getAllSsjsFunctions();
        const lines = functions.map((fn) => {
            const paramList = (fn.params ?? []).map((p: { name: string; type?: string; required?: boolean; optional?: boolean }) =>
                (p.optional || p.required === false) ? `[${p.name}: ${p.type ?? 'any'}]` : `${p.name}: ${p.type ?? 'any'}`,
            ).join(', ');
            return `${fn.name}(${paramList}) — ${fn.description ?? ''}`;
        });
        return {
            contents: [{
                uri: 'sfmc://ssjs/functions',
                mimeType: 'text/plain',
                text: `# SSJS Function Catalog (${functions.length} functions)\n\n` + lines.join('\n'),
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Resource: ampscript-keywords
// ---------------------------------------------------------------------------

server.resource(
    'ampscript-keywords',
    'sfmc://ampscript/keywords',
    async () => {
        const keywords = sfmcLanguageService.getAmpscriptKeywords();
        return {
            contents: [{
                uri: 'sfmc://ampscript/keywords',
                mimeType: 'text/plain',
                text: `# AMPscript Keywords\n\n${keywords.join(', ')}`,
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Resource: ssjs-unsupported-syntax
// ---------------------------------------------------------------------------

server.resource(
    'ssjs-unsupported-syntax',
    'sfmc://ssjs/unsupported-syntax',
    async () => {
        const items = sfmcLanguageService.getUnsupportedSsjsSyntax();
        const lines = items.map((item) => `- **${item.pattern}**: ${item.message}`);
        return {
            contents: [{
                uri: 'sfmc://ssjs/unsupported-syntax',
                mimeType: 'text/markdown',
                text: `# SSJS Unsupported Syntax\n\nThese ES6+ features are not supported in Salesforce Marketing Cloud SSJS:\n\n${lines.join('\n')}`,
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Resource: mce-product-context (Engagement vs Next)
// ---------------------------------------------------------------------------

const MCE_VS_NEXT_MD = `# Marketing Cloud Engagement vs Marketing Cloud Next

Use this when interpreting **search_mce_help** results or user questions about Salesforce Marketing Cloud products.

## Marketing Cloud Engagement (MCE)

This is the established Marketing Cloud application area many teams mean when they say "Marketing Cloud": Email Studio, Journey Builder, Automation Studio, Content Builder, Mobile Studio, and related setup and administration. **Bundled help excerpts** tagged as Marketing Cloud Engagement come from the mirrored Help tree **outside** the folder named **Marketing Cloud Next for Engagement**.

For "how do I…", "where do I enable…", or "set up a business unit" **without** an explicit Next migration ask, start with the \`search_mce_help\` tool using **product_focus \`engagement\`** so answers stay on classic Engagement workflows.

## Marketing Cloud Next

**Marketing Cloud Next** is a **different product** Salesforce often positions as a long-term direction and upsell. It is **not** a drop-in rename of Engagement: feature coverage and UI paths differ, and Next is still evolving relative to many Engagement capabilities.

Help chunks tagged as **Marketing Cloud Next** are sourced from the **Marketing Cloud Next for Engagement** section of the same mirror. Use those when the user asks about Next, migration, or that section explicitly. Use **product_focus \`next\`** or \`any\` for those topics.

## Practical rule

- Default operational questions → **Engagement** (\`product_focus: engagement\`).
- User names Next, migration to Next, or "Next for Engagement" → include **Next** (\`next\` or \`any\`) and **state in the answer** which product the steps apply to.
`;

server.resource(
    'mce-product-context',
    'sfmc://mce/product-context',
    async () => ({
        contents: [{
            uri: 'sfmc://mce/product-context',
            mimeType: 'text/markdown',
            text: MCE_VS_NEXT_MD,
        }],
    }),
);

// ---------------------------------------------------------------------------
// Resource: mce-help index (bundled files)
// ---------------------------------------------------------------------------

server.resource(
    'mce-help-index',
    'sfmc://mce/help-index',
    async () => {
        const chunks = getChunks();
        const files = [...new Set(chunks.map((c) => c.relativePath))].sort();
        const stats = getMceHelpStats();
        const text =
            `# Bundled Marketing Cloud help (${stats.chunkCount} sections from ${files.length} files)\n\n` +
            `| Scope | Sections |\n| --- | ---: |\n| Marketing Cloud Engagement | ${stats.engagementChunks} |\n| Marketing Cloud Next (Next for Engagement folder) | ${stats.nextChunks} |\n\n` +
            `## Files\n\n` +
            files.map((f) => `- ${f}`).join('\n');
        return {
            contents: [{ uri: 'sfmc://mce/help-index', mimeType: 'text/markdown', text }],
        };
    },
);

// ---------------------------------------------------------------------------
// Prompt: writeAmpscript
// ---------------------------------------------------------------------------

server.prompt(
    'writeAmpscript',
    'Generate AMPscript code for a specific task. Ensures correct syntax, proper use of delimiters, ' +
    'and references to real SFMC functions.',
    {
        task: z.string().describe('Description of what the AMPscript code should do.'),
        context: z.string().optional().describe('Optional context about the email, landing page, or SFMC configuration.'),
    },
    ({ task, context }) => ({
        messages: [{
            role: 'user',
            content: {
                type: 'text',
                text: [
                    'You are an expert Salesforce Marketing Cloud developer.',
                    'Generate AMPscript code for the following task.',
                    '',
                    '## Rules',
                    '- Use `%%[ ]%%` for block-level code and `%%= =%%` for inline output.',
                    '- Keywords (SET, VAR, IF, ENDIF, FOR, NEXT, OUTPUT) must be uppercase.',
                    '- Variables start with `@`. Example: `SET @myVar = "value"`',
                    '- Use `/* */` for comments — never `//` or `<!-- -->`.',
                    '- All function names are case-insensitive but conventionally PascalCase.',
                    '- Do NOT use ES6+ syntax (this is not JavaScript).',
                    '- Validate your output against the AMPscript function catalog.',
                    '',
                    `## Task`,
                    task,
                    context ? `\n## Context\n${context}` : '',
                ].filter(Boolean).join('\n'),
            },
        }],
    }),
);

// ---------------------------------------------------------------------------
// Prompt: writeSsjs
// ---------------------------------------------------------------------------

server.prompt(
    'writeSsjs',
    'Generate SSJS (Server-Side JavaScript) code for a specific task. Ensures ES5-compatible syntax and ' +
    'correct use of SFMC Platform APIs.',
    {
        task: z.string().describe('Description of what the SSJS code should do.'),
        context: z.string().optional().describe('Optional context about the SFMC environment or assets involved.'),
    },
    ({ task, context }) => ({
        messages: [{
            role: 'user',
            content: {
                type: 'text',
                text: [
                    'You are an expert Salesforce Marketing Cloud developer.',
                    'Generate SSJS code for the following task.',
                    '',
                    '## Rules',
                    '- SSJS runs in an ES5 engine. Use `var`, not `let`/`const`.',
                    '- No arrow functions, template literals, destructuring, or `class`.',
                    '- Wrap code in `<script runat="server">` ... `</script>`.',
                    '- Use `Platform.Load("core", "1.1.5");` before accessing Core library objects.',
                    '- Use `Platform.Function.*` for SFMC-specific functions (e.g. `Platform.Function.Lookup`).',
                    '- For SOAP API calls, use WSProxy: `var prox = new WSProxy();`',
                    '- Use `Platform.Response.Write()` to output content.',
                    '',
                    `## Task`,
                    task,
                    context ? `\n## Context\n${context}` : '',
                ].filter(Boolean).join('\n'),
            },
        }],
    }),
);

// ---------------------------------------------------------------------------
// Prompt: reviewSfmcCode
// ---------------------------------------------------------------------------

server.prompt(
    'reviewSfmcCode',
    'Review SFMC code for correctness, best practices, and potential issues. Provides actionable feedback.',
    {
        code: z.string().describe('The SFMC code to review.'),
        language: z.enum(['ampscript', 'ssjs', 'html', 'auto']).optional(),
        focus: z.string().optional().describe('Optional focus area, e.g. "security", "performance", "data extension usage".'),
    },
    ({ code, language = 'auto', focus }) => {
        const detectedLang = language === 'auto' ? detectLanguage(code) : detectLanguage(code, language as LanguageId);
        return {
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        `You are an expert Salesforce Marketing Cloud developer reviewing ${detectedLang.toUpperCase()} code.`,
                        'Identify bugs, anti-patterns, performance issues, and security concerns.',
                        focus ? `Focus especially on: ${focus}` : '',
                        '',
                        '## Code to Review',
                        '```' + (detectedLang === 'ssjs' ? 'javascript' : detectedLang),
                        code,
                        '```',
                        '',
                        '## Review checklist',
                        detectedLang === 'ampscript' ? [
                            '- Delimiter balance (%%[ ]%%, %%= =%%)',
                            '- IF/ENDIF, FOR/NEXT block balance',
                            '- Correct function names and argument counts',
                            '- Correct comment syntax (/* */ only)',
                            '- Proper variable declaration with @',
                        ].join('\n') : [
                            '- No ES6+ syntax (var, not let/const; no arrow functions)',
                            '- Platform.Load before Core library objects',
                            '- Correct Platform.Function calls',
                            '- WSProxy error handling',
                            '- No sensitive data in logs or responses',
                        ].join('\n'),
                    ].filter(Boolean).join('\n'),
                },
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Prompt: convertAmpscriptToSsjs
// ---------------------------------------------------------------------------

server.prompt(
    'convertAmpscriptToSsjs',
    'Convert AMPscript code to equivalent SSJS, preserving business logic while adapting to SSJS APIs.',
    {
        ampscript: z.string().describe('The AMPscript code to convert.'),
    },
    ({ ampscript }) => ({
        messages: [{
            role: 'user',
            content: {
                type: 'text',
                text: [
                    'Convert the following AMPscript code to equivalent SSJS.',
                    '',
                    '## Conversion rules',
                    '- AMPscript `Lookup()` → `Platform.Function.Lookup()` in SSJS',
                    '- AMPscript `LookupRows()` → `Platform.Function.LookupRows()` in SSJS',
                    '- AMPscript `@variable` → `var variable` in SSJS',
                    '- AMPscript `SET @x = value` → `var x = value;` in SSJS',
                    '- AMPscript `IF @x == "y" THEN` → `if (x === "y") {` in SSJS',
                    '- AMPscript `OUTPUT(CONCAT(...))` → `Platform.Response.Write(...)` in SSJS',
                    '- AMPscript `FOR @i = 1 TO 10 DO` → `for (var i = 1; i <= 10; i++) {` in SSJS',
                    '- Use `var`, not `let`/`const`. No arrow functions or template literals.',
                    '- Wrap in `<script runat="server">...</script>`.',
                    '- Add `Platform.Load("core", "1.1.5");` if using DataExtension, Rows, etc.',
                    '',
                    '## AMPscript to convert',
                    '```ampscript',
                    ampscript,
                    '```',
                ].join('\n'),
            },
        }],
    }),
);

// ---------------------------------------------------------------------------
// Prompt: answerMceHowTo
// ---------------------------------------------------------------------------

server.prompt(
    'answerMceHowTo',
    'Answer a Marketing Cloud **administration or setup** question using the bundled Engagement help search. ' +
    'Distinguishes Marketing Cloud Engagement from Marketing Cloud Next.',
    {
        question: z.string().describe('User question, e.g. how to enable a feature or set up a business unit.'),
        assumeProduct: z.enum(['engagement', 'next', 'unsure']).optional()
            .describe('Whether the user means classic Engagement, Marketing Cloud Next, or unknown (default: engagement).'),
    },
    ({ question, assumeProduct = 'engagement' }) => {
        const focusLine =
            assumeProduct === 'next'
                ? 'Use MCP tool `search_mce_help` with product_focus `next` or `any`, and the `mce-product-context` resource.'
                : assumeProduct === 'unsure'
                    ? 'Use `search_mce_help` with product_focus `any`; if results mix products, separate Engagement vs Next steps clearly.'
                    : 'Use `search_mce_help` with product_focus `engagement` first; only use `next` if the question is explicitly about Marketing Cloud Next.';
        return {
            messages: [{
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are a Salesforce Marketing Cloud specialist helping with **setup and operations** (not AMPscript/SSJS code unless asked).',
                        '',
                        '## Product scope',
                        '- **Marketing Cloud Engagement** = classic Email Studio, Journey Builder, Automation Studio, tenant/BU admin, etc.',
                        '- **Marketing Cloud Next** = a **different** Salesforce product; do not assume the same UI or steps as Engagement.',
                        '',
                        '## What to do',
                        '1. Read resource `sfmc://mce/product-context` if you need a refresher on Engagement vs Next.',
                        `2. ${focusLine}`,
                        '3. Cite which product your steps apply to. If the bundled excerpts are incomplete, say what is missing and suggest verifying in the live org or current Salesforce Help.',
                        '',
                        '## Question',
                        question,
                    ].join('\n'),
                },
            }],
        };
    },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('mcp-server-sfmc running on stdio\n');
}

main().catch((error: unknown) => {
    process.stderr.write(`Fatal: ${String(error)}\n`);
    process.exit(1);
});
