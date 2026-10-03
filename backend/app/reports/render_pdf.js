/**
 * Server-side Playwright PDF renderer for CSA-OPS incident reports.
 * Invoked by backend/app/reports/pdf_renderer.py via Node subprocess.
 * Usage: node render_pdf.js <input_html_path> <output_pdf_path>
 */
const fs = require("fs");
const path = require("path");

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: node render_pdf.js <input_html_path> <output_pdf_path>");
    process.exit(1);
  }

  const html = fs.readFileSync(inputPath, "utf8");

  // Locate dashboard directory where @playwright/test and playwright are installed
  const projectRoot = path.resolve(__dirname, "../../..");
  const dashboardDir = path.join(projectRoot, "dashboard");

  let chromium;
  try {
    const pwPath = require.resolve("playwright", { paths: [dashboardDir] });
    chromium = require(pwPath).chromium;
  } catch (err1) {
    try {
      const pwTestPath = require.resolve("@playwright/test", { paths: [dashboardDir] });
      chromium = require(pwTestPath).chromium;
    } catch (err2) {
      console.error("Failed to resolve playwright from:", dashboardDir);
      console.error(err2);
      process.exit(1);
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      margin: {
        top: "20mm",
        bottom: "20mm",
        left: "20mm",
        right: "20mm",
      },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("PDF generation failed:", err);
  process.exit(1);
});

