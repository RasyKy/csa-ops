import { expect, test } from "@playwright/test";
import {
  entitiesOf,
  isCheckedKind,
  matchesUngrounded,
  shortenPath,
  tokenize,
  toMarkdown,
} from "../lib/explainEntities";

test.describe("explainEntities unit tests", () => {
  test("losslessness on at least 8 diverse strings", () => {
    const testStrings = [
      // 1. Empty string
      "",
      // 2. Plain text with no entities
      "This is a simple analysis notice with no entities or timestamps at all.",
      // 3. String with every entity kind: host, user, pid, ip, path, file, technique, timestamp
      "At 2026-09-28T01:25:00.172Z, host WS01 saw user CORP\\alice execute C:\\Users\\alice\\AppData\\Local\\Temp\\payload.exe (PID 4412) connecting to 192.168.1.50 using technique T1059.001 and dropping script.ps1.",
      // 4. UNC path with trailing punctuation and parentheses
      "File located at \\\\SRV01\\share\\data.dmp! Also saw (PID: 9999).",
      // 5. Hostnames and security abbreviations
      "Communication from DC01 and SRV-042 via TLS12 and SHA256 over SMB2.",
      // 6. Multiple adjacent punctuation and brackets
      "[Alert]: Path [C:\\Windows\\System32\\cmd.exe], user 'CORP\\bob', ip 10.0.0.1; check T1003.",
      // 7. Whitespace, newlines, and tabs
      "Line 1: WS02\nLine 2:\tC:\\temp\\log.txt\r\nLine 3: PID 1010",
      // 8. Edge case combinations
      "No match C2 contact with PID 888 and file other.dll at 2026-10-04T12:00:00Z.",
    ];

    expect(testStrings.length).toBeGreaterThanOrEqual(8);

    for (const str of testStrings) {
      const tokens = tokenize(str);
      const joined = tokens.map((t) => t.text).join("");
      expect(joined).toBe(str);
    }
  });

  test("C2 contact and SHA256 yield no entities", () => {
    const tokensC2 = tokenize("exfiltration or C2 contact");
    const entitiesC2 = tokensC2.filter((t) => t.kind !== "text" && t.kind !== "timestamp");
    expect(entitiesC2).toHaveLength(0);

    const tokensSha = tokenize("Computed SHA256 hash");
    const entitiesSha = tokensSha.filter((t) => t.kind !== "text" && t.kind !== "timestamp");
    expect(entitiesSha).toHaveLength(0);
  });

  test("hosts, users, paths, pids, techniques, and timestamps detection rules", () => {
    // Hosts: WS01, DC01, SRV-042
    const hostTokens = tokenize("Machines WS01, DC01 and SRV-042 were active.");
    const hosts = hostTokens.filter((t) => t.kind === "host").map((t) => t.text);
    expect(hosts).toEqual(["WS01", "DC01", "SRV-042"]);

    // User vs path: CORP\alice is user, not path
    const userTokens = tokenize("Logged in as CORP\\alice.");
    const users = userTokens.filter((t) => t.kind === "user");
    expect(users).toHaveLength(1);
    expect(users[0].text).toBe("CORP\\alice");
    expect(userTokens.filter((t) => t.kind === "path")).toHaveLength(0);

    // Path trailing period: C:\Users\alice\AppData\Local\Temp\lsass.dmp. is one path excluding period
    const pathWithPeriodTokens = tokenize(
      "Dumped to C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp.",
    );
    const paths = pathWithPeriodTokens.filter((t) => t.kind === "path");
    expect(paths).toHaveLength(1);
    expect(paths[0].text).toBe("C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp");
    const trailingPeriodToken = pathWithPeriodTokens.find((t) => t.text === ".");
    expect(trailingPeriodToken).toBeDefined();
    expect(trailingPeriodToken?.kind).toBe("text");

    // UNC path: \\SRV01\share\x.txt is one path
    const uncTokens = tokenize("Accessed \\\\SRV01\\share\\x.txt.");
    const uncPaths = uncTokens.filter((t) => t.kind === "path");
    expect(uncPaths).toHaveLength(1);
    expect(uncPaths[0].text).toBe("\\\\SRV01\\share\\x.txt");

    // Filename inside path is not a separate file token
    const fileTokensInPath = pathWithPeriodTokens.filter((t) => t.kind === "file");
    expect(fileTokensInPath).toHaveLength(0);

    // PID 4412 gives pid with value "4412"
    const pidTokens = tokenize("Process PID 4412 terminated.");
    const pids = pidTokens.filter((t) => t.kind === "pid");
    expect(pids).toHaveLength(1);
    expect(pids[0].text).toBe("PID 4412");
    expect(pids[0].value).toBe("4412");

    // (PID 1280) keeps parentheses outside the chip
    const parenPidTokens = tokenize("Observed (PID 1280) running.");
    const parenPid = parenPidTokens.find((t) => t.kind === "pid");
    expect(parenPid).toBeDefined();
    expect(parenPid?.text).toBe("PID 1280");
    expect(parenPid?.value).toBe("1280");
    expect(parenPidTokens.map((t) => t.text).join("")).toBe("Observed (PID 1280) running.");

    // Technique: T1059.001 and T1003 are techniques, T12 is not
    const techTokens = tokenize("Used T1059.001 and T1003 but not T12.");
    const techniques = techTokens.filter((t) => t.kind === "technique").map((t) => t.text);
    expect(techniques).toEqual(["T1059.001", "T1003"]);
    expect(techniques).not.toContain("T12");

    // Timestamp: 2026-09-28T01:25:00.172Z token and stub formatter
    const tsTokens = tokenize("Happened at 2026-09-28T01:25:00.172Z.", {
      formatTimestamp: (iso) => `Formatted: ${iso}`,
    });
    const ts = tsTokens.find((t) => t.kind === "timestamp");
    expect(ts).toBeDefined();
    expect(ts?.text).toBe("2026-09-28T01:25:00.172Z");
    expect(ts?.display).toBe("Formatted: 2026-09-28T01:25:00.172Z");
    expect(tsTokens.map((t) => t.text).join("")).toBe("Happened at 2026-09-28T01:25:00.172Z.");
  });

  test("entitiesOf dedupes the same path with different case and with a trailing period", () => {
    const texts = [
      "Wrote to C:\\Users\\alice\\AppData\\Local\\Temp\\lsass.dmp.",
      "Also accessed c:\\users\\alice\\appdata\\local\\temp\\lsass.dmp",
      "Repeated C:\\USERS\\ALICE\\APPDATA\\LOCAL\\TEMP\\LSASS.DMP",
    ];
    const entities = entitiesOf(texts);
    const pathEntities = entities.filter((e) => e.kind === "path");
    expect(pathEntities).toHaveLength(1);
    expect(pathEntities[0].value.toLowerCase()).toBe(
      "c:\\users\\alice\\appdata\\local\\temp\\lsass.dmp",
    );
  });

  test("matchesUngrounded behaves correctly for pid, path, and ip", () => {
    // pid "4412" matches "PID 4412" entity
    expect(
      matchesUngrounded({ kind: "pid", value: "4412" }, ["4412"]),
    ).toBe(true);
    expect(
      matchesUngrounded({ kind: "pid", value: "PID 4412" }, ["4412"]),
    ).toBe(true);
    expect(
      matchesUngrounded({ kind: "pid", value: "4412" }, ["PID 4412"]),
    ).toBe(true);
    expect(
      matchesUngrounded({ kind: "pid", value: "4412" }, ["9999"]),
    ).toBe(false);

    // path matching is case-insensitive and tolerant of doubled backslashes
    expect(
      matchesUngrounded(
        { kind: "path", value: "c:\\temp\\file.txt" },
        ["C:\\\\TEMP\\\\file.txt."],
      ),
    ).toBe(true);
    expect(
      matchesUngrounded(
        { kind: "path", value: "C:\\Temp\\File.txt" },
        ["c:\\temp\\file.txt"],
      ),
    ).toBe(true);

    // IP not in list does not match
    expect(
      matchesUngrounded({ kind: "ip", value: "192.168.1.1" }, ["10.0.0.1", "10.0.0.2"]),
    ).toBe(false);
    expect(
      matchesUngrounded({ kind: "ip", value: "10.0.0.1" }, ["10.0.0.1", "10.0.0.2"]),
    ).toBe(true);
  });

  test("shortenPath shortens paths > 40 chars to ...\\lastTwoSegments", () => {
    expect(shortenPath("C:\\short\\path.exe")).toBe("C:\\short\\path.exe");
    const longPath = "C:\\Users\\alice\\AppData\\Local\\Temp\\very_long_directory_name\\lsass.dmp";
    expect(longPath.length).toBeGreaterThan(40);
    expect(shortenPath(longPath)).toBe("...\\very_long_directory_name\\lsass.dmp");
  });

  test("isCheckedKind identifies checked entities", () => {
    expect(isCheckedKind("pid")).toBe(true);
    expect(isCheckedKind("ip")).toBe(true);
    expect(isCheckedKind("path")).toBe(true);
    expect(isCheckedKind("host")).toBe(true);
    expect(isCheckedKind("user")).toBe(false);
    expect(isCheckedKind("file")).toBe(false);
    expect(isCheckedKind("technique")).toBe(false);
  });

  test("toMarkdown matches the exact template for full input, empty objective, and empty caveats", () => {
    // 1. Full input
    const full = toMarkdown({
      incidentId: "inc-0001",
      generatedUtc: "2026-10-04 12:00:00 UTC",
      modelLabel: "deepseek-chat",
      summary: "This is a full summary.",
      objective: "Credential dumping.",
      nextSteps: ["Isolate host", "Revoke credentials"],
      notableDetails: ["Accessed LSASS memory"],
      caveats: ["Advisory only"],
    });

    const expectedFull = [
      "## AI analysis (advisory, AI generated)",
      "",
      "Incident: inc-0001",
      "Generated: 2026-10-04 12:00:00 UTC by deepseek-chat",
      "",
      "### Summary",
      "This is a full summary.",
      "",
      "Likely objective: Credential dumping.",
      "",
      "### Next steps",
      "1. Isolate host",
      "2. Revoke credentials",
      "",
      "### Notable details",
      "- Accessed LSASS memory",
      "",
      "### Caveats",
      "- Advisory only",
    ].join("\n");

    expect(full).toBe(expectedFull);

    // 2. Empty objective
    const noObj = toMarkdown({
      incidentId: "inc-0002",
      generatedUtc: "2026-10-04 12:00:00 UTC",
      modelLabel: "deepseek-chat",
      summary: "Summary with no objective.",
      objective: "",
      nextSteps: ["Step 1"],
      notableDetails: ["Detail 1"],
      caveats: ["Caveat 1"],
    });

    expect(noObj).not.toContain("Likely objective:");
    expect(noObj).toContain("### Summary\nSummary with no objective.\n\n### Next steps");

    // 3. Empty caveats
    const noCaveats = toMarkdown({
      incidentId: "inc-0003",
      generatedUtc: "2026-10-04 12:00:00 UTC",
      modelLabel: "",
      summary: "Summary with no caveats.",
      objective: "Some objective.",
      nextSteps: ["Step 1"],
      notableDetails: ["Detail 1"],
      caveats: [],
    });

    expect(noCaveats).not.toContain("### Caveats");
    expect(noCaveats).not.toContain("Generated: 2026-10-04 12:00:00 UTC by");
    expect(noCaveats).toContain("Generated: 2026-10-04 12:00:00 UTC\n\n### Summary");
  });
});

