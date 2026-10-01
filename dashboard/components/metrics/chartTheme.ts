// Recharts' <Tooltip> renders its own popup box outside Tailwind's dark:
// reach (it's an inline-styled portal, not a className'd element), so it
// needs an explicit style per theme instead of a utility class.
export function tooltipStyle(theme: "light" | "dark") {
  return theme === "dark"
    ? { background: "#27272a", border: "1px solid #3f3f46", color: "#f4f4f5", fontSize: 12 }
    : { background: "#ffffff", border: "1px solid #e4e4e7", color: "#18181b", fontSize: 12 };
}
