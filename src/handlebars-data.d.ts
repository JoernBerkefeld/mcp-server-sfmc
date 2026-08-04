/**
 * Minimal type declarations for handlebars-data (plain-JS package, no bundled .d.ts).
 * Only the exports consumed by mcp-server-sfmc are declared here. The canonical
 * catalog is read through sfmc-language-lsp accessors; this shim covers the few
 * direct handlebars-data calls in conversion-rules.ts and the validator.
 *
 * The interface names mirror the `HandlebarsData*` names that sfmc-language-lsp's
 * type declarations import from this module, so the LSP's re-exported
 * `HandlebarsHelper` / `HandlebarsBinding` aliases resolve to real shapes here
 * rather than `any`.
 * @param name
 */
declare module 'handlebars-data' {
    /**
     * A parameter on a Handlebars helper definition.
     */
    export interface HandlebarsDataParam {
        name: string;
        type: string;
        description: string;
        optional?: boolean;
        variadic?: boolean;
    }

    /**
     * A single MCN Handlebars helper definition.
     */
    export interface HandlebarsDataHelper {
        name: string;
        displayName?: string;
        category: string;
        origin: 'handlebars-builtin' | 'mcn-helper' | 'mcn-platform';
        helperType: 'inline' | 'block' | 'both';
        mcnSince: number;
        params: HandlebarsDataParam[];
        returnType: string;
        description: string;
        docUrl?: string;
        subexpressionOnly?: boolean;
    }

    /**
     * A built-in MCN merge-field binding (`{!$…}`).
     */
    export interface HandlebarsDataBinding {
        name: string;
        token: string;
        namespace: string;
        mcnSince: number;
        description: string;
    }

    /**
     * A Handlebars construct unsupported by the locked-down MCN engine.
     */
    export interface HandlebarsDataUnsupportedConstruct {
        id: string;
        astNodeType: string;
        helperName: string | null;
        label: string;
        message: string;
    }

    export const HELPERS: HandlebarsDataHelper[];
    export const CANONICAL_HELPERS: string[];
    export const helperLookup: Map<string, HandlebarsDataHelper>;
    export const helperNames: Set<string>;
    export const BUILTIN_BINDINGS: HandlebarsDataBinding[];
    export const bindingLookup: Map<string, HandlebarsDataBinding>;
    export const bindingNames: Set<string>;
    export const UNSUPPORTED_CONSTRUCTS: HandlebarsDataUnsupportedConstruct[];
    export const unsupportedByNodeType: Map<string, HandlebarsDataUnsupportedConstruct[]>;

    export function getHelper(name: string): HandlebarsDataHelper | undefined;
    export function isHelper(name: string): boolean;
    export function getHelperMcnSince(name: string): number | null;
    export function isBuiltinBinding(name: string): boolean;
}
