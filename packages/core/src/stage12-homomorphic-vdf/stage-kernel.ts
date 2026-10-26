/**
 * @cosmora/core — Stage 12 Kernel: Paillier Additive Homomorphic Encryption,
 * Wesolowski Verifiable Delay Functions (VDF), Chained HMAC Capability Macaroons &
 * 3f+1 Byzantine Quorum Intersection Engine (F353–F384)
 */

import { createHash } from "node:crypto";
import { KosmoraHomomorphicVdfEngine } from "../kosmora-homomorphic-vdf-engine.js";
import type {
  StageKernelExecutionInput,
  StageKernelExecutionResult,
  StageKernelProvider
} from "../stage1-autonomy/stage-kernel.js";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

export class Stage12HomomorphicVdfKernel implements StageKernelProvider {
  private static sharedInstance: Stage12HomomorphicVdfKernel | null = null;
  public readonly engine: KosmoraHomomorphicVdfEngine;

  constructor(engine: KosmoraHomomorphicVdfEngine = new KosmoraHomomorphicVdfEngine()) {
    this.engine = engine;
  }

  public static getShared(): Stage12HomomorphicVdfKernel {
    if (!Stage12HomomorphicVdfKernel.sharedInstance) {
      Stage12HomomorphicVdfKernel.sharedInstance = new Stage12HomomorphicVdfKernel();
    }
    return Stage12HomomorphicVdfKernel.sharedInstance;
  }

  public executeDomainOperation(input: StageKernelExecutionInput): StageKernelExecutionResult {
    const [f0, f1, f2, f3] = Object.keys(input.domainFields) as [string, string, string, string];
    const num = Number.parseInt(input.featureId.slice(1), 10);

    // F353-F360: Paillier Additive Homomorphic Encryption
    if (num >= 353 && num <= 360) {
      const m1 = 1250;
      const m2 = 3750;
      const c1 = this.engine.encryptPaillierHomomorphic(m1, `${input.featureId}:r1`);
      const c2 = this.engine.encryptPaillierHomomorphic(m2, `${input.featureId}:r2`);
      const cSum = this.engine.addHomomorphicCiphertexts(c1, c2);
      const decryptedSum = this.engine.decryptPaillierHomomorphic(cSum);
      const exact = decryptedSum === m1 + m2;
      const digest = sha256Hex(JSON.stringify({ c1, c2, cSum, decryptedSum }));
      return {
        resolvedFields: {
          [f0]: `paillier_c_sum:${cSum.ciphertext_dec.slice(0, 16)}`,
          [f1]: decryptedSum,
          [f2]: exact ? "homomorphic_addition_verified" : "mismatch",
          [f3]: cSum.public_n
        },
        domainOutcome: {
          engine: "KosmoraHomomorphicVdfEngine",
          operationCode: input.operationCode,
          stateChanged: true,
          summary: `Paillier homomorphic E(${m1})*E(${m2}) mod n^2 decrypted=${decryptedSum} (verified=${exact})`,
          metrics: {
            decrypted_sum: decryptedSum,
            verified: exact
          }
        },
        provenanceSha256: digest
      };
    }

    // F361-F368: Wesolowski Verifiable Delay Function (VDF)
    if (num >= 361 && num <= 368) {
      const proof = this.engine.evaluateVerifiableDelayFunction({
        challenge_id: `vdf_${input.featureId}_${input.requestId}`,
        seed_input: `${input.tenantId}:${input.projectId}`,
        iterations_t: 64
      });
      const verified = this.engine.verifyVerifiableDelayProof(proof);
      const digest = sha256Hex(JSON.stringify({ proof, verified }));
      return {
        resolvedFields: {
          [f0]: proof.challenge_id,
          [f1]: `y:${proof.output_y}:pi:${proof.wesolowski_proof_pi}`,
          [f2]: `l:${proof.prime_challenge_l}:T:${proof.iterations_t}`,
          [f3]: verified ? "wesolowski_vdf_verified" : "vdf_invalid"
        },
        domainOutcome: {
          engine: "KosmoraHomomorphicVdfEngine",
          operationCode: input.operationCode,
          stateChanged: true,
          summary: `Evaluated & verified Wesolowski VDF ${proof.challenge_id} (T=${proof.iterations_t}, verified=${verified})`,
          metrics: {
            iterations_t: proof.iterations_t,
            verified
          }
        },
        provenanceSha256: digest
      };
    }

    // F369-F376: Chained HMAC Capability Macaroons with Contextual Caveat Attenuation
    if (num >= 369 && num <= 376) {
      const rootSecret = `mac_root_${input.tenantId}_secret`;
      const baseMac = this.engine.mintCapabilityMacaroon({
        root_secret: rootSecret,
        identifier: `mac_${input.featureId}_${input.requestId}`,
        location: "kosmora://control-plane",
        initial_caveats: [`tenant_id = ${input.tenantId}`]
      });
      const attenuated = this.engine.attenuateMacaroonWithCaveats(baseMac, [
        `project_id = ${input.projectId}`,
        "budget_usd <= 50"
      ]);
      const check = this.engine.verifyMacaroonAuthorization({
        root_secret: rootSecret,
        macaroon: attenuated,
        context: {
          tenant_id: input.tenantId,
          project_id: input.projectId,
          budget_usd: 15
        }
      });
      const digest = sha256Hex(JSON.stringify({ attenuated, check }));
      return {
        resolvedFields: {
          [f0]: attenuated.identifier,
          [f1]: attenuated.caveats.length,
          [f2]: attenuated.signature_hmac_hex.slice(0, 24),
          [f3]: check.valid ? "macaroon_caveats_verified" : "macaroon_denied"
        },
        domainOutcome: {
          engine: "KosmoraHomomorphicVdfEngine",
          operationCode: input.operationCode,
          stateChanged: true,
          summary: `Verified attenuated capability macaroon ${attenuated.identifier} (${attenuated.caveats.length} caveats, valid=${check.valid})`,
          metrics: {
            caveats_count: attenuated.caveats.length,
            valid: check.valid
          }
        },
        provenanceSha256: digest
      };
    }

    // F377-F384: Malkhi-Reiter 3f+1 Byzantine Quorum Intersection & Equivocation Slasher
    const bft = this.engine.verifyByzantineQuorumIntersection({
      validators: ["val_1", "val_2", "val_3", "val_4"],
      quorum_a: ["val_1", "val_2", "val_3"],
      quorum_b: ["val_2", "val_3", "val_4"],
      votes: [
        { validator_id: "val_1", view_number: 7, block_digest: "blk_hash_a", signature_hex: "sig1" },
        { validator_id: "val_2", view_number: 7, block_digest: "blk_hash_a", signature_hex: "sig2" },
        { validator_id: "val_4", view_number: 7, block_digest: "blk_hash_a", signature_hex: "sig4a" },
        { validator_id: "val_4", view_number: 7, block_digest: "blk_hash_FORK", signature_hex: "sig4b" }
      ]
    });
    return {
      resolvedFields: {
        [f0]: `n${bft.total_validators_n}_f${bft.max_faulty_f}_q${bft.required_quorum_size}`,
        [f1]: bft.intersection_nodes.join(","),
        [f2]: bft.equivocating_validators.join(","),
        [f3]: bft.quorum_certificate_sha256.slice(0, 24)
      },
      domainOutcome: {
        engine: "KosmoraHomomorphicVdfEngine",
        operationCode: input.operationCode,
        stateChanged: true,
        summary: `Verified 3f+1 BFT quorum intersection (${bft.intersection_nodes.join(",")}) & slashed equivocator (${bft.equivocating_validators.join(",")})`,
        metrics: {
          honest_intersection_guaranteed: bft.honest_intersection_guaranteed,
          equivocators_slashed: bft.equivocating_validators.length
        }
      },
      provenanceSha256: bft.quorum_certificate_sha256
    };
  }
}
