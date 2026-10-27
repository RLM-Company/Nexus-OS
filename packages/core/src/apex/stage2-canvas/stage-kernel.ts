import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage2CanvasKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage2-canvas", operations);
  }
  static getShared(): Stage2CanvasKernel {
    return new Stage2CanvasKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
