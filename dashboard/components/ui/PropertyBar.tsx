import React from "react";

export interface PropertyItem {
  label: React.ReactNode;
  value: React.ReactNode;
}

export function Property({
  label,
  value,
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col min-w-0 ${className}`}>
      <span className="text-xs text-ink-subtle">{label}</span>
      <span className="text-sm font-medium text-ink mt-0.5 truncate">{value}</span>
    </div>
  );
}

export function PropertyBar({
  items,
  children,
  className = "",
}: {
  items?: PropertyItem[];
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-2 sm:flex sm:flex-wrap items-start gap-x-8 gap-y-3 ${className}`}>
      {items
        ? items.map((item, idx) => (
            <Property key={idx} label={item.label} value={item.value} />
          ))
        : children}
    </div>
  );
}
