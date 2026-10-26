import { createHash } from "node:crypto";
import { APEX_CATALOG } from "./catalog.js";
import type {
  StageKernelExecutionInput,
  StageKernelExecutionResult,
  StageKernelProvider
} from "./stage1-autonomy/stage-kernel.js";

export class ApexAdapterUnavailable extends Error {
  readonly code = "APEX_ADAPTER_UNAVAILABLE";
  constructor(readonly featureId: string) {
    super(`APEX_ADAPTER_UNAVAILABLE:${featureId}`);
  }
}
export type BoundApexOperation = (input: StageKernelExecutionInput) => StageKernelExecutionResult;
/** Host-provided operations only. Feature IDs do not select built-in demonstrations. */
export class BoundApexKernel implements StageKernelProvider {
  constructor(
    private readonly stage: string,
    private readonly operations: ReadonlyMap<string, BoundApexOperation> = new Map()
  ) {}
  executeDomainOperation(input: StageKernelExecutionInput): StageKernelExecutionResult {
    const descriptor = APEX_CATALOG.find((item) => item.featureId === input.featureId);
    if (
      !descriptor ||
      descriptor.stage !== this.stage ||
      descriptor.operationCode !== input.operationCode
    )
      throw Error("APEX_OPERATION_MISMATCH");
    const operation = this.operations.get(input.featureId);
    if (!operation) throw new ApexAdapterUnavailable(input.featureId);
    const result = operation(structuredClone(input));
    if (result.domainOutcome.operationCode !== input.operationCode)
      throw Error("APEX_OPERATION_MISMATCH");
    return structuredClone(result);
  }
}
export const apexDigest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
