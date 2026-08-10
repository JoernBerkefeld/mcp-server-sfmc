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
         * The canonical MCN Handlebars helper name this function converts to,
         * or null when no Handlebars helper exists. Drives the AMP_TO_HANDLEBARS
         * / HANDLEBARS_TO_AMP / AMP_HANDLEBARS_APPROX maps in conversion-rules.ts.
         */
        handlebarsEquivalent?: string | null;
        /**
         * Only meaningful when `handlebarsEquivalent` is set: true when the
         * helper is an argument-for-argument drop-in, false when it does the
         * same job with a different call shape (converter emits a hint).
         */
        handlebarsExact?: boolean;
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
