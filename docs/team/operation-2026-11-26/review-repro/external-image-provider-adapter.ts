import type {
  ExternalMediaDownloadedArtifact,
  ExternalMediaProviderAdapter,
  ExternalMediaProviderStatus,
  ExternalMediaStartRequest
} from "./external-music-provider-adapter.js";

export class ExternalImageProviderAdapter implements ExternalMediaProviderAdapter {
  public readonly providerId = "external-image-provider";
  public readonly mode = "image" as const;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async startGeneration(
    req: ExternalMediaStartRequest
  ): Promise<ExternalMediaProviderStatus> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "idempotency-key": req.idempotencyKey
      },
      body: JSON.stringify({
        prompt: req.prompt,
        aspect_ratio: req.parameters.aspectRatio ?? "1:1",
        style: req.parameters.style ?? "editorial",
        references: req.references
      })
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      return {
        providerJobId: String(data.id ?? data.providerJobId ?? ""),
        status: "failed",
        errorCode: String(
          data.error?.code ?? data.errorCode ?? `IMAGE_PROVIDER_HTTP_${res.status}`
        ),
        errorMessage: String(
          data.error?.message ??
            data.errorMessage ??
            `Ошибка провайдера изображений (HTTP ${res.status}).`
        )
      };
    }

    return {
      providerJobId: String(data.id ?? data.providerJobId ?? ""),
      status: (data.status as ExternalMediaProviderStatus["status"]) ?? "queued",
      artifactUrl: data.artifact_url ?? data.artifactUrl ?? null,
      mimeType: data.mime_type ?? data.mimeType ?? "image/png",
      filename: data.filename ?? null,
      errorCode: data.error_code ?? data.errorCode ?? null,
      errorMessage: data.error_message ?? data.errorMessage ?? null
    };
  }

  public async pollStatus(providerJobId: string): Promise<ExternalMediaProviderStatus> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/images/generations/${encodeURIComponent(providerJobId)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${this.apiKey}` }
      }
    );

    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      return {
        providerJobId,
        status: "failed",
        errorCode: String(
          data.error?.code ?? data.errorCode ?? `IMAGE_PROVIDER_POLL_HTTP_${res.status}`
        ),
        errorMessage: String(
          data.error?.message ??
            data.errorMessage ??
            `Ошибка проверки статуса изображения (HTTP ${res.status}).`
        )
      };
    }

    return {
      providerJobId: String(data.id ?? data.providerJobId ?? providerJobId),
      status: (data.status as ExternalMediaProviderStatus["status"]) ?? "running",
      artifactUrl: data.artifact_url ?? data.artifactUrl ?? null,
      mimeType: data.mime_type ?? data.mimeType ?? "image/png",
      filename: data.filename ?? null,
      errorCode: data.error_code ?? data.errorCode ?? null,
      errorMessage: data.error_message ?? data.errorMessage ?? null
    };
  }

  public async downloadArtifact(
    artifactUrl: string,
    fallbackFilename: string
  ): Promise<ExternalMediaDownloadedArtifact> {
    const fullUrl = artifactUrl.startsWith("http")
      ? artifactUrl
      : `${this.baseUrl}${artifactUrl.startsWith("/") ? "" : "/"}${artifactUrl}`;
    const res = await this.fetchImpl(fullUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${this.apiKey}` }
    });
    if (!res.ok) throw new Error(`IMAGE_PROVIDER_DOWNLOAD_HTTP_${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0) throw new Error("IMAGE_PROVIDER_ARTIFACT_EMPTY");
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    return { buffer, mimeType, filename: fallbackFilename };
  }
}
