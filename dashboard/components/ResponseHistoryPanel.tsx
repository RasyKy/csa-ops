import { describeResponseAction } from "@/lib/responseWording";
import type { ResponseAction } from "@/lib/types";

function formatTime(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

export function ResponseHistoryPanel({ history }: { history: ResponseAction[] }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Response history</h3>
      {history.length === 0 ? (
        <p className="text-sm text-zinc-500">No response actions yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {history.map((a) => (
            <li key={a.action_id}>
              <p>{describeResponseAction(a)}</p>
              {formatTime(a.command_issued_time) && (
                <p className="text-xs text-zinc-500">{formatTime(a.command_issued_time)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
