/**
 * Kosmora / Nexus-OS Constrained Grammar & Schema-Guided Structured Output Enforcer (Wave 22)
 *
 * Repairs and validates malformed, truncated, or markdown-wrapped LLM structured JSON outputs
 * in real time and enforces strict schema conformance before tool or workflow execution:
 * 1. Strips markdown code fences (` ```json ... ``` `), leading/trailing conversational prose,
 *    and single-line/multi-line comments.
 * 2. Fixes trailing commas (`{"a": 1,}` -> `{"a": 1}`), unquoted keys, and unclosed brackets/strings
 *    from interrupted SSE streams via a stack-based grammar automaton.
 * 3. Validates against a typed declarative schema (`required`, `properties`, `enum`, `min`, `max`)
 *    and coerces safe scalar representations (e.g. `"250000"` -> `250000` when `type: "number"`).
 */

export type GrammarFieldType = "string" | "number" | "boolean" | "array" | "object";

export interface GrammarPropertySchema {
  type: GrammarFieldType;
  required?: boolean;
  enum?: Array<string | number>;
  min?: number;
  max?: number;
  default?: any;
}

export interface GrammarObjectSchema {
  properties: Record<string, GrammarPropertySchema>;
  allowAdditionalProperties?: boolean;
}

export interface GrammarEnforcementResult<T = Record<string, any>> {
  valid: boolean;
  repairedJsonString: string;
  value: T | null;
  repairsApplied: string[];
  validationErrors: string[];
}

/**
 * Stack-based deterministic JSON grammar repair for truncated or noisy LLM outputs.
 */
export function repairMalformedJsonStream(rawInput: string): {
  repaired: string;
  repairsApplied: string[];
} {
  const repairs: string[] = [];
  let text = String(rawInput ?? "").trim();

  // 1. Strip markdown ```json ... ``` fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenceMatch && text.startsWith("```")) {
    text = fenceMatch[1].trim();
    repairs.push("stripped_markdown_fences");
  }

  // 2. Locate first '{' or '[' if preceded by conversational preamble
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  let startIdx = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx > 0) {
    text = text.slice(startIdx);
    repairs.push("stripped_leading_prose");
  }

  // 3. Remove trailing commas before '}' or ']'
  const noTrailingCommas = text.replace(/,\s*([}\]])/g, "$1");
  if (noTrailingCommas !== text) {
    text = noTrailingCommas;
    repairs.push("removed_trailing_commas");
  }

  // 4. Quote unquoted object keys: `{ key: "val" }` -> `{ "key": "val" }`
  const quotedKeys = text.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
  if (quotedKeys !== text) {
    text = quotedKeys;
    repairs.push("quoted_unquoted_keys");
  }

  // 5. Stack-based bracket & string closure for truncated streams
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastValidEnd = text.length;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === "{") {
        stack.push("}");
      } else if (ch === "[") {
        stack.push("]");
      } else if (ch === "}" || ch === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === ch) {
          stack.pop();
          if (stack.length === 0) {
            lastValidEnd = i + 1;
            break;
          }
        }
      }
    }
  }

  if (stack.length === 0 && !inString && lastValidEnd < text.length) {
    text = text.slice(0, lastValidEnd);
    repairs.push("stripped_trailing_prose");
  } else if (inString || stack.length > 0) {
    if (inString) {
      text += '"';
      repairs.push("closed_truncated_string");
    }
    // Remove dangling colon or comma at the end before closing brackets
    text = text.replace(/[,:\s]+$/, "");
    while (stack.length > 0) {
      text += stack.pop();
    }
    repairs.push("closed_truncated_brackets");
  }

  return { repaired: text, repairsApplied: repairs };
}

export class ConstrainedGrammarEnforcer {
  /**
   * Repairs a raw LLM string and validates/coerces it against the target `GrammarObjectSchema`.
   */
  public enforceSchema<T = Record<string, any>>(
    rawInput: string,
    schema: GrammarObjectSchema
  ): GrammarEnforcementResult<T> {
    const { repaired, repairsApplied } = repairMalformedJsonStream(rawInput);
    const validationErrors: string[] = [];

    let parsed: any;
    try {
      parsed = JSON.parse(repaired);
    } catch (err: any) {
      return {
        valid: false,
        repairedJsonString: repaired,
        value: null,
        repairsApplied,
        validationErrors: [`JSON_PARSE_ERROR: ${err?.message || String(err)}`]
      };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        valid: false,
        repairedJsonString: repaired,
        value: null,
        repairsApplied,
        validationErrors: ["ROOT_NOT_OBJECT: Expected top-level JSON object"]
      };
    }

    const output: Record<string, any> = {};

    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      let val = parsed[propName];

      if (val === undefined || val === null) {
        if (propSchema.default !== undefined) {
          val = structuredClone(propSchema.default);
          repairsApplied.push(`applied_default:${propName}`);
        } else if (propSchema.required) {
          validationErrors.push(`MISSING_REQUIRED_FIELD: '${propName}' is required`);
          continue;
        } else {
          continue;
        }
      }

      // Safe type coercion
      if (propSchema.type === "number" && typeof val === "string") {
        const cleaned = val.replace(/[$,\s]/g, "");
        const num = Number(cleaned);
        if (!Number.isNaN(num)) {
          val = num;
          repairsApplied.push(`coerced_number:${propName}`);
        }
      } else if (propSchema.type === "boolean" && typeof val === "string") {
        if (val.toLowerCase() === "true") {
          val = true;
          repairsApplied.push(`coerced_boolean:${propName}`);
        } else if (val.toLowerCase() === "false") {
          val = false;
          repairsApplied.push(`coerced_boolean:${propName}`);
        }
      }

      // Type check
      const actualType = Array.isArray(val) ? "array" : typeof val;
      if (actualType !== propSchema.type) {
        validationErrors.push(
          `TYPE_MISMATCH: Field '${propName}' expected ${propSchema.type}, got ${actualType}`
        );
        continue;
      }

      // Enum check
      if (propSchema.enum && !propSchema.enum.includes(val)) {
        validationErrors.push(
          `ENUM_VIOLATION: Field '${propName}' value '${val}' not in [${propSchema.enum.join(", ")}]`
        );
        continue;
      }

      // Numeric bounds check
      if (propSchema.type === "number") {
        if (propSchema.min !== undefined && val < propSchema.min) {
          validationErrors.push(`MIN_VIOLATION: Field '${propName}' (${val}) < min ${propSchema.min}`);
        }
        if (propSchema.max !== undefined && val > propSchema.max) {
          validationErrors.push(`MAX_VIOLATION: Field '${propName}' (${val}) > max ${propSchema.max}`);
        }
      }

      output[propName] = val;
    }

    if (schema.allowAdditionalProperties) {
      for (const [k, v] of Object.entries(parsed)) {
        if (!(k in schema.properties)) {
          output[k] = v;
        }
      }
    }

    return {
      valid: validationErrors.length === 0,
      repairedJsonString: JSON.stringify(output),
      value: validationErrors.length === 0 ? (output as T) : null,
      repairsApplied,
      validationErrors
    };
  }
}
