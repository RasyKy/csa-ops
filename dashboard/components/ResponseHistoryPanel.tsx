import type { ResponseAction } from "@/lib/types";

export function ResponseHistoryPanel({ history }: { history: ResponseAction[] }) {
  return (
    <div className="rounded border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Response history</h3>
      {history.length === 0 ? (
        <p className="text-sm text-slate-500">No response actions yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {history.map((a) => (
            <li key={a.action_id} className="flex justify-between gap-4">
              <span>{a.action}</span>
              <span className="text-slate-500">
                {a.status} ({a.mode})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
