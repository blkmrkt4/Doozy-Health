import "server-only";
import puppeteer from "puppeteer-core";

// PDF renderer via Puppeteer (PRD §5.10, §13.16). Headless Chrome doesn't ship
// in a serverless runtime, so on Vercel/Lambda we load a serverless-built
// Chromium from @sparticuz/chromium; locally (or any box with a real Chrome) we
// use the system binary at CHROMIUM_PATH.
//
// Dependencies: puppeteer-core (~2MB, no bundled Chromium) + @sparticuz/chromium
// (~50MB brotli binary that unpacks to /tmp at runtime) — the standard way to
// run headless Chrome in a Vercel function. Its Chromium build (149) matches
// puppeteer-core 25's expected revision. Alternative considered: a hosted
// browser API (e.g. Browserless), rejected to avoid shipping report HTML to a
// third party and a recurring cost (CLAUDE.md rule #13).

const isServerless = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
);

async function launchBrowser() {
  if (isServerless) {
    // Loaded lazily so local/dev never pulls the big binary into the bundle.
    const chromium = (await import("@sparticuz/chromium")).default;
    // A PDF render needs no WebGL; disabling the graphics stack skips unpacking
    // the swiftshader blob, so it cold-starts faster and lighter.
    chromium.setGraphicsMode = false;
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }

  // Local / self-hosted: use the system Chrome/Chromium.
  const executablePath = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium-browser";
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
}

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
  const browser = await launchBrowser();

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
