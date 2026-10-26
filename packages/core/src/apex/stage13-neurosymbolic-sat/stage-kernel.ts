import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage13NeurosymbolicSatKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage13-neurosymbolic-sat", operations);
  }
  static getShared(): Stage13NeurosymbolicSatKernel {
    return new Stage13NeurosymbolicSatKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
