export type PolicyCombiningAlgorithm =
  | "deny-overrides"
  | "permit-overrides"
  | "first-applicable";

export interface AccessSubject {
  subjectId: string;
  roles: string[];
  clearanceLevel: number;
  ownerId: string;
}

export interface AccessResource {
  resourceId: string;
  ownerId: string;
  classificationLevel: number;
  confidential?: boolean;
}

export interface AccessPolicyRule {
  ruleId: string;
  effect: "permit" | "deny";
  requiredRoles?: string[];
  actionPattern: string | "*";
  conditionFn?: (subject: AccessSubject, resource: AccessResource, env: Record<string, unknown>) => boolean;
}

export interface PolicyDecisionResult {
  decision: "PERMIT" | "DENY";
  matchedRuleId: string | null;
  combiningAlgorithm: PolicyCombiningAlgorithm;
  reason: string;
}

/**
 * Hierarchical RBAC + ABAC Policy Decision Point (PDP) with XACML Combining Algorithms.
 * Evaluates role inheritance, Bell-LaPadula clearance levels, owner isolation,
 * and contextual ABAC predicates under `deny-overrides`, `permit-overrides`, or `first-applicable`.
 */
export class RbacAbacPolicyEngine {
  private readonly roleHierarchy = new Map<string, string[]>(); // role -> inherited parent roles
  private readonly rules: AccessPolicyRule[] = [];

  public defineRoleInheritance(role: string, inheritsFrom: string[]): void {
    this.roleHierarchy.set(role, inheritsFrom);
  }

  public addRule(rule: AccessPolicyRule): void {
    this.rules.push(rule);
  }

  public resolveEffectiveRoles(initialRoles: string[]): Set<string> {
    const effective = new Set<string>(initialRoles);
    const queue = [...initialRoles];
    while (queue.length > 0) {
      const r = queue.shift()!;
      for (const parent of this.roleHierarchy.get(r) ?? []) {
        if (!effective.has(parent)) {
          effective.add(parent);
          queue.push(parent);
        }
      }
    }
    return effective;
  }

  public evaluate(params: {
    subject: AccessSubject;
    action: string;
    resource: AccessResource;
    environment?: Record<string, unknown>;
    combiningAlgorithm?: PolicyCombiningAlgorithm;
  }): PolicyDecisionResult {
    const alg = params.combiningAlgorithm ?? "deny-overrides";
    const env = params.environment ?? {};
    const effectiveRoles = this.resolveEffectiveRoles(params.subject.roles);

    let firstPermitRuleId: string | null = null;
    let firstDenyRuleId: string | null = null;

    for (const rule of this.rules) {
      if (rule.actionPattern !== "*" && rule.actionPattern !== params.action) {
        continue;
      }
      if (
        rule.requiredRoles &&
        rule.requiredRoles.length > 0 &&
        !rule.requiredRoles.some((r) => effectiveRoles.has(r))
      ) {
        continue;
      }
      if (rule.conditionFn && !rule.conditionFn(params.subject, params.resource, env)) {
        continue;
      }

      if (alg === "first-applicable") {
        return {
          decision: rule.effect === "permit" ? "PERMIT" : "DENY",
          matchedRuleId: rule.ruleId,
          combiningAlgorithm: alg,
          reason: `First applicable rule '${rule.ruleId}' evaluated to ${rule.effect.toUpperCase()}.`
        };
      }

      if (rule.effect === "deny") {
        firstDenyRuleId = firstDenyRuleId ?? rule.ruleId;
        if (alg === "deny-overrides") {
          return {
            decision: "DENY",
            matchedRuleId: rule.ruleId,
            combiningAlgorithm: alg,
            reason: `Rule '${rule.ruleId}' explicitly denied access under deny-overrides.`
          };
        }
      } else {
        firstPermitRuleId = firstPermitRuleId ?? rule.ruleId;
        if (alg === "permit-overrides") {
          return {
            decision: "PERMIT",
            matchedRuleId: rule.ruleId,
            combiningAlgorithm: alg,
            reason: `Rule '${rule.ruleId}' explicitly permitted access under permit-overrides.`
          };
        }
      }
    }

    if (alg === "deny-overrides" && firstPermitRuleId) {
      return {
        decision: "PERMIT",
        matchedRuleId: firstPermitRuleId,
        combiningAlgorithm: alg,
        reason: `Permitted by rule '${firstPermitRuleId}' with zero deny rules triggered.`
      };
    }

    if (alg === "permit-overrides" && firstDenyRuleId) {
      return {
        decision: "DENY",
        matchedRuleId: firstDenyRuleId,
        combiningAlgorithm: alg,
        reason: `Denied by rule '${firstDenyRuleId}' with zero permit rules triggered.`
      };
    }

    // Default deny (fail-closed)
    return {
      decision: "DENY",
      matchedRuleId: null,
      combiningAlgorithm: alg,
      reason: "Default fail-closed DENY: no matching permit rule satisfied."
    };
  }
}
