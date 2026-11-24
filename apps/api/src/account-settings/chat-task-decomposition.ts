import type { GeneralChatMessage, ModelMessage, ModelRequest } from "@cosmora/contracts";
import { estimateInputTokensUpperBound } from "@cosmora/core";
import { GatewayRunError, type ModelGateway } from "@cosmora/model-gateway";
import type { ServerConfig } from "@cosmora/config";

type Subject = Pick<GeneralChatMessage, "content" | "attachments">;
type Routes = ServerConfig["chatTaskSplitRoutes"];

const stepInstruction =
  "Work through [[step:N]] sections in order, sharing constraints and findings. " +
  "Return one concise result, with step headings when the requested format allows. " +
  "Omit internal markers and repeated brief text. Distinguish plans from verified actions.";
const referenceInstruction =
  " A [[shared:N]] line repeats the exact earlier line starting with [[shared:N]]=.";

const stepMarker = /^(\d{1,2})[.)][ \t]+\S/gmu;

function numberedStepCount(content: string): number {
  if (/\[\[(?:shared|step):|^[ \t]*(?:```|~~~|>)/m.test(content)) return 0;
  const steps = [...content.matchAll(stepMarker)];
  if (steps.length < 2 || steps.length > 8) return 0;
  if (!steps.every((step, index) => Number(step[1]) === index + 1)) return 0;
  return steps.length;
}

function reuseRepeatedLines(brief: string): string {
  const lines = brief.split("\n");
  const seen = new Map<string, number>();
  const references = new Map<string, string>();
  for (const [index, line] of lines.entries()) {
    if (Buffer.byteLength(line) < 128 || !/^\p{L}/u.test(line)) continue;
    const first = seen.get(line);
    if (first === undefined) {
      seen.set(line, index);
      continue;
    }
    const reference = references.get(line) ?? `[[shared:${references.size + 1}]]`;
    references.set(line, reference);
    lines[first] = `${reference}=${line}`;
    lines[index] = reference;
  }
  return lines.join("\n");
}

export function decomposeChatTask(
  request: ModelRequest,
  options: {
    subject: Subject;
    turbo: boolean;
    routes: Routes;
    gateway: Pick<ModelGateway, "assertRoute">;
  }
): ModelRequest {
  const { subject, turbo, routes, gateway } = options;
  if (subject.attachments?.length) return request;

  const stepCount = numberedStepCount(subject.content);
  if (!stepCount || (!turbo && (stepCount < 3 || subject.content.length < 600))) return request;

  const index = request.messages.findLastIndex((message) => message.role === "user");
  const user = request.messages[index];
  if (
    !user ||
    !user.content.endsWith(subject.content) ||
    request.messages.some((message) => message.images?.length)
  )
    return request;

  const prefix = user.content.slice(0, -subject.content.length);
  const compacted = reuseRepeatedLines(subject.content);
  const instruction = `The user brief has ${stepCount} tasks. ${stepInstruction}`;
  function build(brief: string, instruction: string): ModelRequest {
    const sections = brief.replace(
      stepMarker,
      (text, number: string) => `[[step:${number}]] ${text}`
    );
    const messages: ModelMessage[] = request.messages.map((message, messageIndex) =>
      messageIndex === index ? { ...message, content: prefix + sections } : message
    );
    messages.splice(1, 0, { role: "system", content: instruction });
    return {
      ...request,
      messages,
      routing: {
        ...request.routing,
        estimated_input_tokens: estimateInputTokensUpperBound(messages)
      }
    };
  }

  const full = build(subject.content, instruction);
  const compact = build(compacted, instruction + referenceInstruction);
  const result =
    compact.routing.estimated_input_tokens < full.routing.estimated_input_tokens &&
    compact.routing.estimated_input_tokens < request.routing.estimated_input_tokens
      ? compact
      : full;
  const route = routes?.[turbo ? "fast" : "large"];
  if (route) {
    const separator = route.indexOf(":");
    const candidate = {
      ...result,
      routing: {
        ...result.routing,
        preferred_provider: route.slice(0, separator),
        preferred_model_alias: route.slice(separator + 1)
      }
    };
    try {
      gateway.assertRoute(candidate);
      return candidate;
    } catch (error) {
      if (!(error instanceof GatewayRunError)) throw error;
    }
  }
  try {
    gateway.assertRoute(result);
    return result;
  } catch (error) {
    // The extra instruction may exceed the route's context or cost ceiling.
    if (!(error instanceof GatewayRunError)) throw error;
    return request;
  }
}
