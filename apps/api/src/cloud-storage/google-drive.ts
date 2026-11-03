import { createHash, randomUUID } from "node:crypto";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024;
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
const FIELDS = "id,mimeType,size,parents,trashed,appProperties";
const FORMAT = "kosmora-archive-v1";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const id = (value: string) => {
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(value)) throw new DriveStorageError("INVALID_DRIVE_ID");
  return value;
};

export class DriveStorageError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false
  ) {
    // No provider body, token, filename or URL belongs in logs/errors.
    super(code);
  }
}
export interface DriveArchiveReceipt {
  fileId: string;
  folderId: string;
  operationId: string;
  bytes: number;
  sha256: string;
}
type Metadata = {
  id?: unknown;
  mimeType?: unknown;
  size?: unknown;
  parents?: unknown;
  trashed?: unknown;
  appProperties?: Record<string, unknown>;
};

export async function readBoundedDriveBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) throw new DriveStorageError("DRIVE_EMPTY_RESPONSE");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks);
      size += next.value.byteLength;
      if (size > limit) throw new DriveStorageError("DRIVE_RESPONSE_TOO_LARGE");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Server-side transport only. The caller must bind receipts and folder IDs to
 * the authenticated owner's durable store. This class never browses all Drive,
 * grants sharing permissions, deletes files or retries writes automatically.
 */
export class GoogleDriveArchiveTransport {
  readonly #binding: string;
  constructor(
    ownerId: string,
    private readonly accessToken: () => Promise<string>,
    private readonly request: typeof fetch = fetch
  ) {
    if (!ownerId.trim() || ownerId.length > 128) throw new DriveStorageError("INVALID_OWNER");
    this.#binding = sha(ownerId);
  }

  private async call(url: string, init: RequestInit = {}, missingAllowed = false) {
    const write = init.method === "POST";
    let token: string;
    try {
      token = await this.accessToken();
    } catch {
      throw new DriveStorageError("DRIVE_AUTH_REQUIRED");
    }
    if (typeof token !== "string" || !token || token.length > 8192 || /[\r\n]/.test(token))
      throw new DriveStorageError("DRIVE_AUTH_REQUIRED");
    let response: Response;
    try {
      response = await this.request(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(20_000)
      });
    } catch {
      throw new DriveStorageError("DRIVE_TRANSPORT_FAILED", write);
    }
    if (missingAllowed && response.status === 404) {
      await response.body?.cancel();
      return null; // Not accessible; this does not prove an earlier POST failed.
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const code =
        response.status === 401
          ? "DRIVE_AUTH_REQUIRED"
          : response.status === 403
            ? "DRIVE_ACCESS_DENIED"
            : response.status === 409
              ? "DRIVE_CONFLICT"
              : "DRIVE_REQUEST_FAILED";
      throw new DriveStorageError(
        code,
        write && (response.status >= 500 || response.status === 409 || response.status === 429)
      );
    }
    return response;
  }

  private async json(url: string, init: RequestInit = {}, missingAllowed = false) {
    const response = await this.call(url, init, missingAllowed);
    if (!response) return null;
    try {
      const value: unknown = JSON.parse(
        (await readBoundedDriveBody(response, 100_000)).toString("utf8")
      );
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
      return value as Record<string, unknown>;
    } catch {
      throw new DriveStorageError("DRIVE_INVALID_RESPONSE", init.method === "POST");
    }
  }

  /** Persist this ID before sending a write. Reconcile an unknown outcome by GET
   * using the same ID; a 404 is not permission to generate a duplicate archive.
   */
  async generateId(): Promise<string> {
    const data = await this.json(`${API}/files/generateIds?count=1&space=drive&type=files`);
    if (!Array.isArray(data?.ids) || data.ids.length !== 1 || typeof data.ids[0] !== "string")
      throw new DriveStorageError("DRIVE_INVALID_RESPONSE");
    return id(data.ids[0]);
  }

  async createFolder(fileId: string): Promise<void> {
    const data = await this.json(`${API}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: id(fileId),
        name: "Kosmora",
        mimeType: "application/vnd.google-apps.folder",
        appProperties: { format: FORMAT, owner: this.#binding }
      })
    });
    if (data?.id !== fileId) throw new DriveStorageError("DRIVE_INVALID_RESPONSE", true);
  }

  async inspectFolder(fileId: string): Promise<"verified_metadata" | "unavailable"> {
    const folder: Metadata | null = await this.json(
      `${API}/files/${id(fileId)}?fields=${FIELDS}`,
      {},
      true
    );
    if (!folder) return "unavailable";
    if (
      folder.id !== fileId ||
      folder.trashed !== false ||
      folder.mimeType !== "application/vnd.google-apps.folder" ||
      folder.appProperties?.format !== FORMAT ||
      folder.appProperties.owner !== this.#binding
    )
      throw new DriveStorageError("DRIVE_FOLDER_CHANGED");
    return "verified_metadata";
  }

  async uploadArchive(
    input: { fileId: string; folderId: string; operationId: string; name: string },
    bytes: Uint8Array
  ): Promise<DriveArchiveReceipt> {
    input = { ...input };
    id(input.fileId);
    id(input.folderId);
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(input.operationId) ||
      !input.name.endsWith(".zip") ||
      input.name.length < 5 ||
      input.name.length > 124 ||
      [...input.name].some(
        (c) => c === "/" || c === "\\" || c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127
      ) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > DRIVE_ARCHIVE_MAX_BYTES
    )
      throw new DriveStorageError("INVALID_DRIVE_ARCHIVE");
    bytes = Buffer.from(bytes);
    if ((await this.inspectFolder(input.folderId)) !== "verified_metadata")
      throw new DriveStorageError("DRIVE_FOLDER_UNAVAILABLE");
    const receipt = {
      fileId: input.fileId,
      folderId: input.folderId,
      operationId: input.operationId,
      bytes: bytes.byteLength,
      sha256: sha(bytes)
    };
    let boundary = "kosmora_" + randomUUID();
    while (Buffer.from(bytes).includes(boundary)) boundary = "kosmora_" + randomUUID();
    const metadata = {
      id: input.fileId,
      name: input.name,
      parents: [input.folderId],
      mimeType: "application/zip",
      appProperties: {
        format: FORMAT,
        owner: this.#binding,
        operation: input.operationId,
        sha256: receipt.sha256
      }
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
    const data = await this.json(`${UPLOAD}&fields=id`, {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body)
    });
    if (data?.id !== input.fileId) throw new DriveStorageError("DRIVE_INVALID_RESPONSE", true);
    return receipt;
  }

  private validateReceipt(receipt: DriveArchiveReceipt) {
    id(receipt.fileId);
    id(receipt.folderId);
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(receipt.operationId) ||
      !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
      !Number.isSafeInteger(receipt.bytes) ||
      receipt.bytes < 1 ||
      receipt.bytes > DRIVE_ARCHIVE_MAX_BYTES
    )
      throw new DriveStorageError("INVALID_DRIVE_RECEIPT");
  }

  async inspectArchive(receipt: DriveArchiveReceipt): Promise<"verified_metadata" | "unavailable"> {
    receipt = { ...receipt };
    this.validateReceipt(receipt);
    const data: Metadata | null = await this.json(
      `${API}/files/${id(receipt.fileId)}?fields=${FIELDS}`,
      {},
      true
    );
    if (!data) return "unavailable";
    if (
      data.id !== receipt.fileId ||
      data.trashed !== false ||
      data.mimeType !== "application/zip" ||
      data.size !== String(receipt.bytes) ||
      !Array.isArray(data.parents) ||
      !data.parents.includes(receipt.folderId) ||
      data.appProperties?.format !== FORMAT ||
      data.appProperties.owner !== this.#binding ||
      data.appProperties.operation !== receipt.operationId ||
      data.appProperties.sha256 !== receipt.sha256
    )
      throw new DriveStorageError("DRIVE_ARCHIVE_CHANGED");
    return "verified_metadata";
  }

  async downloadArchive(receipt: DriveArchiveReceipt): Promise<Buffer> {
    receipt = { ...receipt };
    if ((await this.inspectArchive(receipt)) !== "verified_metadata")
      throw new DriveStorageError("DRIVE_ARCHIVE_UNAVAILABLE");
    const response = await this.call(`${API}/files/${id(receipt.fileId)}?alt=media`);
    let bytes: Buffer;
    try {
      bytes = await readBoundedDriveBody(response!, receipt.bytes);
    } catch {
      throw new DriveStorageError("DRIVE_DOWNLOAD_FAILED");
    }
    if (bytes.length !== receipt.bytes || sha(bytes) !== receipt.sha256)
      throw new DriveStorageError("DRIVE_ARCHIVE_CHANGED");
    return bytes;
  }
}
