import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage12HomomorphicVdfKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage12-homomorphic-vdf", operations);
  }
  static getShared(): Stage12HomomorphicVdfKernel {
    return new Stage12HomomorphicVdfKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
