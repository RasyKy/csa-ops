import React from "react";
import { formatDateTime, formatUtc } from "@/lib/time";

export interface TimeProps extends React.HTMLAttributes<HTMLTimeElement> {
  iso: string | null | undefined;
  timeZone?: string;
  className?: string;
}

export function Time({ iso, timeZone, className = "", ...props }: TimeProps) {
  return (
    <time
      dateTime={iso || undefined}
      title={formatUtc(iso)}
      suppressHydrationWarning
      className={`text-inherit ${className}`.trim()}
      {...props}
    >
      {formatDateTime(iso, timeZone)}
    </time>
  );
}
