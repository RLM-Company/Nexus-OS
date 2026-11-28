import { formatDuration } from "./chat-task-plan";
import { observedInterval } from "./task-runtime-evidence";

export function TaskRuntimeInterval({
  start,
  end,
  label
}: {
  start?: string | undefined;
  end?: string | undefined;
  label: string;
}) {
  const span = observedInterval(start, end);
  if (span === null) return null;
  return (
    <small>
      {label}: {span === 0 ? "0 мс" : formatDuration(span)}
    </small>
  );
}
