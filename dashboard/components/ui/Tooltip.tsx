"use client";

import React, { useEffect, useId, useRef, useState } from "react";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  delayMs?: number;
  className?: string;
  side?: "top" | "bottom";
}

export function Tooltip({
  content,
  children,
  delayMs = 150,
  className = "",
  side = "top",
}: TooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const id = useId();

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, delayMs);
  };

  const hide = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        hide();
      }
    };

  if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={isOpen ? id : undefined}
    >
      {children}
      {isOpen && (
        <span
          id={id}
          role="tooltip"
          className={`absolute z-50 -translate-x-1/2 left-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-xs text-surface border border-line-strong select-none ${
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
          }`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
