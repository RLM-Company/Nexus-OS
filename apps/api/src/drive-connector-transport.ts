import type { ConnectorTransport } from "@cosmora/tool-runtime";
import type { GoogleDriveRuntime } from "./cloud-storage/google-drive-runtime.js";

export type DriveRestoreInput = {
  archive_id: string;
  token: string;
  operation_id: string;
};

/**
 * Bind the descriptor-only Drive connector to the EXISTING Drive runtime.
 * No new OAuth grant, network path or token handling: the transport only calls
 * already-audited store/bundle methods with the actor id supplied by the
 * guarded runtime. Capabilities stay in the connector descriptor.
 */
export function driveConnectorTransports(runtime: GoogleDriveRuntime | undefined): {
  list_sources: ConnectorTransport;
  restore_backup: ConnectorTransport;
} {
  return {
    list_sources: {
      execute(_input, context) {
        if (!runtime?.bundleStore)
          return Promise.resolve({ state: "not_connected", items: [], files: [] });
        const sources = runtime.bundleStore.sources(context.actorId);
        return Promise.resolve({
          state: runtime.store.status(context.actorId)?.connection_id ? "connected" : "disconnected",
          items: sources.items,
          files: sources.files
        });
      }
    },
    restore_backup: {
      execute(input, context) {
        if (!runtime?.bundleStore || !runtime.bundles)
          return Promise.resolve({ status: "NOT_CONNECTED" });
        const value = input as Partial<DriveRestoreInput>;
        if (!value.archive_id || !value.token || !value.operation_id)
          return Promise.resolve({ status: "INVALID_INPUT" });
        return Promise.resolve(
          runtime.bundles.restore(
            context.actorId,
            value.archive_id,
            value.token,
            value.operation_id
          )
        );
      }
    }
  };
}
