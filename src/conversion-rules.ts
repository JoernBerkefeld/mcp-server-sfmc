/**
 * Shared conversion rules for SSJS ↔ AMPscript and MCN rewriting.
 *
 * Single source of truth for mapping tables and deterministic transformation
 * logic used by:
 *   - rewrite_for_mcn tool
 *   - convertSsjsToAmpscript tool
 *   - convertAmpscriptToSsjs tool
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangeEntry {
    line: number;
    description: string;
}

export interface FlaggedSection {
    line: number;
    code: string;
    reason: string;
}

export interface ConversionResult {
    convertedCode: string;
    changes: ChangeEntry[];
    flaggedSections: FlaggedSection[];
}

// ---------------------------------------------------------------------------
// Dynamic Platform.Function ↔ AMPscript maps (built from ssjs-data at load time)
// ---------------------------------------------------------------------------

import { PLATFORM_FUNCTIONS } from 'ssjs-data';

/**
 * Maps a Platform.Function.X name (lowercase) to the equivalent AMPscript
 * canonical function name. Built at module load time from ssjs-data's
 * ampscriptEquivalent field — always in sync with the installed ssjs-data version.
 * Only functions with a direct 1:1 equivalent are included.
 */
export const PLATFORM_FUNCTION_TO_AMP: Readonly<Record<string, string>> = Object.fromEntries(
    PLATFORM_FUNCTIONS.filter((f) => f.ampscriptEquivalent != null).map((f) => [
        f.name.toLowerCase(),

        f.ampscriptEquivalent!,
    ])
);

/**
 * Maps an AMPscript function name (lowercase) to its SSJS Platform.Function
 * equivalent name (the part after "Platform.Function."). Inverted from
 * PLATFORM_FUNCTION_TO_AMP at module load time.
 */
export const AMP_TO_PLATFORM_FUNCTION: Readonly<Record<string, string>> = Object.fromEntries(
    PLATFORM_FUNCTIONS.filter((f) => f.ampscriptEquivalent != null).map((f) => [
        f.ampscriptEquivalent!.toLowerCase(),
        f.name,
    ])
);

/**
 * Set of SSJS Platform.Function names (lowercase) that have no AMPscript
 * equivalent (SSJS-only). These must be flagged MANUAL_REWRITE_REQUIRED when
 * converting SSJS → AMPscript.
 */
const SSJS_ONLY_FUNCTIONS: ReadonlySet<string> = new Set(
    PLATFORM_FUNCTIONS.filter((f) => f.ampscriptEquivalent === null).map((f) =>
        f.name.toLowerCase()
    )
);

// ---------------------------------------------------------------------------
// Dynamic AMPscript ↔ MCN Handlebars maps (built from ampscript-data at load time)
// ---------------------------------------------------------------------------

import { FUNCTIONS as AMPSCRIPT_FUNCTIONS } from 'ampscript-data';
import { getHelper as getHandlebarsHelper } from 'handlebars-data';

/**
 * Maps an AMPscript function name (lowercase) to the canonical MCN Handlebars
 * helper name it converts to. Built at module load time from ampscript-data's
 * `handlebarsEquivalent` field — always in sync with the installed
 * ampscript-data version, never hand-edited (`mcp-conversion-rules-sync.mdc`).
 *
 * Only Category A functions (non-null string `handlebarsEquivalent`) are
 * included. The stored value is the bare helper name; the canonical casing is
 * resolved through `handlebars-data` so emitted `{{helper}}` calls match the
 * catalog exactly.
 */
export const AMP_TO_HANDLEBARS: Readonly<Record<string, string>> = Object.fromEntries(
    AMPSCRIPT_FUNCTIONS.filter(
        (f) => typeof f.handlebarsEquivalent === 'string' && f.handlebarsEquivalent.length > 0
    ).map((f) => {
        const canonical = getHandlebarsHelper(f.handlebarsEquivalent as string);
        return [
            f.name.toLowerCase(),
            canonical ? canonical.name : (f.handlebarsEquivalent as string),
        ];
    })
);

/**
 * Maps a canonical MCN Handlebars helper name (lowercase) to its AMPscript
 * function name. Inverted from AMP_TO_HANDLEBARS at module load time. Used by
 * convertHandlebarsToAmpscript.
 */
export const HANDLEBARS_TO_AMP: Readonly<Record<string, string>> = Object.fromEntries(
    AMPSCRIPT_FUNCTIONS.filter(
        (f) => typeof f.handlebarsEquivalent === 'string' && f.handlebarsEquivalent.length > 0
    ).map((f) => {
        const canonical = getHandlebarsHelper(f.handlebarsEquivalent as string);
        return [
            (canonical ? canonical.name : (f.handlebarsEquivalent as string)).toLowerCase(),
            f.name,
        ];
    })
);

/**
 * Set of AMPscript function names (lowercase) flagged `mcnHandlebarsGap: true`
 * in ampscript-data (Category C). These are documented as MCN-supported but
 * currently fail at runtime and have no Handlebars helper — converting them
 * must emit a MANUAL_REWRITE marker distinct from Category B (no counterpart).
 */
export const AMP_MCN_HANDLEBARS_GAP: ReadonlySet<string> = new Set(
    AMPSCRIPT_FUNCTIONS.filter((f) => f.mcnHandlebarsGap === true).map((f) => f.name.toLowerCase())
);

// ---------------------------------------------------------------------------
// AMP_NATIVE_JS_HINTS: AMPscript-only functions with clean native JS rewrites
// ---------------------------------------------------------------------------

/**
 * Maps an AMPscript function name (lowercase) to a native JavaScript rewrite
 * hint comment. Checked BEFORE the TreatAsContent polyfill fallback in
 * AMPscript → SSJS conversion. All hints are ES3-safe (no ES5+ methods).
 *
 * NOTE: Trim is deliberately absent — it maps to Platform.Function.Trim via
 * the dynamic map above. String.prototype.trim() is ES5 and unavailable in
 * SFMC SSJS.
 */
export const AMP_NATIVE_JS_HINTS: Readonly<Record<string, string>> = {
    // String operations
    concat: '/* use string concatenation: a + b */',
    substring: '.substring(start, start + length)',
    lowercase: '.toLowerCase()',
    uppercase: '.toUpperCase()',
    indexof: '.indexOf(searchStr)',
    length: '.length',
    replace: '.replace(search, replacement)',
    // Math
    add: '/* use: a + b */',
    subtract: '/* use: a - b */',
    multiply: '/* use: a * b */',
    divide: '/* use: a / b */',
    mod: '/* use: a % b */',
    random: 'Math.floor(Math.random() * n)',
    // Utility
    iif: '/* use ternary: condition ? trueValue : falseValue */',
    empty: '/* use: !value */',
    isnull: '/* use: value === null */',
    // Output (also handled explicitly in ssjsToAmpscript)
    output: 'Platform.Response.Write(expr)',
    outputline: 'Platform.Response.Write(expr)',
};

// ---------------------------------------------------------------------------
// .NET → Java SimpleDateFormat format string replacements
// ---------------------------------------------------------------------------

/**
 * Ordered list of [RegExp, replacement] pairs to convert .NET format specifiers
 * in FormatDate() calls to Java SimpleDateFormat equivalents.
 * Applied sequentially so more specific patterns match before general ones.
 */
export const DOTNET_TO_JAVA_FORMAT_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
    // AM/PM marker: .NET 'tt' → Java 'a'
    [/\btt\b/g, 'a'],
];

/**
 * Set of .NET standard format shorthands that have no direct Java equivalent
 * and must be replaced with an explicit pattern.
 */
export const DOTNET_STANDARD_SHORTHANDS: ReadonlySet<string> = new Set([
    'G',
    'g',
    'D',
    'F',
    'f',
    'T',
    't',
    'R',
    'r',
    'U',
    'u',
    's',
    'o',
    'O',
]);

// ---------------------------------------------------------------------------
// CloudPages-specific AMPscript functions (not available in MCN)
// ---------------------------------------------------------------------------

/**
 * Set of AMPscript function names (lowercase) that are available only in
 * CloudPages / web content context and are not supported in Marketing Cloud Next.
 */
export const CLOUDPAGES_ONLY_FUNCTIONS: ReadonlySet<string> = new Set([
    'cloudpagesurl',
    'requestparameter',
    'queryparameter',
    'redirect',
    'micrositeurl',
    'isprimarycontext',
    'cloudpageurl',
    'ampscriptnow',
]);

// ---------------------------------------------------------------------------
// Non-migratable SSJS patterns
// ---------------------------------------------------------------------------

/**
 * Patterns in SSJS code that indicate constructs with no AMPscript equivalent.
 * Any SSJS block containing these patterns is classified as "Not migratable"
 * in check_mcn_compatibility and marked MANUAL_REWRITE_REQUIRED in rewriting tools.
 */
export const NON_MIGRATABLE_SSJS_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
    { pattern: /\btry\s*\{/, reason: 'try/catch has no AMPscript equivalent' },
    { pattern: /\bcatch\s*\(/, reason: 'try/catch has no AMPscript equivalent' },
    {
        pattern: /\bfinally\s*\{/,
        reason: 'try/catch/finally has no AMPscript equivalent',
    },
    {
        pattern: /\.forEach\s*\(/,
        reason: 'Array.forEach() has no AMPscript equivalent',
    },
    {
        pattern: /\.map\s*\(/,
        reason: 'Array.map() has no AMPscript equivalent',
    },
    {
        pattern: /\.filter\s*\(/,
        reason: 'Array.filter() has no AMPscript equivalent',
    },
    {
        pattern: /\.reduce\s*\(/,
        reason: 'Array.reduce() has no AMPscript equivalent',
    },
    {
        pattern: /JSON\.stringify\s*\(/,
        reason: 'JSON.stringify() has no AMPscript equivalent',
    },
    {
        pattern: /new\s+RegExp\s*\(/,
        reason: 'Regular expressions have no AMPscript equivalent',
    },
    {
        pattern: /Platform\.Request\.(GetQueryStringParameter|GetFormField)\s*\(/,
        reason: 'Query string / form field access requires CloudPages context (not available in MCN)',
    },
];

/**
 * Returns the first non-migratable SSJS pattern that matches the given code, or undefined.
 * @param code single line of trimmed SSJS source
 */
function findNonMigratableSsjsPattern(
    code: string
): { pattern: RegExp; reason: string } | undefined {
    return NON_MIGRATABLE_SSJS_PATTERNS.find(({ pattern }) => {
        // Reset lastIndex for global regexes
        pattern.lastIndex = 0;
        return pattern.test(code);
    });
}

// ---------------------------------------------------------------------------
// SSJS → AMPscript conversion
// ---------------------------------------------------------------------------

/**
 * Convert a SSJS code block to equivalent AMPscript using deterministic rules.
 *
 * Handles:
 * - `Platform.Function.X(args)` → `X(args)`
 * - `Platform.Variable.GetValue("name")` → `\@name`
 * - `Platform.Variable.SetValue("name", val)` → `SET \@name = val`
 * - `Platform.Response.Write(expr)` → `OutputLine(expr)`
 * - `var x = expr;` → `SET \@x = expr`
 * - `var x;` → `VAR \@x`
 * - Control flow: if/else if/else/} → IF/ELSEIF/ELSE/ENDIF
 * - `for (var i = start; i <= end; i++) {` → `FOR \@i = start TO end DO`
 *
 * Flags non-migratable constructs as MANUAL_REWRITE_REQUIRED.
 * @param code - SSJS source code (may include `<script runat="server">` tags).
 * @returns {ConversionResult} Conversion result with converted code, change log, and flagged sections.
 */
export function ssjsToAmpscript(code: string): ConversionResult {
    const changes: ChangeEntry[] = [];
    const flaggedSections: FlaggedSection[] = [];

    // Strip <script runat="server"> wrappers if present
    const inner = code
        .replaceAll(/<script[^>]+runat=['"]?server['"]?[^>]*>/gi, '')
        .replaceAll(/<\/script>/gi, '')
        .trim();

    const rawLines = inner.split('\n');
    const outputLines: string[] = [];

    for (const [index, original] of rawLines.entries()) {
        const lineNumber = index + 1;
        const trimmed = original.trim();

        // Skip blank lines, Platform.Load(), var-only declarations with no value
        if (!trimmed) {
            outputLines.push('');
            continue;
        }

        // Skip Platform.Load() — no AMPscript equivalent, not needed in MCN
        if (/^Platform\.Load\s*\(/i.test(trimmed)) {
            changes.push({
                line: lineNumber,
                description: 'Removed Platform.Load() (not needed in AMPscript)',
            });
            continue;
        }

        // Check for non-migratable patterns first
        const nonMigratable = findNonMigratableSsjsPattern(trimmed);
        if (nonMigratable) {
            const { reason } = nonMigratable;
            outputLines.push(
                `%%-- MANUAL_REWRITE_REQUIRED: ${reason} --%%`,
                `%%-- Original: ${trimmed} --%%`
            );
            flaggedSections.push({ line: lineNumber, code: trimmed, reason });
            continue;
        }

        let line = original;

        // Platform.Variable.GetValue("name") → @name
        line = line.replaceAll(
            /Platform\.Variable\.GetValue\s*\(\s*["']([^"']+)["']\s*\)/gi,
            '@$1'
        );

        // Platform.Variable.SetValue("name", value) → SET @name = value (strip ; at end if present)
        line = line.replaceAll(
            /Platform\.Variable\.SetValue\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)\s*;?/gi,
            (_, variableName: string, value: string) => {
                changes.push({
                    line: lineNumber,
                    description: `Platform.Variable.SetValue → SET @${variableName}`,
                });
                return `SET @${variableName} = ${value.trim()}`;
            }
        );

        // Platform.Response.Write(expr) → OutputLine(expr)
        line = line.replaceAll(/Platform\.Response\.Write\s*\(/gi, () => {
            changes.push({ line: lineNumber, description: 'Platform.Response.Write → OutputLine' });
            return 'OutputLine(';
        });

        // Platform.Function.X(args) → X(args) using known function map
        line = line.replaceAll(/Platform\.Function\.(\w+)\s*\(/gi, (_, functionName: string) => {
            const key = functionName.toLowerCase();
            if (SSJS_ONLY_FUNCTIONS.has(key)) {
                flaggedSections.push({
                    line: lineNumber,
                    code: `Platform.Function.${functionName}(...)`,
                    reason: `Platform.Function.${functionName} has no AMPscript equivalent`,
                });
                return `/* MANUAL_REWRITE_REQUIRED: Platform.Function.${functionName} has no AMPscript equivalent */ ${functionName}(`;
            }
            const ampName = PLATFORM_FUNCTION_TO_AMP[key];
            if (!ampName) {
                flaggedSections.push({
                    line: lineNumber,
                    code: `Platform.Function.${functionName}(...)`,
                    reason: `Platform.Function.${functionName} not found in ssjs-data catalog`,
                });
                return `/* MANUAL_REWRITE_REQUIRED: unknown Platform.Function.${functionName} */ ${functionName}(`;
            }
            changes.push({
                line: lineNumber,
                description: `Platform.Function.${functionName} → ${ampName}`,
            });
            return `${ampName}(`;
        });

        // var x = expr; → SET @x = expr
        line = line.replace(
            /\bvar\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*;?\s*$/,
            (_, variableName: string, value: string) => {
                changes.push({
                    line: lineNumber,
                    description: `var ${variableName} = ... → SET @${variableName}`,
                });
                return `SET @${variableName} = ${value.trim()}`;
            }
        );

        // var x; → VAR @x
        line = line.replace(/\bvar\s+([A-Za-z_]\w*)\s*;?\s*$/, (_, variableName: string) => {
            changes.push({
                line: lineNumber,
                description: `var ${variableName} → VAR @${variableName}`,
            });
            return `VAR @${variableName}`;
        });

        // Control flow: if (cond) { → IF cond THEN
        line = line.replace(/^\s*if\s*\((.+)\)\s*\{\s*$/, (_, cond: string) => {
            const ampCond = ssjsCondToAmp(cond.trim());
            changes.push({ line: lineNumber, description: 'if (...) { → IF ... THEN' });
            return `IF ${ampCond} THEN`;
        });

        // } else if (cond) { → ELSEIF cond THEN
        line = line.replace(/^\s*\}\s*else\s+if\s*\((.+)\)\s*\{\s*$/, (_, cond: string) => {
            const ampCond = ssjsCondToAmp(cond.trim());
            changes.push({ line: lineNumber, description: '} else if (...) { → ELSEIF ... THEN' });
            return `ELSEIF ${ampCond} THEN`;
        });

        // } else { → ELSE
        line = line.replace(/^\s*\}\s*else\s*\{\s*$/, () => {
            changes.push({ line: lineNumber, description: '} else { → ELSE' });
            return 'ELSE';
        });

        // for (var i = start; i <= end; i++) { → FOR @i = start TO end DO
        const forMatch =
            /^\s*for\s*\(\s*var\s+(\w+)\s*=\s*(\S+?)\s*;\s*\w+\s*<=?\s*(\S+?)\s*;\s*\w+\+\+\s*\)\s*\{\s*$/.exec(
                line
            );
        if (forMatch) {
            const [, iterVariable, start, end] = forMatch;
            changes.push({
                line: lineNumber,
                description: `for (var ${iterVariable}...) → FOR @${iterVariable} = ${start} TO ${end} DO`,
            });
            line = `FOR @${iterVariable} = ${start} TO ${end} DO`;
        }

        // Standalone closing brace } → ENDIF (best-effort; may not always be correct)
        if (/^\s*\}\s*$/.test(line) && !/^\s*\}\s*(else|catch|finally)/.test(line)) {
            changes.push({ line: lineNumber, description: '} → ENDIF' });
            line = 'ENDIF';
        }

        // Strip trailing semicolons from non-SET lines (AMPscript doesn't use them)
        if (!/^\s*SET /i.test(line.trim()) && /;\s*$/.test(line)) {
            line = line.replace(/;\s*$/, '');
        }

        outputLines.push(line.trim());
    }

    // Wrap in AMPscript block
    const convertedCode = `%%[\n${outputLines.filter((l) => l !== undefined).join('\n')}\n]%%`;

    return { convertedCode, changes, flaggedSections };
}

/**
 * Convert simple SSJS conditional expression to AMPscript syntax.
 * @param cond - JS condition string.
 * @returns {string} AMPscript condition string.
 */
function ssjsCondToAmp(cond: string): string {
    // @variable references from previous conversions stay as-is
    // Convert JS == / === to AMPscript == and != / !== to !=
    return cond
        .replaceAll(/!==\s*/g, '!= ')
        .replaceAll(/===\s*/g, '== ')
        .replaceAll('||', 'OR')
        .replaceAll('&&', 'AND')
        .replaceAll('!', 'NOT ');
}

// ---------------------------------------------------------------------------
// AMPscript → SSJS conversion
// ---------------------------------------------------------------------------

/**
 * Convert AMPscript code to equivalent SSJS using deterministic rules.
 *
 * Handles:
 * - `%%[ SET \@x = expr ]%%` → `var x = expr;`
 * - `%%[ VAR \@x, \@y ]%%` → `var x, y;`
 * - `%%[ IF cond THEN / ELSEIF / ELSE / ENDIF ]%%` → JS control flow
 * - `%%[ FOR \@i = start TO end DO / NEXT \@i ]%%` → for loop
 * - `%%=Output(\@x)=%%` / `%%=OutputLine(\@x)=%%` → `Platform.Response.Write(x)`
 * - `%%=FunctionName(args)=%%` → `Platform.Response.Write(Platform.Function.FunctionName(args))`
 * - Known AMPscript functions → Platform.Function.X equivalents
 * - `\@variable` references → bare variable names
 * @param code - AMPscript source code.
 * @returns {ConversionResult} Conversion result with converted SSJS, change log, and flagged sections.
 */
export function ampscriptToSsjs(code: string): ConversionResult {
    const changes: ChangeEntry[] = [];
    const flaggedSections: FlaggedSection[] = [];
    const outputLines: string[] = ['<script runat="server">', 'Platform.Load("Core", "1.1.5");'];
    const polyfillUsed = { value: false };

    // Normalize: combine multi-line %%[ ... ]%% blocks into single pseudo-lines
    // then process line by line
    const normalized = normalizeAmpscriptBlocks(code);

    const lines = normalized.split('\n');
    const lineOffset = 0;

    for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1 + lineOffset;
        const trimmed = line.trim();

        if (!trimmed) {
            outputLines.push('');
            continue;
        }

        // %%=Output(@x)=%% or %%=OutputLine(@x)=%%
        const inlineOutputMatch = /^%%=\s*(?:Output|OutputLine)\s*\((.+)\)\s*=%%$/i.exec(trimmed);
        if (inlineOutputMatch) {
            const expression = stripAmpVars(inlineOutputMatch[1].trim());
            changes.push({
                line: lineNumber,
                description: '%%=Output(...)=%% → Platform.Response.Write(...)',
            });
            outputLines.push(`Platform.Response.Write(${expression});`);
            continue;
        }

        // %%=FunctionName(args)=%% → Platform.Response.Write(Platform.Function.FunctionName(args))
        const inlineFunctionMatch = /^%%=\s*(\w+)\s*\((.*)?\)\s*=%%$/i.exec(trimmed);
        if (inlineFunctionMatch) {
            const functionName = inlineFunctionMatch[1];
            const arguments_ = inlineFunctionMatch[2]?.trim() ?? '';
            const key = functionName.toLowerCase();
            const ssName = AMP_TO_PLATFORM_FUNCTION[key];
            const nativeHint = AMP_NATIVE_JS_HINTS[key];
            const argumentsConverted = stripAmpVars(arguments_);
            if (ssName) {
                changes.push({
                    line: lineNumber,
                    description: `%%=${functionName}(...)=%% → Platform.Response.Write(Platform.Function.${ssName}(...))`,
                });
                outputLines.push(
                    `Platform.Response.Write(Platform.Function.${ssName}(${argumentsConverted}));`
                );
            } else if (nativeHint) {
                changes.push({
                    line: lineNumber,
                    description: `%%=${functionName}(...)=%% → native JS hint`,
                });
                outputLines.push(
                    `Platform.Response.Write(${nativeHint} /* AMPscript: ${functionName}(${arguments_}) */);`
                );
            } else if (CLOUDPAGES_ONLY_FUNCTIONS.has(key)) {
                // CloudPages-only function
                outputLines.push(
                    `/* MANUAL_REWRITE_REQUIRED: %%=${functionName}(${arguments_})=%% */`
                );
                flaggedSections.push({
                    line: lineNumber,
                    code: trimmed,
                    reason: `AMPscript function '${functionName}' is CloudPages-only — no SSJS equivalent`,
                });
            } else {
                // AMP-only function with no native hint → polyfill
                polyfillUsed.value = true;
                changes.push({
                    line: lineNumber,
                    description: `%%=${functionName}(...)=%% → _ampScript polyfill`,
                });
                outputLines.push(
                    `Platform.Response.Write(_ampScript('${trimmed.replaceAll("'", String.raw`\'`)}'));`
                );
            }
            continue;
        }

        // %%[ block content ]%%
        const blockMatch = /^%%\[\s*([\s\S]*?)\s*\]%%$/i.exec(trimmed);
        if (blockMatch) {
            const blockContent = blockMatch[1].trim();
            const statements = blockContent.split(/\n+/);
            for (const statement of statements) {
                const converted = convertAmpStatement(
                    statement.trim(),
                    lineNumber,
                    changes,
                    flaggedSections,
                    polyfillUsed
                );
                if (converted !== null) {
                    outputLines.push(converted);
                }
            }
            continue;
        }

        // Bare AMPscript statement (already stripped of delimiters from normalizeAmpscriptBlocks)
        if (/^(SET|VAR|IF|ELSEIF|ELSE|ENDIF|FOR|NEXT|OUTPUT|OUTPUTLINE)\b/i.test(trimmed)) {
            const converted = convertAmpStatement(
                trimmed,
                lineNumber,
                changes,
                flaggedSections,
                polyfillUsed
            );
            if (converted !== null) {
                outputLines.push(converted);
            }
            continue;
        }

        // Bare function call or other AMPscript statement inside a normalized block
        if (/^\w+\s*\(/.test(trimmed)) {
            const converted = convertAmpStatement(
                trimmed,
                lineNumber,
                changes,
                flaggedSections,
                polyfillUsed
            );
            if (converted !== null) {
                outputLines.push(converted);
            }
            continue;
        }

        // Pass through non-AMPscript content as an HTML comment
        if (trimmed) {
            outputLines.push(`/* HTML content: ${trimmed.slice(0, 80)} */`);
        }
    }

    // If any polyfill calls were emitted, insert the _ampScript helper after Platform.Load
    if (polyfillUsed.value) {
        // splice in right after the Platform.Load line (index 1)
        outputLines.splice(
            2,
            0,

            '',
            '// Polyfill: executes AMPscript and returns result via @_amp_response',
            'function _ampScript(code) {',
            "    Platform.Function.TreatAsContent('%%[ SET @_amp_response = ' + code + ' ]%%');",
            "    return Platform.Variable.GetValue('@_amp_response');",
            '}'
        );
    }

    outputLines.push('</script>');

    return {
        convertedCode: outputLines.join('\n'),
        changes,
        flaggedSections,
    };
}

/**
 * Normalize AMPscript block delimiters so each AMPscript statement is on its
 * own line, with `%%[` and `]%%` stripped.
 * @param code - Raw AMPscript source.
 * @returns {string} Normalized code with one statement per line.
 */
function normalizeAmpscriptBlocks(code: string): string {
    // Expand %%[ ... ]%% to individual statements
    let result = code;
    result = result.replaceAll(/%%\[\s*([\s\S]*?)\s*\]%%/g, (_, inner: string) =>
        inner
            .split('\n')
            .map((l: string) => l.trim())
            .filter(Boolean)
            .join('\n')
    );
    return result;
}

/**
 * Convert a single AMPscript statement to SSJS.
 * @param stmt - AMPscript statement string (no delimiters).
 * @param lineNum - Source line number for change tracking.
 * @param changes - Mutable changes array.
 * @param flaggedSections - Mutable flagged sections array.
 * @param polyfillUsed - Mutable flag set to true when _ampScript polyfill is emitted.
 * @param polyfillUsed.value
 * @returns {string | null} SSJS statement string, or null to skip.
 */
function convertAmpStatement(
    stmt: string,
    lineNum: number,
    changes: ChangeEntry[],
    flaggedSections: FlaggedSection[],
    polyfillUsed: { value: boolean }
): string | null {
    if (!stmt) return null;

    const upper = stmt.toUpperCase();

    // SET @x = expr → var x = expr;
    const setMatch = /^SET\s+@(\w+)\s*=\s*(.+)$/i.exec(stmt);
    if (setMatch) {
        const [, variableName, expression] = setMatch;
        const expressionTrimmed = expression.trim();
        // Check if the expression is a single AMP-only function call with no Platform.Function equivalent
        // and no native JS hint — if so, emit _ampScript polyfill rather than a broken expression.
        const singleFunctionMatch = /^(\w+)\s*\(/.exec(expressionTrimmed);
        if (singleFunctionMatch) {
            const key = singleFunctionMatch[1].toLowerCase();
            const hasSsjsEquiv = AMP_TO_PLATFORM_FUNCTION[key] !== undefined;
            const hasNativeHint = AMP_NATIVE_JS_HINTS[key] !== undefined;
            if (!hasSsjsEquiv && !hasNativeHint && !CLOUDPAGES_ONLY_FUNCTIONS.has(key)) {
                polyfillUsed.value = true;
                changes.push({
                    line: lineNum,
                    description: `SET @${variableName} = ${singleFunctionMatch[1]}(...) → _ampScript polyfill`,
                });
                return `var ${variableName} = _ampScript('${expressionTrimmed.replaceAll("'", String.raw`\'`)}');`;
            }
        }
        const ssExpression = convertAmpExpression(expressionTrimmed);
        changes.push({
            line: lineNum,
            description: `SET @${variableName} = ... → var ${variableName} = ...`,
        });
        return `var ${variableName} = ${ssExpression};`;
    }

    // VAR @x, @y → var x, y;
    const variableMatch = /^VAR\s+(.+)$/i.exec(stmt);
    if (variableMatch) {
        const variables = variableMatch[1]
            .split(',')
            .map((v: string) => v.trim().replace(/^@/, ''));
        changes.push({
            line: lineNum,
            description: `VAR @${variables.join(', @')} → var ${variables.join(', ')}`,
        });
        return `var ${variables.join(', ')};`;
    }

    // IF cond THEN → if (cond) {
    const ifMatch = /^IF\s+(.+?)\s+THEN$/i.exec(stmt);
    if (ifMatch) {
        const cond = ampCondToSsjs(ifMatch[1].trim());
        changes.push({ line: lineNum, description: 'IF ... THEN → if (...) {' });
        return `if (${cond}) {`;
    }

    // ELSEIF cond THEN → } else if (cond) {
    const elseifMatch = /^ELSEIF\s+(.+?)\s+THEN$/i.exec(stmt);
    if (elseifMatch) {
        const cond = ampCondToSsjs(elseifMatch[1].trim());
        changes.push({ line: lineNum, description: 'ELSEIF ... THEN → } else if (...) {' });
        return `} else if (${cond}) {`;
    }

    // ELSE → } else {
    if (/^ELSE$/i.test(stmt)) {
        changes.push({ line: lineNum, description: 'ELSE → } else {' });
        return '} else {';
    }

    // ENDIF → }
    if (/^ENDIF$/i.test(stmt)) {
        changes.push({ line: lineNum, description: 'ENDIF → }' });
        return '}';
    }

    // FOR @i = start TO end DO → for (var i = start; i <= end; i++) {
    const forMatch = /^FOR\s+@(\w+)\s*=\s*(\S+?)\s+TO\s+(\S+?)(?:\s+STEP\s+\S+)?\s+DO$/i.exec(stmt);
    if (forMatch) {
        const [, iterVariable, start, end] = forMatch;
        const ssStart = stripAmpVars(start);
        const ssEnd = stripAmpVars(end);
        changes.push({
            line: lineNum,
            description: `FOR @${iterVariable} = ${start} TO ${end} DO → for loop`,
        });
        return `for (var ${iterVariable} = ${ssStart}; ${iterVariable} <= ${ssEnd}; ${iterVariable}++) {`;
    }

    // NEXT @i → }
    if (/^NEXT\s+@\w+$/i.test(stmt)) {
        changes.push({ line: lineNum, description: 'NEXT @i → }' });
        return '}';
    }

    // OUTPUT(expr) / OUTPUTLINE(expr) → Platform.Response.Write(expr)
    const outputMatch = /^(?:OUTPUT|OUTPUTLINE)\s*\((.+)\)$/i.exec(stmt);
    if (outputMatch) {
        const expression = convertAmpExpression(outputMatch[1].trim());
        changes.push({ line: lineNum, description: 'Output/OutputLine → Platform.Response.Write' });
        return `Platform.Response.Write(${expression});`;
    }

    // Known AMPscript function call → Platform.Function.X(args)
    const functionCallMatch = /^(\w+)\s*\((.*)?\)$/i.exec(stmt);
    if (functionCallMatch) {
        const [, functionName, arguments_] = functionCallMatch;
        const key = functionName.toLowerCase();
        const ssName = AMP_TO_PLATFORM_FUNCTION[key];
        if (ssName) {
            const argumentsConverted = arguments_ ? convertAmpExpression(arguments_.trim()) : '';
            changes.push({
                line: lineNum,
                description: `${functionName}(…) → Platform.Function.${ssName}(…)`,
            });
            return `Platform.Function.${ssName}(${argumentsConverted});`;
        }

        // CloudPages-only functions have no SSJS/MCN equivalent
        if (CLOUDPAGES_ONLY_FUNCTIONS.has(key)) {
            flaggedSections.push({
                line: lineNum,
                code: stmt,
                reason: 'CloudPages-specific function — not available in SSJS/MCN context',
            });
            return `/* MANUAL_REWRITE_REQUIRED: ${stmt} */`;
        }

        // Check native JS hints for AMP-only functions
        const hint = AMP_NATIVE_JS_HINTS[key];
        if (hint) {
            changes.push({
                line: lineNum,
                description: `${functionName}(…) → native JS equivalent`,
            });
            return `${hint} /* AMPscript: ${stmt} */`;
        }

        // AMP-only function with no native hint → TreatAsContent polyfill
        polyfillUsed.value = true;
        changes.push({
            line: lineNum,
            description: `${functionName}(…) → _ampScript polyfill (no direct SSJS equivalent)`,
        });
        return `_ampScript('${stmt.replaceAll("'", String.raw`\'`)}');`;
    }

    // Check for AMPscript-only constructs that can't be converted (catch-all for non-standard usage)
    if (/\bCLOUDPAGESURL\b|\bREQUESTPARAMETER\b|\bQUERYPARAMETER\b|\bREDIRECT\b/i.test(stmt)) {
        flaggedSections.push({
            line: lineNum,
            code: stmt,
            reason: 'CloudPages-specific function — not available in SSJS/MCN context',
        });
        return `/* MANUAL_REWRITE_REQUIRED: ${stmt} */`;
    }

    // Unknown statement — pass through as comment
    if (upper !== stmt.toUpperCase() || /[A-Za-z]/.test(stmt)) {
        // Has alphabetic content — flag it
        flaggedSections.push({
            line: lineNum,
            code: stmt,
            reason: 'Could not automatically convert this AMPscript statement',
        });
        return `/* MANUAL_REWRITE_REQUIRED: ${stmt} */`;
    }

    return stmt;
}

/**
 * Convert an AMPscript expression to its SSJS equivalent.
 * Strips `@` from variable references and maps known function names.
 * @param expr - AMPscript expression string.
 * @returns {string} SSJS expression string.
 */
function convertAmpExpression(expr: string): string {
    // Replace known AMPscript function calls with Platform.Function.X equivalents;
    // emit a hint comment for native-hint functions; leave others with a MANUAL_REWRITE comment.
    // Note: AMP-only functions used in a SET assignment are handled at the statement level
    // (convertAmpStatement SET handler) which emits _ampScript(...) for the whole expression.
    let result = expr.replaceAll(/\b(\w+)\s*\(/g, (match: string, functionName: string) => {
        const key = functionName.toLowerCase();
        const ssName = AMP_TO_PLATFORM_FUNCTION[key];
        if (ssName) return `Platform.Function.${ssName}(`;
        const hint = AMP_NATIVE_JS_HINTS[key];
        if (hint) return `${hint} /* ${functionName}( */`;
        // Unknown function in expression context — annotate
        return `/* MANUAL_REWRITE_REQUIRED: no SSJS equivalent for ${functionName} */ ${functionName}(`;
    });

    // Strip @ from variable references
    result = stripAmpVars(result);

    return result;
}

/**
 * Convert an AMPscript condition expression to SSJS syntax.
 * @param cond - AMPscript condition string.
 * @returns {string} SSJS condition string.
 */
function ampCondToSsjs(cond: string): string {
    return stripAmpVars(cond)
        .replaceAll(/\bAND\b/gi, '&&')
        .replaceAll(/\bOR\b/gi, '||')
        .replaceAll(/\bNOT\b/gi, '!')
        .replaceAll(/\bEQUAL\s+TO\b/gi, '===')
        .replaceAll(/\bNOT\s+EQUAL\s+TO\b/gi, '!==')
        .replaceAll(/\bGREATER\s+THAN\b/gi, '>')
        .replaceAll(/\bLESS\s+THAN\b/gi, '<');
}

/**
 * Strip `@` prefix from AMPscript variable references in an expression.
 * @param expr - Expression possibly containing `@varName` references.
 * @returns {string} Expression with `@` prefixes removed.
 */
export function stripAmpVars(expr: string): string {
    return expr.replaceAll(/@(\w+)/g, '$1');
}

// ---------------------------------------------------------------------------
// AMPscript ↔ MCN Handlebars conversion
// ---------------------------------------------------------------------------

/**
 * Distinct MANUAL_REWRITE note for Category C functions (`mcnHandlebarsGap`).
 * Must be visibly different from the Category B note so consumers can tell a
 * documented-but-broken function apart from one with no counterpart at all.
 */
export const HBS_GAP_NOTE =
    'documented as supported in Marketing Cloud Next but currently fails at runtime — no Handlebars helper exists yet';

/**
 * Split a function-argument string into top-level comma-separated arguments,
 * respecting nested parens/brackets and quoted strings. Returns an empty array
 * for an empty/whitespace-only string.
 * @param argsStr - The argument string (contents between the outer parens).
 * @returns {string[]} Trimmed top-level arguments.
 */
interface ArgSplitState {
    depth: number;
    current: string;
    quote: string | null;
    args: string[];
}

/**
 * Fold a single character into the argument-splitting accumulator state.
 * @param state - Mutable accumulator carried across characters.
 * @param ch - The current character.
 */
function foldArgumentChar(state: ArgSplitState, ch: string): void {
    if (state.quote) {
        state.current += ch;
        if (ch === state.quote) state.quote = null;
        return;
    }
    switch (ch) {
        case '"':
        case "'": {
            state.quote = ch;
            state.current += ch;
            break;
        }
        case '(':
        case '[': {
            state.depth++;
            state.current += ch;
            break;
        }
        case ')':
        case ']': {
            state.depth--;
            state.current += ch;
            break;
        }
        default: {
            if (ch === ',' && state.depth === 0) {
                state.args.push(state.current.trim());
                state.current = '';
            } else {
                state.current += ch;
            }
        }
    }
}

function splitArguments(argsStr: string): string[] {
    if (!argsStr.trim()) return [];
    const state: ArgSplitState = { depth: 0, current: '', quote: null, args: [] };
    for (const ch of argsStr) {
        foldArgumentChar(state, ch);
    }
    if (state.current.trim()) state.args.push(state.current.trim());
    return state.args;
}

/**
 * Convert a single AMPscript call argument to its Handlebars form: string and
 * numeric literals pass through unchanged; `@var` references lose the `@`.
 * @param arg - A single AMPscript argument.
 * @returns {string} The Handlebars argument.
 */
function ampArgumentToHbs(arg: string): string {
    const t = arg.trim();
    if (/^["']/.test(t)) return t;
    return stripAmpVars(t);
}

/**
 * Convert a single Handlebars argument to its AMPscript form: string/number/
 * boolean literals pass through; bare identifiers become `@var` references;
 * dotted paths are returned unchanged (caller decides how to flag them).
 * @param arg - A single Handlebars argument.
 * @returns {string} The AMPscript argument.
 */
function hbsArgumentToAmp(arg: string): string {
    const t = arg.trim();
    if (/^["']/.test(t)) return t;
    if (/^-?\d/.test(t)) return t;
    if (/^(true|false|null)$/i.test(t)) return t;
    if (t.startsWith('@')) return t;
    if (/^[A-Za-z_]\w*$/.test(t)) return `@${t}`;
    return t;
}

/**
 * Convert the inner text of a single AMPscript inline expression (`%%=…=%%`)
 * to Handlebars, classifying function calls by the three conversion categories.
 * @param inner - The expression between `%%=` and `=%%` (already trimmed).
 * @param lineNum - Source line number for change/flag tracking.
 * @param changes - Mutable change log.
 * @param flaggedSections - Mutable flagged-section log.
 * @returns {string} The Handlebars replacement string.
 */
function convertInlineAmpToHbs(
    inner: string,
    lineNum: number,
    changes: ChangeEntry[],
    flaggedSections: FlaggedSection[]
): string {
    // v(@x) / v(x) → {{x}}
    const vMatch = /^v\s*\(\s*@?([A-Za-z_]\w*)\s*\)$/i.exec(inner);
    if (vMatch) {
        changes.push({ line: lineNum, description: `%%=v(@${vMatch[1]})=%% → {{${vMatch[1]}}}` });
        return `{{${vMatch[1]}}}`;
    }

    // Bare @var / var → {{var}}
    const variableMatch = /^@?([A-Za-z_]\w*)$/.exec(inner);
    if (variableMatch) {
        changes.push({ line: lineNum, description: `%%=${inner}=%% → {{${variableMatch[1]}}}` });
        return `{{${variableMatch[1]}}}`;
    }

    // FunctionName(args)
    const functionMatch = /^([A-Za-z_]\w*)\s*\(([\s\S]*)\)$/.exec(inner);
    if (functionMatch) {
        const functionName = functionMatch[1];
        const key = functionName.toLowerCase();
        const hbsArguments = splitArguments(functionMatch[2]).map((a) => ampArgumentToHbs(a));

        // Category A — mapped helper.
        const helper = AMP_TO_HANDLEBARS[key];
        if (helper) {
            changes.push({
                line: lineNum,
                description: `%%=${functionName}(…)=%% → {{${helper} …}}`,
            });
            return `{{${helper}${hbsArguments.length > 0 ? ' ' + hbsArguments.join(' ') : ''}}}`;
        }

        // Category C — mcnHandlebarsGap (distinct note from Category B).
        if (AMP_MCN_HANDLEBARS_GAP.has(key)) {
            flaggedSections.push({
                line: lineNum,
                code: `%%=${inner}=%%`,
                reason: `${functionName} is ${HBS_GAP_NOTE}`,
            });
            return `{{!-- MANUAL_REWRITE_REQUIRED: ${functionName} is ${HBS_GAP_NOTE} --}}`;
        }

        // Category B — no Handlebars counterpart.
        flaggedSections.push({
            line: lineNum,
            code: `%%=${inner}=%%`,
            reason: `AMPscript function '${functionName}' has no Handlebars equivalent`,
        });
        return `{{!-- MANUAL_REWRITE_REQUIRED: AMPscript function '${functionName}' has no Handlebars equivalent --}}`;
    }

    // Anything else (complex expression).
    flaggedSections.push({
        line: lineNum,
        code: `%%=${inner}=%%`,
        reason: 'complex AMPscript expression has no direct Handlebars form',
    });
    return `{{!-- MANUAL_REWRITE_REQUIRED: ${inner} --}}`;
}

/**
 * Convert AMPscript to MCN Handlebars using deterministic, data-driven rules.
 *
 * Inline expressions (`%%=Fn(args)=%%`, `%%=v(@x)=%%`, `%%var%%`) are mapped via
 * the three conversion categories built from ampscript-data's
 * `handlebarsEquivalent` / `mcnHandlebarsGap` fields:
 * - **A** — mapped helper → `{{helper …}}`
 * - **B** — no counterpart → `{{!-- MANUAL_REWRITE_REQUIRED … --}}`
 * - **C** — `mcnHandlebarsGap` → `{{!-- MANUAL_REWRITE_REQUIRED … (distinct note) --}}`
 *
 * Procedural AMPscript blocks (`%%[ … ]%%`, `SET`/`VAR`/`IF`/`FOR`) have no
 * Handlebars counterpart (Handlebars cannot assign variables or run imperative
 * control flow) and are flagged MANUAL_REWRITE_REQUIRED.
 * @param code - AMPscript source code (may include HTML context).
 * @returns {ConversionResult} Converted Handlebars, change log, and flagged sections.
 */
export function ampscriptToHandlebars(code: string): ConversionResult {
    const changes: ChangeEntry[] = [];
    const flaggedSections: FlaggedSection[] = [];
    const lines = code.split('\n');
    const outputLines: string[] = [];

    let isInBlock = false;
    for (const [index, line] of lines.entries()) {
        const lineNumber = index + 1;
        const trimmed = line.trim();

        // Track multi-line %%[ … ]%% blocks — flag the whole block once.
        if (isInBlock) {
            if (/\]%%/.test(line)) isInBlock = false;
            continue;
        }
        if (/%%\[/.test(line)) {
            if (!/\]%%/.test(line)) isInBlock = true;
            outputLines.push(
                '{{!-- MANUAL_REWRITE_REQUIRED: AMPscript block (SET/VAR/IF/FOR) has no Handlebars equivalent — Handlebars cannot assign variables or run imperative control flow --}}'
            );
            flaggedSections.push({
                line: lineNumber,
                code: trimmed.slice(0, 80),
                reason: 'AMPscript procedural block has no Handlebars counterpart',
            });
            continue;
        }

        // Convert inline expressions on this line.
        const converted = line
            .replaceAll(/%%=\s*([\s\S]*?)\s*=%%/g, (_full, raw: string) =>
                convertInlineAmpToHbs(raw.trim(), lineNumber, changes, flaggedSections)
            )
            .replaceAll(/%%([A-Za-z_]\w*)%%/g, (_full, v: string) => {
                changes.push({ line: lineNumber, description: `%%${v}%% → {{${v}}}` });
                return `{{${v}}}`;
            });
        outputLines.push(converted);
    }

    return { convertedCode: outputLines.join('\n'), changes, flaggedSections };
}

/**
 * Convert MCN Handlebars to AMPscript using deterministic, data-driven rules.
 *
 * Inline helper calls (`{{helper args}}`) whose helper maps back to an AMPscript
 * function (via HANDLEBARS_TO_AMP) become `%%=Fn(args)=%%`; bare variables
 * (`{{name}}`) become `%%=v(@name)=%%`. Block helpers (`{{#each}}`…), partials
 * (`{{> …}}`), dotted binding paths, and unknown helpers are flagged
 * MANUAL_REWRITE_REQUIRED.
 * @param code - Handlebars source code (may include HTML context).
 * @returns {ConversionResult} Converted AMPscript, change log, and flagged sections.
 */
export function handlebarsToAmpscript(code: string): ConversionResult {
    const changes: ChangeEntry[] = [];
    const flaggedSections: FlaggedSection[] = [];
    let lineCursor = 1;
    let lastIndex = 0;

    const convertedCode = code.replaceAll(
        /\{\{([\s\S]*?)\}\}/g,
        (full, raw: string, offset: number) => {
            lineCursor += countNewlines(code.slice(lastIndex, offset));
            lastIndex = offset;
            const lineNumber = lineCursor;
            const inner = raw.trim();

            // Comments — preserve as an AMPscript comment.
            if (inner.startsWith('!')) {
                return full;
            }

            // Block helpers / partials / closing tags — no deterministic AMPscript form.
            if (/^[#/>]/.test(inner)) {
                flaggedSections.push({
                    line: lineNumber,
                    code: full,
                    reason: 'Handlebars block helper / partial has no direct AMPscript equivalent',
                });
                return `%%-- MANUAL_REWRITE_REQUIRED: ${full} --%%`;
            }

            // Strip a leading no-escape ampersand: {{& x}}.
            const body = inner.replace(/^&\s*/, '');

            // Helper with arguments: {{helper arg1 arg2 …}}
            const functionMatch = /^([A-Za-z_]\w*)\s+(.+)$/.exec(body);
            if (functionMatch) {
                const helperName = functionMatch[1];
                const key = helperName.toLowerCase();
                const ampName = HANDLEBARS_TO_AMP[key];
                const ampArguments = splitArguments(functionMatch[2]).map((a) =>
                    hbsArgumentToAmp(a)
                );
                if (ampName) {
                    changes.push({
                        line: lineNumber,
                        description: `{{${helperName} …}} → %%=${ampName}(…)=%%`,
                    });
                    return `%%=${ampName}(${ampArguments.join(', ')})=%%`;
                }
                flaggedSections.push({
                    line: lineNumber,
                    code: full,
                    reason: `Handlebars helper '${helperName}' has no AMPscript equivalent`,
                });
                return `%%-- MANUAL_REWRITE_REQUIRED: Handlebars helper '${helperName}' has no AMPscript equivalent --%%`;
            }

            // Bare single identifier: {{name}} → %%=v(@name)=%%
            const bareMatch = /^([A-Za-z_]\w*)$/.exec(body);
            if (bareMatch) {
                changes.push({
                    line: lineNumber,
                    description: `{{${bareMatch[1]}}} → %%=v(@${bareMatch[1]})=%%`,
                });
                return `%%=v(@${bareMatch[1]})=%%`;
            }

            // Dotted binding path or other expression — context-specific.
            flaggedSections.push({
                line: lineNumber,
                code: full,
                reason: 'Handlebars binding path requires context-specific AMPscript mapping',
            });
            return `%%-- MANUAL_REWRITE_REQUIRED: ${full} --%%`;
        }
    );

    return { convertedCode, changes, flaggedSections };
}

/**
 * Count newline characters in a string (helper for line tracking in
 * handlebarsToAmpscript).
 * @param s - Input string.
 * @returns {number} Number of `\n` characters.
 */
function countNewlines(s: string): number {
    let n = 0;
    for (const ch of s) {
        if (ch === '\n') n++;
    }
    return n;
}

/**
 * Convert SSJS to MCN Handlebars deterministically via a two-step chain:
 * SSJS → AMPscript (`ssjsToAmpscript`) → Handlebars (`ampscriptToHandlebars`).
 *
 * Because Handlebars is declarative, most imperative SSJS has no Handlebars
 * counterpart and is conservatively flagged MANUAL_REWRITE_REQUIRED; inline
 * `Platform.Function.X(…)` calls that map through AMPscript to a Handlebars
 * helper are converted.
 * @param code - SSJS source code (may include `<script runat="server">` tags).
 * @returns {ConversionResult} Converted Handlebars, combined change log, and flagged sections.
 */
export function ssjsToHandlebars(code: string): ConversionResult {
    const toAmp = ssjsToAmpscript(code);
    const toHbs = ampscriptToHandlebars(toAmp.convertedCode);
    return {
        convertedCode: toHbs.convertedCode,
        changes: [
            ...toAmp.changes.map((c) => ({
                line: c.line,
                description: `[SSJS→AMPscript] ${c.description}`,
            })),
            ...toHbs.changes.map((c) => ({
                line: c.line,
                description: `[AMPscript→Handlebars] ${c.description}`,
            })),
        ],
        flaggedSections: [...toAmp.flaggedSections, ...toHbs.flaggedSections],
    };
}

// ---------------------------------------------------------------------------
// MCN-specific AMPscript rewrites
// ---------------------------------------------------------------------------

export interface McnRewriteOptions {
    /** Function to check if an AMPscript function is MCN-supported */
    isMcnSupportedFn: (name: string) => boolean;
    /** Function to get MCN behavioral notes for a function */
    getMcnNotesFn: (name: string) => string | null;
}

export interface McnRewriteResult {
    rewrittenCode: string;
    changes: Array<{ line: number; type: string; description: string }>;
    nonMigratableItems: Array<{ line: number; code: string; reason: string }>;
    difficulty: 'ready' | 'minor' | 'significant' | 'not-migratable';
    summary: string;
}

/**
 * Rewrite AMPscript code to be compatible with Marketing Cloud Next.
 *
 * Performs deterministic rewrites:
 * - FormatDate(StringToDate(x), fmt) → FormatDate(x, fmt)
 * - .NET → Java SimpleDateFormat format string conversions in FormatDate()
 * - Lookup with odd arg count → annotated with comment
 * - MCE-only functions → marked with %%-- NOT SUPPORTED IN MCN --%% annotation
 * @param code - AMPscript source code to rewrite.
 * @param options - Functions for MCN support checking and note retrieval.
 * @returns {McnRewriteResult} Rewrite result with rewritten code, change log, and difficulty assessment.
 */
export function rewriteAmpForMcn(code: string, options: McnRewriteOptions): McnRewriteResult {
    const { isMcnSupportedFn, getMcnNotesFn } = options;
    const changes: Array<{ line: number; type: string; description: string }> = [];
    const nonMigratableItems: Array<{ line: number; code: string; reason: string }> = [];

    let rewrittenCode = code;

    // 1. Remove StringToDate() wrapper inside FormatDate() first argument
    // FormatDate(StringToDate(x), fmt) → FormatDate(x, fmt)
    const stringToDatePattern = /FormatDate\s*\(\s*StringToDate\s*\(([^)]+)\)\s*,/gi;
    if (stringToDatePattern.test(rewrittenCode)) {
        rewrittenCode = rewrittenCode.replaceAll(
            /FormatDate\s*\(\s*StringToDate\s*\(([^)]+)\)\s*,/gi,
            'FormatDate($1,'
        );
        // Find affected lines for change tracking
        const lines = code.split('\n');
        for (const [index, line] of lines.entries()) {
            if (/FormatDate\s*\(\s*StringToDate\s*\(/i.test(line)) {
                changes.push({
                    line: index + 1,
                    type: 'rewritten',
                    description:
                        'Removed StringToDate() wrapper: FormatDate(StringToDate(x), fmt) → FormatDate(x, fmt)',
                });
            }
        }
    }

    // 2. Convert .NET format strings to Java SimpleDateFormat in FormatDate() calls
    rewrittenCode = rewrittenCode.replaceAll(
        /FormatDate\s*\(\s*([^,]+),\s*"([^"]+)"\s*\)/gi,
        (match: string, argument1: string, formatString: string) => {
            // Check for standard shorthands
            const trimmedFormat = formatString.trim();
            const hasShorthand = [...DOTNET_STANDARD_SHORTHANDS].some((shorthand) =>
                new RegExp(`^${shorthand}$`).test(trimmedFormat)
            );

            if (hasShorthand) {
                // Annotate with comment about needing explicit format
                return `FormatDate(${argument1}, "/* MANUAL_REWRITE_REQUIRED: Convert .NET standard shorthand '${formatString}' to explicit Java SimpleDateFormat pattern */"${formatString}")`;
            }

            let newFormat = formatString;
            let isChanged = false;

            // Apply .NET → Java replacements
            for (const [pattern, replacement] of DOTNET_TO_JAVA_FORMAT_REPLACEMENTS) {
                const before = newFormat;
                newFormat = newFormat.replace(pattern, () => replacement);
                if (newFormat !== before) {
                    isChanged = true;
                }
            }

            if (isChanged) {
                return `FormatDate(${argument1}, "${newFormat}")`;
            }
            return match;
        }
    );

    // Track format string changes
    const codeLines = code.split('\n');
    const rewrittenLines = rewrittenCode.split('\n');
    for (const [index, codeLine] of codeLines.entries()) {
        if (codeLine !== rewrittenLines[index] && /FormatDate/i.test(codeLine)) {
            changes.push({
                line: index + 1,
                type: 'rewritten',
                description: `Converted .NET format string to Java SimpleDateFormat in FormatDate()`,
            });
        }
    }

    // 3. Annotate Lookup() calls with odd argument counts
    rewrittenCode = rewrittenCode.replaceAll(
        /\bLookup\s*\(([^)]+)\)/gi,
        (match: string, argumentsString: string) => {
            const argumentCount = countArgs(argumentsString);
            // Lookup takes: DE, returnCol, [searchCol, searchVal, ...]
            // Min 2 args, then pairs after that → should be even number > 2 or exactly 2
            // Odd count after first 2 = problem
            if (argumentCount >= 3 && (argumentCount - 2) % 2 !== 0) {
                return `${match} %%-- MCN NOTE: Lookup() requires search arguments in column/value pairs (even count after DE and return column). Current arg count (${argumentCount}) may cause an error in MCN. --%% `;
            }
            return match;
        }
    );

    // 4. Mark MCE-only function calls with annotation
    // Find all function calls and mark unsupported ones
    const functionCallPattern = /\b([A-Z][A-Za-z]+)\s*\(/g;
    let functionMatch: RegExpExecArray | null;
    const seenUnsupported = new Set<string>();

    while ((functionMatch = functionCallPattern.exec(code)) !== null) {
        const functionName = functionMatch[1];
        if (!isMcnSupportedFn(functionName) && functionName.length > 1) {
            seenUnsupported.add(functionName);
        }
    }

    for (const functionName of seenUnsupported) {
        const mcnNotes = getMcnNotesFn(functionName);
        const annotationPattern = new RegExp(String.raw`\b${functionName}\s*\(`, 'gi');
        rewrittenCode = rewrittenCode.replace(annotationPattern, (m: string) => {
            return `%%-- NOT SUPPORTED IN MCN: ${functionName}${mcnNotes ? ` — ${mcnNotes}` : ''} --%%\n${m}`;
        });

        // Find lines for tracking
        const linePattern = new RegExp(String.raw`\b${functionName}\s*\(`, 'i');
        const matchingLines = codeLines
            .map((codeLine, index) => ({ codeLine, index }))
            .filter(({ codeLine }) => linePattern.test(codeLine));
        for (const { codeLine, index } of matchingLines) {
            changes.push({
                line: index + 1,
                type: 'annotated',
                description: `${functionName}() is not supported in Marketing Cloud Next`,
            });
            nonMigratableItems.push({
                line: index + 1,
                code: codeLine.trim(),
                reason: `${functionName}() is not available in Marketing Cloud Next`,
            });
        }
    }

    // 5. Check for CloudPages functions
    const cloudFunctionPattern =
        /\b(CloudPagesURL|RequestParameter|QueryParameter|Redirect|MicrositeURL)\s*\(/gi;
    let cloudMatch: RegExpExecArray | null;
    while ((cloudMatch = cloudFunctionPattern.exec(code)) !== null) {
        const functionName = cloudMatch[1];
        const lineNumber = code.slice(0, cloudMatch.index).split('\n').length;
        nonMigratableItems.push({
            line: lineNumber,
            code: codeLines[lineNumber - 1]?.trim() ?? functionName,
            reason: `${functionName}() is a CloudPages-specific function and cannot run in Marketing Cloud Next`,
        });
    }

    // Assess difficulty
    const hasNotMigratable = nonMigratableItems.some(
        (item) => item.reason.includes('CloudPages') || item.reason.includes('NOT SUPPORTED')
    );
    const hasMcnNotes =
        Array.from(seenUnsupported).some((function_) => getMcnNotesFn(function_) !== null) ||
        /FormatDate|StringToDate|Lookup/i.test(code);
    const hasSsjs = /<script[^>]+runat/i.test(code);

    let difficulty: McnRewriteResult['difficulty'];
    if (hasNotMigratable) {
        difficulty = 'not-migratable';
    } else if (seenUnsupported.size > 0 || hasSsjs) {
        difficulty = 'significant';
    } else if (hasMcnNotes) {
        difficulty = 'minor';
    } else {
        difficulty = 'ready';
    }

    const summaryParts: string[] = [];
    if (seenUnsupported.size > 0) {
        summaryParts.push(`${seenUnsupported.size} MCE-only function(s) flagged`);
    }
    if (hasMcnNotes) {
        summaryParts.push('behavioral differences noted (FormatDate, Lookup, or StringToDate)');
    }
    if (hasSsjs) {
        summaryParts.push('SSJS blocks detected');
    }
    const summary = summaryParts.length > 0 ? summaryParts.join('; ') : 'No MCN issues found';

    return { rewrittenCode, changes, nonMigratableItems, difficulty, summary };
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of top-level comma-separated arguments in a function
 * argument string (respects nested parentheses).
 * @param argsStr - The argument string (contents between outer parens).
 * @returns {number} Number of top-level arguments.
 */
export function countArgs(argsStr: string): number {
    if (!argsStr.trim()) return 0;
    let depth = 0;
    let count = 1;
    for (const ch of argsStr) {
        if (ch === '(' || ch === '[') {
            depth++;
        } else if (ch === ')' || ch === ']') {
            depth--;
        } else if (ch === ',' && depth === 0) {
            count++;
        }
    }
    return count;
}

/**
 * Determine whether a SSJS code block contains only patterns that can be
 * automatically converted to AMPscript. Returns true when no non-migratable
 * patterns are found.
 * @param blockCode - SSJS block code (without `<script>` tags).
 * @returns {boolean} True when the block is likely convertible.
 */
export function isSsjsBlockConvertible(blockCode: string): boolean {
    for (const { pattern } of NON_MIGRATABLE_SSJS_PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(blockCode)) {
            return false;
        }
    }
    return true;
}
