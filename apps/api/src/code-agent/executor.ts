import { readFileSync } from "node:fs";
import {
  computeCodeAgentSnapshotDigest,
  createCodeAgentHttpExecutor,
  type CodeAgentWorkspaceRunner
} from "@cosmora/tool-runtime";

/** API never opens an OCI socket or launches a host process. Operator-only origin and secret. */
export function configuredCodeAgentExecutor(
  environment: NodeJS.ProcessEnv = process.env
): CodeAgentWorkspaceRunner {
  const url = environment.CODE_AGENT_EXECUTOR_URL;
  const tokenFile = environment.CODE_AGENT_EXECUTOR_TOKEN_FILE;
  if (url && tokenFile)
    return createCodeAgentHttpExecutor({ url, token: readFileSync(tokenFile, "utf8").trim() });
  return {
    run: (input) =>
      Promise.resolve({
        status: "unavailable",
        snapshotDigest: computeCodeAgentSnapshotDigest(input.files),
        exitCode: null,
        stdout: "",
        stderr: "CODE_AGENT_EXECUTOR_UNAVAILABLE",
        truncated: false,
        cleanupVerified: false,
        journal: [
          {
            at: new Date().toISOString(),
            event: "unavailable",
            detail: "Configure the internal authenticated executor"
          }
        ]
      })
  };
}
