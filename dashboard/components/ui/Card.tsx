import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}

export function Card({
  className = "",
  "data-testid": testId,
  children,
  ...props
}: CardProps) {
  return (
    <div
      data-testid={testId}
      className={`rounded-lg border border-line bg-surface ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between border-b border-line px-4 py-3 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {description && <p className="text-xs text-ink-subtle mt-1">{description}</p>}
      </div>
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({
  className = "",
  flush = false,
  children,
}: {
  className?: string;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return <div className={`${flush ? "" : "p-4"} ${className}`.trim()}>{children}</div>;
}
