import React from "react";
import {
  buildPlaybooksViewModel,
  computeUiPlaybookPreview,
  KosmoraPlaybooksPanel,
  type PlaybooksViewModel
} from "../playbooks.js";

export {
  buildPlaybooksViewModel,
  computeUiPlaybookPreview,
  KosmoraPlaybooksPanel
};
export type { PlaybooksViewModel };

export default function KosmoraPlaybooksPage(): React.ReactElement {
  const vm = buildPlaybooksViewModel({ mode: "active" });
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
      <KosmoraPlaybooksPanel viewModel={vm} />
    </main>
  );
}
