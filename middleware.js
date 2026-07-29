// Edge Middleware: requires a valid session cookie for the tracker page and
// its APIs. Unauthenticated page requests redirect to the landing page;
// unauthenticated API requests get 401.

export const config = {
  matcher: ["/tracker.html", "/api/tracker", "/api/pdf"]
};

function getCookie(req, name) {
  const header = req.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

async function verify(token, secretStr) {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secretStr), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(exp)));
  const hex = Array.from(mac).map(b => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export default async function middleware(req) {
  const secretStr = (process.env.SITE_PASSWORD || "") + "|salxco-tracker-v1";
  const token = getCookie(req, "salxco_session");
  if (await verify(token, secretStr)) {
    return; // authenticated: continue to the requested resource
  }
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }
  return Response.redirect(new URL("/", req.url), 302);
}
