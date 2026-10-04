export const DISPLAY_TZ = process.env.NEXT_PUBLIC_DISPLAY_TZ || "Asia/Phnom_Penh";

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateTime(iso: string | null | undefined, timeZone: string = DISPLAY_TZ): string {
  const d = parseDate(iso);
  if (!d) return "Unknown";
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = dtf.formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.day} ${map.month} ${map.year}, ${map.hour}:${map.minute}:${map.second}`;
  } catch {
    return "Unknown";
  }
}

export function formatTime(iso: string | null | undefined, timeZone: string = DISPLAY_TZ): string {
  const d = parseDate(iso);
  if (!d) return "Unknown";
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = dtf.formatToParts(d);
    const map: Record<string, string> = {};
    for (const p of parts) map[p.type] = p.value;
    return `${map.hour}:${map.minute}:${map.second}`;
  } catch {
    return "Unknown";
  }
}

export function formatUtc(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "Unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}:${s} UTC`;
}

export function formatRelative(iso: string | null | undefined, now?: Date | string | number): string {
  const d = parseDate(iso);
  if (!d) return "Unknown";
  const current = now
    ? now instanceof Date
      ? now.getTime()
      : new Date(now).getTime()
    : Date.now();
  const diffSec = Math.floor((current - d.getTime()) / 1000);
  if (diffSec < 0) return "just now";
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function tzLabel(timeZone: string = DISPLAY_TZ): string {
  try {
    const d = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(d);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    if (tzPart?.value) {
      const val = tzPart.value.replace("GMT", "UTC");
      return val === "UTC" ? "UTC+0" : val;
    }
  } catch {
    // fallback
  }
  return "UTC+0";
}

export function formatShortDate(iso: string | null | undefined, timeZone?: string): string {
  const d = parseDate(iso);
  if (!d) return "Unknown";
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = dtf.formatToParts(d);
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    const month = parts.find((p) => p.type === "month")?.value ?? "";
    return `${day} ${month}`;
  } catch {
    return "Unknown";
  }
}

export function formatHourMinute(iso: string | null | undefined, timeZone: string = DISPLAY_TZ): string {
  const d = parseDate(iso);
  if (!d) return "Unknown";
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timeZone ? { timeZone } : {}),
    });
    const parts = dtf.formatToParts(d);
    const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${hour}:${minute}`;
  } catch {
    return "Unknown";
  }
}

