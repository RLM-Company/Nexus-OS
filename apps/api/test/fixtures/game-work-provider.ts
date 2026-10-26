import { MockProviderAdapter } from "@cosmora/model-gateway";
import { GAME_FIXTURES } from "./game-packages.js";
import type { GameGenre } from "@cosmora/contracts/game-package";
import { GAME_SOURCE_FILES } from "./game-source.js";

/** Local browser transport fixture. Never installed by the production server. */
export function installGameWorkFixture() {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const previous = MockProviderAdapter.prototype.stream;
  MockProviderAdapter.prototype.stream = async function* (request, signal) {
    const sourceProject = request.messages.some((message) =>
      message.content.includes("E2E_GAME_SOURCE")
    );
    const genre = request.messages
      .map((message) => message.content)
      .join("\n")
      .match(/E2E_GAME_WORK_(arcade|memory|quiz)/)?.[1] as GameGenre | undefined;
    if ((!genre && !sourceProject) || !request.task_type.startsWith("manager_work_")) {
      yield* previous.call(this, request, signal);
      return;
    }
    if (signal.aborted) throw Error("Aborted game fixture");
    const game = GAME_FIXTURES[genre ?? "arcade"];
    const value =
      request.task_type === "manager_work_plan"
        ? {
            summary: sourceProject ? "Звёздный пилот" : game.title,
            instructions: "Create game.json for the requested built-in mechanic",
            complexity: "simple",
            needs_critic: false,
            requires_external_actions: false
          }
        : request.task_type === "manager_work_draft"
          ? sourceProject
            ? { files: GAME_SOURCE_FILES }
            : { files: [{ name: "game.json", content: JSON.stringify(game, null, 2) }] }
          : { verdict: "PASS", reason: "Synthetic game fixture" };
    yield { type: "text.delta", delta: JSON.stringify(value) };
    yield {
      type: "response.completed",
      provider: this.id,
      model: this.modelId,
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 100 }
    };
  };
}
