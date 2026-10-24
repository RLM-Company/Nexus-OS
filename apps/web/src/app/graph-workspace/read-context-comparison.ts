import type {
  IntelligenceGraphContextPreview,
  IntelligenceGraphContextState,
  IntelligenceGraphModelContext
} from "@cosmora/contracts";
import { isIntelligenceGraphSavedContextStatus } from "@cosmora/contracts/intelligence-graph-context";
import { compareGraphContexts } from "./context-comparison";

type Preview = IntelligenceGraphContextPreview & { state: IntelligenceGraphContextState };
/** readPreview must validate the requested graph/revision/query and the payload SHA-256. */
export async function readContextComparison(
  proposed: Preview,
  readStatus: () => Promise<unknown>,
  readPreview: (query: string, revision: number) => Promise<Preview>
) {
  const status = await readStatus();
  if (!isIntelligenceGraphSavedContextStatus(status) || !status.saved)
    throw new Error("Сохранённый снимок отсутствует или не подтверждён. Проверьте актуальность.");
  if (
    status.materials_version !== proposed.state.materials_version ||
    status.current_sha256 !== proposed.state.current_sha256
  )
    throw new Error(
      "Материалы проекта изменились. Нажмите «Проверить сохранение» перед сравнением."
    );
  const saved = await readPreview(status.saved.query, status.saved.revision);
  if (
    saved.sha256 !== status.current_sha256 ||
    saved.state.materials_version !== status.materials_version ||
    saved.state.current_sha256 !== status.current_sha256
  )
    throw new Error("Сохранённый снимок изменился во время сравнения. Проверьте сохранение.");
  const previous = JSON.parse(saved.attachment.content) as IntelligenceGraphModelContext;
  const next = JSON.parse(proposed.attachment.content) as IntelligenceGraphModelContext;
  return { changes: compareGraphContexts(previous, next), savedRevision: previous.graph.revision };
}
