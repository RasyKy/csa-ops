import React from "react";

export interface KeyValueItem {
  label: React.ReactNode;
  value: React.ReactNode;
}

export function KeyValueRow({
  label,
  value,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start gap-4 ${className}`}>
      <dt className="w-24 shrink-0 text-xs text-ink-subtle pt-0.5">{label}</dt>
      <dd className="min-w-0 flex-1 text-left text-sm text-ink break-words">{value}</dd>
    </div>
  );
}

export function KeyValueList({
  items,
  children,
  className = "",
}: {
  items?: KeyValueItem[];
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <dl className={`flex flex-col gap-3 ${className}`}>
      {items
        ? items.map((item, idx) => (
            <KeyValueRow key={idx} label={item.label} value={item.value} />
          ))
        : children}
    </dl>
  );
}
