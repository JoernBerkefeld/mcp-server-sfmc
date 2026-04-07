/**
 * mcp-server-sfmc — integration tests
 *
 * These tests validate the language intelligence layer that powers the MCP
 * server tools, using sfmc-language-lsp directly. They verify the same code
 * paths that the MCP tool handlers call.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sfmcLanguageService, validateAmpscript, validateSsjs, validateGtlBlocks } from 'sfmc-language-lsp';
import {
    clearMceHelpCache,
    getMceHelpStats,
    searchMceHelp,
} from '../dist/mce-help-search.js';

const testsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(testsDir, '..');

function readRepoJson(name) {
    return JSON.parse(readFileSync(join(repoRoot, name), 'utf8'));
}

// ---------------------------------------------------------------------------
// validate_ampscript tool logic
// ---------------------------------------------------------------------------

describe('validate_ampscript tool logic', () => {
    test('reports no issues for valid AMPscript', () => {
        const code = '%%[ SET @name = "World" ]%%\nHello %%=v(@name)=%%';
        const diags = validateAmpscript(code, { maxNumberOfProblems: 100 });
        assert.equal(diags.length, 0);
    });

    test('reports unclosed %%[ block', () => {
        const code = '%%[ SET @x = "value"';
        const diags = validateAmpscript(code, { maxNumberOfProblems: 100 });
        assert.ok(diags.length > 0);
        assert.ok(diags[0].message.includes('Unclosed') || diags[0].message.toLowerCase().includes('block'));
    });

    test('reports unknown AMPscript function', () => {
        const code = '%%[ SET @x = NonExistentFn("arg") ]%%';
        const diags = validateAmpscript(code, { maxNumberOfProblems: 100 });
        assert.ok(diags.some((d) => d.message.toLowerCase().includes('unknown')));
    });

    test('respects maxNumberOfProblems', () => {
        const code = '%%[ ]%%\n%%[ ]%%\n%%[ ]%%\n%%=NonFn()=%% %%=NonFn()=%%';
        const diags = validateAmpscript(code, { maxNumberOfProblems: 1 });
        assert.ok(diags.length <= 1);
    });
});

// ---------------------------------------------------------------------------
// validate_ssjs tool logic
// ---------------------------------------------------------------------------

describe('validate_ssjs tool logic', () => {
    test('reports no issues for valid SSJS', () => {
        const code = '<script runat="server">\nvar x = "hello";\nWrite(x);\n</script>';
        const diags = validateSsjs(code, { maxNumberOfProblems: 100 });
        assert.equal(diags.length, 0);
    });

    test('reports let/const usage', () => {
        const code = '<script runat="server">\nlet x = 1;\nconst y = 2;\n</script>';
        const diags = validateSsjs(code, { maxNumberOfProblems: 100 });
        assert.ok(diags.length >= 2);
    });

    test('reports arrow function usage', () => {
        const code = '<script runat="server">\nvar fn = (x) => { return x; };\n</script>';
        const diags = validateSsjs(code, { maxNumberOfProblems: 100 });
        assert.ok(diags.length > 0, 'Should report at least one issue for arrow function');
        assert.ok(diags.some((d) => d.message.toLowerCase().includes('arrow') || d.message.toLowerCase().includes('function expression')));
    });
});

// ---------------------------------------------------------------------------
// validate_sfmc_html tool logic (GTL)
// ---------------------------------------------------------------------------

describe('validate_sfmc_html tool logic (GTL)', () => {
    test('validates GTL blocks', () => {
        const code = '{{#each items}}{{/if}}'; // mismatch
        const diags = [];
        validateGtlBlocks(code, diags, 100);
        assert.ok(diags.length > 0);
    });

    test('no issues for valid GTL', () => {
        const code = '{{#each items}}{{name}}{{/each}}';
        const diags = [];
        validateGtlBlocks(code, diags, 100);
        assert.equal(diags.length, 0);
    });
});

// ---------------------------------------------------------------------------
// lookup_ampscript_function tool logic
// ---------------------------------------------------------------------------

describe('lookup_ampscript_function tool logic', () => {
    test('finds known function by exact name', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('Lookup');
        assert.ok(fn, 'Lookup should be found');
        assert.equal(fn.name, 'Lookup');
    });

    test('is case-insensitive', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('lookup');
        assert.ok(fn, 'lookup (lowercase) should be found');
    });

    test('returns null for unknown function', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('CompletelyUnknownFn9999');
        assert.equal(fn, null);
    });

    test('returned function has expected shape', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('DateAdd');
        assert.ok(fn, 'DateAdd should be found');
        assert.ok(typeof fn.description === 'string');
        assert.ok(Array.isArray(fn.params));
        assert.ok(fn.params.length > 0);
    });
});

// ---------------------------------------------------------------------------
// lookup_ssjs_function tool logic
// ---------------------------------------------------------------------------

describe('lookup_ssjs_function tool logic', () => {
    test('finds Platform function by bare name', () => {
        const fn = sfmcLanguageService.lookupSsjsFunction('Lookup');
        assert.ok(fn, 'Lookup should be found in SSJS catalog');
    });

    test('finds WSProxy method', () => {
        const fn = sfmcLanguageService.lookupSsjsFunction('retrieve');
        assert.ok(fn, 'retrieve should be found');
    });

    test('returns null for unknown function', () => {
        const fn = sfmcLanguageService.lookupSsjsFunction('totallyMadeUpFn999');
        assert.equal(fn, null);
    });
});

// ---------------------------------------------------------------------------
// review_change tool logic (uses validate)
// ---------------------------------------------------------------------------

describe('review_change tool logic', () => {
    test('detects issues in added AMPscript lines', () => {
        const addedCode = 'SET @x = BadFunction("arg")';
        const diags = validateAmpscript('%%[\n' + addedCode + '\n]%%', { maxNumberOfProblems: 100 });
        assert.ok(diags.some((d) => d.message.toLowerCase().includes('unknown')));
    });

    test('clean code produces no diagnostics', () => {
        const code = '%%[ SET @greeting = "Hello World" ]%%\n%%=v(@greeting)=%%';
        const diags = validateAmpscript(code, { maxNumberOfProblems: 100 });
        assert.equal(diags.length, 0);
    });
});

// ---------------------------------------------------------------------------
// Catalog resources logic
// ---------------------------------------------------------------------------

describe('catalog resources logic', () => {
    test('getAllAmpscriptFunctions returns non-empty array', () => {
        const fns = sfmcLanguageService.getAllAmpscriptFunctions();
        assert.ok(Array.isArray(fns));
        assert.ok(fns.length > 100, 'Should have more than 100 AMPscript functions');
    });

    test('getAllSsjsFunctions returns non-empty array', () => {
        const fns = sfmcLanguageService.getAllSsjsFunctions();
        assert.ok(Array.isArray(fns));
        assert.ok(fns.length > 0);
    });

    test('getAmpscriptKeywords returns common keywords', () => {
        const kws = sfmcLanguageService.getAmpscriptKeywords();
        assert.ok(kws.includes('if') || kws.includes('IF') || kws.some((k) => k.toLowerCase() === 'if'));
        assert.ok(kws.some((k) => k.toLowerCase() === 'set'));
    });

    test('getUnsupportedSsjsSyntax returns items with pattern and message', () => {
        const items = sfmcLanguageService.getUnsupportedSsjsSyntax();
        assert.ok(items.length > 0);
        for (const item of items) {
            assert.ok(typeof item.pattern === 'string');
            assert.ok(typeof item.message === 'string');
        }
    });

    test('getSsjsCompletionCatalog returns non-empty array', () => {
        const items = sfmcLanguageService.getSsjsCompletionCatalog();
        assert.ok(items.length > 50, 'Should have more than 50 SSJS completions');
    });
});

// ---------------------------------------------------------------------------
// get_ampscript_completions tool logic
// ---------------------------------------------------------------------------

describe('get_ampscript_completions tool logic', () => {
    test('returns completions inside AMPscript block', () => {
        const code = '%%[\n  ';
        const doc = { text: code, languageId: /** @type {'ampscript'} */ ('ampscript'), uri: 'test' };
        const items = sfmcLanguageService.getCompletions(doc, { line: 1, character: 2 });
        assert.ok(items.length > 0, 'Should return completions inside block');
    });

    test('returns no completions outside AMPscript block', () => {
        const code = '<html>\n<body>Hello</body>\n</html>';
        const doc = { text: code, languageId: /** @type {'ampscript'} */ ('ampscript'), uri: 'test' };
        const items = sfmcLanguageService.getCompletions(doc, { line: 1, character: 5 });
        assert.equal(items.length, 0);
    });
});

// ---------------------------------------------------------------------------
// format_sfmc_code tool logic (keyword normalisation)
// ---------------------------------------------------------------------------

describe('format_sfmc_code tool logic', () => {
    test('uppercases AMPscript keywords', () => {
        const code = '%%[\nif @x == 1 then\nset @y = 2\nendif\n]%%';
        const formatted = code
            .replace(/\b(if|elseif|else|endif|for|to|downto|step|next|set|var|do|output)\b/gi, (m) => m.toUpperCase());
        assert.ok(formatted.includes('IF'));
        assert.ok(formatted.includes('SET'));
        assert.ok(formatted.includes('ENDIF'));
    });

    test('normalises SSJS Platform.Load to double quotes', () => {
        const code = "Platform.Load('core', '1.1.5');";
        const formatted = code.replace(
            /Platform\.Load\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g,
            'Platform.Load("$1", "$2")',
        );
        assert.equal(formatted, 'Platform.Load("core", "1.1.5");');
    });
});

// ---------------------------------------------------------------------------
// search_mce_help (bundled Marketing Cloud Engagement help)
// ---------------------------------------------------------------------------

describe('search_mce_help index', () => {
    test('bundled chunks exist and are split by product scope', () => {
        clearMceHelpCache();
        const stats = getMceHelpStats();
        assert.ok(stats.chunkCount > 0, 'Expected bundled/mce-help/chunks.json with at least one chunk');
        assert.ok(stats.engagementChunks > 0, 'Expected Marketing Cloud Engagement sections');
        assert.ok(stats.nextChunks > 0, 'Expected Marketing Cloud Next sections');
        // Verify breakdown covers all 7 product areas
        const scopes = Object.keys(stats.breakdown);
        assert.ok(scopes.includes('marketing_cloud_engagement'), 'breakdown missing marketing_cloud_engagement');
        assert.ok(scopes.includes('marketing_cloud_next'), 'breakdown missing marketing_cloud_next');
        assert.ok(scopes.includes('loyalty_management'), 'breakdown missing loyalty_management');
        assert.ok(scopes.includes('marketing_cloud_personalization'), 'breakdown missing marketing_cloud_personalization');
        assert.ok(scopes.includes('marketing_cloud_account_engagement'), 'breakdown missing marketing_cloud_account_engagement');
        assert.ok(scopes.includes('marketing_cloud_intelligence'), 'breakdown missing marketing_cloud_intelligence');
    });

    test('finds setup-related content for a typical admin query', () => {
        clearMceHelpCache();
        const hits = searchMceHelp('business unit', 5, 'engagement');
        assert.ok(hits.length > 0, 'Expected hits for "business unit" in Engagement scope');
        for (const h of hits) {
            assert.equal(h.chunk.productScope, 'marketing_cloud_engagement');
        }
    });

    test('product_focus next only returns Next-scoped chunks', () => {
        clearMceHelpCache();
        const hits = searchMceHelp('marketing', 8, 'next');
        assert.ok(hits.length > 0, 'Expected some Next-folder hits');
        for (const h of hits) {
            assert.equal(h.chunk.productScope, 'marketing_cloud_next');
        }
    });

    test('product_focus loyalty only returns loyalty_management chunks', () => {
        clearMceHelpCache();
        const hits = searchMceHelp('loyalty program', 8, 'loyalty');
        assert.ok(hits.length > 0, 'Expected hits for "loyalty program" in loyalty scope');
        for (const h of hits) {
            assert.equal(h.chunk.productScope, 'loyalty_management');
        }
    });

    test('product_focus personalization only returns personalization chunks', () => {
        clearMceHelpCache();
        const hits = searchMceHelp('personalization', 8, 'personalization');
        assert.ok(hits.length > 0, 'Expected hits for "personalization" scope');
        for (const h of hits) {
            assert.ok(
                h.chunk.productScope === 'marketing_cloud_personalization' ||
                h.chunk.productScope === 'salesforce_personalization',
                `Unexpected scope: ${h.chunk.productScope}`,
            );
        }
    });

    test('product_focus account-engagement only returns account-engagement chunks', () => {
        clearMceHelpCache();
        const hits = searchMceHelp('account engagement', 5, 'account-engagement');
        assert.ok(hits.length > 0, 'Expected hits for account-engagement scope');
        for (const h of hits) {
            assert.equal(h.chunk.productScope, 'marketing_cloud_account_engagement');
        }
    });

    test('product_focus intelligence only returns intelligence chunks', () => {
        clearMceHelpCache();
        const hits = searchMceHelp('data pipeline', 5, 'intelligence');
        assert.ok(hits.length > 0, 'Expected hits for intelligence scope');
        for (const h of hits) {
            assert.equal(h.chunk.productScope, 'marketing_cloud_intelligence');
        }
    });

    test('empty query yields no hits', () => {
        clearMceHelpCache();
        const hits = searchMceHelp('   ', 5, 'any');
        assert.equal(hits.length, 0);
    });
});

// ---------------------------------------------------------------------------
// MCP Registry manifest (package.json / server.json)
// ---------------------------------------------------------------------------

describe('MCP Registry manifest', () => {
    test('mcpName matches server.json name', () => {
        const pkg = readRepoJson('package.json');
        const server = readRepoJson('server.json');
        assert.equal(pkg.mcpName, server.name);
        assert.equal(pkg.mcpName, 'io.github.JoernBerkefeld/mcp-server-sfmc');
    });

    test('versions and npm package row match package.json', () => {
        const pkg = readRepoJson('package.json');
        const server = readRepoJson('server.json');
        assert.equal(server.version, pkg.version);
        assert.equal(server.packages.length, 1);
        assert.equal(server.packages[0].version, pkg.version);
        assert.equal(server.packages[0].identifier, pkg.name);
        assert.equal(server.packages[0].registryType, 'npm');
        assert.equal(server.packages[0].transport.type, 'stdio');
    });

    test('registry description length within MCP Registry limit (100 chars)', () => {
        const server = readRepoJson('server.json');
        assert.ok(
            server.description.length <= 100,
            `server.json description is ${server.description.length} chars (max 100)`,
        );
    });
});
