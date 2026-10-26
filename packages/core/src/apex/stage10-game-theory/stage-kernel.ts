import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage10GameTheoryKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage10-game-theory", operations);
  }
  static getShared(): Stage10GameTheoryKernel {
    return new Stage10GameTheoryKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
