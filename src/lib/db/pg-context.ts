// PostgreSQL Transaction-Local Tenant Context & Session Hygiene (Task RLS-01)
// Reference: Master Plan Section 7 (Security and Isolation: PostgreSQL RLS) & ADR 0002

export interface TenantSessionContext {
  tenantId?: string | null;
  userId?: string | null;
  userRole: "ADMIN" | "USER" | "ALLOCATOR" | "WORKSHOP" | "SITE_PUMP" | string;
  projectId?: string | null;
  bulkTankId?: string | null;
  bypassRls?: boolean;
}

export interface PgQueryExecutor {
  query(sql: string, params?: any[]): Promise<any>;
}

/**
 * Escapes single quotes for SQL SET LOCAL parameters to prevent SQL injection.
 */
function escapeSqlLiteral(val: string): string {
  return val.replace(/'/g, "''");
}

/**
 * Generates SQL `SET LOCAL` statements that bind context variables strictly
 * to the current PostgreSQL transaction. Upon COMMIT or ROLLBACK, PostgreSQL
 * automatically clears these transaction-local settings, preventing connection pool leakage.
 */
export function buildSetLocalSql(context: TenantSessionContext): string[] {
  const statements: string[] = [];

  const tenantId = context.tenantId || "";
  const userId = context.userId || "";
  const userRole = context.userRole || "";
  const projectId = context.projectId || "";
  const bulkTankId = context.bulkTankId || "";
  const bypassRls = context.bypassRls ? "true" : "false";

  statements.push(`SET LOCAL app.current_tenant_id = '${escapeSqlLiteral(tenantId)}';`);
  statements.push(`SET LOCAL app.current_user_id = '${escapeSqlLiteral(userId)}';`);
  statements.push(`SET LOCAL app.current_user_role = '${escapeSqlLiteral(userRole)}';`);
  statements.push(`SET LOCAL app.current_project_id = '${escapeSqlLiteral(projectId)}';`);
  statements.push(`SET LOCAL app.current_tank_id = '${escapeSqlLiteral(bulkTankId)}';`);
  statements.push(`SET LOCAL app.bypass_rls = '${bypassRls}';`);

  return statements;
}

/**
 * Generates session-reset SQL statements to guarantee hygiene if SET was used
 * outside of an explicit transaction.
 */
export function buildResetSessionSql(): string[] {
  return [
    "RESET app.current_tenant_id;",
    "RESET app.current_user_id;",
    "RESET app.current_user_role;",
    "RESET app.current_project_id;",
    "RESET app.current_tank_id;",
    "RESET app.bypass_rls;",
  ];
}

/**
 * Executes a unit of work within an explicit PostgreSQL transaction configured
 * with the caller's authorized tenant context.
 *
 * Guarantees:
 * 1. `SET LOCAL` scopes context variables strictly to the transaction.
 * 2. On successful completion, changes commit and settings automatically clear.
 * 3. On error, changes rollback and settings automatically clear.
 * 4. Context cannot cross-contaminate pooled database connections.
 */
export async function withTenantContext<T>(
  executor: PgQueryExecutor,
  context: TenantSessionContext,
  work: () => Promise<T>
): Promise<T> {
  const setStatements = buildSetLocalSql(context);

  await executor.query("BEGIN;");
  try {
    for (const sql of setStatements) {
      await executor.query(sql);
    }

    const result = await work();
    await executor.query("COMMIT;");
    return result;
  } catch (err) {
    try {
      await executor.query("ROLLBACK;");
    } catch {
      // Suppress secondary rollback error to preserve original exception
    }
    throw err;
  }
}
