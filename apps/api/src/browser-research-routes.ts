import type { KosworkBrowserResearchSessionStore } from "../../packages/db/src/browser-research-session-store.ts";
import type {
  BrowserResearchReportContract,
  BrowserSearchReceiptContract,
  BrowserSourceRecordContract,
  BrowserUtf16ExcerptContract
} from "../../packages/contracts/src/koswork-browser-research.ts";

export interface BrowserResearchRouteDependencies {
  store: KosworkBrowserResearchSessionStore;
}

/**
 * Isolated Route Registration & Controller for Koswork Browser Research
 * (`apps/api/src/browser-research-routes.ts`).
 */
export function createBrowserResearchRoutesController(deps: BrowserResearchRouteDependencies) {
  const { store } = deps;

  return {
    postSearchReceipt(input: BrowserSearchReceiptContract): BrowserSearchReceiptContract {
      return store.recordSearch(input);
    },

    postSourceVisit(input: BrowserSourceRecordContract): BrowserSourceRecordContract {
      return store.recordSourceVisit(input);
    },

    postExcerpt(
      input: Omit<BrowserUtf16ExcerptContract, "quoteSha256"> & { quoteSha256?: string }
    ): BrowserUtf16ExcerptContract {
      return store.recordExcerpt(input);
    },

    postVerifyClaim(params: {
      ownerId: string;
      claimId: string;
      claim: string;
      optionName?: string | null;
      criterion?: string | null;
      value?: string | number | null;
      sourceId?: string | null;
      excerptId?: string | null;
      candidateUrl?: string | null;
    }) {
      return store.verifyClaimLinkage(params);
    },

    postSaveReport(report: BrowserResearchReportContract): BrowserResearchReportContract {
      return store.saveResearchReport(report);
    },

    getReport(reportId: string, ownerId: string): BrowserResearchReportContract | null {
      return store.getResearchReport(reportId, ownerId);
    },

    deleteOwnerResearchData(ownerId: string) {
      return store.purgeOwnerBrowserResearchData(ownerId);
    }
  };
}
