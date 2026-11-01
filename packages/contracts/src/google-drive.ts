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
