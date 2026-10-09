import {
  computeCodeAgentSnapshotDigest,
  createCodeAgentWorkspaceRunner,
  type CodeAgentWorkspaceRunner
} from "@cosmora/tool-runtime";

/** Trusted operator configuration only. Never pass model/request arguments here. */
export function configuredCodeAgentExecutor(
  environment: NodeJS.ProcessEnv = process.env
): CodeAgentWorkspaceRunner {
  const image = environment.CODE_AGENT_SANDBOX_IMAGE;
  if (!image)
    return {
      run: (input) =>
        Promise.resolve({
          status: "unavailable",
          snapshotDigest: computeCodeAgentSnapshotDigest(input.files),
          exitCode: null,
          stdout: "",
          stderr: "CODE_AGENT_EXECUTOR_UNAVAILABLE",
          truncated: false,
          journal: [
            {
              at: new Date().toISOString(),
              event: "unavailable",
              detail: "Provision a pinned local OCI image and dedicated executor"
            }
          ]
        })
    };
  const runtime = environment.CODE_AGENT_SANDBOX_RUNTIME ?? "podman";
  if (runtime !== "podman" && runtime !== "docker")
    throw new Error("CODE_AGENT_UNSUPPORTED_SANDBOX");
  return createCodeAgentWorkspaceRunner({
    runtime,
    image,
    ...(environment.CODE_AGENT_SANDBOX_EXECUTABLE
      ? { executable: environment.CODE_AGENT_SANDBOX_EXECUTABLE }
      : {})
  });
}
