import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  StudioStoryboardSchema,
  type StudioStoryboard,
  type StudioStoryboardChange
} from "@cosmora/contracts";
import { Value } from "typebox/value";

const maxBytes = 1024 * 1024;
const filename = (directory: string, owner: string) =>
  join(directory, "storyboard-" + createHash("sha256").update(owner).digest("hex") + ".json");

function readRecord(
  directory: string,
  owner: string
): { board: StudioStoryboard; fingerprint: string } | null {
  const path = filename(directory, owner);
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return null;
  if (!info.isFile() || info.size > maxBytes) throw Error("STORYBOARD_UNAVAILABLE");
  const value = JSON.parse(readFileSync(path, "utf8")) as {
    board?: unknown;
    fingerprint?: unknown;
  } | null;
  if (
    !value ||
    !Value.Check(StudioStoryboardSchema, value.board) ||
    typeof value.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  )
    throw Error("STORYBOARD_UNAVAILABLE");
  return { board: value.board, fingerprint: value.fingerprint };
}

export function readStoryboard(directory: string, owner: string): StudioStoryboard | null {
  return readRecord(directory, owner)?.board ?? null;
}

export function emptyStoryboard(): StudioStoryboard {
  return { format: "kosmora.storyboard.v1", version: 0, last_operation_id: null, scenes: [] };
}

export function updateStoryboard(directory: string, owner: string, change: StudioStoryboardChange) {
  const stored = readRecord(directory, owner);
  const board = stored?.board ?? emptyStoryboard();
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        change.expected_version,
        change.action,
        "scene_id" in change ? change.scene_id : null,
        change.action === "accept"
          ? change.revision
          : [change.description.trim(), change.duration_seconds]
      ])
    )
    .digest("hex");
  // Readback recovers a lost response. Reusing an operation ID with a different
  // action never writes again.
  if (board.last_operation_id === change.operation_id) {
    if (stored?.fingerprint !== fingerprint) throw Error("STORYBOARD_CONFLICT");
    return board;
  }
  if (board.version !== change.expected_version) throw Error("STORYBOARD_CONFLICT");
  if (change.action === "add") {
    if (board.scenes.length >= 12) throw Error("STORYBOARD_LIMIT");
    board.scenes.push({
      id: randomUUID(),
      accepted_version: null,
      revisions: [
        {
          version: 1,
          description: change.description.trim(),
          duration_seconds: change.duration_seconds
        }
      ]
    });
  } else {
    const scene = board.scenes.find(({ id }) => id === change.scene_id);
    if (!scene) throw Error("STORYBOARD_SCENE_NOT_FOUND");
    if (change.action === "accept") {
      if (!scene.revisions.some(({ version }) => version === change.revision))
        throw Error("STORYBOARD_SCENE_NOT_FOUND");
      scene.accepted_version = change.revision;
    } else {
      if (scene.revisions.length >= 12) throw Error("STORYBOARD_LIMIT");
      scene.revisions.push({
        version: scene.revisions.length + 1,
        description: change.description.trim(),
        duration_seconds: change.duration_seconds
      });
    }
  }
  board.version++;
  board.last_operation_id = change.operation_id;
  const path = filename(directory, owner);
  const temp = join(directory, `storyboard-${randomUUID()}.tmp`);
  const content = JSON.stringify({ board, fingerprint });
  if (Buffer.byteLength(content) > maxBytes) throw Error("STORYBOARD_LIMIT");
  try {
    writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  return board;
}

export function deleteStoryboard(directory: string, owner: string): void {
  rmSync(filename(directory, owner), { force: true });
}
