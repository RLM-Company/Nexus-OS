export interface PidControlStepResult {
  controlOutput: number;
  error: number;
  proportionalTerm: number;
  integralTerm: number;
  derivativeTerm: number;
  saturated: boolean;
}

/**
 * Industrial Closed-Loop PID Autoscaler & Concurrency Controller with Integral Anti-Windup
 * and Low-Pass Derivative Filtering.
 */
export class PidAntiWindupController {
  public readonly kp: number;
  public readonly ki: number;
  public readonly kd: number;
  public readonly minOutput: number;
  public readonly maxOutput: number;

  private integralAccumulator = 0;
  private prevError: number | null = null;
  private filteredDerivative = 0;

  constructor(params: {
    kp: number;
    ki: number;
    kd: number;
    minOutput: number;
    maxOutput: number;
  }) {
    this.kp = params.kp;
    this.ki = params.ki;
    this.kd = params.kd;
    this.minOutput = params.minOutput;
    this.maxOutput = params.maxOutput;
  }

  public computeControl(setpoint: number, measuredValue: number, dtSec = 1.0): PidControlStepResult {
    const safeDt = Math.max(1e-3, dtSec);
    const error = setpoint - measuredValue;

    const pTerm = this.kp * error;

    const rawDerivative =
      this.prevError === null ? 0 : (error - this.prevError) / safeDt;
    // Low-pass filter on derivative to prevent high-frequency derivative kick
    this.filteredDerivative = 0.7 * rawDerivative + 0.3 * this.filteredDerivative;
    const dTerm = this.kd * this.filteredDerivative;

    const candidateIntegral = this.integralAccumulator + error * safeDt;
    const unclamped = pTerm + this.ki * candidateIntegral + dTerm;

    let saturated = false;
    let controlOutput = unclamped;

    if (unclamped > this.maxOutput) {
      controlOutput = this.maxOutput;
      saturated = true;
      // Anti-windup: only integrate if error pushes back below saturation
      if (error < 0) {
        this.integralAccumulator = candidateIntegral;
      }
    } else if (unclamped < this.minOutput) {
      controlOutput = this.minOutput;
      saturated = true;
      if (error > 0) {
        this.integralAccumulator = candidateIntegral;
      }
    } else {
      this.integralAccumulator = candidateIntegral;
    }

    this.prevError = error;

    return {
      controlOutput: Number(controlOutput.toFixed(6)),
      error: Number(error.toFixed(6)),
      proportionalTerm: Number(pTerm.toFixed(6)),
      integralTerm: Number((this.ki * this.integralAccumulator).toFixed(6)),
      derivativeTerm: Number(dTerm.toFixed(6)),
      saturated
    };
  }
}
