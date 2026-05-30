import "server-only";
import puppeteer from "puppeteer-core";

// PDF renderer via Puppeteer (PRD §5.10, §13.16). Uses puppeteer-core
// (~2MB npm, no bundled Chromium) — expects Chromium in the deployment
// environment. Dependency: puppeteer-core. Alternative: @react-pdf/renderer
// (~2MB, own styling DSL, less CSS fidelity). CLAUDE.md rule #13 flagged.

/**
 * Render a URL to a PDF buffer using headless Chromium.
 * The URL should be a fully-rendered HTML page (e.g. the report page).
 */
export async function renderPdf(
  url: string,
  opts?: {
    /** Cookie string to pass for authentication. */
    cookie?: string;
  }
): Promise<Buffer> {
  // In production, use the Chromium binary available in the environment.
  // Common paths: /usr/bin/chromium-browser (Alpine), /usr/bin/google-chrome.
  const executablePath =
    process.env.CHROMIUM_PATH ??
    "/usr/bin/chromium-browser";

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const page = await browser.newPage();

    // Pass the session cookie so the report page can authenticate.
    if (opts?.cookie) {
      const urlObj = new URL(url);
      await page.setCookie({
        name: "sb-access-token",
        value: opts.cookie,
        domain: urlObj.hostname,
        path: "/",
      });
    }

    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });

    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
