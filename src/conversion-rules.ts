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
// Platform.Function.X → AMPscript function name (lowercase key)
// ---------------------------------------------------------------------------

/**
 * Maps a Platform.Function.X name (lowercase) to the equivalent AMPscript
 * canonical function name. Only functions with a direct 1:1 equivalent are
 * included.
 */
export const PLATFORM_FUNCTION_TO_AMP: Readonly<Record<string, string>> = {
    lookup: 'Lookup',
    lookuprows: 'LookupRows',
    lookuporderedrows: 'LookupOrderedRows',
    lookuporderedrowscs: 'LookupOrderedRowsCS',
    insertde: 'InsertDE',
    updatede: 'UpdateDE',
    upsertde: 'UpsertDE',
    deletede: 'DeleteDE',
    rowcount: 'RowCount',
    contentblockbyid: 'ContentBlockById',
    contentblockbyname: 'ContentBlockByName',
    contentblockbykey: 'ContentBlockByKey',
    now: 'Now',
    dateadd: 'DateAdd',
    datediff: 'DateDiff',
    dateparse: 'DateParse',
    formatdate: 'FormatDate',
    stringtodate: 'StringToDate',
    concat: 'Concat',
    substring: 'Substring',
    trim: 'Trim',
    lowercase: 'Lowercase',
    uppercase: 'Uppercase',
    propercase: 'ProperCase',
    replace: 'Replace',
    replacelist: 'ReplaceList',
    indexof: 'IndexOf',
    length: 'Length',
    add: 'Add',
    subtract: 'Subtract',
    multiply: 'Multiply',
    divide: 'Divide',
    mod: 'Mod',
    iif: 'Iif',
    empty: 'Empty',
    isnull: 'IsNull',
    format: 'Format',
    formatcurrency: 'FormatCurrency',
    formatnumber: 'FormatNumber',
    random: 'Random',
    guid: 'GUID',
    v: 'v',
    output: 'Output',
    outputline: 'OutputLine',
    raiseerror: 'RaiseError',
    httpget: 'HTTPGet',
    httppost: 'HTTPPost',
    httpgetwithcacheability: 'HTTPGetWithCacheability',
};

// ---------------------------------------------------------------------------
// AMPscript function name → Platform.Function.X SSJS name (lowercase key)
// ---------------------------------------------------------------------------

/**
 * Maps an AMPscript function name (lowercase) to its SSJS Platform.Function
 * equivalent name (the part after "Platform.Function.").
 */
export const AMP_TO_PLATFORM_FUNCTION: Readonly<Record<string, string>> = {
    lookup: 'Lookup',
    lookuprows: 'LookupRows',
    lookuporderedrows: 'LookupOrderedRows',
    lookuporderedrowscs: 'LookupOrderedRowsCS',
    insertde: 'InsertDE',
    updatede: 'UpdateDE',
    upsertde: 'UpsertDE',
    deletede: 'DeleteDE',
    rowcount: 'RowCount',
    contentblockbyid: 'ContentBlockById',
    contentblockbyname: 'ContentBlockByName',
    contentblockbykey: 'ContentBlockByKey',
    now: 'Now',
    dateadd: 'DateAdd',
    datediff: 'DateDiff',
    dateparse: 'DateParse',
    formatdate: 'FormatDate',
    stringtodate: 'StringToDate',
    concat: 'Concat',
    substring: 'Substring',
    trim: 'Trim',
    lowercase: 'Lowercase',
    uppercase: 'Uppercase',
    propercase: 'ProperCase',
    replace: 'Replace',
    replacelist: 'ReplaceList',
    indexof: 'IndexOf',
    length: 'Length',
    add: 'Add',
    subtract: 'Subtract',
    multiply: 'Multiply',
    divide: 'Divide',
    mod: 'Mod',
    iif: 'Iif',
    empty: 'Empty',
    isnull: 'IsNull',
    format: 'Format',
    formatcurrency: 'FormatCurrency',
    formatnumber: 'FormatNumber',
    random: 'Random',
    guid: 'GUID',
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

    for (const [i, original] of rawLines.entries()) {
        const lineNum = i + 1;
        const trimmed = original.trim();

        // Skip blank lines, Platform.Load(), var-only declarations with no value
        if (!trimmed) {
            outputLines.push('');
            continue;
        }

        // Skip Platform.Load() — no AMPscript equivalent, not needed in MCN
        if (/^Platform\.Load\s*\(/i.test(trimmed)) {
            changes.push({
                line: lineNum,
                description: 'Removed Platform.Load() (not needed in AMPscript)',
            });
            continue;
        }

        // Check for non-migratable patterns first
        let isFlagged = false;
        for (const { pattern, reason } of NON_MIGRATABLE_SSJS_PATTERNS) {
            // Reset lastIndex for global regexes
            pattern.lastIndex = 0;
            if (pattern.test(trimmed)) {
                outputLines.push(
                    `%%-- MANUAL_REWRITE_REQUIRED: ${reason} --%%`,
                    `%%-- Original: ${trimmed} --%%`
                );
                flaggedSections.push({ line: lineNum, code: trimmed, reason });
                isFlagged = true;
                break;
            }
        }
        if (isFlagged) {
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
            (_, varName: string, value: string) => {
                changes.push({
                    line: lineNum,
                    description: `Platform.Variable.SetValue → SET @${varName}`,
                });
                return `SET @${varName} = ${value.trim()}`;
            }
        );

        // Platform.Response.Write(expr) → OutputLine(expr)
        line = line.replaceAll(/Platform\.Response\.Write\s*\(/gi, () => {
            changes.push({ line: lineNum, description: 'Platform.Response.Write → OutputLine' });
            return 'OutputLine(';
        });

        // Platform.Function.X(args) → X(args) using known function map
        line = line.replaceAll(/Platform\.Function\.(\w+)\s*\(/gi, (_, fnName: string) => {
            const ampName = PLATFORM_FUNCTION_TO_AMP[fnName.toLowerCase()] ?? fnName;
            changes.push({
                line: lineNum,
                description: `Platform.Function.${fnName} → ${ampName}`,
            });
            return `${ampName}(`;
        });

        // var x = expr; → SET @x = expr
        line = line.replace(
            /\bvar\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*;?\s*$/,
            (_, varName: string, value: string) => {
                changes.push({
                    line: lineNum,
                    description: `var ${varName} = ... → SET @${varName}`,
                });
                return `SET @${varName} = ${value.trim()}`;
            }
        );

        // var x; → VAR @x
        line = line.replace(/\bvar\s+([A-Za-z_]\w*)\s*;?\s*$/, (_, varName: string) => {
            changes.push({ line: lineNum, description: `var ${varName} → VAR @${varName}` });
            return `VAR @${varName}`;
        });

        // Control flow: if (cond) { → IF cond THEN
        line = line.replace(/^\s*if\s*\((.+)\)\s*\{\s*$/, (_, cond: string) => {
            const ampCond = ssjsCondToAmp(cond.trim());
            changes.push({ line: lineNum, description: 'if (...) { → IF ... THEN' });
            return `IF ${ampCond} THEN`;
        });

        // } else if (cond) { → ELSEIF cond THEN
        line = line.replace(/^\s*\}\s*else\s+if\s*\((.+)\)\s*\{\s*$/, (_, cond: string) => {
            const ampCond = ssjsCondToAmp(cond.trim());
            changes.push({ line: lineNum, description: '} else if (...) { → ELSEIF ... THEN' });
            return `ELSEIF ${ampCond} THEN`;
        });

        // } else { → ELSE
        line = line.replace(/^\s*\}\s*else\s*\{\s*$/, () => {
            changes.push({ line: lineNum, description: '} else { → ELSE' });
            return 'ELSE';
        });

        // for (var i = start; i <= end; i++) { → FOR @i = start TO end DO
        const forMatch =
            /^\s*for\s*\(\s*var\s+(\w+)\s*=\s*(\S+?)\s*;\s*\w+\s*<=?\s*(\S+?)\s*;\s*\w+\+\+\s*\)\s*\{\s*$/.exec(
                line
            );
        if (forMatch) {
            const [, iterVar, start, end] = forMatch;
            changes.push({
                line: lineNum,
                description: `for (var ${iterVar}...) → FOR @${iterVar} = ${start} TO ${end} DO`,
            });
            line = `FOR @${iterVar} = ${start} TO ${end} DO`;
        }

        // Standalone closing brace } → ENDIF (best-effort; may not always be correct)
        if (/^\s*\}\s*$/.test(line) && !/^\s*\}\s*(else|catch|finally)/.test(line)) {
            changes.push({ line: lineNum, description: '} → ENDIF' });
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

    // Normalize: combine multi-line %%[ ... ]%% blocks into single pseudo-lines
    // then process line by line
    const normalized = normalizeAmpscriptBlocks(code);

    const lines = normalized.split('\n');
    const lineOffset = 0;

    for (const [i, line] of lines.entries()) {
        const lineNum = i + 1 + lineOffset;
        const trimmed = line.trim();

        if (!trimmed) {
            outputLines.push('');
            continue;
        }

        // %%=Output(@x)=%% or %%=OutputLine(@x)=%%
        const inlineOutputMatch = /^%%=\s*(?:Output|OutputLine)\s*\((.+)\)\s*=%%$/i.exec(trimmed);
        if (inlineOutputMatch) {
            const expr = stripAmpVars(inlineOutputMatch[1].trim());
            changes.push({
                line: lineNum,
                description: '%%=Output(...)=%% → Platform.Response.Write(...)',
            });
            outputLines.push(`Platform.Response.Write(${expr});`);
            continue;
        }

        // %%=FunctionName(args)=%% → Platform.Response.Write(Platform.Function.FunctionName(args))
        const inlineFnMatch = /^%%=\s*(\w+)\s*\((.*)?\)\s*=%%$/i.exec(trimmed);
        if (inlineFnMatch) {
            const fnName = inlineFnMatch[1];
            const args = inlineFnMatch[2]?.trim() ?? '';
            const ssName = AMP_TO_PLATFORM_FUNCTION[fnName.toLowerCase()];
            const argsConverted = stripAmpVars(args);
            if (ssName) {
                changes.push({
                    line: lineNum,
                    description: `%%=${fnName}(...)=%% → Platform.Response.Write(Platform.Function.${ssName}(...))`,
                });
                outputLines.push(
                    `Platform.Response.Write(Platform.Function.${ssName}(${argsConverted}));`
                );
            } else {
                // Unknown function — pass through as comment for AI
                outputLines.push(`/* MANUAL_REWRITE_REQUIRED: %%=${fnName}(${args})=%% */`);
                flaggedSections.push({
                    line: lineNum,
                    code: trimmed,
                    reason: `Unknown AMPscript function '${fnName}' — no SSJS equivalent in catalog`,
                });
            }
            continue;
        }

        // %%[ block content ]%%
        const blockMatch = /^%%\[\s*([\s\S]*?)\s*\]%%$/i.exec(trimmed);
        if (blockMatch) {
            const blockContent = blockMatch[1].trim();
            const stmts = blockContent.split(/\n+/);
            for (const stmt of stmts) {
                const converted = convertAmpStatement(
                    stmt.trim(),
                    lineNum,
                    changes,
                    flaggedSections
                );
                if (converted !== null) {
                    outputLines.push(converted);
                }
            }
            continue;
        }

        // Bare AMPscript statement (already stripped of delimiters from normalizeAmpscriptBlocks)
        if (/^(SET|VAR|IF|ELSEIF|ELSE|ENDIF|FOR|NEXT|OUTPUT|OUTPUTLINE)\b/i.test(trimmed)) {
            const converted = convertAmpStatement(trimmed, lineNum, changes, flaggedSections);
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
 * @returns {string | null} SSJS statement string, or null to skip.
 */
function convertAmpStatement(
    stmt: string,
    lineNum: number,
    changes: ChangeEntry[],
    flaggedSections: FlaggedSection[]
): string | null {
    if (!stmt) return null;

    const upper = stmt.toUpperCase();

    // SET @x = expr → var x = expr;
    const setMatch = /^SET\s+@(\w+)\s*=\s*(.+)$/i.exec(stmt);
    if (setMatch) {
        const [, varName, expr] = setMatch;
        const ssExpr = convertAmpExpr(expr.trim());
        changes.push({
            line: lineNum,
            description: `SET @${varName} = ... → var ${varName} = ...`,
        });
        return `var ${varName} = ${ssExpr};`;
    }

    // VAR @x, @y → var x, y;
    const varMatch = /^VAR\s+(.+)$/i.exec(stmt);
    if (varMatch) {
        const vars = varMatch[1].split(',').map((v: string) => v.trim().replace(/^@/, ''));
        changes.push({
            line: lineNum,
            description: `VAR @${vars.join(', @')} → var ${vars.join(', ')}`,
        });
        return `var ${vars.join(', ')};`;
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
        const [, iterVar, start, end] = forMatch;
        const ssStart = stripAmpVars(start);
        const ssEnd = stripAmpVars(end);
        changes.push({
            line: lineNum,
            description: `FOR @${iterVar} = ${start} TO ${end} DO → for loop`,
        });
        return `for (var ${iterVar} = ${ssStart}; ${iterVar} <= ${ssEnd}; ${iterVar}++) {`;
    }

    // NEXT @i → }
    if (/^NEXT\s+@\w+$/i.test(stmt)) {
        changes.push({ line: lineNum, description: 'NEXT @i → }' });
        return '}';
    }

    // OUTPUT(expr) / OUTPUTLINE(expr) → Platform.Response.Write(expr)
    const outputMatch = /^(?:OUTPUT|OUTPUTLINE)\s*\((.+)\)$/i.exec(stmt);
    if (outputMatch) {
        const expr = convertAmpExpr(outputMatch[1].trim());
        changes.push({ line: lineNum, description: 'Output/OutputLine → Platform.Response.Write' });
        return `Platform.Response.Write(${expr});`;
    }

    // Known AMPscript function call → Platform.Function.X(args)
    const fnCallMatch = /^(\w+)\s*\((.*)?\)$/i.exec(stmt);
    if (fnCallMatch) {
        const [, fnName, args] = fnCallMatch;
        const ssName = AMP_TO_PLATFORM_FUNCTION[fnName.toLowerCase()];
        if (ssName) {
            const argsConverted = args ? convertAmpExpr(args.trim()) : '';
            changes.push({
                line: lineNum,
                description: `${fnName}(…) → Platform.Function.${ssName}(…)`,
            });
            return `Platform.Function.${ssName}(${argsConverted});`;
        }
    }

    // Check for AMPscript-only constructs that can't be converted
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
function convertAmpExpr(expr: string): string {
    // Replace known AMPscript function calls with Platform.Function.X equivalents
    let result = expr.replaceAll(/\b(\w+)\s*\(/g, (match: string, fnName: string) => {
        const ssName = AMP_TO_PLATFORM_FUNCTION[fnName.toLowerCase()];
        return ssName ? `Platform.Function.${ssName}(` : match;
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
    const strToDatePattern = /FormatDate\s*\(\s*StringToDate\s*\(([^)]+)\)\s*,/gi;
    if (strToDatePattern.test(rewrittenCode)) {
        rewrittenCode = rewrittenCode.replaceAll(
            /FormatDate\s*\(\s*StringToDate\s*\(([^)]+)\)\s*,/gi,
            'FormatDate($1,'
        );
        // Find affected lines for change tracking
        const lines = code.split('\n');
        for (const [i, line] of lines.entries()) {
            if (/FormatDate\s*\(\s*StringToDate\s*\(/i.test(line)) {
                changes.push({
                    line: i + 1,
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
        (match: string, arg1: string, formatStr: string) => {
            let newFormat = formatStr;
            let changed = false;
            let hasShorthand = false;

            // Check for standard shorthands
            for (const shorthand of DOTNET_STANDARD_SHORTHANDS) {
                if (new RegExp(`^${shorthand}$`).test(formatStr.trim())) {
                    hasShorthand = true;
                }
            }

            if (hasShorthand) {
                // Annotate with comment about needing explicit format
                return `FormatDate(${arg1}, "/* MANUAL_REWRITE_REQUIRED: Convert .NET standard shorthand '${formatStr}' to explicit Java SimpleDateFormat pattern */"${formatStr}")`;
            }

            // Apply .NET → Java replacements
            for (const [pattern, replacement] of DOTNET_TO_JAVA_FORMAT_REPLACEMENTS) {
                const before = newFormat;
                newFormat = newFormat.replace(pattern, replacement);
                if (newFormat !== before) {
                    changed = true;
                }
            }

            if (changed) {
                return `FormatDate(${arg1}, "${newFormat}")`;
            }
            return match;
        }
    );

    // Track format string changes
    const codeLines = code.split('\n');
    const rewrittenLines = rewrittenCode.split('\n');
    for (const [i, codeLine] of codeLines.entries()) {
        if (codeLine !== rewrittenLines[i] && /FormatDate/i.test(codeLine)) {
            changes.push({
                line: i + 1,
                type: 'rewritten',
                description: `Converted .NET format string to Java SimpleDateFormat in FormatDate()`,
            });
        }
    }

    // 3. Annotate Lookup() calls with odd argument counts
    rewrittenCode = rewrittenCode.replaceAll(
        /\bLookup\s*\(([^)]+)\)/gi,
        (match: string, argsStr: string) => {
            const argCount = countArgs(argsStr);
            // Lookup takes: DE, returnCol, [searchCol, searchVal, ...]
            // Min 2 args, then pairs after that → should be even number > 2 or exactly 2
            // Odd count after first 2 = problem
            if (argCount >= 3 && (argCount - 2) % 2 !== 0) {
                return `${match} %%-- MCN NOTE: Lookup() requires search arguments in column/value pairs (even count after DE and return column). Current arg count (${argCount}) may cause an error in MCN. --%% `;
            }
            return match;
        }
    );

    // 4. Mark MCE-only function calls with annotation
    // Find all function calls and mark unsupported ones
    const funcCallPattern = /\b([A-Z][A-Za-z]+)\s*\(/g;
    let funcMatch: RegExpExecArray | null;
    const seenUnsupported = new Set<string>();

    while ((funcMatch = funcCallPattern.exec(code)) !== null) {
        const fnName = funcMatch[1];
        if (!isMcnSupportedFn(fnName) && fnName.length > 1) {
            seenUnsupported.add(fnName);
        }
    }

    for (const fnName of seenUnsupported) {
        const mcnNotes = getMcnNotesFn(fnName);
        const annotationPattern = new RegExp(String.raw`\b${fnName}\s*\(`, 'gi');
        rewrittenCode = rewrittenCode.replace(annotationPattern, (m: string) => {
            return `%%-- NOT SUPPORTED IN MCN: ${fnName}${mcnNotes ? ` — ${mcnNotes}` : ''} --%%\n${m}`;
        });

        // Find lines for tracking
        for (const [i, codeLine] of codeLines.entries()) {
            if (new RegExp(String.raw`\b${fnName}\s*\(`, 'i').test(codeLine)) {
                changes.push({
                    line: i + 1,
                    type: 'annotated',
                    description: `${fnName}() is not supported in Marketing Cloud Next`,
                });
                nonMigratableItems.push({
                    line: i + 1,
                    code: codeLine.trim(),
                    reason: `${fnName}() is not available in Marketing Cloud Next`,
                });
            }
        }
    }

    // 5. Check for CloudPages functions
    const cloudFnPattern =
        /\b(CloudPagesURL|RequestParameter|QueryParameter|Redirect|MicrositeURL)\s*\(/gi;
    let cloudMatch: RegExpExecArray | null;
    while ((cloudMatch = cloudFnPattern.exec(code)) !== null) {
        const fnName = cloudMatch[1];
        const lineNum = code.slice(0, cloudMatch.index).split('\n').length;
        nonMigratableItems.push({
            line: lineNum,
            code: codeLines[lineNum - 1]?.trim() ?? fnName,
            reason: `${fnName}() is a CloudPages-specific function and cannot run in Marketing Cloud Next`,
        });
    }

    // Assess difficulty
    const hasNotMigratable = nonMigratableItems.some(
        (item) => item.reason.includes('CloudPages') || item.reason.includes('NOT SUPPORTED')
    );
    const hasMcnNotes =
        Array.from(seenUnsupported).some((fn) => getMcnNotesFn(fn) !== null) ||
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
