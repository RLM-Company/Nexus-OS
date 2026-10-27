import React from "react";
import {
  buildEvaluationsViewModel,
  KosmoraEvaluationsPanel,
  type EvaluationsViewModel
} from "../evaluations.js";

export { buildEvaluationsViewModel, KosmoraEvaluationsPanel };
export type { EvaluationsViewModel };

export default function KosmoraEvaluationsPage(): React.ReactElement {
  const vm = buildEvaluationsViewModel({ mode: "active" });
  return (
    <main
      style={{
        backgroundColor: vm.theme.background_primary,
        color: vm.theme.text_primary,
        minHeight: "100vh",
        padding: "32px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
      }}
    >
      <KosmoraEvaluationsPanel viewModel={vm} />
    </main>
  );
}
