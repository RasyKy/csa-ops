import { describeResponseAction as describe } from "./responseText";
import type { ResponseAction } from "./types";

// Plain-language description of a single response action. The wording lives in
// lib/responseText.ts so the Incidents list and the Response history card
// always agree.
export function describeResponseAction(a: ResponseAction): string {
  return describe(a);
}
