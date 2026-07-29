// Serverless function: reads the SalxCo Post-LOI Tracker project from Asana
// and returns tracker JSON for the frontend. The Asana PAT lives in the
// ASANA_PAT environment variable on Vercel and never reaches the browser.

const ASANA_BASE = "https://app.asana.com/api/1.0";

// Seller-facing workstreams only. Internal / Fund III / Deal Team tasks are
// intentionally NOT listed here and are never exposed by this endpoint.
const WORKSTREAMS = [
  { gid: "1216972035776176", name: "Legal Documentation",             col: "A" },
  { gid: "1216972080469184", name: "Corporate & Business Diligence",  col: "A" },
  { gid: "1216972080610338", name: "Tax & Structuring",               col: "A" },
  { gid: "1216973742211096", name: "Artist Contract Diligence",       col: "B" },
  { gid: "1216972080620574", name: "Financial Diligence",             col: "B" },
  { gid: "1216972630285207", name: "Closing Mechanics",               col: "B" }
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

module.exports = async (req, res) => {
  const pat = process.env.ASANA_PAT;
  if (!pat) {
    res.status(500).json({ error: "ASANA_PAT environment variable is not set" });
    return;
  }
  const headers = { Authorization: "Bearer " + pat };
  const get = async (path) => {
    const r = await fetch(ASANA_BASE + path, { headers });
    if (!r.ok) throw new Error("Asana API " + r.status + " on " + path);
    return (await r.json()).data;
  };

  try {
    const [daily, dealTeam, ...subtaskLists] = await Promise.all([
      get(`/tasks/${DAILY_UPDATE_TASK}?opt_fields=notes`),
      get(`/tasks/${DEAL_TEAM_TASK}?opt_fields=notes`),
      ...WORKSTREAMS.map(ws =>
        get(`/tasks/${ws.gid}/subtasks?opt_fields=name,notes,completed&limit=100`))
    ]);

    const dailyParsed = parseDailyUpdate(daily.notes);
    const contacts = parseContacts(dealTeam.notes);

    const workstreams = WORKSTREAMS.map((ws, i) => ({
      name: ws.name,
      col: ws.col,
      items: (subtaskLists[i] || []).map(t => {
        const meta = parseItemNotes(t.notes);
        return {
          item: t.name,
          owner: meta.owner || "",
          status: t.completed ? "complete" : (meta.status || "upcoming"),
          date: meta.date || "",
          note: meta.note || ""
        };
      })
    }));

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
    res.status(200).json({
      syncedAt: new Date().toISOString(),
      overallStatus: dailyParsed.status,
      overallStatusTone: dailyParsed.tone,
      thisWeek: dailyParsed.thisWeek,
      sellerAsks: dailyParsed.sellerAsks,
      contacts,
      workstreams
    });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
};
