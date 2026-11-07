export interface GoogleDriveConnectionView {
  configured: boolean;
  state: "unavailable" | "disconnected" | "preparing" | "connected";
  can_disconnect: boolean;
  can_retry: boolean;
  archive_count: number;
  pending_count: number;
}
export interface GoogleDriveConnectStart {
  authorization_url: string;
  state: string;
  proof: string;
  expires_at: number;
}

export interface GoogleDriveSourceList {
  /** Legacy chat list retained for already loaded clients. */
  items: { id: string; title: string; mode: string }[];
  chats?: GoogleDriveSourceList["items"];
  file_selection?: boolean;
  files?: {
    id: string;
    name: string;
    project: string;
    version: number;
    bytes: number;
    sha256: string | null;
    kind: "kosmora" | "user";
  }[];
}
