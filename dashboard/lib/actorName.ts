// The name recorded on case changes. Pure and import-free. It is only a label:
// the dashboard has one shared login, so names are not verified.
export const ACTOR_STORAGE_KEY = "csa-actor-name";
export const DEFAULT_ACTOR_NAME = "Analyst";
export const MAX_ACTOR_NAME_LENGTH = 64;

export function sanitizeActorName(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_ACTOR_NAME;
  const cleaned = raw
    .replace(/[\t\n\r]/g, " ") // whitespace controls become spaces
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "") // every other control character is dropped
    .replace(/\s+/g, " ")
    .trim();
  const clipped = Array.from(cleaned).slice(0, MAX_ACTOR_NAME_LENGTH).join("").trim();
  return clipped === "" ? DEFAULT_ACTOR_NAME : clipped;
}
