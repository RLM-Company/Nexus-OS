import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage8FinOpsKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage8-finops-compliance", operations);
  }
  static getShared(): Stage8FinOpsKernel {
    return new Stage8FinOpsKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
