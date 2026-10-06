"use client";

import type { Severity } from "@/lib/types";

const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

export function Filters({
  severity,
  host,
  search,
  techniqueOrTactic,
  techniquesAndTactics,
  statusFilter,
  assigneeFilter,
  assigneeNames,
  onSeverityChange,
  onHostChange,
  onSearchChange,
  onTechniqueOrTacticChange,
  onStatusFilterChange,
  onAssigneeFilterChange,
}: {
  severity: Severity | "";
  host?: string;
  search?: string;
  techniqueOrTactic?: string;
  techniquesAndTactics?: string[];
  statusFilter?: string;
  assigneeFilter?: string;
  assigneeNames?: string[];
  onSeverityChange: (value: Severity | "") => void;
  onHostChange?: (value: string) => void;
  onSearchChange?: (value: string) => void;
  onTechniqueOrTacticChange?: (value: string) => void;
  onStatusFilterChange?: (value: string) => void;
  onAssigneeFilterChange?: (value: string) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {onSearchChange ? (
        <label className="flex flex-col text-sm flex-1 min-w-[220px]">
          <span className="mb-1 text-zinc-500">Search</span>
          <div className="relative">
            <input
              type="text"
              className="w-full rounded border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
              value={search ?? ""}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search host, user, scenario..."
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                ✕
              </button>
            )}
          </div>
        </label>
      ) : onHostChange ? (
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-zinc-500">Host</span>
          <input
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            value={host ?? ""}
            onChange={(e) => onHostChange(e.target.value)}
            placeholder="WS01"
          />
        </label>
      ) : null}

      <label className="flex flex-col text-sm min-w-[120px]">
        <span className="mb-1 text-zinc-500">Severity</span>
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          value={severity}
          onChange={(e) => onSeverityChange(e.target.value as Severity | "")}
        >
          <option value="">All</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s.toUpperCase()}
            </option>
          ))}
        </select>
      </label>

      {onStatusFilterChange && (
        <label className="flex flex-col text-sm min-w-[130px]">
          <span className="mb-1 text-zinc-500">Status</span>
          <select
            className="rounded border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
            value={statusFilter ?? "all"}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
      )}

      {onAssigneeFilterChange && (
        <label className="flex flex-col text-sm min-w-[140px]">
          <span className="mb-1 text-zinc-500">Assignee</span>
          <select
            className="rounded border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
            value={assigneeFilter ?? "all"}
            onChange={(e) => onAssigneeFilterChange(e.target.value)}
          >
            <option value="all">All</option>
            <option value="unassigned">Unassigned</option>
            {(assigneeNames ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

      {techniquesAndTactics && onTechniqueOrTacticChange && (
        <label className="flex flex-col text-sm min-w-[170px]">
          <span className="mb-1 text-zinc-500">Technique / Tactic</span>
          <select
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            value={techniqueOrTactic ?? ""}
            onChange={(e) => onTechniqueOrTacticChange(e.target.value)}
          >
            <option value="">All Techniques & Tactics</option>
            {techniquesAndTactics.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
