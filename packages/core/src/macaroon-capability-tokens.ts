import { createHmac, timingSafeEqual } from "node:crypto";

export interface MacaroonCaveat {
  predicate:
    | "owner_id"
    | "allowed_tool"
    | "expires_before_ms"
    | "read_only"
    | "max_budget_usd";
  value: string;
}

export interface MacaroonTokenPacket {
  identifier: string;
  location: string;
  caveats: MacaroonCaveat[];
  signatureHex: string;
}

export interface MacaroonVerificationContext {
  ownerId: string;
  requestedTool: string;
  isMutatingTool: boolean;
  nowMs: number;
  requestedCostUsd?: number;
}

function hmacSha256(keyHexOrBuf: Buffer | string, data: string): Buffer {
  const keyBuf =
    typeof keyHexOrBuf === "string" ? Buffer.from(keyHexOrBuf, "utf8") : keyHexOrBuf;
  return createHmac("sha256", keyBuf).update(data, "utf8").digest();
}

/**
 * Zero-Trust Caveat-Chained HMAC Macaroon Capability Token Engine.
 * Supports offline attenuation (adding restrictive caveats without the root key)
 * and cryptographic + contextual verification before sub-agent tool execution.
 */
export class MacaroonCapabilityEngine {
  /**
   * Mints a new root Macaroon capability token signed with `rootSecretKey`.
   */
  public static mintRootMacaroon(params: {
    rootSecretKey: string;
    identifier: string;
    location?: string;
    initialCaveats?: MacaroonCaveat[];
  }): MacaroonTokenPacket {
    const location = params.location ?? "kosmora://local-os-kernel";
    let sig = hmacSha256(params.rootSecretKey, params.identifier);

    const caveats = [...(params.initialCaveats ?? [])];
    for (const cav of caveats) {
      sig = hmacSha256(sig, `${cav.predicate}=${cav.value}`);
    }

    return {
      identifier: params.identifier,
      location,
      caveats,
      signatureHex: sig.toString("hex")
    };
  }

  /**
   * Attenuates an existing Macaroon token offline (without needing `rootSecretKey`)
   * by chaining an additional restrictive caveat onto the HMAC signature.
   */
  public static attenuateWithCaveat(
    token: MacaroonTokenPacket,
    newCaveat: MacaroonCaveat
  ): MacaroonTokenPacket {
    const prevSigBuf = Buffer.from(token.signatureHex, "hex");
    const nextSig = hmacSha256(prevSigBuf, `${newCaveat.predicate}=${newCaveat.value}`);

    return {
      identifier: token.identifier,
      location: token.location,
      caveats: [...token.caveats, newCaveat],
      signatureHex: nextSig.toString("hex")
    };
  }

  /**
   * Verifies both the chained HMAC cryptographic signature and all embedded contextual caveats.
   */
  public static verifyMacaroon(params: {
    rootSecretKey: string;
    token: MacaroonTokenPacket;
    context: MacaroonVerificationContext;
  }): { valid: boolean; failedReason: string | null } {
    // 1. Recompute chained HMAC from rootSecretKey + identifier + caveats
    let expectedSig = hmacSha256(params.rootSecretKey, params.token.identifier);
    for (const cav of params.token.caveats) {
      expectedSig = hmacSha256(expectedSig, `${cav.predicate}=${cav.value}`);
    }

    const providedSig = Buffer.from(params.token.signatureHex, "hex");
    if (
      providedSig.length !== expectedSig.length ||
      !timingSafeEqual(providedSig, expectedSig)
    ) {
      return { valid: false, failedReason: "MACAROON_SIGNATURE_MISMATCH_OR_TAMPERED_CAVEAT" };
    }

    // 2. Evaluate contextual caveats
    const ctx = params.context;
    const allowedTools = new Set<string>();

    for (const cav of params.token.caveats) {
      if (cav.predicate === "owner_id" && cav.value !== ctx.ownerId) {
        return {
          valid: false,
          failedReason: `CAVEAT_OWNER_MISMATCH: expected '${cav.value}', got '${ctx.ownerId}'`
        };
      }
      if (cav.predicate === "expires_before_ms" && ctx.nowMs > Number(cav.value)) {
        return {
          valid: false,
          failedReason: `CAVEAT_TOKEN_EXPIRED: nowMs=${ctx.nowMs} > ${cav.value}`
        };
      }
      if (cav.predicate === "read_only" && cav.value === "true" && ctx.isMutatingTool) {
        return {
          valid: false,
          failedReason: `CAVEAT_READ_ONLY_VIOLATION: tool '${ctx.requestedTool}' is mutating`
        };
      }
      if (
        cav.predicate === "max_budget_usd" &&
        (ctx.requestedCostUsd ?? 0) > Number(cav.value)
      ) {
        return {
          valid: false,
          failedReason: `CAVEAT_BUDGET_EXCEEDED: cost ${ctx.requestedCostUsd} > ${cav.value}`
        };
      }
      if (cav.predicate === "allowed_tool") {
        for (const t of cav.value.split(",").map((s) => s.trim()).filter(Boolean)) {
          allowedTools.add(t);
        }
      }
    }

    if (allowedTools.size > 0 && !allowedTools.has(ctx.requestedTool)) {
      return {
        valid: false,
        failedReason: `CAVEAT_TOOL_NOT_ALLOWED: '${ctx.requestedTool}' not in [${Array.from(allowedTools).join(", ")}]`
      };
    }

    return { valid: true, failedReason: null };
  }
}
