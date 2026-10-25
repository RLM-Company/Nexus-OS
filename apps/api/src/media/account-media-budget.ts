import type { AccountStore } from "../account-settings/account-store.js";
import type { OwnerMediaBudget, CanonicalMediaUsage, MediaKind } from "./media-budget.js";
import { canonicalUsage } from "./media-budget.js";
type Row = {
  owner_id: string;
  kind: string;
  model_id: string;
  hold_id: string;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
};
/** One canonical account ledger; unknown provider usage remains reserved, never zero-priced. */
export class AccountMediaBudget implements OwnerMediaBudget {
  constructor(
    private readonly account: AccountStore,
    private readonly provider: string
  ) {}
  reserve(input: {
    ownerId: string;
    operationId: string;
    kind: MediaKind;
    model: string;
  }): Promise<void> {
    const prior = this.account.sqlite
      .prepare("SELECT * FROM kosmora_media_usage WHERE operation_id=?")
      .get(input.operationId) as Row | undefined;
    if (prior) {
      if (
        prior.owner_id !== input.ownerId ||
        prior.kind !== input.kind ||
        prior.model_id !== input.model ||
        prior.status !== "reserved"
      )
        throw Error("MEDIA_RESERVATION_CONFLICT");
      return Promise.resolve();
    }
    // A conservative admission reservation, not a report of consumed tokens or money.
    const reserved = 200000;
    const hold = this.account.reserve(
      input.ownerId,
      `media:${input.operationId}`,
      1,
      reserved,
      "main",
      "",
      this.provider,
      input.model
    );
    this.account.sqlite
      .prepare(
        "INSERT INTO kosmora_media_usage(operation_id,owner_id,kind,provider_id,model_id,hold_id,status,reserved_tokens,created_at) VALUES(?,?,?,?,?,?,'reserved',?,?)"
      )
      .run(
        input.operationId,
        input.ownerId,
        input.kind,
        this.provider,
        input.model,
        hold,
        reserved,
        new Date().toISOString()
      );
    return Promise.resolve();
  }
  reconcile(input: {
    ownerId: string;
    operationId: string;
    usage: CanonicalMediaUsage;
  }): Promise<void> {
    if (!canonicalUsage(input.usage)) throw Error("MEDIA_USAGE_INVALID");
    const row = this.owned(input.ownerId, input.operationId);
    if (row.status === "committed") {
      if (
        row.input_tokens !== input.usage.input_tokens ||
        row.output_tokens !== input.usage.output_tokens
      )
        throw Error("MEDIA_USAGE_CONFLICT");
      return Promise.resolve();
    }
    if (row.status !== "reserved" && row.status !== "uncertain")
      throw Error("MEDIA_USAGE_CONFLICT");
    this.account.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.account.sqlite
        .prepare(
          "UPDATE kosmora_media_usage SET status='committed',input_tokens=?,output_tokens=? WHERE operation_id=? AND owner_id=?"
        )
        .run(input.usage.input_tokens, input.usage.output_tokens, input.operationId, input.ownerId);
      this.account.sqlite
        .prepare("DELETE FROM kosmora_usage_holds WHERE id=? AND owner_id=?")
        .run(row.hold_id, input.ownerId);
      this.account.sqlite.exec("COMMIT");
    } catch (error) {
      this.account.sqlite.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }
  uncertain(input: { ownerId: string; operationId: string; reason: string }): Promise<void> {
    const row = this.owned(input.ownerId, input.operationId);
    if (row.status === "committed" || row.status === "cancelled") return Promise.resolve();
    if (input.reason === "RESERVED_BEFORE_DISPATCH") {
      this.account.sqlite.exec("BEGIN IMMEDIATE");
      try {
        this.account.releaseBeforeDispatch(row.hold_id);
        this.account.sqlite
          .prepare(
            "UPDATE kosmora_media_usage SET status='cancelled' WHERE operation_id=? AND owner_id=?"
          )
          .run(input.operationId, input.ownerId);
        this.account.sqlite.exec("COMMIT");
      } catch (error) {
        this.account.sqlite.exec("ROLLBACK");
        throw error;
      }
    } else {
      this.account.uncertainReservation(row.hold_id, "main");
      this.account.sqlite
        .prepare(
          "UPDATE kosmora_media_usage SET status='uncertain' WHERE operation_id=? AND owner_id=? AND status='reserved'"
        )
        .run(input.operationId, input.ownerId);
    }
    return Promise.resolve();
  }
  private owned(owner: string, id: string): Row {
    const row = this.account.sqlite
      .prepare("SELECT * FROM kosmora_media_usage WHERE operation_id=? AND owner_id=?")
      .get(id, owner) as Row | undefined;
    if (!row) throw Error("MEDIA_RESERVATION_MISSING");
    return row;
  }
}
