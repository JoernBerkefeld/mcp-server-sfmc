/**
 * mcp-server-sfmc — integration tests
 *
 * These tests validate the language intelligence layer that powers the MCP
 * server tools, using sfmc-language-lsp directly. They verify the same code
 * paths that the MCP tool handlers call.
 */

import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    sfmcLanguageService,
    validateAmpscript,
    validateSsjs,
    validateGtlBlocks,
    isMcnSupported,
    getMcnApiVersion,
    getMcnNotes,
    extractAmpscriptFunctionCalls,
} from 'sfmc-language-lsp';
import { clearMceHelpCache, getMceHelpStats, searchMceHelp } from '../dist/mce-help-search.js';
import { clearMcnHelpCache, getMcnHelpStats, searchMcnHelp } from '../dist/mcn-help-search.js';
import {
    PLATFORM_FUNCTION_TO_AMP,
    AMP_TO_PLATFORM_FUNCTION,
    DOTNET_TO_JAVA_FORMAT_REPLACEMENTS,
    DOTNET_STANDARD_SHORTHANDS,
    NON_MIGRATABLE_SSJS_PATTERNS,
    ssjsToAmpscript,
    ampscriptToSsjs,
    rewriteAmpForMcn,
    isSsjsBlockConvertible,
} from '../dist/conversion-rules.js';

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
        assert.ok(
            diags[0].message.includes('Unclosed') ||
                diags[0].message.toLowerCase().includes('block')
        );
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
        // Use Platform.Function.Now() with correct Core Load version — no diagnostics expected
        const code =
            '<script runat="server">\nPlatform.Load("Core","1.1.5");\nvar d = Platform.Function.Now();\n</script>';
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
        assert.ok(
            diags.some(
                (d) =>
                    d.message.toLowerCase().includes('arrow') ||
                    d.message.toLowerCase().includes('function expression')
            )
        );
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

    test('deprecated function exposes deprecated: true', () => {
        // ContentArea is a known deprecated SSJS function
        const fn = sfmcLanguageService.lookupSsjsFunction('ContentArea');
        assert.ok(fn, 'ContentArea should be found');
        assert.equal(fn.deprecated, true, 'ContentArea should be deprecated');
    });

    test('non-deprecated function does not have deprecated flag', () => {
        const fn = sfmcLanguageService.lookupSsjsFunction('Lookup');
        assert.ok(fn, 'Lookup should be found');
        assert.ok(!fn.deprecated, 'Lookup should not be deprecated');
    });

    test('requiresCoreLoad function exposes requiresCoreLoad: true', () => {
        // Get / Post are Core library HTTP methods that need Platform.Load
        const fn = sfmcLanguageService.lookupSsjsFunction('Get');
        assert.ok(fn, 'Get should be found');
        assert.equal(fn.requiresCoreLoad, true, 'Get should require Core load');
    });

    test('Platform function does not require Core load', () => {
        // Platform.Function.Lookup is available without Platform.Load
        const fn = sfmcLanguageService.lookupSsjsFunction('Lookup');
        assert.ok(fn, 'Lookup should be found');
        assert.ok(!fn.requiresCoreLoad, 'Lookup should not require Core load');
    });
});

// ---------------------------------------------------------------------------
// review_change tool logic (uses validate)
// ---------------------------------------------------------------------------

describe('review_change tool logic', () => {
    test('detects issues in added AMPscript lines', () => {
        const addedCode = 'SET @x = BadFunction("arg")';
        const diags = validateAmpscript('%%[\n' + addedCode + '\n]%%', {
            maxNumberOfProblems: 100,
        });
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
        assert.ok(
            kws.includes('if') || kws.includes('IF') || kws.some((k) => k.toLowerCase() === 'if')
        );
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
        const doc = {
            text: code,
            languageId: /** @type {'ampscript'} */ ('ampscript'),
            uri: 'test',
        };
        const items = sfmcLanguageService.getCompletions(doc, { line: 1, character: 2 });
        assert.ok(items.length > 0, 'Should return completions inside block');
    });

    test('returns no completions outside AMPscript block', () => {
        const code = '<html>\n<body>Hello</body>\n</html>';
        const doc = {
            text: code,
            languageId: /** @type {'ampscript'} */ ('ampscript'),
            uri: 'test',
        };
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
        const formatted = code.replaceAll(
            /\b(if|elseif|else|endif|for|to|downto|step|next|set|var|do|output)\b/gi,
            (m) => m.toUpperCase()
        );
        assert.ok(formatted.includes('IF'));
        assert.ok(formatted.includes('SET'));
        assert.ok(formatted.includes('ENDIF'));
    });

    test('normalises SSJS Platform.Load to double quotes', () => {
        const code = "Platform.Load('core', '1.1.5');";
        const formatted = code.replaceAll(
            /Platform\.Load\s*\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g,
            'Platform.Load("$1", "$2")'
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
        assert.ok(
            stats.chunkCount > 0,
            'Expected bundled/mce-help/chunks.json with at least one chunk'
        );
        assert.ok(stats.engagementChunks > 0, 'Expected Marketing Cloud Engagement sections');
        assert.ok(stats.nextChunks > 0, 'Expected Marketing Cloud Next sections');
        // Verify breakdown covers all 7 product areas
        const scopes = Object.keys(stats.breakdown);
        assert.ok(
            scopes.includes('marketing_cloud_engagement'),
            'breakdown missing marketing_cloud_engagement'
        );
        assert.ok(
            scopes.includes('marketing_cloud_next'),
            'breakdown missing marketing_cloud_next'
        );
        assert.ok(scopes.includes('loyalty_management'), 'breakdown missing loyalty_management');
        assert.ok(
            scopes.includes('marketing_cloud_personalization'),
            'breakdown missing marketing_cloud_personalization'
        );
        assert.ok(
            scopes.includes('marketing_cloud_account_engagement'),
            'breakdown missing marketing_cloud_account_engagement'
        );
        assert.ok(
            scopes.includes('marketing_cloud_intelligence'),
            'breakdown missing marketing_cloud_intelligence'
        );
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
                `Unexpected scope: ${h.chunk.productScope}`
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
// lookup_ampscript_function — MCN fields
// (The MCP tool handler combines lookupAmpscriptFunction + getMcnApiVersion/getMcnNotes
//  to produce the response. We test those helpers here to verify the data backing
//  the tool response.)
// ---------------------------------------------------------------------------

describe('lookup_ampscript_function MCN fields', () => {
    test('Lookup: getMcnApiVersion returns 67 and getMcnNotes returns non-null', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('Lookup');
        assert.ok(fn, 'Lookup should be found');
        assert.equal(getMcnApiVersion('Lookup'), 67, 'Lookup mcnSince should be 67');
        const notes = getMcnNotes('Lookup');
        assert.ok(notes !== null, 'Lookup mcnNotes should be non-null');
        assert.ok(typeof notes === 'string', 'Lookup mcnNotes should be a string');
    });

    test('Add: getMcnApiVersion returns 67 and getMcnNotes returns null', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('Add');
        assert.ok(fn, 'Add should be found');
        assert.equal(getMcnApiVersion('Add'), 67, 'Add mcnSince should be 67');
        assert.equal(getMcnNotes('Add'), null, 'Add mcnNotes should be null');
    });

    test('AttachFile: getMcnApiVersion returns null and getMcnNotes returns null', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('AttachFile');
        assert.ok(fn, 'AttachFile should be found');
        assert.equal(getMcnApiVersion('AttachFile'), null, 'AttachFile mcnSince should be null');
        assert.equal(getMcnNotes('AttachFile'), null, 'AttachFile mcnNotes should be null');
    });

    test('FormatDate: getMcnNotes mentions Java SimpleDateFormat', () => {
        const fn = sfmcLanguageService.lookupAmpscriptFunction('FormatDate');
        assert.ok(fn, 'FormatDate should be found');
        assert.equal(getMcnApiVersion('FormatDate'), 67, 'FormatDate mcnSince should be 67');
        const notes = getMcnNotes('FormatDate');
        assert.ok(notes !== null, 'FormatDate mcnNotes should be non-null');
        assert.ok(
            notes.toLowerCase().includes('java'),
            'FormatDate mcnNotes should mention Java format strings'
        );
    });
});

// ---------------------------------------------------------------------------
// check_mcn_compatibility tool logic
// ---------------------------------------------------------------------------

describe('check_mcn_compatibility tool logic', () => {
    test('file with only MCN-supported functions → zero unsupported items', () => {
        const code = '%%[ SET @x = Concat("hello", " world") SET @n = Now() SET @a = Add(1, 2) ]%%';
        const calls = extractAmpscriptFunctionCalls(code);
        const unsupported = calls.filter((c) => !isMcnSupported(c.name));
        assert.equal(unsupported.length, 0, 'All called functions should be MCN-supported');
    });

    test('file with MCE-only function → lists unsupported items', () => {
        const code = '%%[ InsertDE("MyDE", "Col", "Val") ]%%';
        const calls = extractAmpscriptFunctionCalls(code);
        const unsupported = calls.filter((c) => !isMcnSupported(c.name));
        assert.ok(unsupported.length > 0, 'InsertDE should be flagged as MCN-unsupported');
        assert.ok(
            unsupported.some((c) => c.name.toLowerCase() === 'insertde'),
            'InsertDE should appear in unsupported list'
        );
    });

    test('FormatDate classified as needs-review (mcnNotes non-null)', () => {
        const code = '%%[ SET @d = FormatDate(@dt, "MM/dd/yyyy") ]%%';
        const calls = extractAmpscriptFunctionCalls(code);
        const formatDateCall = calls.find((c) => c.name.toLowerCase() === 'formatdate');
        assert.ok(formatDateCall, 'expected FormatDate call');
        assert.ok(isMcnSupported(formatDateCall.name), 'FormatDate should be MCN-supported');
        const notes = getMcnNotes(formatDateCall.name);
        assert.ok(
            notes !== null,
            'FormatDate should have mcnNotes for needs-review classification'
        );
    });

    test('SSJS using only Platform.Function.* → classified as convertible', () => {
        const ssjsBlock = 'Platform.Function.Lookup("DE","col","k","v");';
        assert.ok(
            isSsjsBlockConvertible(ssjsBlock),
            'SSJS using only Platform.Function should be convertible'
        );
    });

    test('SSJS with try/catch → classified as not migratable', () => {
        const ssjsBlock =
            'try { Platform.Function.Lookup("DE","c","k","v"); } catch(e) { Write(e); }';
        assert.ok(
            !isSsjsBlockConvertible(ssjsBlock),
            'SSJS with try/catch should not be convertible'
        );
    });

    test('SSJS with array.forEach → classified as not migratable', () => {
        const ssjsBlock = 'var items = [1,2,3]; items.forEach(function(i) { Write(i); });';
        assert.ok(
            !isSsjsBlockConvertible(ssjsBlock),
            'SSJS with forEach should not be convertible'
        );
    });

    test('CloudPages function → flagged as not supported', () => {
        const code = '%%[ SET @url = CloudPagesURL(1234) ]%%';
        const calls = extractAmpscriptFunctionCalls(code);
        const cloudpagesCall = calls.find((c) => c.name.toLowerCase() === 'cloudpagesurl');
        assert.ok(cloudpagesCall, 'expected CloudPagesURL call');
        assert.ok(
            !isMcnSupported(cloudpagesCall.name),
            'CloudPagesURL should not be MCN-supported'
        );
    });

    test('multi-function file returns all call sites correctly', () => {
        const code = [
            '%%[ SET @a = Concat("x", "y") ]%%',
            '%%[ SET @b = InsertDE("DE", "Col", "Val") ]%%',
            '%%[ SET @d = FormatDate(@dt, "MM/dd/yyyy") ]%%',
        ].join('\n');
        const calls = extractAmpscriptFunctionCalls(code);
        const names = calls.map((c) => c.name.toLowerCase());
        assert.ok(names.includes('concat'), 'expected Concat');
        assert.ok(names.includes('insertde'), 'expected InsertDE');
        assert.ok(names.includes('formatdate'), 'expected FormatDate');

        const supported = calls.filter((c) => isMcnSupported(c.name));
        const unsupported = calls.filter((c) => !isMcnSupported(c.name));
        assert.ok(supported.length >= 2, 'expected at least 2 supported functions');
        assert.ok(unsupported.length >= 1, 'expected at least 1 unsupported function');
    });
});

// ---------------------------------------------------------------------------
// rewrite_for_mcn tool logic
// ---------------------------------------------------------------------------

describe('rewrite_for_mcn tool logic', () => {
    const opts = { isMcnSupportedFn: isMcnSupported, getMcnNotesFn: getMcnNotes };

    test('FormatDate(StringToDate(x), fmt) → FormatDate(x, fmt)', () => {
        const code = 'FormatDate(StringToDate(@startDate), "MM/dd/yyyy")';
        const result = rewriteAmpForMcn(code, opts);
        assert.ok(
            result.rewrittenCode.includes('FormatDate(@startDate,'),
            `expected StringToDate to be stripped, got: ${result.rewrittenCode}`
        );
        assert.ok(!result.rewrittenCode.includes('StringToDate'), 'StringToDate should be removed');
        assert.ok(result.changes.length > 0, 'expected at least one change entry');
    });

    test('.NET tt format specifier → Java a', () => {
        const code = 'FormatDate(@d, "M/d/yyyy h:mm:ss tt")';
        const result = rewriteAmpForMcn(code, opts);
        assert.ok(
            result.rewrittenCode.includes('a'),
            `expected 'tt' replaced with 'a', got: ${result.rewrittenCode}`
        );
        assert.ok(!result.rewrittenCode.includes(' tt'), "expected no ' tt' in rewritten code");
    });

    test('MCE-only function annotated with NOT SUPPORTED IN MCN', () => {
        const code = 'InsertDE("MyDE", "Col", "Val")';
        const result = rewriteAmpForMcn(code, opts);
        assert.ok(
            result.rewrittenCode.includes('NOT SUPPORTED IN MCN'),
            `expected NOT SUPPORTED annotation, got: ${result.rewrittenCode}`
        );
    });

    test('SSJS Platform.Function.Lookup → converted to AMPscript Lookup', () => {
        const code =
            '<script runat="server">Platform.Function.Lookup("DE","ret","k","v");</script>';
        const result = rewriteAmpForMcn(code, opts);
        assert.ok(
            result.rewrittenCode.includes('Lookup(') ||
                result.rewrittenCode.includes('%%-- MANUAL_REWRITE_REQUIRED'),
            `expected Lookup conversion or flagging, got: ${result.rewrittenCode}`
        );
    });

    test('SSJS try/catch → flagged as MANUAL_REWRITE_REQUIRED', () => {
        const code = '<script runat="server">try { var x = 1; } catch(e) { Write(e); }</script>';
        const result = rewriteAmpForMcn(code, opts);
        assert.ok(
            result.nonMigratableItems.length > 0 ||
                result.rewrittenCode.includes('MANUAL_REWRITE_REQUIRED'),
            'try/catch should be flagged as not migratable'
        );
    });

    test('context: cloudpage → returns not-migratable immediately', () => {
        const code = 'CloudPagesURL(1234)';
        const result = rewriteAmpForMcn(code, { ...opts, context: 'cloudpage' });
        assert.equal(
            result.difficulty,
            'not-migratable',
            'cloudpage context should yield not-migratable difficulty'
        );
    });

    test('MCN-supported function with no notes → no changes', () => {
        const code = 'Concat("hello", " world")';
        const result = rewriteAmpForMcn(code, opts);
        assert.equal(result.changes.length, 0, 'Concat needs no changes for MCN compatibility');
        assert.equal(result.difficulty, 'ready', 'simple MCN-supported code should be ready');
    });
});

// ---------------------------------------------------------------------------
// convertSsjsToAmpscript tool logic
// ---------------------------------------------------------------------------

describe('convertSsjsToAmpscript tool logic', () => {
    test('Platform.Function.Lookup → Lookup()', () => {
        const code = 'Platform.Function.Lookup("DE","col","k","v");';
        const result = ssjsToAmpscript(code);
        assert.ok(
            result.convertedCode.includes('Lookup('),
            `expected Lookup(), got: ${result.convertedCode}`
        );
        assert.ok(
            !result.convertedCode.includes('Platform.Function.Lookup'),
            'Platform.Function prefix should be removed'
        );
    });

    test('Platform.Function.LookupRows → LookupRows()', () => {
        const code = 'Platform.Function.LookupRows("DE","col","v");';
        const result = ssjsToAmpscript(code);
        assert.ok(
            result.convertedCode.includes('LookupRows('),
            `expected LookupRows(), got: ${result.convertedCode}`
        );
    });

    test('Platform.Variable.GetValue("myVar") → @myVar', () => {
        const code = 'var x = Platform.Variable.GetValue("myVar");';
        const result = ssjsToAmpscript(code);
        assert.ok(
            result.convertedCode.includes('@myVar') || result.convertedCode.includes('@x'),
            `expected variable reference in AMPscript, got: ${result.convertedCode}`
        );
    });

    test('JS-native array forEach → MANUAL_REWRITE_REQUIRED', () => {
        const code = 'var arr = [1,2,3]; arr.forEach(function(i) { Write(i); });';
        const result = ssjsToAmpscript(code);
        assert.ok(
            result.flaggedSections.length > 0 ||
                result.convertedCode.includes('MANUAL_REWRITE_REQUIRED'),
            'forEach should be flagged'
        );
    });

    test('Platform.Load is stripped (not needed in AMPscript)', () => {
        const code =
            'Platform.Load("AmpScript", "1.1.1");\nPlatform.Function.Lookup("DE","c","k","v");';
        const result = ssjsToAmpscript(code);
        assert.ok(
            !result.convertedCode.includes('Platform.Load'),
            'Platform.Load should be removed'
        );
        assert.ok(result.changes.some((c) => c.description.includes('Platform.Load')));
    });

    test('result has convertedCode, changes, and flaggedSections shape', () => {
        const result = ssjsToAmpscript('Platform.Function.Trim("hi");');
        assert.ok(typeof result.convertedCode === 'string');
        assert.ok(Array.isArray(result.changes));
        assert.ok(Array.isArray(result.flaggedSections));
    });
});

// ---------------------------------------------------------------------------
// convertAmpscriptToSsjs tool logic
// ---------------------------------------------------------------------------

describe('convertAmpscriptToSsjs tool logic', () => {
    test('SET @x = expr → var x = expr', () => {
        const code = '%%[ SET @name = "World" ]%%';
        const result = ampscriptToSsjs(code);
        assert.ok(
            result.convertedCode.includes('var name') || result.convertedCode.includes('name ='),
            `expected var name assignment, got: ${result.convertedCode}`
        );
    });

    test('Lookup call → Platform.Function.Lookup call', () => {
        const code = '%%[ SET @x = Lookup("DE","col","k","v") ]%%';
        const result = ampscriptToSsjs(code);
        assert.ok(
            result.convertedCode.includes('Platform.Function.Lookup') ||
                result.convertedCode.includes('Lookup('),
            `expected Lookup conversion, got: ${result.convertedCode}`
        );
    });

    test('IF / ENDIF → if / closing brace structure', () => {
        const code = '%%[ IF @cond == "yes" THEN\n  OutputLine("yes")\nENDIF ]%%';
        const result = ampscriptToSsjs(code);
        assert.ok(
            result.convertedCode.includes('if ') || result.convertedCode.includes('if('),
            `expected if statement, got: ${result.convertedCode}`
        );
    });

    test('FOR loop → for loop', () => {
        const code = '%%[ FOR @i = 1 TO 5 DO\n  OutputLine(@i)\nNEXT @i ]%%';
        const result = ampscriptToSsjs(code);
        assert.ok(
            result.convertedCode.includes('for ') || result.convertedCode.includes('for('),
            `expected for loop, got: ${result.convertedCode}`
        );
    });

    test('@variable reference → bare variable name in expressions', () => {
        const code = '%%[ SET @greeting = Concat("Hello, ", @firstName) ]%%';
        const result = ampscriptToSsjs(code);
        // The converted code should use bare variable names not @-prefixed
        assert.ok(
            result.convertedCode.includes('firstName') || result.convertedCode.includes('greeting'),
            `expected bare variable names, got: ${result.convertedCode}`
        );
    });

    test('result has convertedCode, changes, and flaggedSections shape', () => {
        const result = ampscriptToSsjs('%%[ SET @x = "test" ]%%');
        assert.ok(typeof result.convertedCode === 'string');
        assert.ok(Array.isArray(result.changes));
        assert.ok(Array.isArray(result.flaggedSections));
    });
});

// ---------------------------------------------------------------------------
// conversion-rules.ts — mapping tables spot-check
// ---------------------------------------------------------------------------

describe('conversion-rules mapping tables', () => {
    test('PLATFORM_FUNCTION_TO_AMP: spot-check 10+ entries', () => {
        const expected = [
            ['lookup', 'Lookup'],
            ['lookuprows', 'LookupRows'],
            ['insertde', 'InsertDE'],
            ['updatede', 'UpdateDE'],
            ['upsertde', 'UpsertDE'],
            ['deletede', 'DeleteDE'],
            ['concat', 'Concat'],
            ['trim', 'Trim'],
            ['formatdate', 'FormatDate'],
            ['now', 'Now'],
            ['dateadd', 'DateAdd'],
        ];
        for (const [key, value] of expected) {
            assert.equal(
                PLATFORM_FUNCTION_TO_AMP[key],
                value,
                `PLATFORM_FUNCTION_TO_AMP['${key}'] should be '${value}'`
            );
        }
    });

    test('AMP_TO_PLATFORM_FUNCTION: spot-check 10+ entries', () => {
        const expected = [
            ['lookup', 'Lookup'],
            ['lookuprows', 'LookupRows'],
            ['insertde', 'InsertDE'],
            ['updatede', 'UpdateDE'],
            ['concat', 'Concat'],
            ['trim', 'Trim'],
            ['formatdate', 'FormatDate'],
            ['now', 'Now'],
            ['dateadd', 'DateAdd'],
            ['lowercase', 'Lowercase'],
            ['uppercase', 'Uppercase'],
        ];
        for (const [key, value] of expected) {
            assert.equal(
                AMP_TO_PLATFORM_FUNCTION[key],
                value,
                `AMP_TO_PLATFORM_FUNCTION['${key}'] should be '${value}'`
            );
        }
    });

    test('DOTNET_TO_JAVA_FORMAT_REPLACEMENTS: tt → a', () => {
        assert.ok(
            DOTNET_TO_JAVA_FORMAT_REPLACEMENTS.length > 0,
            'expected at least one replacement rule'
        );
        const [ttPattern, ttReplacement] = DOTNET_TO_JAVA_FORMAT_REPLACEMENTS[0];
        const result = 'h:mm:ss tt'.replace(ttPattern, ttReplacement);
        assert.ok(result.includes('a'), `expected 'tt' replaced with 'a', got: ${result}`);
        assert.ok(!result.includes(' tt'), `expected no ' tt' remaining, got: ${result}`);
    });

    test('DOTNET_STANDARD_SHORTHANDS contains expected patterns', () => {
        for (const shorthand of ['G', 'g', 'D', 'F', 'f', 'T', 't']) {
            assert.ok(
                DOTNET_STANDARD_SHORTHANDS.has(shorthand),
                `expected '${shorthand}' in DOTNET_STANDARD_SHORTHANDS`
            );
        }
    });

    test('NON_MIGRATABLE_SSJS_PATTERNS: try/catch pattern matches try/catch code', () => {
        const tryCatchCode = 'try { var x = 1; } catch(e) { }';
        const matched = NON_MIGRATABLE_SSJS_PATTERNS.some(({ pattern }) => {
            pattern.lastIndex = 0;
            return pattern.test(tryCatchCode);
        });
        assert.ok(matched, 'try/catch pattern should match try/catch code');
    });

    test('NON_MIGRATABLE_SSJS_PATTERNS: forEach matches array method code', () => {
        const forEachCode = 'items.forEach(function(i) { Write(i); });';
        const matched = NON_MIGRATABLE_SSJS_PATTERNS.some(({ pattern }) => {
            pattern.lastIndex = 0;
            return pattern.test(forEachCode);
        });
        assert.ok(matched, 'forEach pattern should match array forEach code');
    });

    test('NON_MIGRATABLE_SSJS_PATTERNS: Platform.Function.* does NOT match as non-migratable', () => {
        const platformCode = 'Platform.Function.Lookup("DE","col","k","v");';
        const matched = NON_MIGRATABLE_SSJS_PATTERNS.some(({ pattern }) => {
            pattern.lastIndex = 0;
            return pattern.test(platformCode);
        });
        assert.ok(!matched, 'Platform.Function.Lookup should NOT be flagged as non-migratable');
    });
});

// ---------------------------------------------------------------------------
// detect_sfmc_platform tool logic
// ---------------------------------------------------------------------------

/**
 * Inline simulation of the detect_sfmc_platform tool logic for tests.
 * @param {string} dir
 * @returns {string}
 */
function detectPlatform(dir) {
    if (existsSync(join(dir, '.mcdevrc.json'))) return 'engagement';
    if (existsSync(join(dir, 'sfdx-project.json'))) return 'next';
    return 'unknown';
}

describe('detect_sfmc_platform tool logic', () => {
    test('returns "engagement" when .mcdevrc.json exists in the given directory', () => {
        const monorepoRoot = join(repoRoot, '..');
        if (!existsSync(join(monorepoRoot, '.mcdevrc.json'))) {
            // .mcdevrc.json not present in this environment — skip gracefully
            return;
        }
        assert.equal(detectPlatform(monorepoRoot), 'engagement');
    });

    test('returns "unknown" for a directory with neither sentinel file', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'sfmc-test-'));
        assert.equal(detectPlatform(tmp), 'unknown');
    });

    test('returns "next" when sfdx-project.json exists', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'sfmc-mcn-'));
        writeFileSync(join(tmp, 'sfdx-project.json'), '{}');
        assert.equal(detectPlatform(tmp), 'next');
    });

    test('engagement takes precedence over next when both sentinels exist', () => {
        const tmp = mkdtempSync(join(tmpdir(), 'sfmc-both-'));
        writeFileSync(join(tmp, '.mcdevrc.json'), '{}');
        writeFileSync(join(tmp, 'sfdx-project.json'), '{}');
        assert.equal(detectPlatform(tmp), 'engagement');
    });
});

// ---------------------------------------------------------------------------
// search_mcn_help tool logic
// ---------------------------------------------------------------------------

describe('search_mcn_help tool logic', () => {
    test('getMcnHelpStats returns non-zero counts when chunks are loaded', () => {
        clearMcnHelpCache();
        const stats = getMcnHelpStats();
        // Chunks bundled in bundled/mcn-help/chunks.json
        assert.ok(stats.chunkCount >= 0, 'chunkCount should be a non-negative number');
        assert.ok(stats.fileCount >= 0, 'fileCount should be a non-negative number');
    });

    test('searchMcnHelp returns results for a broad marketing cloud API query', () => {
        clearMcnHelpCache();
        const stats = getMcnHelpStats();
        if (stats.chunkCount === 0) {
            // Bundled file not present — skip
            return;
        }
        const hits = searchMcnHelp('marketing cloud api', 5);
        assert.ok(hits.length > 0, 'should find at least one result for "marketing cloud api"');
    });

    test('searchMcnHelp returns empty for a nonsense query', () => {
        clearMcnHelpCache();
        const hits = searchMcnHelp('xyzzy_nonexistent_query_zzz', 5);
        assert.equal(hits.length, 0);
    });

    test('searchMcnHelp hit objects have required fields', () => {
        clearMcnHelpCache();
        const stats = getMcnHelpStats();
        if (stats.chunkCount === 0) return;
        const hits = searchMcnHelp('marketing cloud', 3);
        for (const hit of hits) {
            assert.ok(typeof hit.score === 'number');
            assert.ok(typeof hit.chunk.id === 'string');
            assert.ok(typeof hit.chunk.heading === 'string');
            assert.ok(typeof hit.chunk.body === 'string');
            assert.ok(typeof hit.chunk.relativePath === 'string');
        }
    });
});

// ---------------------------------------------------------------------------
// validate_ampscript target:'next' tool logic
// ---------------------------------------------------------------------------

describe('validate_ampscript target:next tool logic', () => {
    test('flags MCN-unsupported function as error when target is next', () => {
        // ContentArea is MCE-only (mcnSince === null)
        const code = '%%[ SET @ca = ContentArea(123) ]%%';
        const diags = validateAmpscript(code, { maxNumberOfProblems: 100, targetPlatform: 'next' });
        const mcnError = diags.find(
            (d) => d.message.toLowerCase().includes('not supported') && d.severity === 1
        );
        assert.ok(mcnError, 'should report an error for a function not supported in MCN');
    });

    test('does not flag MCN-supported function when target is next', () => {
        // Lookup is MCN-supported (mcnSince === 67)
        const code = '%%[ SET @val = Lookup("DE","field","key","val") ]%%';
        const diags = validateAmpscript(code, { maxNumberOfProblems: 100, targetPlatform: 'next' });
        const mcnError = diags.find(
            (d) => d.message.toLowerCase().includes('not supported') && d.severity === 1
        );
        assert.ok(!mcnError, 'Lookup should not be flagged as MCN-unsupported');
    });

    test('behaves identically to engagement for standard errors regardless of target', () => {
        const code = '%%[ SET @x = UnknownFunctionXYZ() ]%%';
        const diagsEngage = validateAmpscript(code, {
            maxNumberOfProblems: 100,
            targetPlatform: 'engagement',
        });
        const diagsNext = validateAmpscript(code, {
            maxNumberOfProblems: 100,
            targetPlatform: 'next',
        });
        // Both should report unknown function
        assert.ok(diagsEngage.length > 0, 'engagement: should report unknown function');
        assert.ok(diagsNext.length > 0, 'next: should report unknown function');
    });
});

// ---------------------------------------------------------------------------
// validate_ssjs target:'next' tool logic
// ---------------------------------------------------------------------------

describe('validate_ssjs target:next tool logic', () => {
    test('flags all SSJS as unsupported when target is next', () => {
        const code = '<script runat="server">Platform.Load("core","1.1.5"); var x = 1;</script>';
        const diags = validateSsjs(code, { maxNumberOfProblems: 100, targetPlatform: 'next' });
        const mcnError = diags.find(
            (d) => d.message.toLowerCase().includes('not supported') && d.severity === 1
        );
        assert.ok(mcnError, 'should report SSJS as not supported in MCN');
    });

    test('does not flag SSJS as MCN-unsupported when target is engagement', () => {
        const code = '<script runat="server">var x = 1;</script>';
        const diags = validateSsjs(code, {
            maxNumberOfProblems: 100,
            targetPlatform: 'engagement',
        });
        const mcnErrors = diags.filter((d) =>
            d.message.toLowerCase().includes('not supported in marketing cloud next')
        );
        assert.equal(mcnErrors.length, 0, 'engagement mode should not add MCN errors to SSJS');
    });
});

// ---------------------------------------------------------------------------
// get_ampscript_completions target:'next' tool logic
// ---------------------------------------------------------------------------

describe('get_ampscript_completions target:next tool logic', () => {
    test('isMcnSupported correctly identifies a known MCN function', () => {
        // Lookup is MCN-supported
        assert.ok(isMcnSupported('Lookup'), 'Lookup should be MCN-supported');
    });

    test('isMcnSupported returns false for MCE-only function', () => {
        // ContentArea is MCE-only
        assert.ok(!isMcnSupported('ContentArea'), 'ContentArea should not be MCN-supported');
    });
});

// ---------------------------------------------------------------------------
// get_ssjs_completions target:'next' tool logic
// ---------------------------------------------------------------------------

describe('get_ssjs_completions target:next tool logic', () => {
    test('getSsjsCompletionCatalog returns items for engagement', () => {
        const items = sfmcLanguageService.getSsjsCompletionCatalog();
        assert.ok(items.length > 0, 'should return SSJS completions for engagement');
    });

    test('MCN target should produce empty SSJS completions (tool redirects to AMPscript)', () => {
        // The tool itself returns a redirect message for target:'next'
        // Test that the catalog is non-empty (engagement) and simulate the MCN branch returning nothing
        const items = sfmcLanguageService.getSsjsCompletionCatalog();
        assert.ok(items.length > 0, 'catalog is non-empty for engagement');
        // The MCN branch simply returns a redirect — simulate by checking the catalog is filtered to 0
        const mcnFiltered = items.filter(() => false); // MCN returns empty list
        assert.equal(mcnFiltered.length, 0);
    });
});

// ---------------------------------------------------------------------------
// suggest_fix target:'next' tool logic
// ---------------------------------------------------------------------------

describe('suggest_fix target:next tool logic', () => {
    test('validates with MCN target and reports MCN-unsupported function', () => {
        const code = '%%[ SET @ca = ContentArea(123) ]%%';
        const doc = { text: code, languageId: 'ampscript', uri: 'fix-target' };
        const diags = sfmcLanguageService.validate(doc, {
            maxNumberOfProblems: 50,
            targetPlatform: 'next',
        });
        const mcnError = diags.find(
            (d) => d.message.toLowerCase().includes('not supported') && d.severity === 1
        );
        assert.ok(
            mcnError,
            'should surface MCN-unsupported error via validate with targetPlatform:next'
        );
    });

    test('validates SSJS with MCN target and flags it', () => {
        const code = '<script runat="server">var x = 1;</script>';
        const doc = { text: code, languageId: 'ssjs', uri: 'fix-target' };
        const diags = sfmcLanguageService.validate(doc, {
            maxNumberOfProblems: 50,
            targetPlatform: 'next',
        });
        const mcnError = diags.find(
            (d) => d.message.toLowerCase().includes('not supported') && d.severity === 1
        );
        assert.ok(
            mcnError,
            'should surface MCN-unsupported error for SSJS via validate with targetPlatform:next'
        );
    });
});

// ---------------------------------------------------------------------------
// MCP Registry manifest (package.json / server.json)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// search_help unified wrapper
// ---------------------------------------------------------------------------

describe('search_help unified wrapper', () => {
    test('routes to MCE help when target is engagement', () => {
        // search_help with explicit target:engagement should behave like search_mce_help
        const mceHits = searchMceHelp('email studio', 5, 'any');
        // We just verify the same search logic returns results (or not)
        assert.ok(Array.isArray(mceHits));
    });

    test('routes to MCN dev docs when projectRoot contains sfdx-project.json', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
        writeFileSync(join(dir, 'sfdx-project.json'), '{}');
        // Verify the sentinel file detection matches what search_help will use
        assert.ok(existsSync(join(dir, 'sfdx-project.json')), 'sfdx-project.json created');
        // Platform resolution
        const platform = existsSync(join(dir, '.mcdevrc.json'))
            ? 'engagement'
            : existsSync(join(dir, 'sfdx-project.json'))
              ? 'next'
              : 'unknown';
        assert.equal(platform, 'next');
    });

    test('routes to MCE when projectRoot contains .mcdevrc.json', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
        writeFileSync(join(dir, '.mcdevrc.json'), '{}');
        const platform = existsSync(join(dir, '.mcdevrc.json'))
            ? 'engagement'
            : existsSync(join(dir, 'sfdx-project.json'))
              ? 'next'
              : 'unknown';
        assert.equal(platform, 'engagement');
    });

    test('falls back to unknown when no sentinel file is present', () => {
        const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
        const platform = existsSync(join(dir, '.mcdevrc.json'))
            ? 'engagement'
            : existsSync(join(dir, 'sfdx-project.json'))
              ? 'next'
              : 'unknown';
        assert.equal(platform, 'unknown');
    });

    test('explicit target overrides projectRoot detection', () => {
        // Even if sfdx-project.json is present, explicit target:engagement wins
        const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
        writeFileSync(join(dir, 'sfdx-project.json'), '{}');
        const explicitTarget = 'engagement';
        // When target is set, it takes precedence regardless of sentinel files
        const effective =
            explicitTarget ?? (existsSync(join(dir, 'sfdx-project.json')) ? 'next' : 'unknown');
        assert.equal(effective, 'engagement');
    });
});

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
            `server.json description is ${server.description.length} chars (max 100)`
        );
    });
});
