// Shared icon+title pattern, extracted from MetricState's PendingIcon and
// AutomatedResponseStatus's original inline InfoIcon (the third place this
// exact markup was about to appear is the signal to share it).
export function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="text-zinc-400 dark:text-zinc-500" title={text}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5 shrink-0">
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 8v5" />
        <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}
