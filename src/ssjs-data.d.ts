/**
 * Minimal type declarations for ssjs-data (plain-JS package, no bundled .d.ts).
 * Only the fields consumed by conversion-rules.ts are declared here.
 */
declare module 'ssjs-data' {
    export interface SsjsPlatformFunction {
        name: string;
        /**
         * The canonical AMPscript function name this Platform.Function maps to,
         * or null when no direct AMPscript equivalent exists (SSJS-only function).
         * Used by mcp-server-sfmc conversion tools.
         */
        ampscriptEquivalent: string | null;
        minArgs: number;
        maxArgs: number;
        description: string;
        returnType: string;
        syntax: string;
    }

    export const PLATFORM_FUNCTIONS: SsjsPlatformFunction[];
}
