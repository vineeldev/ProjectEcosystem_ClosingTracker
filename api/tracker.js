// Serverless function: reads the SalxCo Post-LOI Tracker project from Asana
// and returns tracker JSON for the frontend. The Asana PAT lives in the
// ASANA_PAT environment variable on Vercel and never reaches the browser.
//
// Hardened: transient Asana errors (429/5xx) are retried once; a partial
// failure degrades gracefully (the page renders whatever synced, with a
// syncWarnings list) instead of 502ing the whole payload. Only a total
// failure or an auth problem returns an error status.

const ASANA_BASE = "https://app.asana.com/api/1.0";

// Workstreams shown on the tracker, mapped to their current Asana task GIDs
// (pulled live from the SalxCo Post-LOI Tracker project, Sep 8 2026).
// To hide a workstream from the page, delete its line here.
const WORKSTREAMS = [
  { gid: "1216972035776176", name: "Legal Documentation",          col: "A" },
  { gid: "1216972080469184", name: "Corporate Diligence",          col: "A" },
  { gid: "1216971584363122", name: "Operational Diligence",        col: "A" },
  { gid: "1216973742211096", name: "Artist Contract Diligence",    col: "A" },
  { gid: "1218188630385585", name: "Financial Diligence",          col: "B" },
  { gid: "1218188316243688", name: "Model",                        col: "B" },
  { gid: "1216972630285207", name: "Signing / Closing Mechanics",  col: "B" },
  { gid: "1216971584363117", name: "RBN / Debt",                   col: "B" }
];

// The "Tracker Daily Update (edit me)" task. Its notes hold the overall
// status, the This Week list, and the Seller Asks list.
const DAILY_UPDATE_TASK = "1216972494028720";

// The "Deal Team & Advisors" task. Its notes hold the key contact list
// under [Lyric] and [Advisors] headers, one "Name | Role | Detail" per line.
const DEAL_TEAM_TASK = "1216972080272342";

const STATUS_MAP = {
  "complete": "complete", "completed": "complete", "done": "complete",
  "in progress": "inprogress", "inprogress": "inprogress",
  "upcoming": "upcoming", "not started": "upcoming",
  "awaiting seller": "seller", "seller": "seller",
  "at risk": "atrisk", "atrisk": "atrisk"
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtDueOn(d) {
  if (!d) return "";
  const p = d.split("-");
  return MONTHS[parseInt(p[1], 10) - 1] + " " + parseInt(p[2], 10);
}

function parseItemNotes(notes) {
  const meta = { owner: "", status: "", date: "", note: "" };
  (notes || "").split("\n").forEach(line => {
    const m = line.match(/^\s*(Owner|Status|Target|Note)\s*:\s*(.*)$/i);
    if (!m) return;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "owner") meta.owner = val;
    else if (key === "status") meta.status = STATUS_MAP[val.toLowerCase()] || "";
    else if (key === "target") meta.date = val;
    else if (key === "note") meta.note = val;
  });
  return meta;
}

function parseContacts(notes) {
  const out = { lyric: [], sellers: [], advisors: [] };
  let section = null;
  (notes || "").split("\n").forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    if (/^\[lyric\]$/i.test(line)) { section = "lyric"; return; }
    if (/^\[sellers\]$/i.test(line)) { section = "sellers"; return; }
    if (/^\[advisors\]$/i.test(line)) { section = "advisors"; return; }
    if (/^\[[^\]]+\]$/.test(line)) { section = null; return; }  // full-line [Header] only
    if (!section || line.indexOf("|") === -1) return;
    const parts = line.replace(/^-\s*/, "").split("|").map(s => s.trim());
    out[section].push({ name: parts[0] || "", role: parts[1] || "", detail: parts[2] || "" });
  });
  return out;
}

function parseDailyUpdate(notes) {
  const out = { status: "On Track", tone: "complete", thisWeek: [], sellerAsks: [] };
  let section = null;
  (notes || "").split("\n").forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    const s = line.match(/^Status\s*:\s*(.*)$/i);
    if (s) {
      out.status = s[1].trim();
      const low = out.status.toLowerCase();
      out.tone = low.includes("risk") || low.includes("behind") ? "atrisk"
        : low.includes("watch") ? "inprogress" : "complete";
      return;
    }
    if (/^\[this week\]$/i.test(line)) { section = "thisWeek"; return; }
    if (/^\[seller asks\]$/i.test(line)) { section = "sellerAsks"; return; }
    if (section) {
      const parts = line.replace(/^-\s*/, "").split("|");
      out[section].push({ text: parts[0].trim(), date: (parts[1] || "").trim() });
    }
  });
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = async (req, res) => {
  const pat = process.env.ASANA_PAT;
  if (!pat) {
    res.status(500).json({ error: "ASANA_PAT environment variable is not set" });
    return;
  }
  const headers = { Authorization: "Bearer " + pat };

  // GET with one retry on transient failures (429 / 5xx / network).
  // Auth failures (401/403) are flagged so we can report them clearly.
  const get = async (path) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await fetch(ASANA_BASE + path, { headers });
      } catch (netErr) {
        if (attempt === 0) { await sleep(400); continue; }
        throw new Error("Network error on " + path + ": " + netErr.message);
      }
      if (r.ok) return (await r.json()).data;
      if (r.status === 401 || r.status === 403) {
        const e = new Error("Asana auth failed (" + r.status + ") — the ASANA_PAT is likely expired or revoked");
        e.auth = true;
        throw e;
      }
      const transient = r.status === 429 || r.status >= 500;
      if (transient && attempt === 0) {
        const retryAfter = parseInt(r.headers.get("Retry-After") || "0", 10);
        await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 3000) : 500);
        continue;
      }
      throw new Error("Asana API " + r.status + " on " + path);
    }
  };

  const settled = await Promise.allSettled([
    get(`/tasks/${DAILY_UPDATE_TASK}?opt_fields=notes`),
    get(`/tasks/${DEAL_TEAM_TASK}?opt_fields=notes`),
    ...WORKSTREAMS.map(ws =>
      get(`/tasks/${ws.gid}/subtasks?opt_fields=name,notes,completed,due_on&limit=100`))
  ]);

  const [dailyR, dealTeamR, ...subtaskR] = settled;
  const warnings = [];

  // If the PAT is dead, every call fails identically — say so plainly.
  const authFail = settled.find(s => s.status === "rejected" && s.reason && s.reason.auth);
  if (authFail) {
    res.status(502).json({ error: String(authFail.reason.message) });
    return;
  }

  // Total failure (Asana down / network gone): keep the old 502 behavior so
  // the frontend falls back to last loaded data.
  if (settled.every(s => s.status === "rejected")) {
    res.status(502).json({ error: String(settled[0].reason && settled[0].reason.message || settled[0].reason) });
    return;
  }

  // Partial success: build the payload from whatever synced and note the gaps.
  const dailyParsed = dailyR.status === "fulfilled"
    ? parseDailyUpdate(dailyR.value.notes)
    : (warnings.push("Daily update did not sync"), { status: "On Track", tone: "complete", thisWeek: [], sellerAsks: [] });

  const contacts = dealTeamR.status === "fulfilled"
    ? parseContacts(dealTeamR.value.notes)
    : (warnings.push("Deal team & advisors did not sync"), { lyric: [], sellers: [], advisors: [] });

  const workstreams = WORKSTREAMS.map((ws, i) => {
    const r = subtaskR[i];
    if (!r || r.status !== "fulfilled") {
      warnings.push(ws.name + " did not sync");
      return { name: ws.name, col: ws.col, items: [], syncFailed: true };
    }
    return {
      name: ws.name,
      col: ws.col,
      items: (r.value || []).map(t => {
        const meta = parseItemNotes(t.notes);
        return {
          item: t.name,
          owner: meta.owner || "",
          status: t.completed ? "complete" : (meta.status || "upcoming"),
          date: meta.date || fmtDueOn(t.due_on),
          note: meta.note || ""
        };
      })
    };
  });

  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
  res.status(200).json({
    syncedAt: new Date().toISOString(),
    overallStatus: dailyParsed.status,
    overallStatusTone: dailyParsed.tone,
    thisWeek: dailyParsed.thisWeek,
    sellerAsks: dailyParsed.sellerAsks,
    contacts,
    workstreams,
    syncWarnings: warnings
  });
};
