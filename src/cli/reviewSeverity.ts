/**
 * Severity parsing helpers for the sfmc-review-diff CLI. Kept in a dedicated
 * module (no shebang) so the pure, unit-tested logic is importable without the
 * executable CLI entry point.
 */

export type FailOnLevel = 'error' | 'warning' | 'info';

export interface SeverityCounts {
    errors: number;
    warnings: number;
    infos: number;
}

/**
 * Counts diagnostic lines emitted by the review_change tool (see src/index.ts).
 * @param output
 */
export function countReviewSeverities(output: string): SeverityCounts {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const line of output.split('\n')) {
        if (line.startsWith('🔴 ERROR')) errors += 1;
        else if (line.startsWith('🟡 WARNING')) warnings += 1;
        else if (line.startsWith('🔵 INFO')) infos += 1;
    }
    return { errors, warnings, infos };
}

/**
 * Whether the CLI should exit with code 1 given counts and --fail-on policy.
 * @param counts
 * @param failOn
 */
export function shouldFail(counts: SeverityCounts, failOn: FailOnLevel): boolean {
    if (counts.errors > 0) return true;
    if ((failOn === 'warning' || failOn === 'info') && counts.warnings > 0) return true;
    return failOn === 'info' && counts.infos > 0;
}
