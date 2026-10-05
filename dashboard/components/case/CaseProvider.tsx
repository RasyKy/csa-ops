"use client";

import { createContext, useContext, type ReactNode } from "react";

import { useCase, type UseCase } from "./useCase";

const CaseContext = createContext<UseCase | null>(null);

// One case state per incident page, shared by the header and the Case card so
// they never disagree. Renders no DOM of its own.
export function CaseProvider({ incidentId, children }: { incidentId: string; children: ReactNode }) {
  const value = useCase(incidentId);
  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
}

export function useCaseContext(): UseCase {
  const value = useContext(CaseContext);
  if (!value) throw new Error("useCaseContext must be used inside CaseProvider");
  return value;
}
