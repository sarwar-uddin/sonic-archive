/**
 * Detects data-destroying statements in migration SQL (docs/safety.md, #9).
 *
 * A destructive statement is allowed only when its own statement block
 * carries a `-- safety-reviewed: <reason>` comment. Drizzle-kit sometimes
 * rebuilds SQLite tables (create new, copy, DROP old, rename), so a human must
 * check that the copy step preserves every row before marking it reviewed.
 */

const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\bDROP\s+TABLE\b/i,
  // SQLite allows both `DROP COLUMN c` and the shorter `DROP c`.
  /\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i,
  /\bDELETE\s+FROM\b/i,
];

// Horizontal whitespace only: the reason must be on the marker line itself.
const REVIEW_MARKER = /--[ \t]*safety-reviewed:[ \t]*\S/i;

/** Drizzle-kit separates statements with this marker. */
export const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

/** Returns each destructive statement that lacks a review marker. */
export function findUnreviewedDestructiveStatements(statements: readonly string[]): string[] {
  return statements.filter((statement) => {
    const code = stripComments(statement);
    return (
      DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(code)) && !REVIEW_MARKER.test(statement)
    );
  });
}

export function splitStatements(migrationSql: string): string[] {
  return migrationSql.split(STATEMENT_BREAKPOINT).filter((s) => s.trim() !== '');
}

function stripComments(statement: string): string {
  return statement.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}
