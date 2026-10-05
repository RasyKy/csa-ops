/**
 * Pure, import-free fetch wrapper with an AbortSignal timeout.
 */

export type FetchTimeoutResult =
  | { readonly ok: true; readonly response: Response }
  | {
      readonly ok: false;
      readonly error: "timeout" | "network_error";
      readonly cause?: unknown;
    };

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = 55000,
): Promise<FetchTimeoutResult> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  let signal: AbortSignal;
  if (init?.signal) {
    if (typeof AbortSignal.any === "function") {
      signal = AbortSignal.any([init.signal, timeoutSignal]);
    } else {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      init.signal.addEventListener("abort", onAbort, { once: true });
      timeoutSignal.addEventListener("abort", onAbort, { once: true });
      signal = controller.signal;
    }
  } else {
    signal = timeoutSignal;
  }

  try {
    const response = await fetch(input, {
      ...init,
      signal,
    });
    return { ok: true, response };
  } catch (err: unknown) {
    const isTimeout =
      timeoutSignal.aborted ||
      (err instanceof Error &&
        (err.name === "TimeoutError" ||
          (err.name === "AbortError" && timeoutSignal.aborted)));
    return {
      ok: false,
      error: isTimeout ? "timeout" : "network_error",
      cause: err,
    };
  }
}
