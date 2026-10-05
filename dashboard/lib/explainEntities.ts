export type EntityKind = "host" | "user" | "pid" | "ip" | "path" | "file" | "technique";

export interface Token {
  kind: EntityKind | "timestamp" | "text";
  text: string;
  display?: string;
  value?: string;
}

export interface Entity {
  kind: EntityKind;
  value: string;
}

const SECURITY_TERMS: ReadonlySet<string> = new Set([
  "SHA1", "SHA256", "MD5", "AES256", "TLS1", "TLS12",
  "HTTP2", "SMB1", "SMB2", "SMB3", "SMBV1", "NTLMV2",
  "IPV4", "IPV6", "BASE64", "UTF8", "UTF16",
  "WIN10", "WIN11", "AMD64", "X64", "X86",
]);

const TRAILING_PUNCT = ".,;:!?)]}\"'";

const KIND_ORDER: Record<EntityKind, number> = {
  host: 0,
  user: 1,
  pid: 2,
  ip: 3,
  path: 4,
  file: 5,
  technique: 6,
};

const PRECEDENCE: Record<EntityKind | "timestamp", number> = {
  timestamp: 0,
  path: 1,
  user: 2,
  ip: 3,
  host: 4,
  pid: 5,
  technique: 6,
  file: 7,
};

interface RawMatch {
  kind: EntityKind | "timestamp";
  start: number;
  end: number;
  text: string;
  value: string;
  display?: string;
  precedence: number;
}

export function isCheckedKind(kind: string): boolean {
  return kind === "pid" || kind === "ip" || kind === "path" || kind === "host";
}

export function shortenPath(p: string): string {
  if (p.length <= 40) return p;
  const segments = p.split("\\");
  if (segments.length <= 2) return p;
  const lastTwo = segments.slice(-2).join("\\");
  return `...\\${lastTwo}`;
}

export function matchesUngrounded(
  entity: { kind: EntityKind; value: string },
  ungrounded: string[],
): boolean {
  if (!ungrounded || ungrounded.length === 0) return false;
  if (entity.kind === "pid") {
    const entityDigits = entity.value.replace(/\D/g, "");
    if (!entityDigits) return false;
    return ungrounded.some((u) => u.replace(/\D/g, "") === entityDigits);
  }
  if (entity.kind === "path") {
    const clean = (s: string) => {
      let r = s.replace(/\\\\/g, "\\");
      while (r.length > 0 && TRAILING_PUNCT.includes(r[r.length - 1])) {
        r = r.slice(0, -1);
      }
      return r.toLowerCase();
    };
    const target = clean(entity.value);
    return ungrounded.some((u) => clean(u) === target);
  }
  if (entity.kind === "ip" || entity.kind === "host") {
    return ungrounded.includes(entity.value);
  }
  return false;
}

export function tokenize(
  text: string,
  opts?: { formatTimestamp?: (iso: string) => string },
): Token[] {
  if (!text) return [];

  const candidates: RawMatch[] = [];

  // 1. Timestamp: ISO 8601 UTC with Z, optional fraction
  const timestampRe = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
  let match: RegExpExecArray | null;
  while ((match = timestampRe.exec(text)) !== null) {
    const iso = match[0];
    const display = opts?.formatTimestamp ? opts.formatTimestamp(iso) : iso;
    candidates.push({
      kind: "timestamp",
      start: match.index,
      end: match.index + iso.length,
      text: iso,
      value: iso,
      display,
      precedence: PRECEDENCE.timestamp,
    });
  }

  // 2. Path: drive-letter and UNC
  const pathRe = /(?:\b[A-Za-z]:|\\\\[^\\/:*?"<>|\r\n\s]+)\\(?:[^\\/:*?"<>|\r\n\s]+\\)*[^\\/:*?"<>|\r\n\s]+/g;
  while ((match = pathRe.exec(text)) !== null) {
    let p = match[0];
    let end = match.index + p.length;
    while (p.length > 0 && TRAILING_PUNCT.includes(p[p.length - 1])) {
      p = p.slice(0, -1);
      end--;
    }
    if (p.length > 0) {
      candidates.push({
        kind: "path",
        start: match.index,
        end,
        text: p,
        value: p,
        precedence: PRECEDENCE.path,
      });
    }
  }

  // 3. User: DOMAIN\name, not drive-letter or UNC
  const userRe = /\b[A-Za-z0-9_-]+\\[A-Za-z0-9_.-]+\b/g;
  while ((match = userRe.exec(text)) !== null) {
    const raw = match[0];
    if (!/^[A-Za-z]:\\/.test(raw) && !raw.startsWith("\\\\")) {
      candidates.push({
        kind: "user",
        start: match.index,
        end: match.index + raw.length,
        text: raw,
        value: raw,
        precedence: PRECEDENCE.user,
      });
    }
  }

  // 4. IP: IPv4
  const ipRe = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  while ((match = ipRe.exec(text)) !== null) {
    const raw = match[0];
    candidates.push({
      kind: "ip",
      start: match.index,
      end: match.index + raw.length,
      text: raw,
      value: raw,
      precedence: PRECEDENCE.ip,
    });
  }

  // 5. Host: uppercase-led alphanumeric with digit, length >= 4, not in SECURITY_TERMS or technique ID
  const hostRe = /\b[A-Z][A-Z0-9-]*\d[A-Z0-9-]*\b/g;
  while ((match = hostRe.exec(text)) !== null) {
    const raw = match[0];
    if (raw.length >= 4 && !SECURITY_TERMS.has(raw.toUpperCase()) && !/^T\d{4}(?:\.\d{3})?$/i.test(raw)) {
      candidates.push({
        kind: "host",
        start: match.index,
        end: match.index + raw.length,
        text: raw,
        value: raw,
        precedence: PRECEDENCE.host,
      });
    }
  }

  // 6. PID: "PID" through the digits only, leaving surrounding parentheses outside; value is the bare digits
  const pidRe = /\bPID\s*[:#]?\s*(\d{2,7})\b/gi;
  while ((match = pidRe.exec(text)) !== null) {
    const raw = match[0];
    const digits = match[1];
    candidates.push({
      kind: "pid",
      start: match.index,
      end: match.index + raw.length,
      text: raw,
      value: digits,
      precedence: PRECEDENCE.pid,
    });
  }

  // 7. Technique: T\d{4}(\.\d{3})?
  const techniqueRe = /\bT\d{4}(?:\.\d{3})?\b/g;
  while ((match = techniqueRe.exec(text)) !== null) {
    const raw = match[0];
    candidates.push({
      kind: "technique",
      start: match.index,
      end: match.index + raw.length,
      text: raw,
      value: raw,
      precedence: PRECEDENCE.technique,
    });
  }

  // 8. File: extension-based
  const fileRe = /\b[\w.-]+\.(?:exe|dll|sys|ps1|bat|cmd|vbs|js|scr|dmp|msi|lnk|docm|xlsm)\b/gi;
  while ((match = fileRe.exec(text)) !== null) {
    const raw = match[0];
    candidates.push({
      kind: "file",
      start: match.index,
      end: match.index + raw.length,
      text: raw,
      value: raw,
      precedence: PRECEDENCE.file,
    });
  }

  // Sort candidates: start ascending, then length descending, then precedence ascending
  candidates.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    return a.precedence - b.precedence;
  });

  // Greedily keep non-overlapping matches
  const kept: RawMatch[] = [];
  let lastEnd = 0;
  for (const cand of candidates) {
    if (cand.start >= lastEnd) {
      kept.push(cand);
      lastEnd = cand.end;
    }
  }

  // Construct lossless tokens
  const tokens: Token[] = [];
  let curr = 0;
  for (const match of kept) {
    if (match.start > curr) {
      tokens.push({
        kind: "text",
        text: text.slice(curr, match.start),
      });
    }
    tokens.push({
      kind: match.kind,
      text: match.text,
      value: match.value,
      display: match.display,
    });
    curr = match.end;
  }
  if (curr < text.length) {
    tokens.push({
      kind: "text",
      text: text.slice(curr),
    });
  }

  return tokens;
}

export function entitiesOf(texts: string[]): Entity[] {
  const seen = new Set<string>();
  const list: Array<Entity & { firstIndex: number }> = [];
  let globalOrder = 0;

  for (const t of texts) {
    if (!t) continue;
    const tokens = tokenize(t);
    for (const tok of tokens) {
      if (tok.kind === "text" || tok.kind === "timestamp") continue;
      const kind = tok.kind as EntityKind;
      let val = tok.value ?? tok.text;
      // Strip trailing punctuation from path values if any
      if (kind === "path") {
        while (val.length > 0 && TRAILING_PUNCT.includes(val[val.length - 1])) {
          val = val.slice(0, -1);
        }
      }
      const normVal = kind === "path" ? val.toLowerCase() : val;
      const key = `${kind}:${normVal}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          kind,
          value: val,
          firstIndex: globalOrder++,
        });
      }
    }
  }

  list.sort((a, b) => {
    const kDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (kDiff !== 0) return kDiff;
    return a.firstIndex - b.firstIndex;
  });

  return list.map(({ kind, value }) => ({ kind, value }));
}

export interface ToMarkdownArgs {
  incidentId: string;
  generatedUtc: string;
  modelLabel: string;
  summary: string;
  objective?: string;
  nextSteps?: string[];
  notableDetails?: string[];
  caveats?: string[];
}

export function toMarkdown({
  incidentId,
  generatedUtc,
  modelLabel,
  summary,
  objective,
  nextSteps,
  notableDetails,
  caveats,
}: ToMarkdownArgs): string {
  const lines: string[] = [
    "## AI analysis (advisory, AI generated)",
    "",
    `Incident: ${incidentId}`,
    `Generated: ${generatedUtc}${modelLabel ? ` by ${modelLabel}` : ""}`,
    "",
    "### Summary",
    summary,
  ];

  if (objective && objective.trim()) {
    lines.push("", `Likely objective: ${objective}`);
  }

  if (nextSteps && nextSteps.length > 0) {
    lines.push("", "### Next steps");
    nextSteps.forEach((step, idx) => {
      lines.push(`${idx + 1}. ${step}`);
    });
  }

  if (notableDetails && notableDetails.length > 0) {
    lines.push("", "### Notable details");
    notableDetails.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }

  if (caveats && caveats.length > 0) {
    lines.push("", "### Caveats");
    caveats.forEach((item) => {
      lines.push(`- ${item}`);
    });
  }

  return lines.join("\n");
}

