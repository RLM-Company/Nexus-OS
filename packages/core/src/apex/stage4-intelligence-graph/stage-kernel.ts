import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage4GraphKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage4-intelligence-graph", operations);
  }
  static getShared(): Stage4GraphKernel {
    return new Stage4GraphKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
