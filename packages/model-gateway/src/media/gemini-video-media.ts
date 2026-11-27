import { MediaProviderError, readBounded, type MediaBinary } from "./openai-media-adapter.js";
import { isMp4Video } from "./mp4-video.js";

export const VIDEO_CREATIVE_ROUTE = {
  provider: "google-cloud",
  model: "gemini-omni-1.2-flash",
  minSeconds: 3,
  maxSeconds: 15,
  resolution: "360p"
} as const;
export const MAX_STUDIO_VIDEO_BYTES = 24 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_STUDIO_VIDEO_BYTES / 3) * 4;
export type VideoAspectRatio = "16:9" | "9:16";

export function validGeminiVideoProject(project: string): boolean {
  return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project);
}

const invalidVideo = () =>
  new MediaProviderError("INVALID_ASSET", "Invalid inline video result", {
    normalizedCode: "corrupt_response"
  });

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export class GeminiVideoMediaAdapter {
  private readonly url: string;

  constructor(
    project: string,
    private readonly credential: string,
    private readonly transport: typeof fetch = fetch
  ) {
    if (!validGeminiVideoProject(project)) throw new Error("INVALID_VIDEO_PROJECT");
    this.url = `https://aiplatform.googleapis.com/v1beta1/projects/${project}/locations/global/interactions`;
  }

  async generate(
    prompt: string,
    duration: number,
    aspectRatio: VideoAspectRatio,
    signal: AbortSignal
  ): Promise<MediaBinary> {
    const response = await this.transport(this.url, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal,
      headers: {
        Authorization: `Bearer ${this.credential}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: VIDEO_CREATIVE_ROUTE.model,
        store: false,
        input: [{ type: "text", text: prompt }],
        response_format: [
          {
            type: "video",
            delivery: "inline",
            aspect_ratio: aspectRatio,
            resolution: VIDEO_CREATIVE_ROUTE.resolution,
            duration: `${duration}s`
          }
        ],
        generation_config: { video_config: { task: "text_to_video" } }
      })
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new MediaProviderError("PROVIDER_ERROR", "Video provider rejected the request", {
        status: response.status,
        normalizedCode:
          response.status === 401 || response.status === 403
            ? "invalid_key"
            : response.status === 429
              ? "rate_limit"
              : response.status === 408 || response.status === 504
                ? "timeout"
                : "provider_error"
      });
    }
    if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") {
      await response.body?.cancel().catch(() => undefined);
      throw invalidVideo();
    }
    const raw = await readBounded(response, MAX_BASE64_LENGTH + 128 * 1024, signal);
    let interaction: Record<string, unknown> | null;
    try {
      interaction = record(JSON.parse(new TextDecoder().decode(raw)));
    } catch {
      throw invalidVideo();
    }
    if (interaction?.status !== "completed" || !Array.isArray(interaction.steps))
      throw invalidVideo();
    const outputs = (interaction.steps as unknown[])
      .map(record)
      .filter((step) => step?.type === "model_output" && Array.isArray(step.content))
      .flatMap((step) => (step!.content as unknown[]).map(record))
      .filter((item) => item?.type === "video");
    const result = outputs[0];
    if (
      outputs.length !== 1 ||
      !result ||
      result.mime_type !== "video/mp4" ||
      result.uri !== undefined
    )
      throw invalidVideo();
    const data = result.data;
    if (
      typeof data !== "string" ||
      !data.length ||
      data.length > MAX_BASE64_LENGTH ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      throw invalidVideo();
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_STUDIO_VIDEO_BYTES || !isMp4Video(bytes)) throw invalidVideo();
    return { mime: "video/mp4", extension: "mp4", bytes };
  }
}
