import { createHash } from "node:crypto";

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const DRIVE_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024;
const METADATA_MAX_BYTES = 100 * 1024;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ZIP_MIME = "application/zip";

export class DriveStorageError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain = false
  ) {
    super(code);
    this.name = "DriveStorageError";
  }
}

export interface DriveArchiveReceipt {
  fileId: string;
  folderId: string;
  operationId: string;
  bytes: number;
  sha256: string;
}

export async function readBoundedDriveBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) {
    throw new DriveStorageError("DRIVE_EMPTY_RESPONSE");
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      total += buf.byteLength;
      if (total > limit) {
        throw new DriveStorageError("DRIVE_RESPONSE_TOO_LARGE");
      }
      chunks.push(buf);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (total === 0) {
    throw new DriveStorageError("DRIVE_EMPTY_RESPONSE");
  }
  return Buffer.concat(chunks, total);
}

export class GoogleDriveArchiveTransport {
  constructor(
    private readonly ownerId: string,
    private readonly accessToken: () => Promise<string>,
    private readonly request: typeof fetch = fetch
  ) {
    if (typeof ownerId !== "string" || !ownerId.trim()) {
      throw new DriveStorageError("INVALID_OWNER");
    }
  }

  private async authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await this.accessToken();
    if (!token) throw new DriveStorageError("DRIVE_AUTH_REQUIRED");
    return {
      Authorization: `Bearer ${token}`,
      ...extra
    };
  }

  async generateId(): Promise<string> {
    let response: Response;
    try {
      response = await this.request(
        "https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive",
        {
          method: "GET",
          headers: await this.authHeaders(),
          redirect: "error"
        }
      );
    } catch {
      throw new DriveStorageError("DRIVE_TRANSPORT_FAILED");
    }
    if (response.status === 401 || response.status === 403) {
      throw new DriveStorageError("DRIVE_ACCESS_DENIED");
    }
    if (!response.ok) {
      throw new DriveStorageError("DRIVE_REQUEST_FAILED");
    }
    const body = await readBoundedDriveBody(response, METADATA_MAX_BYTES);
    const parsed = JSON.parse(body.toString("utf8")) as { ids?: unknown };
    const id = Array.isArray(parsed.ids) ? parsed.ids[0] : null;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
      throw new DriveStorageError("DRIVE_INVALID_RESPONSE");
    }
    return id;
  }

  async createFolder(fileId: string): Promise<void> {
    let response: Response;
    try {
      response = await this.request(
        "https://www.googleapis.com/drive/v3/files?fields=id,mimeType,trashed,appProperties",
        {
          method: "POST",
          headers: await this.authHeaders({ "Content-Type": "application/json; charset=utf-8" }),
          body: JSON.stringify({
            id: fileId,
            name: "Kosmora Archives",
            mimeType: FOLDER_MIME,
            appProperties: {
              kosmora_kind: "archive_folder",
              owner: this.ownerId
            }
          }),
          redirect: "error"
        }
      );
    } catch {
      throw new DriveStorageError("DRIVE_TRANSPORT_FAILED", true);
    }
    if (response.status === 409) {
      throw new DriveStorageError("DRIVE_CONFLICT", true);
    }
    if (response.status >= 500) {
      throw new DriveStorageError("DRIVE_REQUEST_FAILED", true);
    }
    if (!response.ok) {
      throw new DriveStorageError("DRIVE_REQUEST_FAILED", false);
    }
    const raw = await readBoundedDriveBody(response, METADATA_MAX_BYTES);
    const meta = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const props = (meta.appProperties ?? {}) as Record<string, unknown>;
    if (
      meta.id !== fileId ||
      meta.mimeType !== FOLDER_MIME ||
      meta.trashed === true ||
      props.owner !== this.ownerId
    ) {
      throw new DriveStorageError("DRIVE_INVALID_RESPONSE", false);
    }
  }

  async inspectFolder(fileId: string): Promise<"verified_metadata" | "unavailable"> {
    const response = await this.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,mimeType,trashed,appProperties`,
      {
        method: "GET",
        headers: await this.authHeaders(),
        redirect: "error"
      }
    );
    if (response.status === 404) return "unavailable";
    if (!response.ok) throw new DriveStorageError("DRIVE_REQUEST_FAILED", true);
    const raw = await readBoundedDriveBody(response, METADATA_MAX_BYTES);
    const meta = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const props = (meta.appProperties ?? {}) as Record<string, unknown>;
    if (
      meta.id !== fileId ||
      meta.mimeType !== FOLDER_MIME ||
      meta.trashed === true ||
      props.owner !== this.ownerId
    ) {
      return "unavailable";
    }
    return "verified_metadata";
  }

  async uploadArchive(
    input: { fileId: string; folderId: string; operationId: string; name: string },
    bytes: Uint8Array
  ): Promise<DriveArchiveReceipt> {
    if (bytes.byteLength < 1 || bytes.byteLength > DRIVE_ARCHIVE_MAX_BYTES) {
      throw new DriveStorageError("INVALID_DRIVE_RECEIPT", false);
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const boundary = `kosmora_drive_${sha256.slice(0, 24)}`;
    const metadata = JSON.stringify({
      id: input.fileId,
      name: input.name,
      parents: [input.folderId],
      mimeType: ZIP_MIME,
      appProperties: {
        owner: this.ownerId,
        operation_id: input.operationId,
        sha256
      }
    });
    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${ZIP_MIME}\r\n\r\n`,
      "utf8"
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
    const multipartBody = Buffer.concat([preamble, Buffer.from(bytes), epilogue]);

    let response: Response;
    try {
      response = await this.request(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,parents,mimeType,size,sha256Checksum,trashed,appProperties",
        {
          method: "POST",
          headers: await this.authHeaders({
            "Content-Type": `multipart/related; boundary=${boundary}`
          }),
          body: multipartBody,
          redirect: "error"
        }
      );
    } catch {
      throw new DriveStorageError("DRIVE_TRANSPORT_FAILED", true);
    }

    if (response.status === 409) {
      throw new DriveStorageError("DRIVE_CONFLICT", true);
    }
    if (response.status >= 500) {
      throw new DriveStorageError("DRIVE_REQUEST_FAILED", true);
    }
    if (!response.ok) {
      throw new DriveStorageError("DRIVE_REQUEST_FAILED", false);
    }

    const raw = await readBoundedDriveBody(response, METADATA_MAX_BYTES);
    const meta = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const props = (meta.appProperties ?? {}) as Record<string, unknown>;
    if (
      meta.id !== input.fileId ||
      meta.trashed === true ||
      Number(meta.size) !== bytes.byteLength ||
      String(meta.sha256Checksum ?? "").toLowerCase() !== sha256 ||
      props.owner !== this.ownerId ||
      props.operation_id !== input.operationId
    ) {
      throw new DriveStorageError("DRIVE_ARCHIVE_CHANGED", false);
    }

    return {
      fileId: input.fileId,
      folderId: input.folderId,
      operationId: input.operationId,
      bytes: bytes.byteLength,
      sha256
    };
  }

  async inspectArchive(receipt: DriveArchiveReceipt): Promise<"verified_metadata" | "unavailable"> {
    const response = await this.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(receipt.fileId)}?fields=id,parents,mimeType,size,sha256Checksum,trashed,appProperties`,
      {
        method: "GET",
        headers: await this.authHeaders(),
        redirect: "error"
      }
    );
    if (response.status === 404) return "unavailable";
    if (!response.ok) throw new DriveStorageError("DRIVE_REQUEST_FAILED", true);
    const raw = await readBoundedDriveBody(response, METADATA_MAX_BYTES);
    const meta = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
    const props = (meta.appProperties ?? {}) as Record<string, unknown>;
    const parents = Array.isArray(meta.parents) ? meta.parents : [];
    if (
      meta.id !== receipt.fileId ||
      meta.trashed === true ||
      !parents.includes(receipt.folderId) ||
      Number(meta.size) !== receipt.bytes ||
      String(meta.sha256Checksum ?? "").toLowerCase() !== receipt.sha256.toLowerCase() ||
      props.owner !== this.ownerId ||
      props.operation_id !== receipt.operationId
    ) {
      throw new DriveStorageError("DRIVE_ARCHIVE_CHANGED", false);
    }
    return "verified_metadata";
  }

  async downloadArchive(receipt: DriveArchiveReceipt): Promise<Buffer> {
    let response: Response;
    try {
      response = await this.request(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(receipt.fileId)}?alt=media`,
        {
          method: "GET",
          headers: await this.authHeaders(),
          redirect: "error"
        }
      );
    } catch {
      throw new DriveStorageError("DRIVE_DOWNLOAD_FAILED", true);
    }
    if (response.status === 404) {
      throw new DriveStorageError("DRIVE_ARCHIVE_UNAVAILABLE", false);
    }
    if (!response.ok) {
      throw new DriveStorageError("DRIVE_DOWNLOAD_FAILED", true);
    }
    const data = await readBoundedDriveBody(response, receipt.bytes);
    const digest = createHash("sha256").update(data).digest("hex");
    if (data.byteLength !== receipt.bytes || digest !== receipt.sha256.toLowerCase()) {
      throw new DriveStorageError("DRIVE_ARCHIVE_CHANGED", false);
    }
    return data;
  }
}
