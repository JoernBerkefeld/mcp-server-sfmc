/**
 * Minimal type declarations for ampscript-data (plain-JS package, no bundled .d.ts).
 * Only the fields consumed by mcp-server-sfmc are declared here.
 */
declare module 'ampscript-data' {
    /**
     * A parameter on an AMPscript function entry.
     */
    export interface AmpscriptFunctionParam {
        name: string;
        description: string;
        type?: string;
        optional?: boolean;
    }

    /**
     * A single AMPscript function definition. Only the fields consumed by
     * mcp-server-sfmc's conversion maps and tooling are declared.
     */
    export interface AmpscriptFunction {
        name: string;
        /**
         * The canonical MCN Handlebars helper name this function converts to
         * (Category A), or null when no Handlebars helper exists. Drives the
         * AMP_TO_HANDLEBARS / HANDLEBARS_TO_AMP maps in conversion-rules.ts.
         */
        handlebarsEquivalent?: string | null;
        /**
         * True when the function is documented as supported in Marketing Cloud
         * Next but currently fails at runtime and has no Handlebars helper
         * (Category C). Such entries must have `handlebarsEquivalent: null`.
         */
        mcnHandlebarsGap?: boolean;
        minArgs: number;
        maxArgs: number;
        category: string;
        description: string;
        params: AmpscriptFunctionParam[];
        returnType?: string;
        mcnSince?: number | null;
        mcnNotes?: string | null;
    }

    export const FUNCTIONS: AmpscriptFunction[];
}
