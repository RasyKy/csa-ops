"""PDF report rendering for CSA-OPS incidents.

Takes the exact Markdown output from build_incident_report_markdown()
and converts it into styled HTML, then renders it to PDF using Playwright
via backend/app/reports/render_pdf.js.
"""
from __future__ import annotations

import os
import pathlib
import re
import shutil
import subprocess
import tempfile
from typing import List, Tuple

_REPORTS_DIR = pathlib.Path(__file__).resolve().parent
RENDER_SCRIPT_PATH = _REPORTS_DIR / "render_pdf.js"

# Stylesheet for PDF rendering
_PDF_CSS = """
@page {
  size: A4;
  margin: 20mm;
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: #111827;
  background: #ffffff;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
  padding: 0;
}

h1 {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid #e5e7eb;
}

h2 {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 20px 0 10px 0;
  padding-bottom: 4px;
  border-bottom: 1px solid #e5e7eb;
}

h3 {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  margin: 14px 0 6px 0;
}

p {
  margin: 6px 0;
}

.report-section {
  margin-bottom: 16px;
}

.header-meta {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 12.5px;
  line-height: 1.6;
}

.header-meta strong {
  color: #374151;
}

.header-meta-item {
  margin: 3px 0;
}

/* Attack chain numbered list */
ol.attack-chain {
  margin: 10px 0;
  padding-left: 24px;
}

ol.attack-chain > li {
  margin-bottom: 14px;
  break-inside: avoid;
}

ol.attack-chain > li::marker {
  font-weight: 700;
  color: #4b5563;
}

.chain-step-title {
  font-weight: 400;
  color: #111827;
  margin-bottom: 4px;
}

.chain-step-title strong {
  font-weight: 600;
  color: #111827;
}

.chain-command-line {
  margin-top: 4px;
  padding-left: 12px;
  color: #4b5563;
  font-size: 12px;
}

/* Code spans & command line styling: wrap long unbroken strings safely */
code, .code-span {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.9em;
  background-color: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 2px 4px;
  color: #111827;
  overflow-wrap: break-word;
  word-break: break-all;
  white-space: pre-wrap;
}

/* Table styling for Response Actions */
table.response-table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 12px;
}

table.response-table th,
table.response-table td {
  border: 1px solid #e5e7eb;
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: break-word;
  word-break: break-word;
}

table.response-table th {
  background-color: #f9fafb;
  font-weight: 600;
  color: #374151;
}

table.response-table tr:nth-child(even) td {
  background-color: #fafafa;
}

/* Callouts / Blockquotes */
.callout {
  padding: 8px 12px;
  margin: 10px 0;
  border-left: 4px solid #9ca3af;
  background-color: #f9fafb;
  border-radius: 0 4px 4px 0;
  font-size: 12px;
}

.callout-caution {
  border-left-color: #ef4444;
  background-color: #fef2f2;
  color: #991b1b;
}

.callout-note {
  border-left-color: #3b82f6;
  background-color: #eff6ff;
  color: #1e40af;
}

/* Lists */
ul.bullet-list {
  margin: 6px 0 10px 0;
  padding-left: 20px;
}

ul.bullet-list li {
  margin-bottom: 3px;
}

.empty-state {
  color: #6b7280;
  font-style: italic;
  margin: 8px 0;
}

hr {
  border: 0;
  border-top: 1px solid #e5e7eb;
  margin: 20px 0;
}

.footer {
  font-size: 11px;
  color: #6b7280;
  margin-top: 12px;
}
"""

_CODE_SPAN_RE = re.compile(r"(`+)(.*?)\1", re.DOTALL)


def _escape_code_span(text: str) -> str:
    """Escapes HTML entities in code spans without escaping single/double quotes."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _render_inline(text: str) -> str:
    """Renders inline CommonMark markdown safely into HTML:
    - Code spans are extracted and HTML-escaped.
    - Non-code text is HTML-escaped.
    - Markdown backslash-escapes (\\*, \\[, \\], \\|, \\<, \\#, \\-, etc.) are unescaped.
    - **bold** and _italic_ tags are converted.
    - Two trailing spaces before newline -> <br>.
    """
    if not text:
        return ""

    parts: List[str] = []
    last_idx = 0

    for match in _CODE_SPAN_RE.finditer(text):
        start, end = match.span()
        if start > last_idx:
            parts.append(_format_prose(text[last_idx:start]))
        code_content = match.group(2)
        # CommonMark space-padding rule: strip 1 leading and trailing space if padded
        if code_content.startswith(" ") and code_content.endswith(" ") and len(code_content) > 2:
            code_content = code_content[1:-1]
        parts.append(f'<code class="code-span">{_escape_code_span(code_content)}</code>')
        last_idx = end

    if last_idx < len(text):
        parts.append(_format_prose(text[last_idx:]))

    return "".join(parts)


def _format_prose(text: str) -> str:
    """Escapes HTML entities in prose, converts bold/italic, unescapes CommonMark punctuation escapes."""
    # 1. Escape ampersands first
    s = text.replace("&", "&amp;")

    # 2. Escape angle brackets: handle both escaped markdown \< and literal <
    s = s.replace(r"\<", "&lt;").replace("<", "&lt;")
    s = s.replace(r"\>", "&gt;").replace(">", "&gt;")

    # 3. Bold: **text**
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)

    # 4. Italics: _text_
    s = re.sub(r"(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])", r"<em>\1</em>", s)

    # 5. Trailing two spaces before newline -> <br>
    s = s.replace("  \n", "<br>\n")

    # 6. Unescape CommonMark backslash escapes (escaped in incident_report.py)
    s = re.sub(r"\\([`*\[\]|#+>-])", r"\1", s)

    return s


def _render_header_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<header class="report-header">']
    meta_lines: List[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("# ") and not stripped.startswith("## "):
            title = stripped[2:].strip()
            body.append(f'  <h1>{_render_inline(title)}</h1>')
        else:
            meta_lines.append(stripped)

    if meta_lines:
        body.append('  <div class="header-meta">')
        for ml in meta_lines:
            clean_ml = ml.rstrip()
            body.append(f'    <div class="header-meta-item">{_render_inline(clean_ml)}</div>')
        body.append('  </div>')

    body.append('</header>')
    return "\n".join(body)


def _render_attack_chain_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<section class="report-section attack-chain-section">', '  <h2>Attack Chain</h2>']
    content_lines = [l.strip() for l in lines[1:] if l.strip()]
    if not content_lines or (len(content_lines) == 1 and "_No events recorded" in content_lines[0]):
        body.append('  <p class="empty-state"><em>No events recorded in this chain.</em></p>')
        body.append('</section>')
        return "\n".join(body)

    items: List[Tuple[str, str]] = []
    curr_title: str | None = None
    curr_cmd: str | None = None

    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue

        step_match = re.match(r"^\*\*(\d+)\.\s*(.*?)\*\*\s*--\s*(.*)$", stripped)
        if step_match:
            if curr_title is not None:
                items.append((curr_title, curr_cmd or ""))
                curr_cmd = None
            step_num, ts, rest = step_match.groups()
            curr_title = f"<strong>{ts}</strong> &mdash; {_render_inline(rest)}"
            continue

        step_fallback = re.match(r"^\*\*(\d+)\.\s*(.*?)$", stripped)
        if step_fallback:
            if curr_title is not None:
                items.append((curr_title, curr_cmd or ""))
                curr_cmd = None
            curr_title = _render_inline(stripped)
            continue

        if stripped.startswith("- Command line:") or stripped.startswith("- _Command line"):
            cmd_content = stripped.lstrip("- ").strip()
            curr_cmd = _render_inline(cmd_content)
            continue

        if curr_title is not None:
            extra = _render_inline(stripped)
            if curr_cmd:
                curr_cmd += f"<br>{extra}"
            else:
                curr_cmd = extra

    if curr_title is not None:
        items.append((curr_title, curr_cmd or ""))

    body.append('  <ol class="attack-chain">')
    for title_html, cmd_html in items:
        body.append('    <li>')
        body.append(f'      <div class="chain-step-title">{title_html}</div>')
        if cmd_html:
            body.append(f'      <div class="chain-command-line">{cmd_html}</div>')
        body.append('    </li>')
    body.append('  </ol>')
    body.append('</section>')
    return "\n".join(body)


def _render_indicators_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<section class="report-section indicators-section">', '  <h2>Indicators</h2>']
    content_lines = [l.strip() for l in lines[1:] if l.strip()]
    if not content_lines or (len(content_lines) == 1 and "_No indicators recorded" in content_lines[0]):
        body.append('  <p class="empty-state"><em>No indicators recorded for this incident.</em></p>')
        body.append('</section>')
        return "\n".join(body)

    body.append('  <ul class="bullet-list">')
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue
        list_match = re.match(r"^(?:\\-|-)\s+(.*)$", stripped)
        if list_match:
            body.append(f'    <li>{_render_inline(list_match.group(1))}</li>')
        else:
            body.append(f'    <li>{_render_inline(stripped)}</li>')
    body.append('  </ul>')
    body.append('</section>')
    return "\n".join(body)


def _render_ai_analysis_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<section class="report-section ai-analysis-section">', '  <h2>AI Analysis</h2>']
    content_lines = [l.strip() for l in lines[1:] if l.strip()]
    if not content_lines or (len(content_lines) == 1 and "No AI explanation has been generated" in content_lines[0]):
        body.append('  <p class="empty-state"><em>No AI explanation has been generated for this incident yet.</em></p>')
        body.append('</section>')
        return "\n".join(body)

    in_list = False
    list_items: List[str] = []

    def flush_list():
        nonlocal in_list, list_items
        if in_list:
            body.append('  <ul class="bullet-list">')
            for item in list_items:
                body.append(f'    <li>{_render_inline(item)}</li>')
            body.append('  </ul>')
            list_items = []
            in_list = False

    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith("### "):
            flush_list()
            heading = stripped[4:].strip()
            body.append(f'  <h3>{_render_inline(heading)}</h3>')
            continue

        list_match = re.match(r"^(?:\\-|-)\s+(.*)$", stripped)
        if list_match:
            in_list = True
            list_items.append(list_match.group(1))
            continue
        elif in_list:
            flush_list()

        if stripped.startswith("> "):
            content = stripped[2:].strip()
            if content.startswith("**Caution:**"):
                body.append(f'  <div class="callout callout-caution">{_render_inline(content)}</div>')
            elif content.startswith("**Note:**"):
                body.append(f'  <div class="callout callout-note">{_render_inline(content)}</div>')
            else:
                body.append(f'  <div class="callout">{_render_inline(content)}</div>')
            continue

        if stripped.startswith("_Generated with ") or stripped.startswith("_None noted._"):
            body.append(f'  <p class="empty-state">{_render_inline(stripped)}</p>')
            continue

        body.append(f'  <p>{_render_inline(stripped)}</p>')

    flush_list()
    body.append('</section>')
    return "\n".join(body)


def _render_ai_triage_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<section class="report-section ai-triage-section">', '  <h2>AI Triage</h2>']
    content_lines = [l.strip() for l in lines[1:] if l.strip()]
    if not content_lines or (len(content_lines) == 1 and "No AI triage verdict is available" in content_lines[0]):
        body.append(f'  <p class="empty-state">{_render_inline(content_lines[0] if content_lines else "_No AI triage verdict is available._")}</p>')
        body.append('</section>')
        return "\n".join(body)

    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("**Verdict:**"):
            body.append(f'  <div class="header-meta">{_render_inline(stripped)}</div>')
        elif stripped.startswith("**Reason:**"):
            body.append(f'  <p>{_render_inline(stripped)}</p>')
        else:
            body.append(f'  <p>{_render_inline(stripped)}</p>')

    body.append('</section>')
    return "\n".join(body)


def _render_response_actions_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<section class="report-section response-actions-section">', '  <h2>Response Actions</h2>']
    content_lines = [l.strip() for l in lines[1:] if l.strip()]
    if not content_lines or (len(content_lines) == 1 and "No response actions have been issued" in content_lines[0]):
        body.append('  <p class="empty-state"><em>No response actions have been issued for this incident.</em></p>')
        body.append('</section>')
        return "\n".join(body)

    table_headers: List[str] = []
    table_rows: List[List[str]] = []
    in_table = False

    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            raw_cells = [c.strip() for c in re.split(r"(?<!\\)\|", stripped)[1:-1]]
            cells = [c.replace(r"\|", "|") for c in raw_cells]
            if not in_table:
                table_headers = cells
                in_table = True
            elif re.match(r"^\|(\s*:?-+:?\s*\|)+$", stripped):
                continue
            else:
                table_rows.append(cells)
        else:
            body.append(f'  <p>{_render_inline(stripped)}</p>')

    if in_table:
        body.append('  <table class="response-table">')
        if table_headers:
            body.append('    <thead>')
            body.append('      <tr>')
            for th in table_headers:
                body.append(f'        <th>{_render_inline(th)}</th>')
            body.append('      </tr>')
            body.append('    </thead>')
        if table_rows:
            body.append('    <tbody>')
            for row in table_rows:
                body.append('      <tr>')
                for td in row:
                    body.append(f'        <td>{_render_inline(td)}</td>')
                body.append('      </tr>')
            body.append('    </tbody>')
        body.append('  </table>')

    body.append('</section>')
    return "\n".join(body)


def _render_case_details_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<section class="report-section case-details-section">', '  <h2>Case Details</h2>', '  <div class="header-meta">']
    for line in lines[1:]:
        stripped = line.strip()
        if not stripped:
            continue
        body.append(f'    <div class="header-meta-item">{_render_inline(stripped)}</div>')
    body.append('  </div>')
    body.append('</section>')
    return "\n".join(body)


def _render_footer_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<footer class="report-footer">', '  <hr>']
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped == "---":
            continue
        body.append(f'  <p class="footer">{_render_inline(stripped)}</p>')
    body.append('</footer>')
    return "\n".join(body)


def _render_generic_section(section_md: str) -> str:
    lines = section_md.splitlines()
    body: List[str] = ['<section class="report-section">']
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("## "):
            body.append(f'  <h2>{_render_inline(stripped[3:].strip())}</h2>')
        elif stripped.startswith("### "):
            body.append(f'  <h3>{_render_inline(stripped[4:].strip())}</h3>')
        elif stripped.startswith("- ") or stripped.startswith("\\- "):
            body.append(f'  <p>{_render_inline(stripped)}</p>')
        else:
            body.append(f'  <p>{_render_inline(stripped)}</p>')
    body.append('</section>')
    return "\n".join(body)


def report_markdown_to_html(markdown: str) -> str:
    """Converts incident report Markdown into a standalone, styled HTML document."""
    raw_sections = [s.strip() for s in re.split(r"(?m)^(?=##? |---$)", markdown.strip()) if s.strip()]

    rendered_sections: List[str] = []
    for sec in raw_sections:
        if sec.startswith("# ") and not sec.startswith("## "):
            rendered_sections.append(_render_header_section(sec))
        elif sec.startswith("## Attack Chain"):
            rendered_sections.append(_render_attack_chain_section(sec))
        elif sec.startswith("## Indicators"):
            rendered_sections.append(_render_indicators_section(sec))
        elif sec.startswith("## AI Analysis"):
            rendered_sections.append(_render_ai_analysis_section(sec))
        elif sec.startswith("## AI Triage"):
            rendered_sections.append(_render_ai_triage_section(sec))
        elif sec.startswith("## Response Actions"):
            rendered_sections.append(_render_response_actions_section(sec))
        elif sec.startswith("## Case Details"):
            rendered_sections.append(_render_case_details_section(sec))
        elif sec.startswith("---"):
            rendered_sections.append(_render_footer_section(sec))
        elif sec.startswith("## "):
            rendered_sections.append(_render_generic_section(sec))
        else:
            rendered_sections.append(f"<p>{_render_inline(sec)}</p>")

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Incident Report</title>
  <style>
{_PDF_CSS}
  </style>
</head>
<body>
{"\n".join(rendered_sections)}
</body>
</html>"""
    return html_content


def render_pdf_from_html(html_str: str) -> bytes:
    """Invokes Playwright via Node subprocess to render HTML to PDF."""
    node_bin = shutil.which("node")
    if not node_bin:
        raise RuntimeError("Node.js runtime not found on PATH. Required for Playwright PDF rendering.")

    if not RENDER_SCRIPT_PATH.exists():
        raise RuntimeError(f"Playwright PDF render script missing at {RENDER_SCRIPT_PATH}")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_file = pathlib.Path(tmpdir) / "report.html"
        output_file = pathlib.Path(tmpdir) / "report.pdf"

        input_file.write_text(html_str, encoding="utf-8")

        result = subprocess.run(
            [node_bin, str(RENDER_SCRIPT_PATH), str(input_file), str(output_file)],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=60,
        )

        if result.returncode != 0:
            err_msg = result.stderr.strip() or result.stdout.strip() or f"Process exited with code {result.returncode}"
            raise RuntimeError(f"Playwright PDF rendering failed: {err_msg}")

        if not output_file.exists():
            raise RuntimeError("Playwright PDF rendering did not produce an output file")

        pdf_bytes = output_file.read_bytes()
        if not pdf_bytes.startswith(b"%PDF-"):
            raise RuntimeError("Generated output does not contain valid PDF magic bytes")

        return pdf_bytes

