// Serverless PDF endpoint. Renders the live tracker page in headless
// Chromium and streams back a single-page PDF with the data as of click time.

const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

module.exports = async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      defaultViewport: { width: 1000, height: 1400 }
    });
    const page = await browser.newPage();

    const proto = req.headers["x-forwarded-proto"] || "https";
    const url = proto + "://" + req.headers.host + "/";
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45000 });
    // Make sure the live Asana data has rendered before printing
    await page.waitForSelector("#wsColA table", { timeout: 20000 }).catch(() => {});
    await page.emulateMediaType("screen");
    // Hide the interactive controls and narrow the column for a clean scale to letter width
    await page.addStyleTag({ content: ".sync-row { display: none; } .page { max-width: 960px; padding: 32px 30px 36px; }" });
    await new Promise(r => setTimeout(r, 400));

    const contentHeight = await page.evaluate(() => document.body.scrollHeight);
    const scale = 816 / 1000; // letter width (8.5in at 96dpi) / viewport width
    const heightIn = (contentHeight * scale) / 96 + 0.02;

    const pdf = await page.pdf({
      width: "8.5in",
      height: heightIn.toFixed(2) + "in",
      scale,
      printBackground: true,
      margin: { top: "0", bottom: "0", left: "0", right: "0" },
      pageRanges: "1"
    });

    const d = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="SalxCo_Closing_Tracker_' + d + '.pdf"');
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(Buffer.from(pdf));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    if (browser) await browser.close();
  }
};
