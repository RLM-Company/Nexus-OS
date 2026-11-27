import { createHash } from "node:crypto";

export function documentFragmentHash(fragment: {
  page: number | null;
  line_start: number;
  line_end: number;
  content: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([fragment.page, fragment.line_start, fragment.line_end, fragment.content])
    )
    .digest("hex");
}
