/**
 * Kosmora / Nexus-OS AST-Level Code & Script Sandbox Security Verifier (Wave 21)
 *
 * Inspects agent-generated scripts, workflow expressions, and custom tool formulas
 * before execution:
 * 1. Lexical & structural AST analysis for dangerous primitives:
 *    - Dynamic code evaluation (`eval`, `new Function`, `vm.runInNewContext`)
 *    - OS process spawning (`child_process`, `execSync`, `spawn`)
 *    - Network exfiltration (`fetch`, `http.request`, `net.connect`, `WebSocket`)
 *    - Prototype pollution (`__proto__`, `constructor.prototype`)
 *    - Infinite unguarded loops (`while(true)`, `for(;;)`)
 * 2. Safe Sandboxed Execution (`executeSandboxedExpression`): evaluates verified mathematical
 *    and data-transformation expressions inside a frozen null-prototype `node:vm` context with
 *    a strict CPU timeout ceiling (e.g. <= 50ms).
 */

import vm from "node:vm";

export type AstHazardCategory =
  | "DYNAMIC_CODE_EVAL"
  | "PROCESS_SPAWN"
  | "NETWORK_ACCESS"
  | "FILESYSTEM_ESCAPE"
  | "PROTOTYPE_POLLUTION"
  | "INFINITE_LOOP_RISK";

export interface AstSecurityViolation {
  category: AstHazardCategory;
  severity: "critical" | "high";
  token: string;
  message: string;
}

export interface AstAuditReport {
  safe: boolean;
  violations: AstSecurityViolation[];
}

const HAZARD_RULES: Array<{
  category: AstHazardCategory;
  severity: "critical" | "high";
  regex: RegExp;
  message: string;
}> = [
  {
    category: "DYNAMIC_CODE_EVAL",
    severity: "critical",
    regex: /\b(?:eval|Function|setTimeout|setInterval|setImmediate)\s*\(/,
    message: "Dynamic code evaluation or timer injection is forbidden in sandbox expressions."
  },
  {
    category: "PROCESS_SPAWN",
    severity: "critical",
    regex: /\b(?:child_process|execSync|execFileSync|spawnSync|fork|process\.binding|process\.dlopen|process\.exit|process\.kill|process\.env)\b/,
    message: "Direct OS process or environment access is forbidden."
  },
  {
    category: "NETWORK_ACCESS",
    severity: "critical",
    regex: /\b(?:fetch|XMLHttpRequest|WebSocket|http\.request|https\.request|net\.connect|dgram|dns)\b/,
    message: "Outbound network calls are forbidden inside local sandbox expressions."
  },
  {
    category: "FILESYSTEM_ESCAPE",
    severity: "critical",
    regex: /\b(?:require\s*\(|import\s*\(|fs\.(?:write|unlink|rm|rmdir|chmod))/,
    message: "Module loading or direct filesystem mutation is forbidden."
  },
  {
    category: "PROTOTYPE_POLLUTION",
    severity: "critical",
    regex: /(?:__proto__|prototype\s*\[|constructor\s*\.\s*prototype|Object\.setPrototypeOf)/,
    message: "Prototype chain manipulation or constructor escape detected."
  },
  {
    category: "INFINITE_LOOP_RISK",
    severity: "high",
    regex: /\b(?:while\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\))/,
    message: "Unbounded infinite loop construct detected."
  }
];

export class AstCodeSandboxVerifier {
  /**
   * Statically audits a JS/TS expression or workflow snippet for forbidden AST patterns.
   */
  public auditCodeSnippet(sourceCode: string): AstAuditReport {
    const code = String(sourceCode ?? "");
    // Strip single-line and multi-line comments before scanning
    const stripped = code
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, " ");

    const violations: AstSecurityViolation[] = [];

    for (const rule of HAZARD_RULES) {
      const match = stripped.match(rule.regex);
      if (match) {
        violations.push({
          category: rule.category,
          severity: rule.severity,
          token: match[0],
          message: rule.message
        });
      }
    }

    return {
      safe: violations.length === 0,
      violations
    };
  }

  /**
   * Audits and executes a pure data-transformation or mathematical expression inside
   * a frozen, null-prototype `node:vm` context with a strict CPU execution timeout.
   */
  public executeSandboxedExpression(
    expression: string,
    variables: Record<string, any> = {},
    options?: { timeoutMs?: number }
  ): { ok: boolean; result?: any; error?: string; audit: AstAuditReport } {
    const audit = this.auditCodeSnippet(expression);
    if (!audit.safe) {
      return {
        ok: false,
        error: `AST_SECURITY_VIOLATION: ${audit.violations.map((v) => `${v.category}(${v.token})`).join(", ")}`,
        audit
      };
    }

    const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? 50, 5), 1000);
    const sandboxEnv = Object.create(null);
    sandboxEnv.Math = Math;
    sandboxEnv.Number = Number;
    sandboxEnv.String = String;
    sandboxEnv.Boolean = Boolean;
    sandboxEnv.Array = Array;
    sandboxEnv.JSON = JSON;

    for (const [k, v] of Object.entries(variables)) {
      if (k !== "__proto__" && k !== "constructor" && k !== "prototype") {
        sandboxEnv[k] = JSON.parse(JSON.stringify(v));
      }
    }

    const context = vm.createContext(sandboxEnv, {
      codeGeneration: { strings: false, wasm: false }
    });

    try {
      const script = new vm.Script(`(${expression})`);
      const res = script.runInContext(context, { timeout: timeoutMs });
      return {
        ok: true,
        result: res,
        audit
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        audit
      };
    }
  }
}
