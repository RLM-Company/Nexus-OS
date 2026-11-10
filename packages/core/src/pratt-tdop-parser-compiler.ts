export type PrattAstNode =
  | { kind: "literal"; value: number }
  | { kind: "ident"; name: string }
  | { kind: "unary"; op: string; operand: PrattAstNode }
  | { kind: "binary"; op: string; left: PrattAstNode; right: PrattAstNode }
  | { kind: "ternary"; cond: PrattAstNode; thenBranch: PrattAstNode; elseBranch: PrattAstNode };

/**
 * Vaughan Pratt's Top-Down Operator Precedence (TDOP) Parser.
 * Uses Null Denotation (`nud`) for prefix/primary constructs and Left Denotation (`led`)
 * with Left/Right Binding Powers (`lbp`/`rbp`) for binary and right-associative ternary (`? :`) operators.
 */
export class PrattTopDownOperatorPrecedenceParser {
  private tokens: string[] = [];
  private pos = 0;

  private peek(): string | null {
    return this.tokens[this.pos] ?? null;
  }

  private consume(expected?: string): string {
    const tok = this.tokens[this.pos];
    if (tok === undefined) {
      throw new Error(`PRATT_UNEXPECTED_EOF${expected ? `: expected '${expected}'` : ""}`);
    }
    if (expected !== undefined && tok !== expected) {
      throw new Error(`PRATT_EXPECTED_TOKEN: expected '${expected}', got '${tok}'`);
    }
    this.pos++;
    return tok;
  }

  private static leftBindingPower(tok: string | null): number {
    if (tok === null) return 0;
    if (tok === "?") return 10;
    if (tok === "==" || tok === ">" || tok === "<") return 20;
    if (tok === "+" || tok === "-") return 30;
    if (tok === "*" || tok === "/") return 40;
    if (tok === "^") return 50;
    return 0;
  }

  private parseNud(tok: string): PrattAstNode {
    if (/^[0-9]+(?:\.[0-9]+)?$/.test(tok)) {
      return { kind: "literal", value: Number(tok) };
    }
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tok)) {
      return { kind: "ident", name: tok };
    }
    if (tok === "-" || tok === "!") {
      const operand = this.parseExpression(60);
      return { kind: "unary", op: tok, operand };
    }
    if (tok === "(") {
      const inner = this.parseExpression(0);
      this.consume(")");
      return inner;
    }
    throw new Error(`PRATT_INVALID_PREFIX_TOKEN: '${tok}'`);
  }

  private parseLed(left: PrattAstNode, opTok: string): PrattAstNode {
    if (opTok === "?") {
      const thenBranch = this.parseExpression(0);
      this.consume(":");
      const elseBranch = this.parseExpression(9); // Right-associative ternary
      return { kind: "ternary", cond: left, thenBranch, elseBranch };
    }

    const lbp = PrattTopDownOperatorPrecedenceParser.leftBindingPower(opTok);
    // Right-associative exponentiation '^' uses rbp = lbp - 1
    const rbp = opTok === "^" ? lbp - 1 : lbp;
    const right = this.parseExpression(rbp);
    return { kind: "binary", op: opTok, left, right };
  }

  private parseExpression(minBindingPower: number): PrattAstNode {
    const firstTok = this.consume();
    let left = this.parseNud(firstTok);

    while (
      PrattTopDownOperatorPrecedenceParser.leftBindingPower(this.peek()) > minBindingPower
    ) {
      const opTok = this.consume();
      left = this.parseLed(left, opTok);
    }

    return left;
  }

  public parse(source: string): PrattAstNode {
    const regex = /\s*(==|[0-9]+(?:\.[0-9]+)?|[a-zA-Z_][a-zA-Z0-9_]*|[\+\-\*\/\^\(\)\?\:\!\>\<])\s*/g;
    this.tokens = [];
    this.pos = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(source)) !== null) {
      this.tokens.push(m[1]!);
    }
    return this.parseExpression(0);
  }

  public static evaluateAst(
    node: PrattAstNode,
    env: Record<string, number> = {}
  ): number {
    if (node.kind === "literal") return node.value;
    if (node.kind === "ident") return env[node.name] ?? 0;
    if (node.kind === "unary") {
      const v = PrattTopDownOperatorPrecedenceParser.evaluateAst(node.operand, env);
      return node.op === "-" ? -v : v === 0 ? 1 : 0;
    }
    if (node.kind === "ternary") {
      const c = PrattTopDownOperatorPrecedenceParser.evaluateAst(node.cond, env);
      return c !== 0
        ? PrattTopDownOperatorPrecedenceParser.evaluateAst(node.thenBranch, env)
        : PrattTopDownOperatorPrecedenceParser.evaluateAst(node.elseBranch, env);
    }
    const l = PrattTopDownOperatorPrecedenceParser.evaluateAst(node.left, env);
    const r = PrattTopDownOperatorPrecedenceParser.evaluateAst(node.right, env);
    if (node.op === "+") return l + r;
    if (node.op === "-") return l - r;
    if (node.op === "*") return l * r;
    if (node.op === "/") return l / (Math.abs(r) < 1e-12 ? 1e-12 : r);
    if (node.op === "^") return Math.pow(l, r);
    if (node.op === ">") return l > r ? 1 : 0;
    if (node.op === "<") return l < r ? 1 : 0;
    if (node.op === "==") return Math.abs(l - r) < 1e-9 ? 1 : 0;
    return 0;
  }
}
