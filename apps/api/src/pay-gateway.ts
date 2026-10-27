/**
 * Real provider integration. No mock transactions are used in production.
 * Secrets must be injected from the environment or a secret manager.
 */
export interface ProviderPayment {
  id: string;
  status: "pending" | "succeeded" | "canceled";
  paid: boolean;
  amountMinor: number;
  currency: "RUB";
  confirmationUrl?: string;
}

export interface PayGateway {
  createPayment(input: { orderId: string; amountMinor: number }): Promise<ProviderPayment>;
  getPayment(paymentId: string): Promise<ProviderPayment>;
}

const parseAmount = (value: unknown): number => {
  if (typeof value !== "string" || !/^\d{1,7}\.\d{2}$/.test(value)) {
    throw new Error("Invalid provider payment amount");
  }
  const [rubles, kopecks] = value.split(".");
  const amountMinor = Number(rubles) * 100 + Number(kopecks);
  if (!Number.isSafeInteger(amountMinor)) throw new Error("Invalid provider payment amount");
  return amountMinor;
};

const parsePayment = (value: unknown): ProviderPayment => {
  if (typeof value !== "object" || value === null) throw new Error("Malformed provider response");
  const row = value as Record<string, unknown>;
  const amount = row.amount as Record<string, unknown> | null;
  const confirmation = row.confirmation as Record<string, unknown> | null;
  if (
    typeof row.id !== "string" || row.id.length > 128 || row.id.length === 0 ||
    !amount || amount.currency !== "RUB" ||
    typeof row.paid !== "boolean" ||
    !["pending", "waiting_for_capture", "succeeded", "canceled"].includes(String(row.status))
  ) throw new Error("Malformed provider payment evidence");
  const status: ProviderPayment["status"] =
    row.status === "waiting_for_capture" ? "pending" : row.status as ProviderPayment["status"];
  const url = confirmation?.confirmation_url;
  if (url !== undefined &&
    (typeof url !== "string" || !url.startsWith("https://") || url.length > 2048)
  ) throw new Error("Provider did not return a secure checkout link");
  return {
    id: row.id,
    status,
    paid: row.paid,
    amountMinor: parseAmount(amount.value),
    currency: "RUB",
    ...(typeof url === "string" ? { confirmationUrl: url } : {})
  };
};

export class YooKassaGateway implements PayGateway {
  private readonly authorization: string;
  private readonly returnUrl: string;

  constructor(shopId: string, secretKey: string, returnUrl: string) {
    if (!shopId || !secretKey || !/^https:\/\//.test(returnUrl)) {
      throw new Error("YooKassa gateway requires shop id, secret and HTTPS return URL");
    }
    const parsed = new URL(returnUrl);
    if (parsed.username || parsed.password) throw new Error("Invalid return URL");
    this.authorization = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString("base64")}`;
    this.returnUrl = returnUrl;
  }

  async createPayment(input: { orderId: string; amountMinor: number }): Promise<ProviderPayment> {
    if (!/^[0-9a-f-]{36}$/.test(input.orderId) ||
        !Number.isSafeInteger(input.amountMinor) ||
        input.amountMinor < 100 || input.amountMinor > 100_000_000) {
      throw new Error("Invalid payment request");
    }
    return this.call("/payments", "POST", {
      amount: { value: (input.amountMinor / 100).toFixed(2), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: this.returnUrl },
      description: `Kosmora order ${input.orderId}`,
      metadata: { kosmora_order_id: input.orderId }
    }, input.orderId);
  }

  async getPayment(paymentId: string): Promise<ProviderPayment> {
    if (!/^[a-zA-Z0-9-]{1,128}$/.test(paymentId)) throw new Error("Invalid payment id");
    return this.call(`/payments/${encodeURIComponent(paymentId)}`, "GET");
  }

  private async call(
    route: string, method: "GET" | "POST", body?: Record<string, unknown>, idempotencyKey?: string
  ): Promise<ProviderPayment> {
    const response = await fetch(`https://api.yookassa.ru/v3${route}`, {
      method,
      headers: {
        authorization: this.authorization,
        "content-type": "application/json",
        ...(idempotencyKey ? { "Idempotence-Key": idempotencyKey } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000)
    });
    // Do not include provider response bodies in thrown errors: may contain private data.
    if (!response.ok) throw new Error(`Payment provider request failed (HTTP ${response.status})`);
    return parsePayment(await response.json());
  }
}
