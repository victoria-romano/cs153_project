# Storybook

*Provider stories for child health equity.*

A prototype web app built for the Stanford Office of Child Health Equity
(Department of Pediatrics). Storybook lets clinicians record short, voice-
or text-based stories about structural barriers their pediatric patients
face, and gives the OCHE team a dashboard for triaging those stories and
turning them into living policy briefs.

> **Demo / non-PHI environment.** All stories, provider names, and details
> in the shipped demo data are fictional. Do not enter real patient
> information without first putting authentication, consent, audit logs,
> and PHI/HIPAA review in place.

---

## Overview

Two roles share one app:

- **Clinician view.** Record a story by voice (transcribed automatically)
  or by typing. Pick a focus area, optionally submit anonymously, save as
  a draft or submit. See your own submissions, their status, and any
  outcomes when the OCHE team marks them as reviewed / used in advocacy /
  shared with policymakers.
- **Policy (OCHE) view.** See incoming stories, weekly volume, top
  recurring barriers, and a per-theme **living policy brief** that
  re-synthesizes from all submitted stories in that theme on demand.

Six focus areas are supported out of the box: *Language Barriers,
Transportation, Cost of Care, Vaccine-Preventable Diseases,
Immigration-Related Concerns, Other.*

### Architecture

- **Frontend:** plain HTML / CSS / vanilla JS (no framework), in
  `index.html`, `styles.css`, `src/main.js`.
- **Backend:** a single Node.js HTTP server (`server.js`) using only the
  standard library plus `fetch`. No build step. The server proxies all
  Supabase and OpenAI calls so API keys never reach the browser.
- **Storage:** Supabase Postgres, two tables — `stories` and
  `policy_briefs` (see `supabase-schema.sql`). When Supabase is not
  configured the server falls back to an in-memory demo dataset so the UI
  is fully viewable without keys.
- **AI:** OpenAI is used for (1) audio transcription, (2) per-story
  summaries, (3) auto-categorization, (4) per-theme living policy briefs.
  All four have local non-AI fallbacks for transcription-free demo use.

---

## Setup

### Prerequisites

- Node.js 18 or newer (the server uses native `fetch`).
- A Supabase project (free tier is fine) for persistence.
- An OpenAI API key for transcription, summaries, categorization, and
  brief synthesis.

### Steps

1. Clone the repo and `cd` into it.
2. Create a Supabase project, then run `supabase-schema.sql` in the
   Supabase SQL editor. This creates the `stories` and `policy_briefs`
   tables.
3. Copy the env template and fill in your keys:
   ```bash
   cp .env.example .env
   ```
   Set at minimum:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (or a newer secret server key)
   - `OPENAI_API_KEY`
4. Start the server:
   ```bash
   npm start
   ```
5. Open <http://127.0.0.1:5173/> in a browser.

If you skip step 2 or 3, the app still runs against an in-memory demo
dataset — useful for a quick look without any external services.

---

## Usage

### As a clinician

1. (Optional) Click **Change** under "Signed in as" in the sidebar and
   enter a provider name. Your submissions will be filtered to that name
   in the "My stories" view.
2. Click **🎙 Record a Story**. Either press *Record* and dictate, or
   type the transcript directly. Pick a focus area. Check **"Submit this
   story anonymously"** if you want no name attached.
3. *Save as draft* keeps it private. *Submit story* sends it to the OCHE
   queue.
4. Click any story card to see status updates and outcomes from the
   OCHE team.

### As the OCHE team (Policy view)

1. Toggle **Policy** in the sidebar.
2. The dashboard shows incoming volume, top recent barrier, and a
   chart of stories over time.
3. Click any **theme row** on the right to open its living policy brief,
   then **Regenerate from latest stories** to synthesize a fresh brief
   from every submitted story under that theme. Past briefs are listed
   below for one-click reopen.
4. Open any story card to summarize, recategorize, or mark it
   **Reviewed**, **Used in advocacy**, or **Shared with policymakers**.
   The provider who submitted it will see the outcome on their own
   dashboard.

---

## Project structure

```
.
├── index.html              # single-page UI
├── styles.css              # styles (Stanford red theme)
├── src/main.js             # client logic, render loop, modals, API calls
├── server.js               # Node HTTP server: API + static files
├── supabase-schema.sql     # `stories` + `policy_briefs` tables
├── stanford-logo.jpg       # org card image
├── package.json
├── .env.example            # template for required env vars
└── README.md
```

---

## Known limitations

- **No authentication.** The "Signed in as" identity is a localStorage
  string — anyone can claim to be anyone. Real per-provider visibility
  (clinician sees only their own; OCHE sees all) requires a login
  system that has not been built yet.
- **Prototype only — not for real PHI.** No de-identification, audit
  logging, consent capture, or HIPAA review. The demo data is fictional
  and labeled as such throughout the UI.
- **Service-role key on the server.** The server uses Supabase's
  service-role key and bypasses RLS. Before exposing Supabase directly
  to the browser, switch to authenticated user JWTs and write RLS
  policies.

---

## AI usage disclosure

AI assistants were used during development of this project, including
for code generation, iteration, and parts of the UI copy.

---

## Acknowledgements

- **Stanford Office of Child Health Equity (Department of Pediatrics)** —
  problem framing, requirements, and feedback throughout the build.
- **Julia** (OCHE) — surfaced the anonymous-submission and
  per-provider-visibility requirements.

---

## External resources

- [Node.js](https://nodejs.org/)
- [Supabase](https://supabase.com/) — Postgres + REST APIs.
- [OpenAI API](https://platform.openai.com/docs/api-reference) —
  transcription (`gpt-4o-mini-transcribe`) and text (`gpt-4.1-mini`)
  endpoints.
- [Stanford Medicine — Office of Child Health Equity](https://med.stanford.edu/pediatrics.html)
