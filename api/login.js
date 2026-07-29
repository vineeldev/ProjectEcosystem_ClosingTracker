// POST /api/login - checks the shared password (SITE_PASSWORD env var) and
// sets a signed, HttpOnly session cookie valid for 7 days.

const crypto = require("crypto");

const COOKIE = "salxco_session";
const MAX_AGE = 7 * 24 * 60 * 60; // seconds

function secret() {
  return (process.env.SITE_PASSWORD || "") + "|salxco-tracker-v1";
}

function mintToken() {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  const sig = crypto.createHmac("sha256", secret()).update(exp).digest("hex");
  return exp + "." + sig;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword) {
    res.status(500).json({ error: "SITE_PASSWORD environment variable is not set" });
    return;
  }
  const supplied = (req.body && req.body.password) || "";
  const a = crypto.createHash("sha256").update(String(supplied)).digest();
  const b = crypto.createHash("sha256").update(sitePassword).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }
  res.setHeader("Set-Cookie",
    `${COOKIE}=${mintToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`);
  res.status(200).json({ ok: true });
};

module.exports.mintToken = mintToken;
module.exports.COOKIE = COOKIE;
