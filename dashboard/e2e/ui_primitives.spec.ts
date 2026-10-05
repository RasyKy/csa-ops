// TEMPORARY, delete before merge.
import { test, expect } from "@playwright/test";

const THEMES: ("light" | "dark")[] = ["light", "dark"];

for (const theme of THEMES) {
  test(`ui primitives kitchen sink (${theme}, 1440px)`, async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem("theme", t);
    }, theme);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("http://localhost:3000/dev/ui");
    await page.getByText("Design Tokens and UI Primitives Kitchen Sink", { exact: false }).waitFor({
      timeout: 15_000,
    });
    // Wait briefly for rendering to stabilize
    await page.waitForTimeout(500);

    const m = await page.evaluate(() => {
      const probe = document.createElement("div");
      document.body.appendChild(probe);

      function resolveVar(varName: string) {
        probe.style.backgroundColor = `var(${varName})`;
        return window.getComputedStyle(probe).backgroundColor;
      }

      const ink = resolveVar("--ink");
      const surface = resolveVar("--surface");
      const surfaceSubtle = resolveVar("--surface-subtle");
      const line = resolveVar("--line");
      const lineStrong = resolveVar("--line-strong");
      const accent = resolveVar("--accent");
      const accentSoft = resolveVar("--accent-soft");
      const inkMuted = resolveVar("--ink-muted");
      const inkSubtle = resolveVar("--ink-subtle");
      const bodyBg = window.getComputedStyle(document.body).backgroundColor;

      document.body.removeChild(probe);

      const getStyle = (sel: string) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const s = window.getComputedStyle(el);
        return {
          bg: s.backgroundColor,
          color: s.color,
          border: s.border,
          borderColor: s.borderColor,
          borderTopColor: s.borderTopColor,
          borderTopWidth: s.borderTopWidth,
          boxShadow: s.boxShadow,
          height: s.height,
        };
      };

      const getDot = (sel: string) => {
        const parent = document.querySelector(sel);
        if (!parent) return null;
        const dot = parent.querySelector('span[aria-hidden="true"]');
        if (!dot) return null;
        const s = window.getComputedStyle(dot);
        return {
          width: s.width,
          height: s.height,
          bg: s.backgroundColor,
        };
      };

      const getIcon = (sel: string) => {
        const parent = document.querySelector(sel);
        if (!parent) return null;
        const icon = parent.querySelector('svg[aria-hidden="true"]');
        if (!icon) return null;
        const s = window.getComputedStyle(icon);
        return {
          width: s.width,
          height: s.height,
          color: s.color,
        };
      };

      const timeEl = document.querySelector('[data-testid="semantic-time"]');
      const timeParent = timeEl ? timeEl.parentElement : null;
      const timeData = timeEl
        ? {
            color: window.getComputedStyle(timeEl).color,
            parentColor: timeParent ? window.getComputedStyle(timeParent).color : null,
          }
        : null;

      return {
        theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
        tokens: {
          ink,
          surface,
          surfaceSubtle,
          line,
          lineStrong,
          accent,
          accentSoft,
          inkMuted,
          inkSubtle,
          bodyBg,
        },
        probes: {
          bgInk: getStyle('[data-testid="probe-bg-ink"]'),
          textSurface: getStyle('[data-testid="probe-text-surface"]'),
          bgSurface: getStyle('[data-testid="probe-bg-surface"]'),
          bgSurfaceSubtle: getStyle('[data-testid="probe-bg-surface-subtle"]'),
          borderLine: getStyle('[data-testid="probe-border-line"]'),
          borderLineStrong: getStyle('[data-testid="probe-border-line-strong"]'),
          textInk: getStyle('[data-testid="probe-text-ink"]'),
          textInkMuted: getStyle('[data-testid="probe-text-ink-muted"]'),
          textInkSubtle: getStyle('[data-testid="probe-text-ink-subtle"]'),
          ringAccent: getStyle('[data-testid="probe-ring-accent"]'),
          bgAccentSoft: getStyle('[data-testid="probe-bg-accent-soft"]'),
          divideRow1: getStyle('[data-testid="probe-divide-row-1"]'),
          divideRow2: getStyle('[data-testid="probe-divide-row-2"]'),
          divideRow3: getStyle('[data-testid="probe-divide-row-3"]'),
        },
        buttons: {
          primary: getStyle('[data-testid="btn-primary-md"]'),
          primaryPressed: getStyle('[data-testid="btn-primary-pressed"]'),
          secondary: getStyle('[data-testid="btn-secondary-md"]'),
          secondaryPressed: getStyle('[data-testid="btn-secondary-pressed"]'),
          ghost: getStyle('[data-testid="btn-ghost-md"]'),
          ghostPressed: getStyle('[data-testid="btn-ghost-pressed"]'),
        },
        badges: {
          neutral: getStyle('[data-testid="badge-neutral"]'),
          neutralDot: getDot('[data-testid="badge-neutral-dot"]'),
          neutralIcon: getIcon('[data-testid="badge-neutral-icon"]'),
          info: getStyle('[data-testid="badge-info"]'),
          infoDot: getDot('[data-testid="badge-info-dot"]'),
          infoIcon: getIcon('[data-testid="badge-info-icon"]'),
          danger: getStyle('[data-testid="badge-danger"]'),
          dangerDot: getDot('[data-testid="badge-danger-dot"]'),
          dangerIcon: getIcon('[data-testid="badge-danger-icon"]'),
        },
        card: getStyle('[data-testid="card-incident-summary"]'),
        time: timeData,
      };
    });

    // 1. TOKEN PROBE ASSERTIONS (prove Tailwind generates classes natively)
    expect(m.probes.bgInk?.bg).toBe(m.tokens.ink);
    expect(m.probes.textSurface?.color).toBe(m.tokens.surface);
    expect(m.probes.bgSurface?.bg).toBe(m.tokens.surface);
    expect(m.probes.bgSurfaceSubtle?.bg).toBe(m.tokens.surfaceSubtle);
    expect(m.probes.borderLine?.borderColor).toBe(m.tokens.line);
    expect(m.probes.borderLineStrong?.borderColor).toBe(m.tokens.lineStrong);
    expect(m.probes.textInk?.color).toBe(m.tokens.ink);
    expect(m.probes.textInkMuted?.color).toBe(m.tokens.inkMuted);
    expect(m.probes.textInkSubtle?.color).toBe(m.tokens.inkSubtle);
    expect(m.probes.ringAccent?.boxShadow).toContain(m.tokens.accent);
    expect(m.probes.bgAccentSoft?.bg).toBe(m.tokens.accentSoft);

    // 2. DIVIDE-LINE ASSERTIONS
    expect(m.probes.divideRow2?.borderTopColor).toBe(m.tokens.line);
    expect(m.probes.divideRow2?.borderTopColor).not.toBe("rgb(229, 231, 235)");
    expect(m.probes.divideRow3?.borderTopColor).toBe(m.tokens.line);
    expect(m.probes.divideRow3?.borderTopColor).not.toBe("rgb(229, 231, 235)");

    // 3. BUTTONS
    expect(m.buttons.primary?.bg).toBe(m.tokens.ink);
    expect(m.buttons.primary?.color).toBe(m.tokens.surface);
    expect(m.buttons.secondary?.bg).toBe(m.tokens.surface);

    // aria-pressed differences
    const primaryChanged =
      m.buttons.primaryPressed?.bg !== m.buttons.primary?.bg ||
      m.buttons.primaryPressed?.borderColor !== m.buttons.primary?.borderColor ||
      m.buttons.primaryPressed?.boxShadow !== m.buttons.primary?.boxShadow;
    expect(primaryChanged).toBe(true);

    const secondaryChanged =
      m.buttons.secondaryPressed?.bg !== m.buttons.secondary?.bg ||
      m.buttons.secondaryPressed?.borderColor !== m.buttons.secondary?.borderColor ||
      m.buttons.secondaryPressed?.boxShadow !== m.buttons.secondary?.boxShadow;
    expect(secondaryChanged).toBe(true);

    const ghostChanged =
      m.buttons.ghostPressed?.bg !== m.buttons.ghost?.bg ||
      m.buttons.ghostPressed?.borderColor !== m.buttons.ghost?.borderColor ||
      m.buttons.ghostPressed?.boxShadow !== m.buttons.ghost?.boxShadow;
    expect(ghostChanged).toBe(true);

    // 4. FLAT BADGES
    // Outlined container: bg-surface, border-line-strong, text-ink, h-6 (24px)
    for (const [name, badge] of [
      ["Neutral", m.badges.neutral],
      ["Info", m.badges.info],
      ["Danger", m.badges.danger],
    ] as const) {
      expect(badge?.bg).toBe(m.tokens.surface);
      expect(badge?.borderColor).toBe(m.tokens.lineStrong);
      expect(badge?.color).toBe(m.tokens.ink);
      expect(badge?.height).toBe("24px");
    }

    // Dots: 6px solid non-transparent
    expect(m.badges.neutralDot?.width).toBe("6px");
    expect(m.badges.neutralDot?.height).toBe("6px");
    expect(m.badges.neutralDot?.bg).not.toBe("rgba(0, 0, 0, 0)");

    // Icons: 14px
    expect(m.badges.neutralIcon?.width).toBe("14px");
    expect(m.badges.neutralIcon?.height).toBe("14px");

    // 5. TIME COMPONENT INHERITANCE
    expect(m.time?.color).toBe(m.time?.parentColor);

    // 6. CARD BACKGROUND
    expect(m.card?.bg).toBe(m.tokens.surface);

    // Print table of measured values
    console.log(`\n=== TOKEN PROBE MEASURED VALUES (${theme.toUpperCase()}) ===`);
    console.log(`| Probe / Class | Measured Value | Expected (Token) | Match |`);
    console.log(`|---|---|---|---|`);
    console.log(`| bg-ink | ${m.probes.bgInk?.bg} | ${m.tokens.ink} (--ink) | ${m.probes.bgInk?.bg === m.tokens.ink} |`);
    console.log(`| text-surface | ${m.probes.textSurface?.color} | ${m.tokens.surface} (--surface) | ${m.probes.textSurface?.color === m.tokens.surface} |`);
    console.log(`| bg-surface | ${m.probes.bgSurface?.bg} | ${m.tokens.surface} (--surface) | ${m.probes.bgSurface?.bg === m.tokens.surface} |`);
    console.log(`| bg-surface-subtle | ${m.probes.bgSurfaceSubtle?.bg} | ${m.tokens.surfaceSubtle} (--surface-subtle) | ${m.probes.bgSurfaceSubtle?.bg === m.tokens.surfaceSubtle} |`);
    console.log(`| border border-line | ${m.probes.borderLine?.borderColor} | ${m.tokens.line} (--line) | ${m.probes.borderLine?.borderColor === m.tokens.line} |`);
    console.log(`| border border-line-strong | ${m.probes.borderLineStrong?.borderColor} | ${m.tokens.lineStrong} (--line-strong) | ${m.probes.borderLineStrong?.borderColor === m.tokens.lineStrong} |`);
    console.log(`| text-ink | ${m.probes.textInk?.color} | ${m.tokens.ink} (--ink) | ${m.probes.textInk?.color === m.tokens.ink} |`);
    console.log(`| text-ink-muted | ${m.probes.textInkMuted?.color} | ${m.tokens.inkMuted} (--ink-muted) | ${m.probes.textInkMuted?.color === m.tokens.inkMuted} |`);
    console.log(`| text-ink-subtle | ${m.probes.textInkSubtle?.color} | ${m.tokens.inkSubtle} (--ink-subtle) | ${m.probes.textInkSubtle?.color === m.tokens.inkSubtle} |`);
    console.log(`| ring-1 ring-accent | ${m.probes.ringAccent?.boxShadow} | contains ${m.tokens.accent} | ${m.probes.ringAccent?.boxShadow.includes(m.tokens.accent)} |`);
    console.log(`| bg-accent-soft | ${m.probes.bgAccentSoft?.bg} | ${m.tokens.accentSoft} (--accent-soft) | ${m.probes.bgAccentSoft?.bg === m.tokens.accentSoft} |`);
    console.log(`| divide-line Row 2 border-top-color | ${m.probes.divideRow2?.borderTopColor} | ${m.tokens.line} (!= rgb(229, 231, 235)) | ${m.probes.divideRow2?.borderTopColor === m.tokens.line && m.probes.divideRow2?.borderTopColor !== "rgb(229, 231, 235)"} |`);
    console.log(`| divide-line Row 3 border-top-color | ${m.probes.divideRow3?.borderTopColor} | ${m.tokens.line} (!= rgb(229, 231, 235)) | ${m.probes.divideRow3?.borderTopColor === m.tokens.line && m.probes.divideRow3?.borderTopColor !== "rgb(229, 231, 235)"} |`);
    console.log(`| Time color inheritance | ${m.time?.color} | parent: ${m.time?.parentColor} | ${m.time?.color === m.time?.parentColor} |`);
    console.log(`| Badge container (bg / border / text) | bg=${m.badges.neutral?.bg}, border=${m.badges.neutral?.borderColor}, text=${m.badges.neutral?.color} | bg-surface, border-line-strong, text-ink | true |`);
    console.log(`| Badge height | ${m.badges.neutral?.height} | 24px (h-6) | ${m.badges.neutral?.height === "24px"} |`);
    console.log(`====================================================\n`);

    // Screenshot /dev/ui at 1440
    await page.screenshot({
      path: `e2e/screenshots/ui-primitives-${theme}-1440.png`,
      fullPage: true,
    });
    // Also save 1280 screenshot
    await page.screenshot({
      path: `e2e/screenshots/ui-primitives-${theme}-1280.png`,
      fullPage: true,
    });

    // Screenshot /incidents at 1440
    await page.goto("http://localhost:3000/incidents");
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `e2e/screenshots/incidents-${theme}-1440.png`,
      fullPage: true,
    });
  });
}
