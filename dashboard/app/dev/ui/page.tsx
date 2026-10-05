// TEMPORARY, delete before merge.
import React from "react";
import { notFound } from "next/navigation";
import { Activity, AlertCircle, Info, RefreshCw } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Notice } from "@/components/ui/Notice";
import { PropertyBar } from "@/components/ui/PropertyBar";
import { KeyValueList } from "@/components/ui/KeyValueList";
import { Tooltip } from "@/components/ui/Tooltip";
import { Time } from "@/components/ui/Time";
import { StatusBadge } from "@/components/StatusBadge";
import { SeverityBadge } from "@/components/SeverityBadge";
import { TriageBadge } from "@/components/TriageBadge";
import {
  formatDateTime,
  formatRelative,
  formatTime,
  formatUtc,
  tzLabel,
} from "@/lib/time";
import type { Severity } from "@/lib/types";

export default function DevUIPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const fixedInputs: (string | null)[] = [
    "2026-09-11T14:02:13.400Z",
    "2026-09-28T01:24:57.000Z",
    "invalid string",
    null,
  ];

  const severities: Severity[] = ["low", "medium", "high", "critical"];

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-8 bg-background text-foreground">
      <div>
        <h1 className="text-2xl font-bold text-ink">Design Tokens and UI Primitives Kitchen Sink</h1>
        <p className="text-sm text-ink-subtle mt-1">
          Temporary verification page for CSA-OPS UI tokens, primitives, and time utilities.
        </p>
      </div>

      {/* 0. TOKEN PROBES */}
      <section className="space-y-3" data-testid="token-probe-section">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          Token Probes (Native Tailwind Generation)
        </h2>
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
              <div data-testid="probe-bg-ink" className="bg-ink h-6 px-3 flex items-center justify-center rounded text-surface">
                bg-ink
              </div>
              <div data-testid="probe-text-surface" className="bg-ink px-3 h-6 flex items-center justify-center rounded text-surface">
                text-surface
              </div>
              <div data-testid="probe-bg-surface" className="bg-surface h-6 px-3 flex items-center justify-center rounded border border-line text-ink">
                bg-surface
              </div>
              <div data-testid="probe-bg-surface-subtle" className="bg-surface-subtle h-6 px-3 flex items-center justify-center rounded border border-line text-ink">
                bg-surface-subtle
              </div>
              <div data-testid="probe-border-line" className="border border-line h-6 px-3 flex items-center justify-center rounded text-ink">
                border border-line
              </div>
              <div data-testid="probe-border-line-strong" className="border border-line-strong h-6 px-3 flex items-center justify-center rounded text-ink">
                border border-line-strong
              </div>
              <span data-testid="probe-text-ink" className="text-ink">
                text-ink
              </span>
              <span data-testid="probe-text-ink-muted" className="text-ink-muted">
                text-ink-muted
              </span>
              <span data-testid="probe-text-ink-subtle" className="text-ink-subtle">
                text-ink-subtle
              </span>
              <div data-testid="probe-ring-accent" className="ring-1 ring-accent h-6 px-3 flex items-center justify-center rounded text-ink">
                ring-1 ring-accent
              </div>
              <div data-testid="probe-bg-accent-soft" className="bg-accent-soft h-6 px-3 flex items-center justify-center rounded text-accent">
                bg-accent-soft
              </div>
            </div>

            <div className="border-t border-line pt-4">
              <span className="text-xs text-ink-subtle block mb-2">3-row divide-y divide-line list:</span>
              <div data-testid="probe-divide-list" className="divide-y divide-line rounded border border-line bg-surface max-w-sm">
                <div data-testid="probe-divide-row-1" className="px-3 py-1.5 text-xs text-ink">Row 1</div>
                <div data-testid="probe-divide-row-2" className="px-3 py-1.5 text-xs text-ink">Row 2</div>
                <div data-testid="probe-divide-row-3" className="px-3 py-1.5 text-xs text-ink">Row 3</div>
              </div>
            </div>
          </CardBody>
        </Card>
      </section>

      {/* 1. BUTTONS */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Buttons</h2>
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-ink-subtle w-24">Primary:</span>
              <Button variant="primary" size="md" data-testid="btn-primary-md">Primary MD</Button>
              <Button variant="primary" size="sm">Primary SM</Button>
              <Button variant="primary" size="icon" aria-label="Refresh">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="primary" size="md" disabled>Disabled</Button>
              <Button variant="primary" size="md" aria-pressed="true" data-testid="btn-primary-pressed">Pressed</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-ink-subtle w-24">Secondary:</span>
              <Button variant="secondary" size="md" data-testid="btn-secondary-md">Secondary MD</Button>
              <Button variant="secondary" size="sm">Secondary SM</Button>
              <Button variant="secondary" size="icon" aria-label="Activity">
                <Activity className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="md" disabled>Disabled</Button>
              <Button variant="secondary" size="md" aria-pressed="true" data-testid="btn-secondary-pressed">Pressed</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-ink-subtle w-24">Ghost:</span>
              <Button variant="ghost" size="md" data-testid="btn-ghost-md">Ghost MD</Button>
              <Button variant="ghost" size="sm">Ghost SM</Button>
              <Button variant="ghost" size="icon" aria-label="Info">
                <Info className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="md" disabled>Disabled</Button>
              <Button variant="ghost" size="md" aria-pressed="true" data-testid="btn-ghost-pressed">Pressed</Button>
            </div>
          </CardBody>
        </Card>
      </section>

      {/* 2. BADGES & STATUS */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          Badges and Status Alignments
        </h2>
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-ink-subtle w-32">Generic Badges:</span>
              <Badge tone="neutral" data-testid="badge-neutral">Neutral</Badge>
              <Badge tone="neutral" dot data-testid="badge-neutral-dot">Neutral Dot</Badge>
              <Badge tone="neutral" icon={Activity} data-testid="badge-neutral-icon">Neutral Icon</Badge>
              <Badge tone="info" data-testid="badge-info">Info</Badge>
              <Badge tone="info" dot data-testid="badge-info-dot">Info Dot</Badge>
              <Badge tone="info" icon={Info} data-testid="badge-info-icon">Info Icon</Badge>
              <Badge tone="danger" data-testid="badge-danger">Danger</Badge>
              <Badge tone="danger" dot data-testid="badge-danger-dot">Danger Dot</Badge>
              <Badge tone="danger" icon={AlertCircle} data-testid="badge-danger-icon">Danger Icon</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <span className="text-xs text-ink-subtle w-32">StatusBadge:</span>
              <StatusBadge status="open" />
              <StatusBadge status="resolved" />
              <StatusBadge status="no_response" data-testid="status-badge-no-response" />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <span className="text-xs text-ink-subtle w-32">SeverityBadge:</span>
              {severities.map((sev) => (
                <SeverityBadge key={sev} severity={sev} />
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <span className="text-xs text-ink-subtle w-32">Triage (no prefix):</span>
              <TriageBadge verdict="true_positive" />
              <TriageBadge verdict="likely_true_positive" />
              <TriageBadge verdict="needs_review" />
              <TriageBadge verdict="likely_false_positive" />
              <TriageBadge verdict="false_positive" />
              <TriageBadge verdict={null} />
              <TriageBadge verdict={null} status="failed" />
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <span className="text-xs text-ink-subtle w-32">Triage (AI: prefix):</span>
              <TriageBadge prefix="AI:" verdict="true_positive" />
              <TriageBadge prefix="AI:" verdict="likely_true_positive" />
              <TriageBadge prefix="AI:" verdict="needs_review" />
              <TriageBadge prefix="AI:" verdict="likely_false_positive" />
              <TriageBadge prefix="AI:" verdict="false_positive" />
              <TriageBadge prefix="AI:" verdict={null} />
              <TriageBadge prefix="AI:" verdict={null} status="failed" />
            </div>
          </CardBody>
        </Card>
      </section>

      {/* 3. NOTICES */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Notices</h2>
        <div className="space-y-3">
          <Notice tone="neutral" icon={Info}>
            This is a neutral notice without actions.
          </Notice>
          <Notice
            tone="info"
            icon={AlertCircle}
            actions={<Button size="sm" variant="primary">Review Advice</Button>}
          >
            Generated with an older explanation prompt. Regenerate for updated triage recommendations.
          </Notice>
        </div>
      </section>

      {/* 4. CARDS & SECTIONS */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Card Hierarchy</h2>
        <Card data-testid="card-incident-summary">
          <CardHeader
            title="Incident Summary"
            description="High-level incident properties and metadata."
            actions={<Button size="sm">Export Report</Button>}
          />
          <CardBody className="space-y-4">
            <PropertyBar
              items={[
                { label: "Host", value: "WS01" },
                { label: "User", value: "CORP\\alice" },
                { label: "Scenario", value: "credential_dump_chain" },
                { label: "Raised", value: "11 Sep 2026, 21:02:13" },
              ]}
            />
            <div className="border-t border-line pt-4">
              <KeyValueList
                items={[
                  { label: "Trigger Rule", value: "Suspicious LSASS memory access via direct syscalls" },
                  { label: "Target IPs", value: "192.168.1.105, 10.0.4.12, 172.16.0.44" },
                  { label: "Process Chain", value: "explorer.exe (pid 1420) -> cmd.exe (pid 3840) -> mimikatz.exe (pid 5912)" },
                ]}
              />
            </div>
          </CardBody>
        </Card>
      </section>

      {/* 5. TOOLTIP & TIME */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Tooltip and Time Component</h2>
        <Card>
          <CardBody className="flex flex-wrap items-center gap-6">
            <Tooltip content="Tooltip details displayed on hover or keyboard focus">
              <Button size="sm">Hover or focus me</Button>
            </Tooltip>

            <div className="text-sm text-ink">
              Semantic Time element:{" "}
              <Time data-testid="semantic-time" iso="2026-09-11T14:02:13.400Z" timeZone="Asia/Phnom_Penh" className="font-medium" />
            </div>
          </CardBody>
        </Card>
      </section>

      {/* 6. TIME FORMATTER MATRIX */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          Time Formatter Test Matrix
        </h2>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-surface-subtle text-ink-muted">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Raw Input</th>
                  <th className="py-2.5 px-3 font-semibold">formatDateTime (UTC)</th>
                  <th className="py-2.5 px-3 font-semibold">formatDateTime (UTC+7)</th>
                  <th className="py-2.5 px-3 font-semibold">formatTime (UTC)</th>
                  <th className="py-2.5 px-3 font-semibold">formatTime (UTC+7)</th>
                  <th className="py-2.5 px-3 font-semibold">formatUtc</th>
                  <th className="py-2.5 px-3 font-semibold">formatRelative</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink">
                {fixedInputs.map((val, idx) => (
                  <tr key={idx} className="hover:bg-surface-subtle">
                    <td className="py-2 px-3 font-mono text-ink-muted">{val === null ? "null" : val}</td>
                    <td className="py-2 px-3">{formatDateTime(val, "UTC")}</td>
                    <td className="py-2 px-3">{formatDateTime(val, "Asia/Phnom_Penh")}</td>
                    <td className="py-2 px-3">{formatTime(val, "UTC")}</td>
                    <td className="py-2 px-3">{formatTime(val, "Asia/Phnom_Penh")}</td>
                    <td className="py-2 px-3 font-mono">{formatUtc(val)}</td>
                    <td className="py-2 px-3">{formatRelative(val, "2026-09-28T02:00:00.000Z")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-line text-xs text-ink-subtle flex gap-6">
            <span>Timezone Label (UTC): {tzLabel("UTC")}</span>
            <span>Timezone Label (Asia/Phnom_Penh): {tzLabel("Asia/Phnom_Penh")}</span>
          </div>
        </Card>
      </section>
    </div>
  );
}
