"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";

export function ExportReportDropdown({ incidentId }: { incidentId: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={buttonClasses({ variant: "secondary", size: "md" })}
        aria-expanded={open}
      >
        <span>Export report</span>
        <ChevronDown
          className={`h-4 w-4 text-ink-subtle transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-36 rounded-lg border border-line bg-surface py-1">
          <a
            href={`/api/incidents/${incidentId}/report?format=md`}
            download
            onClick={() => setOpen(false)}
            className="flex h-8 items-center px-3 text-sm text-ink hover:bg-surface-subtle transition-colors"
          >
            Markdown
          </a>
          <a
            href={`/api/incidents/${incidentId}/report?format=pdf`}
            download
            onClick={() => setOpen(false)}
            className="flex h-8 items-center px-3 text-sm text-ink hover:bg-surface-subtle transition-colors"
          >
            PDF
          </a>
        </div>
      )}
    </div>
  );
}
