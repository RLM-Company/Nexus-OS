import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export class Stage9QuantumZkKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage9-quantum-zk", operations);
  }
  static getShared(): Stage9QuantumZkKernel {
    return new Stage9QuantumZkKernel();
  }
}
export * from "../stage1-autonomy/stage-kernel.js";
