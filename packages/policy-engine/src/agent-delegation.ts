import type { AgentBlueprint } from "@cosmora/contracts";

export interface AgentDelegationValidation {
  allowed: boolean;
  reasons: string[];
}

const missing = (parent: readonly string[], child: readonly string[]): string[] =>
  child.filter((value) => !parent.includes(value));

export function validateAgentDelegation(
  parent: AgentBlueprint,
  child: AgentBlueprint,
  evaluatedAt: string
): AgentDelegationValidation {
  const reasons: string[] = [];
  const now = Date.parse(evaluatedAt);
  const parentExpiry = Date.parse(parent.grant.valid_until);
  const childExpiry = Date.parse(child.grant.valid_until);

  if (parent.owner_id !== child.owner_id) reasons.push("Delegation cannot cross owner boundary.");
  if (
    parent.project_id !== child.project_id ||
    parent.grant.project_id !== parent.project_id ||
    child.grant.project_id !== child.project_id
  ) {
    reasons.push("Delegation cannot cross or misbind the project boundary.");
  }

  for (const [label, expanded] of [
    ["capabilities", missing(parent.grant.capability_ids, child.grant.capability_ids)],
    ["tools", missing(parent.grant.tool_ids, child.grant.tool_ids)],
    ["data scopes", missing(parent.grant.data_scope_ids, child.grant.data_scope_ids)],
    ["objects", missing(parent.grant.object_ids, child.grant.object_ids)]
  ] as const) {
    if (expanded.length > 0) reasons.push(`Child grant expands ${label}: ${expanded.join(", ")}.`);
  }

  if (parent.grant.budget.currency !== child.grant.budget.currency) {
    reasons.push("Child grant changes the budget currency.");
  }
  if (child.grant.budget.money_minor > parent.grant.budget.money_minor) {
    reasons.push("Child grant expands the money budget.");
  }
  if (child.grant.budget.tokens > parent.grant.budget.tokens) {
    reasons.push("Child grant expands the token budget.");
  }
  if (child.grant.budget.operations > parent.grant.budget.operations) {
    reasons.push("Child grant expands the operation budget.");
  }

  if (parent.grant.delegation_depth === 0) {
    reasons.push("Parent grant forbids further delegation.");
  } else if (child.grant.delegation_depth >= parent.grant.delegation_depth) {
    reasons.push("Child delegation depth must be lower than its parent.");
  }

  if (
    !Number.isFinite(now) ||
    !Number.isFinite(parentExpiry) ||
    !Number.isFinite(childExpiry) ||
    childExpiry <= now ||
    childExpiry > parentExpiry
  ) {
    reasons.push("Child expiry must be valid, future, and no later than its parent.");
  }

  return { allowed: reasons.length === 0, reasons };
}
