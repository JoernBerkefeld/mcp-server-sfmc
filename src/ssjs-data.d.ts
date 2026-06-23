/**
 * Minimal type declarations for ssjs-data (plain-JS package, no bundled .d.ts).
 * Only the fields consumed by mcp-server-sfmc are declared here.
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

    /** A parameter on an ECMAScript builtin entry. */
    export interface EcmascriptBuiltinParam {
        name: string;
        type?: string;
        optional?: boolean;
        description?: string;
    }

    /**
     * A supported ECMAScript built-in member (method, property, or constructor)
     * confirmed to work in the SFMC SSJS engine. `caveat` documents a confirmed
     * engine limitation for members that work in common forms but fail in edge cases.
     */
    export interface EcmascriptBuiltin {
        name: string;
        owner: string;
        esVersion: 3 | 5 | 6;
        description: string;
        caveat?: string;
        params?: EcmascriptBuiltinParam[];
        returnType?: string;
        syntax?: string;
        example?: string;
    }

    export const ECMASCRIPT_BUILTINS: EcmascriptBuiltin[];

    /**
     * An ECMAScript member that is unavailable or broken in the SFMC SSJS engine
     * and is NOT shipped with a polyfill in ssjs-data (`hasPolyfill` only flags
     * whether a polyfill is *possible*, surfaced via the suggestion text).
     */
    export interface KnownUnsupportedMember {
        member: string;
        owner: string;
        esVersion: 3 | 5 | 6;
        isStatic: boolean;
        isProperty: boolean;
        category: 'unavailable' | 'broken';
        hasPolyfill: boolean;
        suggestion: string;
    }

    export const KNOWN_UNSUPPORTED: KnownUnsupportedMember[];

    /**
     * An ECMAScript member that is unavailable or broken in the SFMC SSJS engine
     * but CAN be made to work via the shipped `polyfill` source string (ES3-safe).
     */
    export interface PolyfillableMethod {
        method: string;
        owner: string;
        esVersion: 3 | 5 | 6;
        isStatic: boolean;
        category: 'unavailable' | 'broken';
        ambiguousWithString: boolean;
        description: string;
        /** Full ES3-safe polyfill source code that defines/overrides the member. */
        polyfill: string;
    }

    export const POLYFILLABLE_METHODS: PolyfillableMethod[];

    /** Polyfillable instance methods keyed by bare method name. */
    export const polyfillByPrototypeName: Map<string, PolyfillableMethod>;
    /** Polyfillable static methods keyed by bare method name. */
    export const polyfillByStaticName: Map<string, PolyfillableMethod>;
}
