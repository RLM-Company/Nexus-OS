export type EdgeCaseCategory =
  | "numeric_boundary"
  | "unicode_surrogate_and_encoding"
  | "concurrency_and_idempotency"
  | "sql_and_path_injection"
  | "temporal_and_clock_skew";

export interface AdversarialTestCase {
  id: string;
  category: EdgeCaseCategory;
  inputPayload: unknown;
  expectedInvariant: string;
}

/**
 * Adversarial Red-Team & Edge-Case Counterexample Generator.
 * Synthesizes deterministic boundary-value, Unicode surrogate, concurrency, and injection
 * counterexamples to stress-test generated schemas, functions, and workflows before deployment.
 */
export class AdversarialCounterexampleGenerator {
  public static generateSuiteForDomain(params: {
    targetComponent: string;
    hasNumericInputs?: boolean;
    hasStringOrPathInputs?: boolean;
    hasDatabaseWrites?: boolean;
    hasTemporalLogic?: boolean;
  }): AdversarialTestCase[] {
    const suite: AdversarialTestCase[] = [];

    if (params.hasNumericInputs !== false) {
      suite.push(
        {
          id: "adv_num_zero_and_neg",
          category: "numeric_boundary",
          inputPayload: { value: 0, negative: -0, minSafe: Number.MIN_SAFE_INTEGER },
          expectedInvariant: `${params.targetComponent} must reject or clamp non-positive and underflow values without NaN/Infinity.`
        },
        {
          id: "adv_num_max_safe_overflow",
          category: "numeric_boundary",
          inputPayload: { value: Number.MAX_SAFE_INTEGER, floatEpsilon: 1e-12 },
          expectedInvariant: `${params.targetComponent} must preserve precision up to MAX_SAFE_INTEGER without 32-bit bitwise truncation.`
        }
      );
    }

    if (params.hasStringOrPathInputs !== false) {
      suite.push(
        {
          id: "adv_str_utf16_surrogate_pair",
          category: "unicode_surrogate_and_encoding",
          inputPayload: "Koswork🚀🪐Текст\uD83D\uDE80",
          expectedInvariant: `${params.targetComponent} must never split UTF-16 high/low surrogate pairs across chunk boundaries.`
        },
        {
          id: "adv_path_traversal_and_null_byte",
          category: "sql_and_path_injection",
          inputPayload: "../../Windows/System32/cmd.exe\u0000.txt",
          expectedInvariant: `${params.targetComponent} must block path traversal ('../') and null-byte truncation before disk access.`
        }
      );
    }

    if (params.hasDatabaseWrites) {
      suite.push({
        id: "adv_concurrency_duplicate_request_id",
        category: "concurrency_and_idempotency",
        inputPayload: { clientRequestId: "req_idem_001", concurrentDuplicateCalls: 3 },
        expectedInvariant: `${params.targetComponent} must deduplicate repeated clientRequestId calls idempotently without double-charging or duplicate rows.`
      });
    }

    if (params.hasTemporalLogic) {
      suite.push({
        id: "adv_clock_backward_skew",
        category: "temporal_and_clock_skew",
        inputPayload: { prevWallTimeMs: 1_762_000_500_000, nextWallTimeMs: 1_762_000_499_000 },
        expectedInvariant: `${params.targetComponent} must maintain monotonic logical ordering even when NTP wall clock steps backward by 1000ms.`
      });
    }

    return suite;
  }
}
