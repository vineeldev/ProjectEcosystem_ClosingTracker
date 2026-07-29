# Project SalxCo - 90-Day Closing Tracker

Seller-facing closing tracker for the SalxCo transaction, hosted on Vercel and fed live from the "SalxCo Post-LOI Tracker" Asana project. The page auto-refreshes every 5 minutes and has a manual Refresh button.

## Files

- `index.html` - the tracker page. The 90-day frame (start date, phases, milestones) is static config at the top of the script block. Everything else loads live.
- `api/tracker.js` - Vercel serverless function. Reads the Asana project server-side using a personal access token stored in an environment variable. The token never reaches the browser.

## Deploy

1. Create a GitHub repo and upload these files, keeping `api/tracker.js` inside an `api/` folder.
2. In Vercel: New Project > import the repo > Framework preset "Other" > Deploy.
3. Create an Asana personal access token: Asana > Settings > Apps > Developer Apps > Create personal access token. Copy it.
4. In the Vercel project: Settings > Environment Variables > add `ASANA_PAT` with the token as the value > redeploy.

That's it. The page at your Vercel URL now reads the Asana project on every sync.

## How updates flow from Asana

The function reads only these five workstream parent tasks (by GID, hardcoded in `api/tracker.js`): Legal Documentation, Financial Diligence, Tax & Structuring, Music Diligence, Closing Mechanics. Internal, Fund III, and Deal Team tasks are never exposed.

Each subtask's description carries its tracker fields, one per line:

```
Owner: Reed Smith
Status: In Progress
Target: Aug 30
Note: First draft to seller counsel by Day 35
```

- `Status` accepts: Complete, In Progress, Upcoming, Awaiting Seller, At Risk. Marking the Asana task complete also shows Complete regardless of the Status line.
- Adding, renaming, or reordering subtasks in Asana changes the page the same way.

The **"Deal Team & Advisors"** task drives the Key Contacts section. Under `[Lyric]`, `[Sellers]`, and `[Advisors]` headers, one contact per line as `Name | Role | Detail (optional)`. Lines without a pipe are ignored.

The **"Tracker Daily Update (edit me)"** task in the project drives the header pill and the two panels. Its description format:

```
Status: On Track

[This Week]
Item text | date

[Seller Asks]
Item text | date
```

Status containing "risk" or "behind" turns the pill red; "watch" turns it blue.

## Daily routine

Edit the "Tracker Daily Update (edit me)" task and flip any item statuses in Asana. The page picks it up on the next sync (responses are cached ~2 minutes at the edge; the Refresh button busts through).

## Download PDF button

The "Download PDF" button next to Refresh hits `/api/pdf`, which runs headless Chromium on Vercel, loads the live page, and streams back a single-page PDF (`SalxCo_Closing_Tracker_YYYY-MM-DD.pdf`) with whatever the Asana data says at that moment. Notes on it:

- First click after a quiet period takes 5-15 seconds (serverless cold start); after that it's a few seconds.
- `package.json` (puppeteer-core + @sparticuz/chromium) and `vercel.json` (memory / duration for the PDF function) must be in the repo root for it to work.
- If the PDF endpoint ever fails on a given plan or config, the fallback is the browser's own print dialog on the page - the built-in print stylesheet produces a clean letter version.

## Notes

- The tracker is marked Internal and shows the deal team contact list, so protect the URL: enable Vercel's Deployment Protection (Settings > Deployment Protection) so only the team can open it.
- Timeline phases and milestone dates are edited in `index.html` under `CONFIG` - they change rarely.
- The exclusivity start date (`2026-07-27`) also lives in `CONFIG`.
