export interface PreflightViolation {
  ruleId: string;
  severity: "critical" | "warning";
  message: string;
}

export interface PreflightVerificationReport {
  valid: boolean;
  language: "sql" | "typescript" | "javascript";
  violations: PreflightViolation[];
}

/**
 * Deterministic Code & SQLite Migration Static Pre-Flight Verifier.
 * Audits generated SQL migrations and TypeScript/JavaScript modules before execution or delivery
 * for unbalanced delimiters, non-idempotent DDL, unguarded destructive queries, and boundary violations.
 */
export class CodeAndSqlPreflightVerifier {
  public static verifySqlMigration(sqlText: string): PreflightVerificationReport {
    const violations: PreflightViolation[] = [];
    const trimmed = sqlText.trim();

    if (!trimmed) {
      violations.push({
        ruleId: "EMPTY_SQL",
        severity: "critical",
        message: "SQL migration content is empty."
      });
    }

    // 1. Check CREATE TABLE without IF NOT EXISTS
    const createTableMatches =
      trimmed.match(/CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)[A-Za-z0-9_]+/gi) ?? [];
    for (const match of createTableMatches) {
      violations.push({
        ruleId: "NON_IDEMPOTENT_CREATE_TABLE",
        severity: "critical",
        message: `SQL migration must use 'CREATE TABLE IF NOT EXISTS': found '${match}'`
      });
    }

    // 2. Check CREATE TRIGGER without IF NOT EXISTS
    const createTriggerMatches =
      trimmed.match(/CREATE\s+TRIGGER\s+(?!IF\s+NOT\s+EXISTS\b)[A-Za-z0-9_]+/gi) ?? [];
    for (const match of createTriggerMatches) {
      violations.push({
        ruleId: "NON_IDEMPOTENT_CREATE_TRIGGER",
        severity: "critical",
        message: `SQL migration must use 'CREATE TRIGGER IF NOT EXISTS': found '${match}'`
      });
    }

    // 3. Block unguarded DROP TABLE or DELETE FROM without WHERE
    if (/\bDROP\s+TABLE\b/i.test(trimmed)) {
      violations.push({
        ruleId: "DESTRUCTIVE_DROP_TABLE",
        severity: "critical",
        message: "Destructive DROP TABLE statement is forbidden in additive migrations."
      });
    }
    if (/\bDELETE\s+FROM\s+[A-Za-z0-9_]+\s*;/i.test(trimmed)) {
      violations.push({
        ruleId: "UNGUARDED_DELETE_WITHOUT_WHERE",
        severity: "critical",
        message: "DELETE FROM without a WHERE clause is blocked."
      });
    }

    return {
      valid: violations.filter((v) => v.severity === "critical").length === 0,
      language: "sql",
      violations
    };
  }

  public static verifyTypeScriptOrJsModule(
    code: string,
    targetFilePath?: string
  ): PreflightVerificationReport {
    const violations: PreflightViolation[] = [];

    // 1. Check reserved Codex parallel work boundary paths
    if (targetFilePath) {
      const normalizedPath = targetFilePath.replace(/\\/g, "/");
      if (
        normalizedPath.includes("apps/api/src/account-settings/") ||
        normalizedPath.endsWith("packages/db/src/usage-store.ts") ||
        normalizedPath.endsWith("packages/contracts/src/usage.ts")
      ) {
        violations.push({
          ruleId: "RESTRICTED_BOUNDARY_FILE",
          severity: "critical",
          message: `Target file '${targetFilePath}' is inside the reserved parallel-work boundary.`
        });
      }
    }

    // 2. Check balanced braces, brackets, and parentheses outside strings/comments
    if (!CodeAndSqlPreflightVerifier.hasBalancedDelimiters(code)) {
      violations.push({
        ruleId: "UNBALANCED_DELIMITERS",
        severity: "critical",
        message: "Module contains unbalanced braces {}, brackets [], or parentheses ()."
      });
    }

    // 3. Check for lazy TODO placeholders
    if (/(?:\/\/\s*TODO\b|\/\*\s*TODO\b)/i.test(code)) {
      violations.push({
        ruleId: "TODO_STUB_PRESENT",
        severity: "critical",
        message: "Module contains unfinished TODO stub comments."
      });
    }

    return {
      valid: violations.filter((v) => v.severity === "critical").length === 0,
      language: "typescript",
      violations
    };
  }

  public static hasBalancedDelimiters(code: string): boolean {
    const stack: string[] = [];
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < code.length; i++) {
      const ch = code[i]!;
      const next = code[i + 1] ?? "";

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          i++;
        }
        continue;
      }
      if (inSingle) {
        if (ch === "\\") {
          i++;
        } else if (ch === "'") {
          inSingle = false;
        }
        continue;
      }
      if (inDouble) {
        if (ch === "\\") {
          i++;
        } else if (ch === '"') {
          inDouble = false;
        }
        continue;
      }
      if (inTemplate) {
        if (ch === "\\") {
          i++;
        } else if (ch === "`") {
          inTemplate = false;
        }
        continue;
      }

      if (ch === "/" && next === "/") {
        inLineComment = true;
        i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i++;
        continue;
      }
      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }

      if (ch === "{" || ch === "[" || ch === "(") {
        stack.push(ch);
      } else if (ch === "}" || ch === "]" || ch === ")") {
        const top = stack.pop();
        if (
          (ch === "}" && top !== "{") ||
          (ch === "]" && top !== "[") ||
          (ch === ")" && top !== "(")
        ) {
          return false;
        }
      }
    }

    return stack.length === 0 && !inSingle && !inDouble && !inTemplate && !inBlockComment;
  }
}
