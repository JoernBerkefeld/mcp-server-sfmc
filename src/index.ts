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
    isMcnSupported,
    getMcnApiVersion,
    getMcnNotes,
    extractAmpscriptFunctionCalls,
    type SfmcSettings,
    type HandlebarsHelper,
} from 'sfmc-language-lsp';
import {
    getChunks,
    getMceHelpStats,
    searchMceHelp,
    type MceProductFocus,
} from './mce-help-search.js';
import { getMcnChunks, getMcnHelpStats, searchMcnHelp } from './mcn-help-search.js';
import {
    CLOUDPAGES_ONLY_FUNCTIONS,
    NON_MIGRATABLE_SSJS_PATTERNS,
    ssjsToAmpscript,
    ampscriptToSsjs,
    rewriteAmpForMcn,
    isSsjsBlockConvertible,
    ampscriptToHandlebars,
    handlebarsToAmpscript,
    ssjsToHandlebars,
    AMP_MCN_HANDLEBARS_GAP,
    HBS_GAP_NOTE,
} from './conversion-rules.js';
import {
    ECMASCRIPT_BUILTINS,
    KNOWN_UNSUPPORTED,
    polyfillByPrototypeName,
    polyfillByStaticName,
} from 'ssjs-data';

function projectPackageRoot(): string {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
}

const pkg = JSON.parse(
    fs.readFileSync(path.join(projectPackageRoot(), 'package.json'), 'utf8')
) as {
    version: string;
};

// ---------------------------------------------------------------------------
// Server instance
// ---------------------------------------------------------------------------

const SERVER_INSTRUCTIONS =
    'This server provides authoritative SFMC language intelligence and bundled Salesforce Marketing Cloud product help.\n\n' +
    '## Target platform — detect before writing or validating code\n\n' +
    'Before writing, validating, converting, or completing any AMPscript or SSJS code:\n' +
    '1. Call `detect_sfmc_platform` with the project root path.\n' +
    '   - Returns `"engagement"` (`.mcdevrc.json` found) → use `target: "engagement"`\n' +
    '   - Returns `"next"` (`sfdx-project.json` found) → use `target: "next"`\n' +
    '   - Returns `"unknown"` → ask the user: "Are you targeting Marketing Cloud Engagement (MCE) or Marketing Cloud Next (MCN)?"\n' +
    '2. Pass the resolved target to all language tools (`validate_*`, `suggest_fix`, `get_*_completions`).\n' +
    '3. When target is `"next"`: SSJS is **not supported** — do not generate SSJS. Only use AMPscript functions that are MCN-supported (check with `list_ampscript_functions` with `platform: "next"`).\n\n' +
    '## When to call search_mcn_help\n\n' +
    '**ALWAYS** call `search_mcn_help` before answering questions about Marketing Cloud Next **developer APIs**, ' +
    'objects, flows, segments, transactional messages, REST/SOAP APIs, or AMPscript behavior differences in MCN.\n\n' +
    '## When to call search_mce_help\n\n' +
    '**ALWAYS** call `search_mce_help` before answering any question about the following product areas ' +
    '(use the matching `product_focus` value for best results):\n\n' +
    '| Topic | product_focus |\n' +
    '|---|---|\n' +
    '| Marketing Cloud Engagement — setup, configuration, business units, tenant types, account hierarchy | `engagement` |\n' +
    '| Journey Builder, Automation Studio, campaigns, behavioral triggers | `engagement` |\n' +
    '| Email Studio, Content Builder, CloudPages | `engagement` |\n' +
    '| Mobile Studio (MobileConnect, MobilePush, GroupConnect) | `engagement` |\n' +
    '| Subscriptions, sending limits, suspended accounts, Einstein features | `engagement` |\n' +
    '| Advertising, Distributed Marketing, Marketing Cloud Connect | `engagement` |\n' +
    '| Contact Builder, Audience Builder, Data Extensions | `engagement` |\n' +
    '| Marketing Cloud Next migration, admin, setup, or operational overview | `next` |\n' +
    '| Marketing Cloud Personalization / Interaction Studio, real-time personalisation, A/B testing | `personalization` |\n' +
    '| Salesforce Personalization | `personalization` |\n' +
    '| Marketing Cloud Account Engagement / Pardot, B2B marketing automation, lead scoring | `account-engagement` |\n' +
    '| Marketing Cloud Intelligence / Datorama, cross-channel analytics, data pipelines | `intelligence` |\n' +
    '| Loyalty Management, loyalty programs, referral marketing, member engagement, vouchers | `loyalty` |\n\n' +
    'Do **not** answer these from general training data — call `search_mce_help` first, cite the product scope ' +
    'in the answer, and note when excerpts are incomplete.\n\n' +
    '## When to call language tools\n\n' +
    'For AMPscript/SSJS/GTL code tasks use `validate_*`, `lookup_*`, `review_change`, `suggest_fix`, etc. ' +
    'Do **not** guess function signatures — call `lookup_ampscript_function` or `lookup_ssjs_function`.\n\n' +
    '## SSJS authoring discipline — non-negotiable\n\n' +
    'When you write or convert SSJS you MUST treat this server (LSP + ssjs-data) as the **only** source of ' +
    'truth about what JavaScript works in the SFMC engine. Do **not** rely on your general JavaScript ' +
    'knowledge — the SFMC SSJS engine is an ES3/ES5-era dialect with many missing or broken built-ins.\n\n' +
    '1. **Verify every identifier before you use it.** For any SFMC API (Platform function, WSProxy, HTTP, ' +
    'global) or ECMAScript built-in (`Array`/`String`/`Math`/`JSON`/`Object`/`Date`/`RegExp`/global method or ' +
    'property), call `lookup_ssjs_function` first.\n' +
    '   - `supported` → use it normally.\n' +
    '   - `supported-with-caveat` → respect the caveat; if a polyfill is offered, emit the polyfill and use it.\n' +
    '   - `polyfillable` → **emit the returned ES3-safe polyfill source once** (after `Platform.Load`, before ' +
    'first use), then call the method normally. Never use the bare broken/unavailable method without its polyfill.\n' +
    '   - `unsupported` → do not use it; follow the suggestion (use a Platform.Function or a literal).\n' +
    '   - `unknown` → do not assume it works; prefer a catalogued built-in or Platform.Function.\n' +
    '2. **Always document the methods you write.** Every function/method you author in SSJS gets a JSDoc block ' +
    'immediately above it: a one-line description, one `@param` line per parameter (wrap the name in `[]` when ' +
    'optional, e.g. `@param {string} [prefix] - ...`) with a description, and a `@returns` line.\n' +
    '3. **Comment your code blocks.** Add a short comment line above each logical block (in both AMPscript and ' +
    'SSJS) explaining what it does, to aid readability.\n\n' +
    '## Unified help search shortcut\n\n' +
    'When you already know the project root, prefer `search_help` over calling `search_mce_help` or ' +
    '`search_mcn_help` directly. Pass `projectRoot` and `search_help` will auto-detect the platform ' +
    'and route the query to the right doc index (or both for MCN). Only fall back to the individual ' +
    'search tools when you need to scope by `product_focus` (MCE only) or when you are **certain** ' +
    'which doc index to target.';

const server = new McpServer(
    { name: 'mcp-server-sfmc', version: pkg.version },
    { instructions: SERVER_INSTRUCTIONS }
);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
    if (
        /<script[^>]+runat=['"]?server/i.test(code) ||
        /Platform\.(Load|Function|Variable)/i.test(code)
    )
        return 'ssjs';
    return 'ampscript';
}

function formatDiagnostics(diagnostics: ReturnType<typeof validateAmpscript>): string {
    if (diagnostics.length === 0) return 'No issues found.';
    return diagnostics
        .map((d) => {
            const sev = d.severity === 1 ? 'ERROR' : d.severity === 2 ? 'WARNING' : 'INFO';
            const loc = `line ${d.range.start.line + 1}, col ${d.range.start.character + 1}`;
            const message = typeof d.message === 'string' ? d.message : d.message.value;
            return `[${sev}] ${loc}: ${message}`;
        })
        .join('\n');
}

function formatHandlebarsHelper(helper: HandlebarsHelper): string {
    const params = helper.params
        .map((p) => {
            const req = p.optional ? '(optional)' : '(required)';
            const variadic = p.variadic ? ' (variadic)' : '';
            return `  - ${p.name}: ${p.type}${variadic} ${req}${p.description ? ' — ' + p.description : ''}`;
        })
        .join('\n');

    const subexpr = helper.subexpressionOnly
        ? '\n\n> Subexpression-only — may only be used inside `( … )`.'
        : '';

    return (
        `## {{${helper.name}}}\n\n` +
        `**Category:** ${helper.category}\n\n` +
        `**Origin:** ${helper.origin}\n\n` +
        `**Type:** ${helper.helperType}\n\n` +
        `**Returns:** ${helper.returnType}\n\n` +
        `**Description:** ${helper.description}\n\n` +
        `**Parameters:**\n${params || '  (none)'}` +
        subexpr +
        `\n\n✅ **Marketing Cloud Next:** Supported since API v${helper.mcnSince}.0` +
        (helper.docUrl ? `\n\n[Documentation](${helper.docUrl})` : '')
    );
}

// ---------------------------------------------------------------------------
// Tool: validate_ampscript
// ---------------------------------------------------------------------------

server.tool(
    'validate_ampscript',
    'Validate AMPscript code for syntax errors, unknown functions, arity mismatches, and style issues. ' +
        'Returns a list of diagnostics with line numbers and severity. ' +
        "Set target to 'next' to also report functions not supported in Marketing Cloud Next.",
    {
        code: z.string().describe('The AMPscript code to validate. May include HTML context.'),
        maxProblems: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Maximum number of problems to return (default 100).'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to flag AMPscript functions not supported in Marketing Cloud Next."
            ),
    },
    ({ code, maxProblems, target }) => {
        const settings: SfmcSettings = {
            maxNumberOfProblems: maxProblems ?? 100,
            targetPlatform: target,
        };
        const diagnostics = validateAmpscript(code, settings);
        return {
            content: [{ type: 'text', text: formatDiagnostics(diagnostics) }],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: validate_ssjs
// ---------------------------------------------------------------------------

server.tool(
    'validate_ssjs',
    'Validate SSJS (Server-Side JavaScript) code for unsupported ES6+ syntax, missing Platform.Load, ' +
        'and incorrect usage patterns. Returns diagnostics with line numbers. ' +
        "Set target to 'next' to flag all SSJS as unsupported (SSJS is not available in Marketing Cloud Next).",
    {
        code: z
            .string()
            .describe('The SSJS code to validate. May include <script runat="server"> tags.'),
        maxProblems: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Maximum number of problems to return (default 100).'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to flag SSJS code as unsupported in Marketing Cloud Next."
            ),
    },
    ({ code, maxProblems, target }) => {
        const settings: SfmcSettings = {
            maxNumberOfProblems: maxProblems ?? 100,
            targetPlatform: target,
        };
        const diagnostics = validateSsjs(code, settings);
        return {
            content: [{ type: 'text', text: formatDiagnostics(diagnostics) }],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: validate_sfmc_html
// ---------------------------------------------------------------------------

server.tool(
    'validate_sfmc_html',
    'Validate an HTML file that contains embedded AMPscript and/or SSJS blocks. ' +
        'Checks both languages and GTL template syntax. ' +
        "Set target to 'next' to flag MCN-unsupported AMPscript functions and all SSJS as errors.",
    {
        code: z
            .string()
            .describe(
                'HTML source that may contain %%[ ]%%, %%= =%%,  <script runat="server">, or {{ }} blocks.'
            ),
        maxProblems: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Maximum number of problems to return (default 100).'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to flag MCN-incompatible code (unsupported AMPscript functions and all SSJS)."
            ),
    },
    ({ code, maxProblems, target }) => {
        const limit = maxProblems ?? 100;
        const settings: SfmcSettings = { maxNumberOfProblems: limit, targetPlatform: target };
        const ampDiags = validateAmpscript(code, settings);
        const ssjsDiags = validateSsjs(code, settings);
        const gtlDiags: ReturnType<typeof validateAmpscript> = [];
        validateGtlBlocks(code, gtlDiags, limit);
        const all = [...ampDiags, ...ssjsDiags, ...gtlDiags].sort(
            (a, b) => a.range.start.line - b.range.start.line
        );
        return {
            content: [{ type: 'text', text: formatDiagnostics(all) }],
        };
    }
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

        // MCN compatibility badge
        const fnMcnSince = (fn as { mcnSince?: number | null }).mcnSince ?? null;
        const fnMcnNotes = (fn as { mcnNotes?: string | null }).mcnNotes ?? null;
        const mcnLine =
            fnMcnSince === null
                ? '\n\n❌ **Marketing Cloud Next:** Not supported'
                : `\n\n✅ **Marketing Cloud Next:** Supported since API v${fnMcnSince}.0` +
                  (fnMcnNotes ? `\n> **MCN Note:** ${fnMcnNotes}` : '');

        const text =
            `## ${fn.name}\n\n` +
            `**Category:** ${fn.category ?? 'Unknown'}\n\n` +
            `**Description:** ${fn.description ?? ''}\n\n` +
            `**Parameters:**\n${params || '  (none)'}` +
            examples +
            mcnLine;

        return { content: [{ type: 'text', text }] };
    }
);

// ---------------------------------------------------------------------------
// Tool: list_ampscript_functions
// ---------------------------------------------------------------------------

server.tool(
    'list_ampscript_functions',
    'List all AMPscript functions, optionally filtered by category and/or target platform. ' +
        "Use platform: 'next' to return only functions supported in Marketing Cloud Next.",
    {
        category: z
            .string()
            .optional()
            .describe(
                'Filter by function category (case-insensitive substring match), e.g. "data extension", "string", "date".'
            ),
        platform: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Filter by target platform. Use 'next' to show only functions available in Marketing Cloud Next (API v67.0+)."
            ),
    },
    ({ category, platform }) => {
        const all = sfmcLanguageService.listAmpscriptFunctions();
        let filtered = all as Array<{
            name: string;
            category?: string;
            description?: string;
            mcnSince?: number | null;
        }>;

        if (platform === 'next') {
            filtered = filtered.filter((f) => isMcnSupported(f.name));
        }

        if (category) {
            const catLower = category.toLowerCase();
            filtered = filtered.filter((f) => f.category?.toLowerCase().includes(catLower));
        }

        if (filtered.length === 0) {
            return {
                content: [{ type: 'text', text: 'No AMPscript functions match the filter.' }],
            };
        }

        const platformHeader =
            platform === 'next'
                ? '*(Marketing Cloud Next — API v67.0+ supported only)*'
                : '*(Marketing Cloud Engagement — all functions)*';

        const rows = filtered
            .map((f) => {
                const mcnTag = getMcnApiVersion(f.name) === null ? '' : ' ✅';
                return `- **${f.name}**${mcnTag} *(${f.category ?? 'Unknown'})*: ${f.description ?? ''}`;
            })
            .join('\n');

        const legend =
            platform === 'next' ? '' : '\n\n*Legend: ✅ = supported in Marketing Cloud Next*';

        return {
            content: [
                {
                    type: 'text',
                    text: `## AMPscript Functions ${platformHeader}\n\n${rows}${legend}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: validate_handlebars
// ---------------------------------------------------------------------------

server.tool(
    'validate_handlebars',
    'Validate Marketing Cloud Next (MCN) Handlebars template code. ' +
        'Checks helper names, arity, block balance, and flags unsupported constructs ' +
        '(partials, decorators, and built-in helpers absent from the locked-down MCN engine). ' +
        'MCN Handlebars lives inside the combined sfmc language and is always validated for the ' +
        "'next' target.",
    {
        code: z
            .string()
            .describe('The MCN Handlebars template code to validate. May include HTML context.'),
        maxProblems: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Maximum number of problems to return (default 100).'),
    },
    ({ code, maxProblems }) => {
        const settings: SfmcSettings = {
            maxNumberOfProblems: maxProblems ?? 100,
            targetPlatform: 'next',
        };
        const diagnostics = validateAmpscript(code, settings).filter(
            (d) => d.source === 'handlebars'
        );
        return {
            content: [{ type: 'text', text: formatDiagnostics(diagnostics) }],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: lookup_handlebars_helper
// ---------------------------------------------------------------------------

server.tool(
    'lookup_handlebars_helper',
    'Look up the signature, parameters, description, and origin for a Marketing Cloud Next ' +
        'Handlebars helper by name. Case-insensitive. Returns null if the helper is not found.',
    {
        name: z
            .string()
            .describe('The Handlebars helper name, e.g. "uppercase", "if", "formatDate".'),
    },
    ({ name }) => {
        const helper = sfmcLanguageService.lookupHandlebarsHelper(name);
        if (!helper) {
            return {
                content: [{ type: 'text', text: `Handlebars helper "${name}" not found.` }],
            };
        }
        return { content: [{ type: 'text', text: formatHandlebarsHelper(helper) }] };
    }
);

// ---------------------------------------------------------------------------
// Tool: list_handlebars_helpers
// ---------------------------------------------------------------------------

server.tool(
    'list_handlebars_helpers',
    'List all Marketing Cloud Next Handlebars helpers, optionally filtered by category ' +
        'and/or origin (handlebars-builtin, mcn-helper, mcn-platform).',
    {
        category: z
            .string()
            .optional()
            .describe(
                'Filter by helper category (case-insensitive substring match), e.g. "string", "date", "comparison".'
            ),
        origin: z
            .enum(['handlebars-builtin', 'mcn-helper', 'mcn-platform'])
            .optional()
            .describe('Filter by helper origin.'),
    },
    ({ category, origin }) => {
        let helpers = sfmcLanguageService.listHandlebarsHelpers();

        if (origin) {
            helpers = helpers.filter((h) => h.origin === origin);
        }
        if (category) {
            const catLower = category.toLowerCase();
            helpers = helpers.filter((h) => h.category.toLowerCase().includes(catLower));
        }

        if (helpers.length === 0) {
            return {
                content: [{ type: 'text', text: 'No Handlebars helpers match the filter.' }],
            };
        }

        const rows = helpers
            .map(
                (h) =>
                    `- **${h.name}** *(${h.category}, ${h.origin}, ${h.helperType})*: ${h.description}`
            )
            .join('\n');

        return {
            content: [
                {
                    type: 'text',
                    text: `## MCN Handlebars Helpers\n\n${rows}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// ECMAScript-builtin support lookup, sourced exclusively from ssjs-data.
// Used as a fall-through inside lookup_ssjs_function so a single tool answers
// "can I use X in SSJS?" for both SFMC APIs and plain-JavaScript built-ins.
// This is the ONLY sanctioned way for an agent to learn whether a plain-JS
// method/property works in the SFMC SSJS engine, whether it has a caveat, and —
// when broken/unavailable — whether a shipped polyfill exists and its source.
// ---------------------------------------------------------------------------

/**
 * Normalise an owner string to ssjs-data's `owner` convention.
 * @param owner - Raw owner hint, e.g. "Array", "String.prototype", "Math", "JSON".
 * @returns {string} The normalised owner, e.g. "Array.prototype".
 */
function normaliseOwner(owner: string): string {
    const o = owner.trim();
    // Accept "Array", "Array.prototype", "String.prototype", "Math", "JSON", etc.
    if (/^(Array|String)$/i.test(o))
        return `${o[0].toUpperCase()}${o.slice(1).toLowerCase()}.prototype`;
    return o;
}

interface SsjsMethodLookupResult {
    status: 'supported' | 'supported-with-caveat' | 'polyfillable' | 'unsupported' | 'unknown';
    text: string;
}

/**
 * Look up an ECMAScript built-in / polyfillable / known-unsupported member by
 * name (optionally disambiguated by owner) against the ssjs-data catalogs.
 * @param method - The method/property name, optionally fully qualified (e.g. "Array.prototype.slice", "slice").
 * @param [ownerHint] - Optional owner to disambiguate a bare method name (e.g. "Array.prototype", "Math").
 * @returns {SsjsMethodLookupResult} A status + rendered markdown text describing engine support and any polyfill.
 */
function lookupSsjsBuiltin(method: string, ownerHint?: string): SsjsMethodLookupResult {
    // Accept "Array.prototype.slice", "String.slice", "slice", "JSON.parse", "Math.max".
    let bareMethod = method.trim();
    let owner = ownerHint?.trim();
    const dotMatch = bareMethod.match(/^(.*)\.([A-Za-z0-9_$]+)$/);
    if (dotMatch && !owner) {
        owner = dotMatch[1];
        bareMethod = dotMatch[2];
    } else if (dotMatch && owner) {
        bareMethod = dotMatch[2];
    }
    const normOwner = owner ? normaliseOwner(owner) : undefined;

    const ownerMatches = (entryOwner: string): boolean => {
        if (!normOwner) return true;
        if (entryOwner.toLowerCase() === normOwner.toLowerCase()) return true;
        // also match e.g. owner "String" against "String.prototype"
        const ownerBase = normOwner.replace(/\.prototype$/i, '');
        const entryBase = entryOwner.replace(/\.prototype$/i, '');
        return ownerBase.toLowerCase() === entryBase.toLowerCase();
    };

    // 1. Supported built-in (possibly with a caveat)?
    const builtin = ECMASCRIPT_BUILTINS.find(
        (b) => b.name.toLowerCase() === bareMethod.toLowerCase() && ownerMatches(b.owner)
    );
    if (builtin) {
        const lines = [
            `## ${builtin.owner}.${builtin.name} — ✅ supported`,
            '',
            `**Description:** ${builtin.description}`,
        ];
        if (builtin.syntax) lines.push('', `**Syntax:** \`${builtin.syntax}\``);
        if (builtin.caveat) {
            lines.push('', `⚠️ **Caveat (SFMC engine):** ${builtin.caveat}`);
            // A caveat member may also be polyfillable — surface the polyfill too.
            const poly =
                polyfillByPrototypeName.get(bareMethod) ?? polyfillByStaticName.get(bareMethod);
            if (poly && ownerMatches(poly.owner)) {
                lines.push(
                    '',
                    '**Polyfill available** — emit this once before using the method to guarantee correct behaviour:',
                    '```javascript',
                    poly.polyfill,
                    '```'
                );
            } else {
                lines.push(
                    '',
                    'Apply the documented workaround in the caveat to avoid the broken form.'
                );
            }
            return { status: 'supported-with-caveat', text: lines.join('\n') };
        }
        return { status: 'supported', text: lines.join('\n') };
    }

    // 2. Polyfillable (unavailable or broken, but ssjs-data ships a polyfill)?
    const poly = polyfillByPrototypeName.get(bareMethod) ?? polyfillByStaticName.get(bareMethod);
    if (poly && ownerMatches(poly.owner)) {
        return {
            status: 'polyfillable',
            text: [
                `## ${poly.owner}.${poly.method} — 🔧 ${poly.category} (polyfill available)`,
                '',
                `**Description:** ${poly.description}`,
                '',
                'This member is **not safe to use directly** in SFMC SSJS. Emit the polyfill below **once** ' +
                    '(before first use, after `Platform.Load`) and then call the method normally:',
                '```javascript',
                poly.polyfill,
                '```',
            ].join('\n'),
        };
    }

    // 3. Known-unsupported (no shipped polyfill)?
    const unsupported = KNOWN_UNSUPPORTED.find(
        (u) => u.member.toLowerCase() === bareMethod.toLowerCase() && ownerMatches(u.owner)
    );
    if (unsupported) {
        return {
            status: 'unsupported',
            text: [
                `## ${unsupported.owner}.${unsupported.member} — ❌ ${unsupported.category} (no polyfill)`,
                '',
                `**Do not use this in SSJS.** ${unsupported.suggestion}`,
            ].join('\n'),
        };
    }

    // 4. Not catalogued.
    return {
        status: 'unknown',
        text:
            `SSJS function/method "${ownerHint ? `${ownerHint}.` : ''}${bareMethod}" not found in the ssjs-data ` +
            'catalogs (SFMC APIs, ECMAScript built-ins, polyfillable members, or known-unsupported members). ' +
            'Treat it as **unverified**: do not assume it works in SFMC SSJS. Prefer a documented ' +
            'Platform.Function or a catalogued built-in, or ask the user to confirm against a CloudPage test.',
    };
}

// ---------------------------------------------------------------------------
// Tool: lookup_ssjs_function
// ---------------------------------------------------------------------------

server.tool(
    'lookup_ssjs_function',
    'Authoritative lookup (sourced ONLY from the LSP + ssjs-data) for anything you want to use in SSJS. ' +
        'Call this BEFORE writing any SSJS identifier — do not rely on general JavaScript knowledge. ' +
        'Covers (a) SFMC APIs — Platform functions, WSProxy methods, HTTP methods, global functions (with ' +
        'signature, parameters, description, deprecation, Platform.Load requirement, static/alias metadata), and ' +
        '(b) plain-JavaScript ECMAScript built-ins (Array/String/Math/JSON/Object/Date/RegExp/global), returning ' +
        'one of: supported, supported-with-caveat (caveat + any polyfill), polyfillable (with ES3-safe polyfill ' +
        'source to emit), unsupported (no polyfill), or unknown. Case-insensitive. ' +
        'Examples: "Lookup", "Platform.Function.Lookup", "Array.prototype.slice", "JSON.parse", "Math.max".',
    {
        name: z
            .string()
            .describe(
                'The function/method/property name. May include a namespace or owner, e.g. "Platform.Function.Lookup", "Array.prototype.slice", "JSON.parse", "Math.max", or a bare name like "Lookup" or "slice".'
            ),
        owner: z
            .string()
            .optional()
            .describe(
                'Optional owner to disambiguate a bare ECMAScript built-in name, e.g. "Array.prototype", "String.prototype", "Math", "JSON".'
            ),
    },
    ({ name, owner }) => {
        // Strip namespace prefix for lookup
        const bare = name.replace(
            /^(Platform\.(Function|Variable|Response|Request|ClientBrowser|Recipient|DateTime)\.|WSProxy\.|HTTP\.|Script\.Util\.|Function\.|Variable\.|Response\.|Request\.)/i,
            ''
        );
        const fn = sfmcLanguageService.lookupSsjsFunction(bare);
        if (!fn) {
            // Fall through to the ECMAScript built-in / polyfill / unsupported catalogs.
            const builtinResult = lookupSsjsBuiltin(name, owner);
            return { content: [{ type: 'text', text: builtinResult.text }] };
        }

        const params = (fn.params ?? [])
            .map(
                (p: {
                    name: string;
                    type?: string;
                    required?: boolean;
                    optional?: boolean;
                    description?: string;
                }) => {
                    const isOptional = p.optional || p.required === false;
                    const req = isOptional ? '(optional)' : '(required)';
                    return `  - ${p.name}: ${p.type ?? 'any'} ${req}${p.description ? ' — ' + p.description : ''}`;
                }
            )
            .join('\n');

        const badges: string[] = [];
        if (fn.deprecated) {
            badges.push('⚠️ **Deprecated** — avoid in new code.');
        }
        if (fn.requiresCoreLoad) {
            badges.push(
                '⚠️ **Requires** `Platform.Load("core", "1.1.5")` before calling this method.'
            );
        }

        const header = fn.isStatic ? `## ${fn.name} *(static)*` : `## ${fn.name}`;
        const badgeBlock = badges.length > 0 ? badges.join('\n') + '\n\n' : '';
        const aliasLine = fn.aliasOf ? `**Alias of:** \`${fn.aliasOf}\`\n\n` : '';

        const text =
            `${header}\n\n` +
            badgeBlock +
            aliasLine +
            `**Description:** ${fn.description ?? ''}\n\n` +
            `**Parameters:**\n${params || '  (none)'}\n\n` +
            `**Returns:** ${fn.returnType ?? 'void'}`;

        return { content: [{ type: 'text', text }] };
    }
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
        language: z
            .enum(['ampscript', 'ssjs', 'html', 'auto'])
            .optional()
            .describe('Language of the changed file. Defaults to "auto" for automatic detection.'),
        maxProblems: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
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
        const detectedLang =
            language === 'auto'
                ? detectLanguage(addedCode)
                : (language as LanguageId) === 'html'
                  ? detectLanguage(addedCode, 'html')
                  : (language as 'ampscript' | 'ssjs');

        const settings: SfmcSettings = { maxNumberOfProblems: maxProblems };
        const doc = { text: addedCode, languageId: detectedLang, uri: 'diff' };
        const diagnostics = sfmcLanguageService.validate(doc, settings);

        if (diagnostics.length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `No issues found in the ${detectedLang.toUpperCase()} changes.`,
                    },
                ],
            };
        }

        const output = [`## SFMC Code Review — ${detectedLang.toUpperCase()} changes\n`];
        for (const d of diagnostics) {
            const sev = d.severity === 1 ? '🔴 ERROR' : d.severity === 2 ? '🟡 WARNING' : '🔵 INFO';
            const origLine = lineMap[d.range.start.line] ?? d.range.start.line + 1;
            const message = typeof d.message === 'string' ? d.message : d.message.value;
            output.push(`${sev} (diff line ${origLine}): ${message}`);
        }

        return { content: [{ type: 'text', text: output.join('\n') }] };
    }
);

// ---------------------------------------------------------------------------
// Tool: suggest_fix
// ---------------------------------------------------------------------------

server.tool(
    'suggest_fix',
    'Generate a corrected version of SFMC code based on validation diagnostics. ' +
        'Returns the original code with inline fix suggestions or a corrected replacement. ' +
        "Set target to 'next' to include MCN platform compatibility in the analysis.",
    {
        code: z.string().describe('The SFMC code snippet to fix.'),
        language: z
            .enum(['ampscript', 'ssjs', 'html', 'auto'])
            .optional()
            .describe('Language of the code. Defaults to "auto".'),
        issueDescription: z
            .string()
            .optional()
            .describe('Optional human description of the specific issue to fix.'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to flag MCN-incompatible functions and SSJS usage."
            ),
    },
    ({ code, language = 'auto', issueDescription, target }) => {
        const detectedLang =
            language === 'auto'
                ? detectLanguage(code)
                : detectLanguage(code, language as LanguageId);
        const settings: SfmcSettings = { maxNumberOfProblems: 50, targetPlatform: target };
        const doc = { text: code, languageId: detectedLang, uri: 'fix-target' };
        const diagnostics = sfmcLanguageService.validate(doc, settings);

        const lines = code.split('\n');
        const suggestions: string[] = [];

        for (const d of diagnostics) {
            const lineText = lines[d.range.start.line] ?? '';
            // Diagnostic.message widened to `string | MarkupContent` in newer LSP types; the
            // SFMC language service only emits plain strings, so unwrap MarkupContent to its value.
            const message = typeof d.message === 'string' ? d.message : d.message.value;
            suggestions.push(
                `Line ${d.range.start.line + 1}: ${message}\n` +
                    `  Code: ${lineText.trim()}\n` +
                    `  Fix: ${getFixSuggestion(message, lineText, detectedLang)}`
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
    }
);

/**
 * Generate a human-readable fix hint for common diagnostics.
 * @param message
 * @param line
 * @param lang
 */
function getFixSuggestion(message: string, line: string, lang: 'ampscript' | 'ssjs'): string {
    const m = message.toLowerCase();
    // MCN Handlebars diagnostics (surfaced when target === 'next' on {{…}} regions).
    if (m.includes('partials ({{>'))
        return 'Inline the partial content directly — the locked-down MCN engine cannot register partials.';
    if (m.includes('partial blocks'))
        return 'Inline the block content directly — the MCN engine cannot register partial blocks.';
    if (m.includes('decorators ({{*') || m.includes('decorator blocks'))
        return 'Remove the decorator — the MCN engine cannot register decorators.';
    if (m.includes('{{log}}'))
        return 'Remove the {{log}} debugging helper — it is not available in MCN Handlebars.';
    if (m.includes('unknown handlebars helper')) {
        const helperMatch = message.match(/'([^']+)'/);
        const hint = helperMatch
            ? ` Check spelling or use a catalog helper instead of "${helperMatch[1]}".`
            : '';
        return `Use a helper from the MCN Handlebars catalog (list_handlebars_helpers); custom helpers cannot be registered.${hint}`;
    }
    if (m.includes('handlebars for marketing cloud next') || m.includes('mcn engine'))
        return 'Replace with a supported MCN Handlebars construct — see list_handlebars_helpers.';
    if (m.includes("'let'") || m.includes("'const'")) return 'Replace `let`/`const` with `var`.';
    if (m.includes('arrow function')) return 'Replace `() =>` with `function() {}`.';
    if (m.includes('template literal')) return 'Replace `` `${x}` `` with `"" + x + ""`.';
    if (m.includes('platform.load'))
        return 'Add `Platform.Load("core", "1.1.5");` before using Core library objects.';
    if (m.includes('unclosed')) return 'Add the matching closing delimiter.';
    if (m.includes('// '))
        return 'AMPscript does not support `//` comments. Use `/* comment */` instead.';
    if (m.includes('html comment'))
        return 'Remove the `<!-- -->` wrapper; use `/* comment */` inside AMPscript.';
    if (m.includes('unknown function')) {
        const fnMatch = message.match(/"([^"]+)"/);
        if (fnMatch)
            return `Check spelling — did you mean a known AMPscript function? ("${fnMatch[1]}")`;
    }
    if (m.includes('expects'))
        return 'Check the number and types of arguments against the function signature.';
    if (lang === 'ssjs' && line.includes('Platform.Load'))
        return 'Use the correct version string, e.g. "1.1.5".';
    return 'Review the relevant SFMC documentation for the correct syntax.';
}

// ---------------------------------------------------------------------------
// Tool: get_ampscript_completions
// ---------------------------------------------------------------------------

server.tool(
    'get_ampscript_completions',
    'Return a list of AMPscript function names, keywords, and variable names available at a given position in the code. ' +
        "Set target to 'next' to filter completions to only MCN-supported functions.",
    {
        code: z.string().describe('The full AMPscript document text.'),
        line: z.number().int().min(0).describe('Zero-based line number of the cursor position.'),
        character: z.number().int().min(0).describe('Zero-based character offset within the line.'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to return only completions supported in Marketing Cloud Next."
            ),
    },
    ({ code, line, character, target }) => {
        const doc = { text: code, languageId: 'ampscript' as const, uri: 'completions' };
        let items = sfmcLanguageService.getCompletions(doc, { line, character });

        if (target === 'next') {
            items = items.filter((item) => {
                const label =
                    typeof item.label === 'string'
                        ? item.label
                        : (item.label as { label: string }).label;
                // Keep keywords and variables (non-function entries); filter out MCN-unsupported functions
                return !label.includes('(') || isMcnSupported(label.replace(/\(.*/, '').trim());
            });
        }

        const formatted = items
            .slice(0, 50)
            .map((item) => {
                const label =
                    typeof item.label === 'string'
                        ? item.label
                        : (item.label as { label: string }).label;
                return `- ${label}${item.detail ? ` — ${item.detail}` : ''}`;
            })
            .join('\n');
        const total = items.length;
        const platformNote =
            target === 'next' ? ' (Marketing Cloud Next — MCN-supported only)' : '';
        return {
            content: [
                {
                    type: 'text',
                    text:
                        total === 0
                            ? 'No completions at this position (cursor is outside an AMPscript block).'
                            : `${total} completions available${platformNote} (showing up to 50):\n\n${formatted}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: get_ssjs_completions
// ---------------------------------------------------------------------------

server.tool(
    'get_ssjs_completions',
    'Return a list of SSJS Platform functions, WSProxy methods, and other SFMC-specific identifiers available for completion. ' +
        "When target is 'next', returns an empty list with a note — SSJS is not supported in Marketing Cloud Next.",
    {
        filter: z
            .string()
            .optional()
            .describe('Optional prefix filter, e.g. "Platform.Function" or "WSProxy".'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to indicate MCN context — SSJS is not available in MCN."
            ),
    },
    ({ filter, target }) => {
        if (target === 'next') {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'SSJS is not supported in Marketing Cloud Next (MCN). Use AMPscript instead. Call `get_ampscript_completions` with `target: "next"` for MCN-compatible function completions.',
                    },
                ],
            };
        }

        const items = sfmcLanguageService.getSsjsCompletionCatalog();
        const filtered = filter
            ? items.filter((item) => {
                  const label =
                      typeof item.label === 'string'
                          ? item.label
                          : (item.label as { label: string }).label;
                  return label.toLowerCase().startsWith(filter.toLowerCase());
              })
            : items;

        const formatted = filtered
            .slice(0, 80)
            .map((item) => {
                const label =
                    typeof item.label === 'string'
                        ? item.label
                        : (item.label as { label: string }).label;
                return `- ${label}${item.detail ? ` — ${item.detail}` : ''}`;
            })
            .join('\n');

        return {
            content: [
                {
                    type: 'text',
                    text:
                        filtered.length === 0
                            ? `No SSJS completions matching "${filter}".`
                            : `${filtered.length} SSJS completions${filter ? ` matching "${filter}"` : ''} (showing up to 80):\n\n${formatted}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: get_handlebars_completions
// ---------------------------------------------------------------------------

server.tool(
    'get_handlebars_completions',
    'Return Marketing Cloud Next (MCN) Handlebars helper completions with snippet insert text. ' +
        'MCN Handlebars is only available on the next platform, so this catalog is always the ' +
        '\'next\' set. Optionally filter by a name prefix (e.g. "form", "date").',
    {
        filter: z
            .string()
            .optional()
            .describe('Optional helper-name prefix filter (case-insensitive), e.g. "form", "to".'),
    },
    ({ filter }) => {
        const items = sfmcLanguageService.getHandlebarsCompletionCatalog();
        const filtered = filter
            ? items.filter((item) => {
                  const label =
                      typeof item.label === 'string'
                          ? item.label
                          : (item.label as { label: string }).label;
                  return label.toLowerCase().startsWith(filter.toLowerCase());
              })
            : items;

        const formatted = filtered
            .slice(0, 80)
            .map((item) => {
                const label =
                    typeof item.label === 'string'
                        ? item.label
                        : (item.label as { label: string }).label;
                return `- ${label}${item.detail ? ` — ${item.detail}` : ''}`;
            })
            .join('\n');

        return {
            content: [
                {
                    type: 'text',
                    text:
                        filtered.length === 0
                            ? `No MCN Handlebars helpers matching "${filter}".`
                            : `${filtered.length} MCN Handlebars helper completions${filter ? ` matching "${filter}"` : ''} (showing up to 80):\n\n${formatted}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: format_sfmc_code (basic, no prettier integration needed)
// ---------------------------------------------------------------------------

/**
 * Conservatively normalize whitespace inside Marketing Cloud Next (MCN)
 * Handlebars `{{…}}` mustaches: collapse runs of internal whitespace to a
 * single space and trim the edges (e.g. `{{ foo   bar }}` → `{{foo bar}}`),
 * matching what Prettier's Glimmer parser does for mustache interiors.
 *
 * Hard guardrails (never altered):
 * - `{!$…}` merge-field bindings — they are not Handlebars syntax.
 * - `{{!-- … --}}` / `{{! … }}` comments — preserved byte-for-byte.
 *
 * This is the deferred-Prettier stub for item 8 of the MCN Handlebars handoff:
 * full routing through prettier-plugin-sfmc's Glimmer path lands once that
 * plugin ships Handlebars support (see HANDOFF-prettier-handlebars.md).
 * @param {string} code - The Handlebars-in-HTML code to normalize.
 * @returns {string} The code with mustache interiors normalized.
 */
function normalizeHandlebarsWhitespace(code: string): string {
    return code.replaceAll(/\{\{([\s\S]*?)\}\}/g, (full, inner: string) => {
        // Preserve comments verbatim.
        if (inner.startsWith('!')) {
            return full;
        }
        const normalized = inner.replaceAll(/\s+/g, ' ').trim();
        return `{{${normalized}}}`;
    });
}

server.tool(
    'format_sfmc_code',
    'Apply basic formatting conventions to AMPscript, SSJS, or Marketing Cloud Next (MCN) ' +
        'Handlebars code. Normalises keyword casing and whitespace. For Handlebars, collapses ' +
        'whitespace inside {{…}} mustaches while leaving {!$…} bindings and {{!-- … --}} comments ' +
        'untouched. (Handlebars formatting is a conservative whitespace normalizer; full Prettier ' +
        'Glimmer routing is deferred until prettier-plugin-sfmc ships Handlebars support.)',
    {
        code: z.string().describe('The SFMC code to format.'),
        language: z.enum(['ampscript', 'ssjs', 'handlebars']).describe('The language of the code.'),
    },
    ({ code, language }) => {
        let formatted = code;

        if (language === 'ampscript') {
            // Normalise AMPscript block keywords to uppercase
            formatted = formatted
                .replaceAll(
                    /\b(if|elseif|else|endif|for|to|downto|step|next|set|var|do|output)\b/gi,
                    (m) => m.toUpperCase()
                )
                .replaceAll(/\bAND\b/gi, 'AND')
                .replaceAll(/\bOR\b/gi, 'OR')
                .replaceAll(/\bNOT\b/gi, 'NOT');
        } else if (language === 'handlebars') {
            formatted = normalizeHandlebarsWhitespace(formatted);
        } else {
            // SSJS: normalise Platform.Load to use double quotes
            formatted = formatted.replaceAll(
                /Platform\.Load\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g,
                'Platform.Load("$1", "$2")'
            );
        }

        return { content: [{ type: 'text', text: formatted }] };
    }
);

// ---------------------------------------------------------------------------
// Tool: search_mce_help
// ---------------------------------------------------------------------------

const MCE_HELP_TOOL_DESC =
    '**Prefer this over training data** for any Salesforce Marketing Cloud operational or administrative question. ' +
    'Searches bundled Salesforce Help excerpts across **7 product areas**:\n' +
    '- **Marketing Cloud Engagement** (`engagement`) — Email Studio, Journey Builder, Automation Studio, Content Builder, Mobile Studio, business units, campaigns, subscriptions\n' +
    '- **Marketing Cloud Next** (`next`) — next-gen platform, migration path from Engagement\n' +
    '- **Marketing Cloud Personalization / Interaction Studio** (`personalization`) — real-time personalisation, A/B testing, behavioral targeting\n' +
    '- **Salesforce Personalization** (`personalization`) — next-generation personalisation engine\n' +
    '- **Marketing Cloud Account Engagement / Pardot** (`account-engagement`) — B2B marketing automation, lead scoring, forms, Salesforce CRM sync\n' +
    '- **Marketing Cloud Intelligence / Datorama** (`intelligence`) — cross-channel analytics, data pipelines, KPI reporting\n' +
    '- **Loyalty Management** (`loyalty`) — loyalty programs, referral marketing, member engagement, vouchers, promotions\n\n' +
    'Use `product_focus` to restrict results to a single product area. Default `any` searches all products.';

server.tool(
    'search_mce_help',
    MCE_HELP_TOOL_DESC,
    {
        query: z
            .string()
            .describe(
                'Keywords or question text (e.g. "enable business unit", "new child account").'
            ),
        limit: z.number().int().min(1).max(25).optional().describe('Max results (default 10).'),
        product_focus: z
            .enum([
                'any',
                'engagement',
                'next',
                'personalization',
                'account-engagement',
                'intelligence',
                'loyalty',
            ])
            .optional()
            .describe(
                'Restrict results to a product area: `engagement` (MCE — Email Studio, Journey Builder, etc.), ' +
                    '`next` (Marketing Cloud Next), `personalization` (MC Personalization / Interaction Studio / Salesforce Personalization), ' +
                    '`account-engagement` (Pardot / MC Account Engagement), `intelligence` (Datorama / MC Intelligence), ' +
                    '`loyalty` (Loyalty Management), or `any` to search all products (default).'
            ),
    },
    ({ query, limit = 10, product_focus = 'any' }) => {
        const focus = product_focus as MceProductFocus;
        const hits = searchMceHelp(query, limit, focus);
        if (hits.length === 0) {
            const stats = getMceHelpStats();
            const hint =
                stats.chunkCount === 0
                    ? 'Bundled help index missing. Run `npm run bundle-mce-help` from the package folder and set ' +
                      '`MCE_HELP_DOCS` to the root of your mirrored Help Markdown tree (see `scripts/bundle-mce-help.mjs`).'
                    : `No matches for this query with product_focus="${focus}". Try broader keywords or product_focus="any".`;
            return { content: [{ type: 'text', text: hint }] };
        }
        const lines = hits.map((h, i) => {
            const excerpt = h.chunk.body.replaceAll(/\s+/g, ' ').slice(0, 520);
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
    }
);

// ---------------------------------------------------------------------------
// Resource: ampscript-function-catalog
// ---------------------------------------------------------------------------

server.resource('ampscript-function-catalog', 'sfmc://ampscript/functions', async () => {
    const functions = sfmcLanguageService.getAllAmpscriptFunctions();
    const lines = functions.map((fn) => {
        const paramList = fn.params
            .map((p: { name: string; type?: string; optional?: boolean }) =>
                p.optional ? `[${p.name}: ${p.type ?? 'any'}]` : `${p.name}: ${p.type ?? 'any'}`
            )
            .join(', ');
        return `${fn.name}(${paramList}) — ${fn.description ?? ''}`;
    });
    return {
        contents: [
            {
                uri: 'sfmc://ampscript/functions',
                mimeType: 'text/plain',
                text:
                    `# AMPscript Function Catalog (${functions.length} functions)\n\n` +
                    lines.join('\n'),
            },
        ],
    };
});

// ---------------------------------------------------------------------------
// Resource: ssjs-function-catalog
// ---------------------------------------------------------------------------

server.resource('ssjs-function-catalog', 'sfmc://ssjs/functions', async () => {
    const functions = sfmcLanguageService.getAllSsjsFunctions();
    const lines = functions.map((fn) => {
        const paramList = (fn.params ?? [])
            .map((p: { name: string; type?: string; required?: boolean; optional?: boolean }) =>
                p.optional || p.required === false
                    ? `[${p.name}: ${p.type ?? 'any'}]`
                    : `${p.name}: ${p.type ?? 'any'}`
            )
            .join(', ');
        return `${fn.name}(${paramList}) — ${fn.description ?? ''}`;
    });
    return {
        contents: [
            {
                uri: 'sfmc://ssjs/functions',
                mimeType: 'text/plain',
                text:
                    `# SSJS Function Catalog (${functions.length} functions)\n\n` +
                    lines.join('\n'),
            },
        ],
    };
});

// ---------------------------------------------------------------------------
// Resource: handlebars-helper-catalog
// ---------------------------------------------------------------------------

server.resource('handlebars-helper-catalog', 'sfmc://handlebars/helpers', async () => {
    const helpers = sfmcLanguageService.listHandlebarsHelpers();
    const lines = helpers.map((h) => {
        const paramList = h.params
            .map((p) => {
                const inner = `${p.name}: ${p.type}`;
                return p.optional ? `[${inner}]` : inner;
            })
            .join(', ');
        return `{{${h.name} ${paramList}}} — (${h.category}, ${h.origin}, v${h.mcnSince}.0+) ${h.description}`;
    });
    return {
        contents: [
            {
                uri: 'sfmc://handlebars/helpers',
                mimeType: 'text/plain',
                text:
                    `# MCN Handlebars Helper Catalog (${helpers.length} helpers)\n\n` +
                    lines.join('\n'),
            },
        ],
    };
});

// ---------------------------------------------------------------------------
// Resource: handlebars-binding-catalog
// ---------------------------------------------------------------------------

server.resource('handlebars-binding-catalog', 'sfmc://handlebars/bindings', async () => {
    const bindings = sfmcLanguageService.listHandlebarsBindings();
    const lines = bindings.map(
        (b) => `${b.token} — (${b.namespace}, v${b.mcnSince}.0+) ${b.description}`
    );
    return {
        contents: [
            {
                uri: 'sfmc://handlebars/bindings',
                mimeType: 'text/plain',
                text:
                    `# MCN Handlebars Built-in Binding Catalog (${bindings.length} bindings)\n\n` +
                    lines.join('\n'),
            },
        ],
    };
});

// ---------------------------------------------------------------------------
// Resource: ampscript-keywords
// ---------------------------------------------------------------------------

server.resource('ampscript-keywords', 'sfmc://ampscript/keywords', async () => {
    const keywords = sfmcLanguageService.getAmpscriptKeywords();
    return {
        contents: [
            {
                uri: 'sfmc://ampscript/keywords',
                mimeType: 'text/plain',
                text: `# AMPscript Keywords\n\n${keywords.join(', ')}`,
            },
        ],
    };
});

// ---------------------------------------------------------------------------
// Resource: ssjs-unsupported-syntax
// ---------------------------------------------------------------------------

server.resource('ssjs-unsupported-syntax', 'sfmc://ssjs/unsupported-syntax', async () => {
    const items = sfmcLanguageService.getUnsupportedSsjsSyntax();
    const lines = items.map((item) => `- **${item.pattern}**: ${item.message}`);
    return {
        contents: [
            {
                uri: 'sfmc://ssjs/unsupported-syntax',
                mimeType: 'text/markdown',
                text: `# SSJS Unsupported Syntax\n\nThese ES6+ features are not supported in Salesforce Marketing Cloud SSJS:\n\n${lines.join('\n')}`,
            },
        ],
    };
});

// ---------------------------------------------------------------------------
// Resource: mce-product-context (Engagement vs Next)
// ---------------------------------------------------------------------------

const MCE_VS_NEXT_MD = `# Salesforce Marketing Cloud Product Guide

Use this when interpreting **search_mce_help** results or answering user questions about Salesforce Marketing Cloud products.

## Marketing Cloud Engagement (MCE) — \`product_focus: engagement\`

The established Marketing Cloud platform many teams mean when they say "Marketing Cloud": Email Studio, Journey Builder, Automation Studio, Content Builder, Mobile Studio, business-unit administration, subscription management, and related setup. When a user asks a generic MCE operational question without naming a specific product, default to \`product_focus: engagement\`.

## Marketing Cloud Next — \`product_focus: next\`

A **separate product** Salesforce positions as the long-term direction and migration path from Engagement. Feature coverage and UI paths differ from classic Engagement. Use \`next\` or \`any\` only when the user explicitly asks about Next or migration to Next.

## Marketing Cloud Personalization / Interaction Studio — \`product_focus: personalization\`

Real-time personalisation engine for web, email, and app experiences. Formerly branded as Interaction Studio. Includes A/B testing, behavioral triggers, and Einstein personalisation. Also covers the newer **Salesforce Personalization** product (successor branding). Use \`product_focus: personalization\` for both.

## Marketing Cloud Account Engagement (Pardot) — \`product_focus: account-engagement\`

B2B marketing automation platform tightly integrated with Salesforce CRM. Covers lead scoring, nurture journeys, forms, landing pages, Engagement Studio, and reporting. Formerly known as Pardot.

## Marketing Cloud Intelligence (Datorama) — \`product_focus: intelligence\`

Cross-channel marketing analytics and data pipeline platform. Covers KPI reporting, data connectors, ingestion pipelines (MDP), dashboards, and marketplace apps. Formerly branded as Datorama.

## Loyalty Management — \`product_focus: loyalty\`

Salesforce Loyalty Management covers loyalty program setup, tiers, points, vouchers, promotions, referral marketing (including B2B referral), member engagement widgets, and data privacy for loyalty data.

## Practical rules

- Generic operational question with no product named → **Engagement** (\`product_focus: engagement\`).
- Question about personalisation, Interaction Studio, or visitor tracking → **personalization**.
- Question about Pardot, lead scoring, or B2B automation → **account-engagement**.
- Question about reporting dashboards, Datorama, or data pipelines → **intelligence**.
- Question about loyalty programs, vouchers, referrals, or member engagement → **loyalty**.
- Question mentions Next, migration to Next, or "Next for Engagement" → **next**.
- Unsure which product → use \`product_focus: any\` and disambiguate from the \`productLabel\` in each result.
`;

server.resource('mce-product-context', 'sfmc://mce/product-context', async () => ({
    contents: [
        {
            uri: 'sfmc://mce/product-context',
            mimeType: 'text/markdown',
            text: MCE_VS_NEXT_MD,
        },
    ],
}));

// ---------------------------------------------------------------------------
// Resource: mce-help index (bundled files)
// ---------------------------------------------------------------------------

server.resource('mce-help-index', 'sfmc://mce/help-index', async () => {
    const chunks = getChunks();
    const files = [...new Set(chunks.map((c) => c.relativePath))].sort();
    const stats = getMceHelpStats();
    const scopeRows = Object.entries(stats.breakdown)
        .sort(([, a], [, b]) => b - a)
        .map(([scope, count]) => `| ${scope} | ${count} |`)
        .join('\n');
    const text =
        `# Bundled Marketing Cloud help (${stats.chunkCount} sections from ${files.length} files)\n\n` +
        `| Product scope | Sections |\n| --- | ---: |\n${scopeRows}\n\n` +
        `## Files\n\n` +
        files.map((f) => `- ${f}`).join('\n');
    return {
        contents: [{ uri: 'sfmc://mce/help-index', mimeType: 'text/markdown', text }],
    };
});

// ---------------------------------------------------------------------------
// Resource: mcn-help index (bundled files)
// ---------------------------------------------------------------------------

server.resource('mcn-help-index', 'sfmc://mcn/help-index', async () => {
    const chunks = getMcnChunks();
    const files = [...new Set(chunks.map((c) => c.relativePath))].sort();
    const stats = getMcnHelpStats();
    const text =
        `# Bundled Marketing Cloud Next developer API docs (${stats.chunkCount} sections from ${stats.fileCount} files)\n\n` +
        `## Files\n\n` +
        files.map((f) => `- ${f}`).join('\n');
    return {
        contents: [{ uri: 'sfmc://mcn/help-index', mimeType: 'text/markdown', text }],
    };
});

// ---------------------------------------------------------------------------
// Tool: detect_sfmc_platform
// ---------------------------------------------------------------------------

server.tool(
    'detect_sfmc_platform',
    'Detect the target SFMC platform for a project by checking for sentinel files. ' +
        'Returns "engagement" if .mcdevrc.json is present, "next" if sfdx-project.json is present, ' +
        'or "unknown" if neither is found. Call this before writing, validating, or converting code.',
    {
        projectRoot: z.string().describe('Absolute path to the project root directory to inspect.'),
    },
    ({ projectRoot }) => {
        if (fs.existsSync(path.join(projectRoot, '.mcdevrc.json'))) {
            return { content: [{ type: 'text', text: 'engagement' }] };
        }
        if (fs.existsSync(path.join(projectRoot, 'sfdx-project.json'))) {
            return { content: [{ type: 'text', text: 'next' }] };
        }
        return { content: [{ type: 'text', text: 'unknown' }] };
    }
);

// ---------------------------------------------------------------------------
// Tool: search_mcn_help
// ---------------------------------------------------------------------------

server.tool(
    'search_mcn_help',
    'Search bundled Marketing Cloud Next developer API documentation. ' +
        'Covers MCN objects, flows, segments, transactional messages, AMPscript behavior in MCN, ' +
        'and REST/SOAP API references. Use this for MCN developer questions; ' +
        'use search_mce_help for MCN migration or operational/admin questions.',
    {
        query: z
            .string()
            .describe(
                'The search query, e.g. "AMPscript FormatDate MCN", "transactional message API", "segment objects".'
            ),
        limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe('Maximum number of result chunks to return (default 5).'),
    },
    ({ query, limit = 5 }) => {
        const hits = searchMcnHelp(query, limit);
        if (hits.length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `No MCN developer docs found for "${query}". The bundled index may not cover this topic — check the live Salesforce developer docs at https://developer.salesforce.com/docs/marketing/marketing-cloud-growth/`,
                    },
                ],
            };
        }
        const parts = hits.map(({ chunk }) => {
            const header = `### ${chunk.heading}\n*Source: ${chunk.relativePath}*`;
            return `${header}\n\n${chunk.body}`;
        });
        return {
            content: [
                {
                    type: 'text',
                    text: `# MCN Developer Docs — "${query}" (${hits.length} results)\n\n${parts.join('\n\n---\n\n')}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: search_help (unified wrapper — auto-detects platform)
// ---------------------------------------------------------------------------

server.tool(
    'search_help',
    'Unified help search that automatically detects the target platform (MCE or MCN) from the project ' +
        'root and routes the query to the right bundled doc index. For MCN projects it searches both the ' +
        'Marketing Cloud Next developer API reference (`search_mcn_help`) and the MCN operational/admin ' +
        'help (`search_mce_help` with product_focus:"next") and merges the results. For MCE projects it ' +
        'searches the full MCE help index (`search_mce_help` with product_focus:"any"). ' +
        'Pass `projectRoot` to enable auto-detection, or set `target` explicitly to skip detection.',
    {
        query: z.string().describe('Keywords or question text to search for.'),
        projectRoot: z
            .string()
            .optional()
            .describe(
                'Absolute path to the project root directory. Used to auto-detect the platform by ' +
                    'checking for `.mcdevrc.json` (MCE) or `sfdx-project.json` (MCN). ' +
                    'Omit if you already know the target platform.'
            ),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                'Override the detected platform. `engagement` → MCE help only; `next` → MCN developer ' +
                    'docs + MCN operational help. When both `projectRoot` and `target` are given, ' +
                    '`target` takes precedence.'
            ),
        limit: z
            .number()
            .int()
            .min(1)
            .max(20)
            .optional()
            .describe('Maximum total results to return across all searched indexes (default 8).'),
    },
    ({ query, projectRoot, target, limit = 8 }) => {
        // Resolve effective platform
        let platform: 'engagement' | 'next' | 'unknown' = 'unknown';
        if (target) {
            platform = target;
        } else if (projectRoot) {
            if (fs.existsSync(path.join(projectRoot, '.mcdevrc.json'))) platform = 'engagement';
            else if (fs.existsSync(path.join(projectRoot, 'sfdx-project.json'))) platform = 'next';
        }

        const sections: string[] = [];

        if (platform === 'next') {
            // MCN: search both the developer API reference and the MCN operational/admin help
            const devHits = searchMcnHelp(query, Math.ceil(limit / 2));
            const opsHits = searchMceHelp(query, Math.floor(limit / 2), 'next' as MceProductFocus);

            if (devHits.length > 0) {
                const parts = devHits.map(
                    ({ chunk }) =>
                        `### ${chunk.heading}\n*Source: ${chunk.relativePath}*\n\n${chunk.body}`
                );
                sections.push(`## MCN Developer API Docs\n\n${parts.join('\n\n---\n\n')}`);
            }
            if (opsHits.length > 0) {
                const parts = opsHits.map((h, i) => {
                    const excerpt = h.chunk.body.replaceAll(/\s+/g, ' ').slice(0, 520);
                    return (
                        `### ${i + 1}. ${h.chunk.relativePath} — ${h.chunk.heading}\n` +
                        `**Score:** ${h.score}\n\n` +
                        `${excerpt}${h.chunk.body.length > 520 ? '…' : ''}`
                    );
                });
                sections.push(`## MCN Operational / Admin Docs\n\n${parts.join('\n\n---\n\n')}`);
            }
            if (sections.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text:
                                `No MCN results found for "${query}". ` +
                                'Check https://developer.salesforce.com/docs/marketing/marketing-cloud-growth/ for developer API content ' +
                                'or https://help.salesforce.com for operational guidance.',
                        },
                    ],
                };
            }
        } else {
            // MCE (or unknown platform — search the full MCE help index)
            const focus: MceProductFocus = 'any';
            const hits = searchMceHelp(query, limit, focus);
            if (hits.length === 0) {
                const stats = getMceHelpStats();
                const hint =
                    stats.chunkCount === 0
                        ? 'Bundled help index missing. Run `npm run bundle-mce-help` from the package folder.'
                        : `No results found for "${query}". Try broader keywords.`;
                return { content: [{ type: 'text', text: hint }] };
            }
            const parts = hits.map((h, i) => {
                const excerpt = h.chunk.body.replaceAll(/\s+/g, ' ').slice(0, 520);
                return (
                    `### ${i + 1}. ${h.chunk.relativePath} — ${h.chunk.heading}\n` +
                    `**Product:** ${h.chunk.productLabel}\n` +
                    `**Score:** ${h.score}\n\n` +
                    `${excerpt}${h.chunk.body.length > 520 ? '…' : ''}`
                );
            });
            sections.push(parts.join('\n\n---\n\n'));
        }

        const platformLabel =
            platform === 'next'
                ? 'Marketing Cloud Next'
                : platform === 'engagement'
                  ? 'Marketing Cloud Engagement'
                  : 'all products';
        return {
            content: [
                {
                    type: 'text',
                    text: `# Help Search — "${query}" (${platformLabel})\n\n${sections.join('\n\n---\n\n')}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: writeAmpscript
// ---------------------------------------------------------------------------

server.prompt(
    'writeAmpscript',
    'Generate AMPscript code for a specific task. Ensures correct syntax, proper use of delimiters, ' +
        'and references to real SFMC functions. Supports both Marketing Cloud Engagement and Next targets.',
    {
        task: z.string().describe('Description of what the AMPscript code should do.'),
        context: z
            .string()
            .optional()
            .describe('Optional context about the email, landing page, or SFMC configuration.'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to restrict output to MCN-supported AMPscript functions only."
            ),
    },
    ({ task, context, target }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer.',
                        `Generate AMPscript code for the following task. Target platform: **${target === 'next' ? 'Marketing Cloud Next (MCN)' : 'Marketing Cloud Engagement (MCE)'}**.`,
                        '',
                        '## Rules',
                        '- Use `%%[ ]%%` for block-level code and `%%= =%%` for inline output.',
                        '- Keywords (SET, VAR, IF, ENDIF, FOR, NEXT, OUTPUT) must be uppercase.',
                        '- Variables start with `@`. Example: `SET @myVar = "value"`',
                        '- Use `/* */` for comments — never `//` or `<!-- -->`.',
                        '- All function names are case-insensitive but conventionally PascalCase.',
                        '- Do NOT use ES6+ syntax (this is not JavaScript).',
                        '- Validate your output against the AMPscript function catalog.',
                        target === 'next'
                            ? [
                                  '',
                                  '## Marketing Cloud Next (MCN) constraints',
                                  '- Only use functions available in MCN (API v67.0+). Call `list_ampscript_functions` with `platform: "next"` to verify.',
                                  '- FormatDate uses Java SimpleDateFormat patterns (not .NET). Example: `yyyy-MM-dd` instead of `yyyy-MM-dd`.',
                                  '- Lookup requires an even number of search arguments (column/value pairs).',
                                  '- StringToDate returns a locale-formatted string in MCN — do not chain it with FormatDate.',
                              ].join('\n')
                            : '',
                        '',
                        `## Task`,
                        task,
                        context ? `\n## Context\n${context}` : '',
                    ]
                        .filter(Boolean)
                        .join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Prompt: writeSsjs
// ---------------------------------------------------------------------------

server.prompt(
    'writeSsjs',
    'Generate SSJS (Server-Side JavaScript) code for a specific task. Ensures ES5-compatible syntax and ' +
        'correct use of SFMC Platform APIs. If target is "next", redirects to AMPscript instead.',
    {
        task: z.string().describe('Description of what the SSJS code should do.'),
        context: z
            .string()
            .optional()
            .describe('Optional context about the SFMC environment or assets involved.'),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. If 'next', the prompt will explain that SSJS is not supported and suggest AMPscript alternatives."
            ),
    },
    ({ task, context, target }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text:
                        target === 'next'
                            ? [
                                  '⚠️ **Marketing Cloud Next (MCN) does not support SSJS.** SSJS is not available in MCN.',
                                  '',
                                  'Instead, use **AMPscript** — MCN supports a subset of AMPscript functions (API v67.0+).',
                                  'Call `list_ampscript_functions` with `platform: "next"` to see which functions are available.',
                                  'Then call `writeAmpscript` with `target: "next"` to generate MCN-compatible AMPscript code.',
                                  '',
                                  `## Original task (for AMPscript rewrite reference)`,
                                  task,
                                  context ? `\n## Context\n${context}` : '',
                              ]
                                  .filter(Boolean)
                                  .join('\n')
                            : [
                                  'You are an expert Salesforce Marketing Cloud developer.',
                                  'Generate SSJS code for the following task.',
                                  '',
                                  '## Rules',
                                  '- SSJS runs in an ES3/ES5-era engine. Use `var`, not `let`/`const`.',
                                  '- No arrow functions, template literals, destructuring, or `class`.',
                                  '- Wrap code in `<script runat="server">` ... `</script>`.',
                                  '- Use `Platform.Load("core", "1.1.5");` before accessing Core library objects.',
                                  '- Use `Platform.Function.*` for SFMC-specific functions (e.g. `Platform.Function.Lookup`).',
                                  '- For SOAP API calls, use WSProxy: `var prox = new Script.Util.WSProxy();`',
                                  '- Use `Platform.Response.Write()` to output content.',
                                  '',
                                  '## ECMAScript built-ins — verify, never assume',
                                  'The SFMC engine is missing or breaks many standard JS built-ins. Do **NOT** rely on',
                                  'your own JavaScript knowledge for what works. For every `Array`/`String`/`Math`/`JSON`/',
                                  '`Object`/`Date`/`RegExp`/global method or property you intend to use:',
                                  '- Call the `lookup_ssjs_function` tool first.',
                                  '- If it reports `supported` → use it as-is.',
                                  '- If it reports `supported-with-caveat` → respect the caveat; emit the offered polyfill if any.',
                                  '- If it reports `polyfillable` → paste the returned ES3-safe polyfill source **once**',
                                  '  (after `Platform.Load`, before first use), then call the method normally.',
                                  '- If it reports `unsupported` → do not use it; follow the suggested workaround.',
                                  '- If it reports `unknown` → do not assume it works; pick a catalogued alternative.',
                                  '',
                                  '## Documentation & readability — always',
                                  '- Add a JSDoc block above **every** function/method you write: a one-line description,',
                                  '  one `@param` line per parameter (wrap the name in `[]` when the parameter is optional,',
                                  '  e.g. `@param {string} [prefix] - description`) with a description, and a `@returns` line.',
                                  '- Add a short comment line above each logical block of code explaining what it does.',
                                  '',
                                  `## Task`,
                                  task,
                                  context ? `\n## Context\n${context}` : '',
                              ]
                                  .filter(Boolean)
                                  .join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Prompt: reviewSfmcCode
// ---------------------------------------------------------------------------

server.prompt(
    'reviewSfmcCode',
    'Review SFMC code for correctness, best practices, and potential issues. Provides actionable feedback. ' +
        "Set target to 'next' to also check for Marketing Cloud Next compatibility.",
    {
        code: z.string().describe('The SFMC code to review.'),
        language: z.enum(['ampscript', 'ssjs', 'html', 'auto']).optional(),
        focus: z
            .string()
            .optional()
            .describe(
                'Optional focus area, e.g. "security", "performance", "data extension usage".'
            ),
        target: z
            .enum(['engagement', 'next'])
            .optional()
            .describe(
                "Target platform. Use 'next' to include MCN compatibility in the review (flags unsupported functions and SSJS)."
            ),
    },
    ({ code, language = 'auto', focus, target }) => {
        const detectedLang =
            language === 'auto'
                ? detectLanguage(code)
                : detectLanguage(code, language as LanguageId);
        const platformNote =
            target === 'next'
                ? '\n- **Marketing Cloud Next compatibility**: Flag any AMPscript functions not supported in MCN (API v67.0+), and any SSJS blocks (SSJS is not supported in MCN).'
                : '';
        return {
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: [
                            `You are an expert Salesforce Marketing Cloud developer reviewing ${detectedLang.toUpperCase()} code` +
                                (target
                                    ? ` for target platform **${target === 'next' ? 'Marketing Cloud Next (MCN)' : 'Marketing Cloud Engagement (MCE)'}**`
                                    : '') +
                                '.',
                            'Identify bugs, anti-patterns, performance issues, and security concerns.',
                            focus ? `Focus especially on: ${focus}` : '',
                            '',
                            '## Code to Review',
                            '```' + (detectedLang === 'ssjs' ? 'javascript' : detectedLang),
                            code,
                            '```',
                            '',
                            '## Review checklist',
                            detectedLang === 'ampscript'
                                ? [
                                      '- Delimiter balance (%%[ ]%%, %%= =%%)',
                                      '- IF/ENDIF, FOR/NEXT block balance',
                                      '- Correct function names and argument counts',
                                      '- Correct comment syntax (/* */ only)',
                                      '- Proper variable declaration with @',
                                  ].join('\n') + platformNote
                                : [
                                      '- No ES6+ syntax (var, not let/const; no arrow functions)',
                                      '- Platform.Load before Core library objects',
                                      '- Correct Platform.Function calls',
                                      '- WSProxy error handling',
                                      '- No sensitive data in logs or responses',
                                  ].join('\n') + platformNote,
                        ]
                            .filter(Boolean)
                            .join('\n'),
                    },
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: convertAmpscriptToSsjs
// ---------------------------------------------------------------------------

server.prompt(
    'convertAmpscriptToSsjs',
    'Convert AMPscript code to equivalent SSJS, preserving business logic while adapting to SSJS APIs. ' +
        'Calls the convertAmpscriptToSsjs tool first for deterministic rule-based conversion, ' +
        'then applies AI reasoning to handle any MANUAL_REWRITE_REQUIRED sections.',
    {
        ampscript: z.string().describe('The AMPscript code to convert to SSJS.'),
    },
    ({ ampscript }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer converting AMPscript to SSJS.',
                        '',
                        '## Instructions',
                        '1. Call the `convertAmpscriptToSsjs` **tool** with the code below to get a deterministic conversion.',
                        '2. Review the `flaggedSections` in the result — these are constructs the tool could not convert automatically.',
                        '3. For each flagged section, apply your expertise:',
                        '   - Email-specific functions (ContentArea, TreatAsContent, etc.) → use equivalent SSJS Content or Server.EscapeJavaScript approaches',
                        '   - Personalization strings (%%FirstName%% etc.) → use Platform.Variable/Recipient equivalents',
                        '   - AMPscript-only data lookups → translate to SSJS DataExtension / WSProxy where appropriate',
                        '4. Produce a single final SSJS code block.',
                        '5. Add a short change log as a bulleted list.',
                        '',
                        '## SSJS rules',
                        '- Use `var`, not `let`/`const`. No arrow functions, template literals, or destructuring.',
                        '- Wrap in `<script runat="server">...</script>`.',
                        '- Add `Platform.Load("Core", "1.1.5");` if using DataExtension, Rows, etc.',
                        '- AMPscript functions → `Platform.Function.*` equivalents.',
                        '- AMPscript `@variable` → bare `variable` in SSJS.',
                        '- AMPscript `Output` / `OutputLine` → `Platform.Response.Write()`.',
                        '',
                        '## AMPscript to convert',
                        '```ampscript',
                        ampscript,
                        '```',
                    ].join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Prompt: answerMceHowTo
// ---------------------------------------------------------------------------

server.prompt(
    'answerMceHowTo',
    'Answer a Marketing Cloud **administration or setup** question using the bundled help search. ' +
        'Covers Marketing Cloud Engagement, Next, Personalization, Account Engagement (Pardot), Intelligence (Datorama), and Loyalty Management.',
    {
        question: z
            .string()
            .describe('User question, e.g. how to enable a feature or set up a business unit.'),
        assumeProduct: z
            .enum([
                'engagement',
                'next',
                'personalization',
                'account-engagement',
                'intelligence',
                'loyalty',
                'unsure',
            ])
            .optional()
            .describe('Which product area the question is about (default: engagement).'),
    },
    ({ question, assumeProduct = 'engagement' }) => {
        const focusMap: Record<string, string> = {
            next: 'Use `search_mce_help` with product_focus `next` or `any`, and the `mce-product-context` resource.',
            personalization:
                'Use `search_mce_help` with product_focus `personalization`. This covers both Marketing Cloud Personalization (Interaction Studio) and Salesforce Personalization.',
            'account-engagement':
                'Use `search_mce_help` with product_focus `account-engagement` (covers Pardot / Marketing Cloud Account Engagement).',
            intelligence:
                'Use `search_mce_help` with product_focus `intelligence` (covers Datorama / Marketing Cloud Intelligence and Data Pipelines).',
            loyalty:
                'Use `search_mce_help` with product_focus `loyalty` (covers Loyalty Management and Referral Marketing).',
            unsure: 'Use `search_mce_help` with product_focus `any`. Read the `productLabel` on each result to identify which product area each excerpt comes from.',
        };
        const focusLine =
            focusMap[assumeProduct] ??
            'Use `search_mce_help` with product_focus `engagement` first; only switch to another focus if the question explicitly targets a different product.';
        return {
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: [
                            'You are a Salesforce Marketing Cloud specialist helping with **setup and operations** (not AMPscript/SSJS code unless asked).',
                            '',
                            '## Product areas covered',
                            '- **Marketing Cloud Engagement** = classic Email Studio, Journey Builder, Automation Studio, Content Builder, Mobile Studio, tenant/BU admin',
                            '- **Marketing Cloud Next** = a **different** Salesforce product; do not assume the same UI or steps as Engagement',
                            '- **Marketing Cloud Personalization / Interaction Studio** = real-time personalisation, A/B testing, behavioral targeting',
                            '- **Marketing Cloud Account Engagement (Pardot)** = B2B marketing automation, lead scoring, Salesforce CRM sync',
                            '- **Marketing Cloud Intelligence (Datorama)** = cross-channel analytics, data pipelines, KPI reporting',
                            '- **Loyalty Management** = loyalty programs, referral marketing, vouchers, member engagement',
                            '',
                            '## What to do',
                            '1. Read resource `sfmc://mce/product-context` if you need a refresher on product differences.',
                            `2. ${focusLine}`,
                            '3. Always state which product your answer applies to. If excerpts are incomplete, say so and recommend verifying in the live org or current Salesforce Help.',
                            '',
                            '## Question',
                            question,
                        ].join('\n'),
                    },
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: check_mcn_compatibility
// ---------------------------------------------------------------------------

server.tool(
    'check_mcn_compatibility',
    'Analyze one or more AMPscript/HTML files for Marketing Cloud Next (MCN) readiness. ' +
        'Returns an executive summary and a per-file, per-function report with migration difficulty. ' +
        'SSJS blocks that only use Platform.Function.* calls are classified as "Needs conversion" (not "Not migratable"). ' +
        'Use this tool before using rewrite_for_mcn.',
    {
        files: z
            .array(
                z.object({
                    filename: z.string().describe('File name (e.g. "email-template.html").'),
                    content: z.string().describe('Full file content to analyze.'),
                })
            )
            .describe('List of files to analyze.'),
    },
    ({ files }) => {
        type AmpFunctionStatus = 'supported' | 'needs-review' | 'not-supported';
        type SsjsBlockStatus = 'needs-conversion' | 'not-migratable';
        type FileDifficulty = 'ready' | 'minor' | 'significant' | 'not-migratable';

        interface AmpFunctionEntry {
            name: string;
            line: number;
            status: AmpFunctionStatus;
            reason: string;
        }

        interface SsjsBlockEntry {
            index: number;
            lineApprox: number;
            status: SsjsBlockStatus;
            reason: string;
        }

        interface HandlebarsProblemEntry {
            line: number;
            severity: 'error' | 'warning' | 'info';
            message: string;
        }

        interface HandlebarsHelperUsage {
            name: string;
            line: number;
            mcnSince: number;
        }

        interface FileResult {
            filename: string;
            difficulty: FileDifficulty;
            ampFunctions: AmpFunctionEntry[];
            ssjsBlocks: SsjsBlockEntry[];
            handlebarsProblems: HandlebarsProblemEntry[];
            handlebarsHelpers: HandlebarsHelperUsage[];
        }

        const results: FileResult[] = [];

        for (const { filename, content } of files) {
            const ampFunctions: AmpFunctionEntry[] = [];
            const ssjsBlocks: SsjsBlockEntry[] = [];

            // 1. Extract and classify AMPscript function calls
            const callSites = extractAmpscriptFunctionCalls(content);
            for (const site of callSites) {
                const mcnSince = getMcnApiVersion(site.name);
                const notes = getMcnNotes(site.name);
                let status: AmpFunctionStatus;
                let reason: string;

                const isHbsGap = AMP_MCN_HANDLEBARS_GAP.has(site.name.toLowerCase());

                if (isHbsGap) {
                    // Category C: documented as MCN-supported but no working Handlebars
                    // helper exists yet — fails at runtime. Always needs-review, even when
                    // mcnSince is set, because the data flags a runtime gap.
                    status = 'needs-review';
                    reason = `${site.name}() is ${HBS_GAP_NOTE}`;
                } else if (mcnSince !== null && notes === null) {
                    status = 'supported';
                    reason = '—';
                } else if (mcnSince !== null && notes !== null) {
                    status = 'needs-review';
                    reason = notes;
                } else {
                    status = 'not-supported';
                    reason = 'No MCN equivalent';
                    // Refine for CloudPages-specific functions
                    if (CLOUDPAGES_ONLY_FUNCTIONS.has(site.name.toLowerCase())) {
                        reason = `${site.name}() is a CloudPages-specific function (not available in MCN)`;
                    }
                }

                ampFunctions.push({ name: site.name, line: site.line + 1, status, reason });
            }

            // 2. Detect and classify SSJS blocks
            const ssjsBlockPattern =
                /<script[^>]+runat=['"]?server['"]?[^>]*>([\s\S]*?)<\/script>/gi;
            let blockMatch: RegExpExecArray | null;
            let blockIndex = 0;
            while ((blockMatch = ssjsBlockPattern.exec(content)) !== null) {
                blockIndex++;
                const blockCode = blockMatch[1];
                const lineApprox = content.slice(0, blockMatch.index).split('\n').length;

                // Check for non-migratable patterns
                let notMigratableReason = '';
                for (const { pattern, reason } of NON_MIGRATABLE_SSJS_PATTERNS) {
                    pattern.lastIndex = 0;
                    if (pattern.test(blockCode)) {
                        notMigratableReason = reason;
                        break;
                    }
                }

                if (notMigratableReason) {
                    ssjsBlocks.push({
                        index: blockIndex,
                        lineApprox,
                        status: 'not-migratable',
                        reason: notMigratableReason,
                    });
                } else {
                    ssjsBlocks.push({
                        index: blockIndex,
                        lineApprox,
                        status: 'needs-conversion',
                        reason: 'Contains only convertible SSJS patterns — use convertSsjsToAmpscript',
                    });
                }
            }

            // 2b. Analyze MCN Handlebars regions (only meaningful for the 'next' target).
            // Diagnostics flag unsupported constructs (partials, decorators, built-in
            // helpers absent from the locked-down engine), unknown helpers, and arity.
            const handlebarsProblems: HandlebarsProblemEntry[] = [];
            const handlebarsHelpers: HandlebarsHelperUsage[] = [];
            if (content.includes('{{')) {
                const hbsDiagnostics = validateAmpscript(content, {
                    maxNumberOfProblems: 200,
                    targetPlatform: 'next',
                }).filter((d) => d.source === 'handlebars');

                for (const d of hbsDiagnostics) {
                    const severity =
                        d.severity === 1 ? 'error' : d.severity === 2 ? 'warning' : 'info';
                    const message = typeof d.message === 'string' ? d.message : d.message.value;
                    handlebarsProblems.push({
                        line: d.range.start.line + 1,
                        severity,
                        message,
                    });
                }

                // Report recognized helper usages with their MCN availability version.
                // Helper names are matched against handlebars-data via the LSP lookup so
                // this stays data-driven (no hand-maintained helper list).
                const helperCallPattern = /\{\{[#/]?\s*([a-zA-Z][\w-]*)/g;
                const seenHelper = new Set<string>();
                let helperMatch: RegExpExecArray | null;
                while ((helperMatch = helperCallPattern.exec(content)) !== null) {
                    const token = helperMatch[1];
                    const helper = sfmcLanguageService.lookupHandlebarsHelper(token);
                    if (!helper) {
                        continue;
                    }
                    const line = content.slice(0, helperMatch.index).split('\n').length;
                    const dedupeKey = `${helper.name}@${line}`;
                    if (seenHelper.has(dedupeKey)) {
                        continue;
                    }
                    seenHelper.add(dedupeKey);
                    handlebarsHelpers.push({ name: helper.name, line, mcnSince: helper.mcnSince });
                }
            }

            // 3. Assess per-file difficulty
            const hasCloudPagesFn = ampFunctions.some(
                (f) =>
                    CLOUDPAGES_ONLY_FUNCTIONS.has(f.name.toLowerCase()) &&
                    f.status === 'not-supported'
            );
            const hasNotMigratableSsjs = ssjsBlocks.some((b) => b.status === 'not-migratable');
            const hasUnsupportedAmp = ampFunctions.some(
                (f) =>
                    f.status === 'not-supported' &&
                    !CLOUDPAGES_ONLY_FUNCTIONS.has(f.name.toLowerCase())
            );
            const hasConvertibleSsjs = ssjsBlocks.some((b) => b.status === 'needs-conversion');
            const hasNeedsReview = ampFunctions.some((f) => f.status === 'needs-review');
            const hasHandlebarsError = handlebarsProblems.some((p) => p.severity === 'error');
            const hasHandlebarsWarning = handlebarsProblems.some((p) => p.severity === 'warning');

            let difficulty: FileDifficulty;
            if (hasCloudPagesFn || hasNotMigratableSsjs) {
                difficulty = 'not-migratable';
            } else if (hasUnsupportedAmp || hasConvertibleSsjs || hasHandlebarsError) {
                difficulty = 'significant';
            } else if (hasNeedsReview || hasHandlebarsWarning) {
                difficulty = 'minor';
            } else {
                difficulty = 'ready';
            }

            results.push({
                filename,
                difficulty,
                ampFunctions,
                ssjsBlocks,
                handlebarsProblems,
                handlebarsHelpers,
            });
        }

        // 4. Build Markdown report
        const difficultyLabel: Record<string, string> = {
            ready: 'Ready',
            minor: 'Minor changes needed',
            significant: 'Significant rewrite required',
            'not-migratable': 'Not migratable',
        };

        const counts = {
            ready: results.filter((r) => r.difficulty === 'ready').length,
            minor: results.filter((r) => r.difficulty === 'minor').length,
            significant: results.filter((r) => r.difficulty === 'significant').length,
            notMigratable: results.filter((r) => r.difficulty === 'not-migratable').length,
        };

        const totalFiles = results.length;
        const effortLevels =
            counts.notMigratable > 0
                ? 'Not possible'
                : counts.significant > 0
                  ? 'Hard'
                  : counts.minor > 0
                    ? 'Medium'
                    : 'Easy';

        const summaryLines = [
            '## MCN Compatibility Report',
            '',
            '### Executive Summary',
            `- ${counts.ready}/${totalFiles} files: Ready`,
            `- ${counts.minor}/${totalFiles} files: Minor changes needed`,
            `- ${counts.significant}/${totalFiles} files: Significant rewrite required`,
            `- ${counts.notMigratable}/${totalFiles} files: Not migratable`,
            '',
            `Overall migration effort: **${effortLevels}**`,
            '',
            '---',
        ];

        const fileLines: string[] = [];
        for (const result of results) {
            const label = difficultyLabel[result.difficulty] ?? result.difficulty;
            fileLines.push('', `### ${result.filename} — ${label}`, '');

            if (result.ssjsBlocks.length > 0) {
                fileLines.push('**SSJS Blocks:**', '');
                for (const block of result.ssjsBlocks) {
                    const icon = block.status === 'needs-conversion' ? '🔄' : '🚫';
                    const statusLabel =
                        block.status === 'needs-conversion' ? 'Needs conversion' : 'Not migratable';
                    fileLines.push(
                        `${icon} SSJS block ${block.index} (≈line ${block.lineApprox}): **${statusLabel}** — ${block.reason}`
                    );
                }
                fileLines.push('');
            }

            if (result.ampFunctions.length > 0) {
                fileLines.push('| Function | Line | Status | Reason |', '|---|---|---|---|');
                for (const fn of result.ampFunctions) {
                    const icon =
                        fn.status === 'supported'
                            ? '✅'
                            : fn.status === 'needs-review'
                              ? '⚠️'
                              : '❌';
                    const statusLabel =
                        fn.status === 'supported'
                            ? 'Supported'
                            : fn.status === 'needs-review'
                              ? 'Needs review'
                              : 'Not supported';
                    fileLines.push(
                        `| ${fn.name} | ${fn.line} | ${icon} ${statusLabel} | ${fn.reason} |`
                    );
                }
            } else if (
                result.ssjsBlocks.length === 0 &&
                result.handlebarsProblems.length === 0 &&
                result.handlebarsHelpers.length === 0
            ) {
                fileLines.push('*No AMPscript functions, SSJS blocks, or Handlebars found.*');
            }

            if (result.handlebarsHelpers.length > 0) {
                fileLines.push('', '**MCN Handlebars Helpers:**', '');
                for (const h of result.handlebarsHelpers) {
                    fileLines.push(
                        `✅ \`{{${h.name}}}\` (line ${h.line}): Supported since API v${h.mcnSince}.0`
                    );
                }
            }

            if (result.handlebarsProblems.length > 0) {
                fileLines.push('', '**MCN Handlebars Problems:**', '');
                for (const p of result.handlebarsProblems) {
                    const icon =
                        p.severity === 'error' ? '❌' : p.severity === 'warning' ? '⚠️' : 'ℹ️';
                    fileLines.push(`${icon} Line ${p.line}: ${p.message}`);
                }
            }

            fileLines.push('', '---');
        }

        return {
            content: [
                {
                    type: 'text',
                    text: [...summaryLines, ...fileLines].join('\n'),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: rewrite_for_mcn
// ---------------------------------------------------------------------------

server.tool(
    'rewrite_for_mcn',
    'Deterministically rewrite AMPscript (and optionally SSJS) code for Marketing Cloud Next compatibility. ' +
        'Handles: FormatDate(StringToDate(x)) simplification, .NET→Java format strings, ' +
        'MCE-only function annotations, SSJS→AMPscript rule-based conversion. ' +
        'Flags complex constructs as MANUAL_REWRITE_REQUIRED. ' +
        'Use the rewrite_for_mcn PROMPT (not this tool) for AI-enhanced handling of MANUAL_REWRITE_REQUIRED sections.',
    {
        code: z.string().describe('The AMPscript or HTML code to rewrite for MCN.'),
        context: z
            .enum(['email', 'cloudpage', 'auto'])
            .optional()
            .default('auto')
            .describe(
                "Content context. Use 'cloudpage' to immediately flag as not migratable. Default 'auto' detects context."
            ),
    },
    ({ code, context = 'auto' }) => {
        // CloudPage detection
        const isCloudPage =
            context === 'cloudpage' ||
            (context === 'auto' &&
                /\b(CloudPagesURL|RequestParameter|QueryParameter)\s*\(/i.test(code));

        if (isCloudPage) {
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            rewrittenCode: code,
                            changes: [],
                            nonMigratableItems: [
                                {
                                    line: 1,
                                    code: 'CloudPage context detected',
                                    reason: 'CloudPages (RequestParameter, QueryParameter, CloudPagesURL, Redirect) are not available in Marketing Cloud Next. This use case cannot be migrated.',
                                },
                            ],
                            difficulty: 'not-migratable',
                            summary: 'CloudPage context — not available in Marketing Cloud Next',
                        }),
                    },
                ],
            };
        }

        // Rewrite AMPscript portions
        const ampResult = rewriteAmpForMcn(code, {
            isMcnSupportedFn: isMcnSupported,
            getMcnNotesFn: getMcnNotes,
        });

        let finalCode = ampResult.rewrittenCode;
        const allChanges = [...ampResult.changes];
        const allNonMigratable = [...ampResult.nonMigratableItems];

        // Convert SSJS blocks to AMPscript
        const ssjsPattern = /<script[^>]+runat=['"]?server['"]?[^>]*>[\s\S]*?<\/script>/gi;
        finalCode = finalCode.replaceAll(ssjsPattern, (ssjsBlock: string) => {
            if (!isSsjsBlockConvertible(ssjsBlock)) {
                allNonMigratable.push({
                    line: 0,
                    code: ssjsBlock.slice(0, 100),
                    reason: 'SSJS block contains non-migratable constructs',
                });
                return (
                    ssjsBlock +
                    '\n%%-- MANUAL_REWRITE_REQUIRED: Non-migratable SSJS block above --%% '
                );
            }
            const ssjsResult = ssjsToAmpscript(ssjsBlock);
            for (const c of ssjsResult.changes) {
                allChanges.push({ line: c.line, type: 'rewritten', description: c.description });
            }
            for (const f of ssjsResult.flaggedSections) {
                allNonMigratable.push({ line: f.line, code: f.code, reason: f.reason });
            }
            return ssjsResult.convertedCode;
        });

        // Reassess difficulty
        const hasMigratable = allNonMigratable.length > 0;
        const difficulty: 'ready' | 'minor' | 'significant' | 'not-migratable' =
            hasMigratable && allNonMigratable.some((i) => i.reason.includes('not-migratable'))
                ? 'not-migratable'
                : ampResult.difficulty;

        const result = {
            rewrittenCode: finalCode,
            changes: allChanges,
            nonMigratableItems: allNonMigratable,
            difficulty,
            summary: ampResult.summary,
        };

        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: rewrite_for_mcn
// ---------------------------------------------------------------------------

server.prompt(
    'rewrite_for_mcn',
    'Rewrite AMPscript/SSJS code to be compatible with Marketing Cloud Next. ' +
        'Calls the rewrite_for_mcn tool first for deterministic rewrites, then applies ' +
        'AI reasoning to handle any MANUAL_REWRITE_REQUIRED sections.',
    {
        code: z.string().describe('The AMPscript or HTML code to rewrite for MCN.'),
        context: z
            .enum(['email', 'cloudpage', 'auto'])
            .optional()
            .describe("Content context — use 'cloudpage' to immediately flag as not migratable."),
    },
    ({ code, context = 'auto' }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer helping migrate code to Marketing Cloud Next (MCN).',
                        '',
                        '## Instructions',
                        '1. Call the `rewrite_for_mcn` **tool** with the code and context below.',
                        '2. Review the `nonMigratableItems` in the result.',
                        '3. For each item marked `MANUAL_REWRITE_REQUIRED`, attempt an AI-driven conversion:',
                        '   - Complex loops → AMPscript FOR/NEXT blocks if possible',
                        '   - SSJS try/catch → AMPscript RaiseError() with conditional guards',
                        '   - Array methods (forEach, map, filter) → AMPscript FOR loops over RowSets',
                        '   - JSON.parse/stringify → BuildRowsetFromJson() / row operations',
                        '4. Produce a single final rewritten code block.',
                        '5. Include a concise change log as a bulleted list.',
                        '',
                        '## MCN rules to enforce',
                        '- AMPscript only — no SSJS blocks (`<script runat="server">`) in the final output.',
                        '- FormatDate() must use Java SimpleDateFormat strings, not .NET strings.',
                        '- FormatDate(StringToDate(x), fmt) must be simplified to FormatDate(x, fmt).',
                        '- Lookup() must have an even number of search column/value pairs.',
                        '- Functions not in the MCN catalog must be replaced or removed.',
                        '- CloudPages context (RequestParameter, QueryParameter, CloudPagesURL) → cannot migrate; explain why.',
                        '',
                        `## Context: ${context}`,
                        '',
                        '## Code to rewrite',
                        '```',
                        code,
                        '```',
                    ].join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Tool: convertSsjsToAmpscript
// ---------------------------------------------------------------------------

server.tool(
    'convertSsjsToAmpscript',
    'Deterministically convert SSJS (Server-Side JavaScript) code to AMPscript using rule-based transformations. ' +
        'Handles: Platform.Function.* → AMPscript equivalents, Platform.Variable.GetValue/SetValue → @variable, ' +
        'Platform.Response.Write → OutputLine, var declarations → SET, if/else → IF/ELSE/ENDIF. ' +
        'Flags JS-native constructs (try/catch, array methods, JSON, regex) as MANUAL_REWRITE_REQUIRED. ' +
        'Use the convertSsjsToAmpscript PROMPT for AI-enhanced handling of flagged sections.',
    {
        code: z
            .string()
            .describe('The SSJS code to convert (may include <script runat="server"> tags).'),
    },
    ({ code }) => {
        const result = ssjsToAmpscript(code);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            convertedCode: result.convertedCode,
                            changes: result.changes,
                            flaggedSections: result.flaggedSections,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: convertSsjsToAmpscript
// ---------------------------------------------------------------------------

server.prompt(
    'convertSsjsToAmpscript',
    'Convert SSJS (Server-Side JavaScript) code to equivalent AMPscript. ' +
        'Calls the convertSsjsToAmpscript tool first for deterministic rule-based conversion, ' +
        'then applies AI reasoning to handle any MANUAL_REWRITE_REQUIRED sections.',
    {
        code: z.string().describe('The SSJS code to convert to AMPscript.'),
    },
    ({ code }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer converting SSJS to AMPscript.',
                        '',
                        '## Instructions',
                        '1. Call the `convertSsjsToAmpscript` **tool** with the code below to get a deterministic conversion.',
                        '2. Review the `flaggedSections` in the result — these are constructs the tool could not convert automatically.',
                        '3. For each flagged section, apply your expertise:',
                        '   - SSJS try/catch → use RaiseError() and conditional guards in AMPscript',
                        '   - Array .forEach/.map → AMPscript FOR @i = 1 TO RowCount(@rs) DO loops',
                        '   - JSON.parse/stringify → use BuildRowsetFromJson() or Field() on RowSets',
                        '   - HTTP calls → use HTTPGet() / HTTPPost() in AMPscript',
                        '   - Complex string manipulation → AMPscript string functions (Concat, Replace, Substring, etc.)',
                        '4. Produce a single final AMPscript code block.',
                        '5. Add a short change log as a bulleted list.',
                        '',
                        '## AMPscript syntax reminders',
                        '- Blocks: `%%[ ... ]%%` — statements: `SET @x = expr`',
                        '- Variables: `@varName` (no declaration needed except VAR)',
                        '- Functions: PascalCase, no Platform.Function. prefix',
                        '- Conditions: `IF cond THEN ... ELSEIF cond THEN ... ELSE ... ENDIF`',
                        '- Loops: `FOR @i = 1 TO @count DO ... NEXT @i`',
                        '- Output: `%%=Output(@x)=%%` (inline) or `%%[ OutputLine(x) ]%%` (block)',
                        '',
                        '## SSJS code to convert',
                        '```javascript',
                        code,
                        '```',
                    ].join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Tool: convertAmpscriptToSsjs
// ---------------------------------------------------------------------------

server.tool(
    'convertAmpscriptToSsjs',
    'Deterministically convert AMPscript code to equivalent SSJS using rule-based transformations. ' +
        'Handles: SET @x → var x, IF/ELSEIF/ELSE/ENDIF → JS conditionals, FOR/NEXT → for loops, ' +
        'Output/OutputLine → Platform.Response.Write, AMPscript functions → Platform.Function equivalents. ' +
        'Flags AMPscript-only constructs (email-specific functions, personalization strings) as MANUAL_REWRITE_REQUIRED. ' +
        'Use the convertAmpscriptToSsjs PROMPT for AI-enhanced handling of flagged sections.',
    {
        code: z.string().describe('The AMPscript code to convert to SSJS.'),
    },
    ({ code }) => {
        const result = ampscriptToSsjs(code);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            convertedCode: result.convertedCode,
                            changes: result.changes,
                            flaggedSections: result.flaggedSections,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Tool: convertAmpscriptToHandlebars
// ---------------------------------------------------------------------------

server.tool(
    'convertAmpscriptToHandlebars',
    'Deterministically convert AMPscript to Marketing Cloud Next (MCN) Handlebars using the ' +
        'three-category model built from ampscript-data: (A) functions with a Handlebars helper ' +
        'equivalent become {{helper …}}; (B) functions with no MCN counterpart become a ' +
        'MANUAL_REWRITE_REQUIRED comment; (C) mcnHandlebarsGap functions (e.g. ContentBlockByKey) ' +
        'become a DISTINCT MANUAL_REWRITE_REQUIRED comment noting they are documented as ' +
        'MCN-supported but currently fail at runtime. Procedural AMPscript blocks (SET/VAR/IF/FOR) ' +
        'have no Handlebars equivalent and are flagged. ' +
        'Use the convertAmpscriptToHandlebars PROMPT for AI-enhanced handling of flagged sections.',
    {
        code: z.string().describe('The AMPscript code to convert to MCN Handlebars.'),
    },
    ({ code }) => {
        const result = ampscriptToHandlebars(code);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            convertedCode: result.convertedCode,
                            changes: result.changes,
                            flaggedSections: result.flaggedSections,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: convertAmpscriptToHandlebars
// ---------------------------------------------------------------------------

server.prompt(
    'convertAmpscriptToHandlebars',
    'Convert AMPscript to Marketing Cloud Next (MCN) Handlebars. ' +
        'Calls the convertAmpscriptToHandlebars tool first for a deterministic, data-driven ' +
        'conversion, then applies AI reasoning to handle MANUAL_REWRITE_REQUIRED sections.',
    {
        code: z.string().describe('The AMPscript code to convert to MCN Handlebars.'),
    },
    ({ code }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer converting AMPscript to Marketing Cloud Next (MCN) Handlebars.',
                        '',
                        '## Instructions',
                        '1. Call the `convertAmpscriptToHandlebars` **tool** with the code below to get a deterministic conversion.',
                        '2. Review the `flaggedSections` — these are constructs the tool could not convert automatically.',
                        '3. For each flagged section, apply your expertise, but obey these hard rules:',
                        '   - NEVER invent a Handlebars helper. Only use helpers that exist in the MCN catalog (call `list_handlebars_helpers` / `lookup_handlebars_helper`).',
                        '   - Category B (no MCN counterpart): leave a clear `{{!-- MANUAL_REWRITE_REQUIRED … --}}` note explaining the manual step.',
                        '   - Category C (documented-supported but runtime gap, e.g. ContentBlockByKey): keep the DISTINCT runtime-gap note — do not replace it with a fabricated helper.',
                        '   - AMPscript procedural blocks (SET/VAR/IF/FOR) have no Handlebars equivalent — Handlebars cannot assign variables or run imperative logic. Restructure the data upstream instead.',
                        '4. Validate your final output by calling `validate_handlebars`.',
                        '5. Produce a single final Handlebars-in-HTML code block plus a short bulleted change log.',
                        '',
                        '## AMPscript code to convert',
                        '```',
                        code,
                        '```',
                    ].join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Tool: convertHandlebarsToAmpscript
// ---------------------------------------------------------------------------

server.tool(
    'convertHandlebarsToAmpscript',
    'Deterministically convert Marketing Cloud Next (MCN) Handlebars to AMPscript (best-effort, ' +
        'lossy). Inline helper calls that map back to an AMPscript function become %%=Fn(…)=%%; ' +
        'bare variables {{name}} become %%=v(@name)=%%. Block helpers ({{#each}}/{{#if}}), partials, ' +
        'dotted binding paths, and helpers with no AMPscript equivalent are flagged ' +
        'MANUAL_REWRITE_REQUIRED. Use the convertHandlebarsToAmpscript PROMPT for AI-enhanced handling.',
    {
        code: z.string().describe('The MCN Handlebars code to convert to AMPscript.'),
    },
    ({ code }) => {
        const result = handlebarsToAmpscript(code);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            convertedCode: result.convertedCode,
                            changes: result.changes,
                            flaggedSections: result.flaggedSections,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: convertHandlebarsToAmpscript
// ---------------------------------------------------------------------------

server.prompt(
    'convertHandlebarsToAmpscript',
    'Convert Marketing Cloud Next (MCN) Handlebars to AMPscript (best-effort, lossy). ' +
        'Calls the convertHandlebarsToAmpscript tool first for a deterministic conversion, then ' +
        'applies AI reasoning to handle MANUAL_REWRITE_REQUIRED sections.',
    {
        code: z.string().describe('The MCN Handlebars code to convert to AMPscript.'),
    },
    ({ code }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer converting MCN Handlebars to AMPscript.',
                        '',
                        '## Instructions',
                        '1. Call the `convertHandlebarsToAmpscript` **tool** with the code below to get a deterministic conversion.',
                        '2. Review the `flaggedSections` — block helpers, partials, and binding paths often need context-specific AMPscript.',
                        '3. For each flagged section, apply your expertise:',
                        '   - `{{#each items}}…{{/each}}` → AMPscript `FOR @i = 1 TO RowCount(@items) DO … NEXT @i`',
                        '   - `{{#if cond}}…{{else}}…{{/if}}` → `IF cond THEN … ELSE … ENDIF`',
                        '   - `{!$…}` bindings and `mcn-platform` helpers may have no AMPscript equivalent — keep the MANUAL_REWRITE_REQUIRED note.',
                        '4. Produce a single final AMPscript code block plus a short bulleted change log.',
                        '',
                        '## Handlebars code to convert',
                        '```',
                        code,
                        '```',
                    ].join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Tool: convertSsjsToHandlebars
// ---------------------------------------------------------------------------

server.tool(
    'convertSsjsToHandlebars',
    'Deterministically convert SSJS to Marketing Cloud Next (MCN) Handlebars transitively ' +
        '(SSJS → AMPscript → Handlebars). Because Handlebars is declarative, most imperative SSJS ' +
        'has no Handlebars counterpart and is conservatively flagged MANUAL_REWRITE_REQUIRED; ' +
        'inline Platform.Function.* calls that map through AMPscript to a Handlebars helper are ' +
        'converted. Use the convertSsjsToHandlebars PROMPT for AI-enhanced handling of flagged sections.',
    {
        code: z
            .string()
            .describe('The SSJS code to convert (may include <script runat="server"> tags).'),
    },
    ({ code }) => {
        const result = ssjsToHandlebars(code);
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            convertedCode: result.convertedCode,
                            changes: result.changes,
                            flaggedSections: result.flaggedSections,
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: convertSsjsToHandlebars
// ---------------------------------------------------------------------------

server.prompt(
    'convertSsjsToHandlebars',
    'Convert SSJS to Marketing Cloud Next (MCN) Handlebars. Calls the convertSsjsToHandlebars ' +
        'tool first (SSJS → AMPscript → Handlebars), then applies AI reasoning to handle the many ' +
        'MANUAL_REWRITE_REQUIRED sections that imperative SSJS produces.',
    {
        code: z.string().describe('The SSJS code to convert to MCN Handlebars.'),
    },
    ({ code }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer converting SSJS to Marketing Cloud Next (MCN) Handlebars.',
                        '',
                        '## Key reality',
                        'MCN runs a locked-down Handlebars engine. SSJS does NOT exist in MCN, and Handlebars is declarative — it cannot run imperative logic. Conversion is only possible transitively (SSJS → MCN-valid AMPscript subset → Handlebars), and most non-trivial SSJS will need a redesign (move logic to the data layer / a query).',
                        '',
                        '## Instructions',
                        '1. Call the `convertSsjsToHandlebars` **tool** with the code below to get a deterministic conversion.',
                        '2. Review the `flaggedSections` from BOTH stages ([SSJS→AMPscript] and [AMPscript→Handlebars]).',
                        '3. For each flagged section, apply your expertise — but NEVER invent a Handlebars helper (use only the MCN catalog via `list_handlebars_helpers`).',
                        '4. Where imperative logic cannot be expressed, recommend moving it upstream (e.g. a `{{#query}}` / data binding) and keep a clear MANUAL_REWRITE_REQUIRED note.',
                        '5. Validate your final output by calling `validate_handlebars`.',
                        '6. Produce a single final Handlebars-in-HTML code block plus a short bulleted change log.',
                        '',
                        '## SSJS code to convert',
                        '```javascript',
                        code,
                        '```',
                    ].join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Tool: write_handlebars
// ---------------------------------------------------------------------------

server.tool(
    'write_handlebars',
    'Validate a Marketing Cloud Next (MCN) Handlebars-in-HTML draft so it can be finalized as ' +
        'authored content. Runs the MCN Handlebars validator (locked-down engine) on the draft and ' +
        'returns whether it is clean, plus any diagnostics (unknown/too-new helpers, unsupported ' +
        'constructs, arity). Use the write_handlebars PROMPT to AUTHOR from intent — that prompt ' +
        'instructs the model to use only catalog helpers and then call this tool to verify.',
    {
        draft: z.string().describe('The Handlebars-in-HTML draft to validate before finalizing.'),
        intent: z
            .string()
            .optional()
            .describe(
                'Optional human description of what the content should do (echoed for context).'
            ),
    },
    ({ draft, intent }) => {
        const diagnostics = validateAmpscript(draft, {
            maxNumberOfProblems: 100,
            targetPlatform: 'next',
        }).filter((d) => d.source === 'handlebars');

        const isClean = diagnostics.length === 0;
        const header = isClean
            ? '✅ Draft is valid MCN Handlebars.'
            : `❌ Draft has ${diagnostics.length} MCN Handlebars issue(s) — fix before finalizing:`;
        const intentLine = intent ? `Intent: ${intent}\n\n` : '';

        return {
            content: [
                {
                    type: 'text',
                    text: `${intentLine}${header}\n\n${formatDiagnostics(diagnostics)}`,
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Prompt: writeHandlebars
// ---------------------------------------------------------------------------

server.prompt(
    'writeHandlebars',
    'Author Marketing Cloud Next (MCN) Handlebars-in-HTML from a natural-language intent, using ' +
        'only helpers that exist in the MCN catalog, then validate the result with write_handlebars.',
    {
        intent: z
            .string()
            .describe(
                'What the content should do, e.g. "greet the subscriber by first name and show their loyalty tier".'
            ),
        context: z
            .string()
            .optional()
            .describe(
                'Optional data/personalization context (available fields, bindings, sample data).'
            ),
    },
    ({ intent, context }) => ({
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: [
                        'You are an expert Salesforce Marketing Cloud developer authoring Marketing Cloud Next (MCN) Handlebars-in-HTML.',
                        '',
                        '## Hard rules',
                        '- MCN runs a LOCKED-DOWN Handlebars engine. NEVER invent a helper. Only use helpers in the MCN catalog — call `list_handlebars_helpers` (and `lookup_handlebars_helper` for signatures) before writing.',
                        '- Respect each helper`s `mcnSince` availability.',
                        '- Partials ({{> …}}), decorators ({{* …}}), and built-in helpers absent from MCN (e.g. {{log}}) are NOT allowed.',
                        '- `{!$…}` bindings are merge fields, not helpers — use `list_handlebars_helpers` output / bindings catalog for valid ones.',
                        '',
                        '## Instructions',
                        '1. Inspect the available catalog with `list_handlebars_helpers`.',
                        '2. Author the Handlebars-in-HTML to satisfy the intent below.',
                        '3. Call the `write_handlebars` **tool** with your draft to validate it.',
                        '4. If validation reports issues, fix them and re-validate until clean.',
                        '5. Return the final, validated Handlebars-in-HTML code block.',
                        '',
                        `## Intent`,
                        intent,
                        ...(context ? ['', '## Context', context] : []),
                    ].join('\n'),
                },
            },
        ],
    })
);

// ---------------------------------------------------------------------------
// Tool: get_server_version
// ---------------------------------------------------------------------------

server.tool(
    'get_server_version',
    'Return the running mcp-server-sfmc version and the size of the bundled Salesforce ' +
        'Marketing Cloud help datasets (MCE and MCN). Use this to confirm which server build ' +
        'and documentation bundle are loaded.',
    {},
    () => {
        const mce = getMceHelpStats();
        const mcn = getMcnHelpStats();
        const mceFileCount = new Set(getChunks().map((c) => c.relativePath)).size;
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(
                        {
                            name: 'mcp-server-sfmc',
                            version: pkg.version,
                            mceHelp: { chunkCount: mce.chunkCount, fileCount: mceFileCount },
                            mcnHelp: { chunkCount: mcn.chunkCount, fileCount: mcn.fileCount },
                        },
                        null,
                        2
                    ),
                },
            ],
        };
    }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    if (process.argv.includes('--version') || process.argv.includes('-v')) {
        process.stdout.write(pkg.version + '\n');
        return;
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('mcp-server-sfmc running on stdio\n');
}

main().catch((ex: unknown) => {
    process.stderr.write(`Fatal: ${String(ex)}\n`);
    process.exit(1);
});
