export type RpnToken =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "^" }
  | { kind: "func"; name: "min" | "max" | "abs" | "sqrt" | "round" };

/**
 * Dijkstra's Shunting-Yard Operator-Precedence Parser & Safe RPN Evaluator.
 * Evaluates mathematical and policy formulas with variables, functions, and right-associative
 * exponentiation (`^`) with zero `eval()` or `new Function()` usage.
 */
export class DijkstraShuntingYardAndAstEvaluator {
  private static readonly PRECEDENCE: Record<string, { prec: number; rightAssoc: boolean }> = {
    "+": { prec: 1, rightAssoc: false },
    "-": { prec: 1, rightAssoc: false },
    "*": { prec: 2, rightAssoc: false },
    "/": { prec: 2, rightAssoc: false },
    "^": { prec: 3, rightAssoc: true }
  };

  public static compileToRpn(expression: string): RpnToken[] {
    const tokenRegex = /\s*([0-9]+(?:\.[0-9]+)?|[a-zA-Z_][a-zA-Z0-9_]*|[\+\-\*\/\^\(\),])\s*/g;
    const rawTokens: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(expression)) !== null) {
      rawTokens.push(match[1]!);
    }

    const outputQueue: RpnToken[] = [];
    const opStack: string[] = [];
    const funcNames = new Set(["min", "max", "abs", "sqrt", "round"]);

    for (let i = 0; i < rawTokens.length; i++) {
      const tok = rawTokens[i]!;

      if (/^[0-9]/.test(tok)) {
        outputQueue.push({ kind: "num", value: Number(tok) });
      } else if (funcNames.has(tok) && rawTokens[i + 1] === "(") {
        opStack.push(tok);
      } else if (/^[a-zA-Z_]/.test(tok)) {
        outputQueue.push({ kind: "var", name: tok });
      } else if (tok === ",") {
        while (opStack.length > 0 && opStack[opStack.length - 1] !== "(") {
          const top = opStack.pop()!;
          outputQueue.push({ kind: "op", op: top as "+" | "-" | "*" | "/" | "^" });
        }
      } else if (tok in DijkstraShuntingYardAndAstEvaluator.PRECEDENCE) {
        const o1 = DijkstraShuntingYardAndAstEvaluator.PRECEDENCE[tok]!;
        while (opStack.length > 0) {
          const top = opStack[opStack.length - 1]!;
          const o2 = DijkstraShuntingYardAndAstEvaluator.PRECEDENCE[top];
          if (
            o2 &&
            ((!o1.rightAssoc && o1.prec <= o2.prec) ||
              (o1.rightAssoc && o1.prec < o2.prec))
          ) {
            opStack.pop();
            outputQueue.push({ kind: "op", op: top as "+" | "-" | "*" | "/" | "^" });
          } else {
            break;
          }
        }
        opStack.push(tok);
      } else if (tok === "(") {
        opStack.push(tok);
      } else if (tok === ")") {
        while (opStack.length > 0 && opStack[opStack.length - 1] !== "(") {
          const top = opStack.pop()!;
          outputQueue.push({ kind: "op", op: top as "+" | "-" | "*" | "/" | "^" });
        }
        if (opStack[opStack.length - 1] === "(") {
          opStack.pop();
        }
        if (opStack.length > 0 && funcNames.has(opStack[opStack.length - 1]!)) {
          const fn = opStack.pop()!;
          outputQueue.push({
            kind: "func",
            name: fn as "min" | "max" | "abs" | "sqrt" | "round"
          });
        }
      }
    }

    while (opStack.length > 0) {
      const top = opStack.pop()!;
      if (top !== "(" && top !== ")") {
        outputQueue.push({ kind: "op", op: top as "+" | "-" | "*" | "/" | "^" });
      }
    }

    return outputQueue;
  }

  public static evaluateExpression(
    expression: string,
    variables: Record<string, number> = {}
  ): { result: number; rpnQueueLength: number } {
    const rpn = DijkstraShuntingYardAndAstEvaluator.compileToRpn(expression);
    const stack: number[] = [];

    for (const tok of rpn) {
      if (tok.kind === "num") {
        stack.push(tok.value);
      } else if (tok.kind === "var") {
        const val = variables[tok.name];
        if (val === undefined) {
          throw new Error(`UNKNOWN_EXPRESSION_VARIABLE: ${tok.name}`);
        }
        stack.push(val);
      } else if (tok.kind === "op") {
        const b = stack.pop() ?? 0;
        const a = stack.pop() ?? 0;
        if (tok.op === "+") stack.push(a + b);
        else if (tok.op === "-") stack.push(a - b);
        else if (tok.op === "*") stack.push(a * b);
        else if (tok.op === "/") stack.push(a / (Math.abs(b) < 1e-12 ? 1e-12 : b));
        else if (tok.op === "^") stack.push(Math.pow(a, b));
      } else if (tok.kind === "func") {
        if (tok.name === "min" || tok.name === "max") {
          const b = stack.pop() ?? 0;
          const a = stack.pop() ?? 0;
          stack.push(tok.name === "min" ? Math.min(a, b) : Math.max(a, b));
        } else {
          const a = stack.pop() ?? 0;
          if (tok.name === "abs") stack.push(Math.abs(a));
          else if (tok.name === "sqrt") stack.push(Math.sqrt(Math.max(0, a)));
          else if (tok.name === "round") stack.push(Math.round(a));
        }
      }
    }

    return {
      result: Number((stack.pop() ?? 0).toFixed(6)),
      rpnQueueLength: rpn.length
    };
  }
}
