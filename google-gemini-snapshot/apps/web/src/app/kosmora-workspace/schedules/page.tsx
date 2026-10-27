import React from "react";
import {
  buildSchedulesViewModel,
  KosmoraSchedulesPanel,
  type SchedulesViewModel
} from "../schedules.js";

export { buildSchedulesViewModel, KosmoraSchedulesPanel };
export type { SchedulesViewModel };

export default function KosmoraSchedulesPage(): React.ReactElement {
  const vm = buildSchedulesViewModel({ mode: "active" });
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
      <KosmoraSchedulesPanel viewModel={vm} />
    </main>
  );
}
