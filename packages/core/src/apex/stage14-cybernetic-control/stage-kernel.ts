import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage14CyberneticControlKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage14-cybernetic-control", operations);
  }
  static getShared(): Stage14CyberneticControlKernel {
    return new Stage14CyberneticControlKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
