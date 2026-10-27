import React from "react";
import {
  buildMissionControlViewModel,
  KosmoraMissionControlPanel,
  type MissionControlViewModel
} from "../mission-control.js";

export { buildMissionControlViewModel, KosmoraMissionControlPanel };
export type { MissionControlViewModel };

export default function KosmoraMissionsPage(): React.ReactElement {
  const vm = buildMissionControlViewModel({ mode: "waiting_for_review" });
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
      <KosmoraMissionControlPanel viewModel={vm} />
    </main>
  );
}
