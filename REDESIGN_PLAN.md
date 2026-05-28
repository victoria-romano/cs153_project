# StoryBridge UI Redesign — Simplified Feature Plan

Source mockups: `img1.jpeg` (Policy Director / Admin) and `img2.jpeg` (Clinician / Doctor).
The mockups are intentionally over-stuffed. This plan keeps only what (a) serves the screen's
core job and (b) is realistic against what we store **today**, then flags the rest.

---

## 0. What we actually store today (the reality check)

One Supabase table drives everything:

```
stories(id, created_at, doctor_name, specialty, encounter_date,
        reference_code, transcript, summary, category)
```

Every feature below is judged against this. Two cross-cutting limits matter most:

- **No auth / no user identity.** `doctor_name` is free text typed into a form. So any
  "my stories", per-doctor stats, or "Good morning, Dr. Patel" greeting is unreliable until
  we add real accounts. → personalization is **deferred**, flagged in §6.
- **No status / lifecycle.** A story is either saved or not. There is no draft / submitted /
  reviewed / de-identified / advocacy state. The entire admin "workflow pipeline" and the
  doctor status badges depend on a field that doesn't exist. → mostly **removed**, flagged in §6.

---

## 1. Design principles applied (why we're cutting)

- **One primary action per screen.** Doctor = *Record a Story*. Admin = *Draft an advocacy proposal*.
- **Each dashboard answers 2–3 questions, not 8.** Doctor: how do I share, what have I shared, what could I share. Admin: what's coming in, what themes are emerging, turn it into advocacy.
- **No vanity metrics we can't compute.** If the number would be fake or always zero, it's out.
- **Don't over-promise compliance.** The mockups claim stories are "de-identified in compliance with HIPAA." We don't de-identify anything. Showing that claim is misleading → replaced with an honest prototype notice.
- **Progressive disclosure.** Extra nav destinations (Reports, Partners, Briefs, Resources…) are removed until they have backing data.

---

## 2. Color theme: RED (locked)

Replace the current teal/green tokens in `styles.css` with a deep-red system (values tweakable):

```css
--primary:      #8a1f2b;  /* deep red — buttons, active nav, headings accents */
--primary-dark: #6d1722;  /* hover/pressed */
--primary-tint: #f7e4e6;  /* icon chips, active-nav background, tag fills */
--accent:       #b23a48;  /* secondary red for trends/links */
--bg:           #faf7f6;  /* off-white app background */
--panel:        #ffffff;  /* cards */
--ink:          #1f1d1d;  /* text */
--muted:        #6b6a6a;  /* secondary text */
--line:         #e7e2e1;  /* borders */
```

---

## 3. Shared shell (simplified)

- **Brand:** "StoryBridge" wordmark, red.
- **Sidebar nav — trimmed to what we'll actually build:** Dashboard, Stories (the full list), and the role's primary action. *Removed:* Themes/Advocacy Briefs/Reports/Partners/Resources/Impact/Settings as separate pages (no data behind them yet).
- **"Our mission" card:** keep (static).
- **Org card:** keep org name "Healthy Voices Alliance"; *drop* the "Enterprise/Member Plan" tier (no billing concept).
- **Top bar:** keep a greeting + the role's primary CTA. *Removed:* global search, notifications bell, per-user avatar/role menu (no auth — see §6).
- **Footer:** replace the HIPAA "de-identified" claim with the honest prototype line already in the README: *"Prototype — do not use with real patient data until security, consent, and compliance reviews are complete."*

---

## 4. Admin dashboard (simplified) — `img1`

**KEEP** (computable from current schema today):
- **KPI: Stories submitted this week** — count where `created_at` in last 7 days.
- **KPI: Top barrier this week** — group by `category` for the week, take the top one + its %.
- **Recurring Policy Themes** — counts and % per `category`. *This is our strongest panel — `category` maps to it directly.*
- **Stories Over Time** — bucket `created_at` weekly/monthly. Keep the Weekly/Monthly toggle.
- **Recent Stories** — list using `doctor_name`, `encounter_date`, `category` tag, and a snippet from `summary`/`transcript`. (Title derived from the summary's first line for now.)
- **Policy Proposal drafting** *(not in mockup, but our most valuable admin feature and it already works)* — restore it as the screen's primary action.

**REMOVED + flagged** (see §6 for lift):
- KPI "Stories Reviewed" (no review state).
- KPI "Stories Ready for Advocacy" (no advocacy state).
- **Story Workflow pipeline** (Captured→Transcribed→De-identified→Theme-coded→Ready) — the single biggest cut; depends on status + transcription tracking + de-identification + review queue.
- Date-range picker (replaced by the chart's weekly/monthly toggle), week-over-week trend % (kept only where data supports it; otherwise hidden).

---

## 5. Doctor dashboard (simplified) — `img2`

**KEEP** (works today or needs no DB):
- **"Record a Story" CTA** — the existing record → transcribe → review → save flow. Primary action.
- **"How it works" strip** — the 3 steps (Capture / Review / Submit), trimmed to a compact row. Static, free.
- **"What to share" prompts** — static hardcoded list of barrier topics; helps overcome the blank page. No DB.
- **Recent Stories** — list with `category` tag + date (no status badges). Scoped by `doctor_name` match for now (best-effort; see auth caveat).
- **Light affirmation** — a simple "X stories shared — thank you" line instead of a goal ring.

**REMOVED + flagged** (see §6 for lift):
- KPI "Drafts" (no draft state).
- KPI "Avg. Time to Submit" (we never capture record-start vs submit timing).
- KPI "Stories Used in Advocacy" (no advocacy state).
- Status badges (Draft / Reviewed / Used in Brief) on recent stories (no status field).
- **Privacy panel claiming auto de-identification + HIPAA/Encrypted/Secure** — removed; we don't de-identify. Replaced by the honest prototype notice in the footer.
- Activity chart (submitted vs drafts) and the 72% goal ring — drafts don't exist and the goal is arbitrary/per-user; cut for clarity.

---

## 6. Verdict tables

### A. Keep — no database change needed
| Feature | Powered by |
| --- | --- |
| Recurring themes breakdown | `category` group-by |
| Stories submitted this week / top barrier this week | `created_at`, `category` |
| Stories over time (weekly/monthly) | `created_at` |
| Recent stories list | existing columns + derived title |
| Record → transcribe → save | existing flow |
| Summarize / categorize a story | existing OpenAI endpoints |
| Policy proposal drafting | existing endpoint over `transcript`/`summary` |
| "What to share" prompts, 3-step strip, mission card | static content |
| Red theme + simplified shell | CSS only |

### B. Keep-able with a SMALL Supabase lift (flagged — your call)
| Feature | Lift on Supabase |
| --- | --- |
| Status badges + "Drafts" / "Reviewed" / "Ready for advocacy" KPIs | Add one column: `status text default 'submitted'` (e.g. `draft / submitted / reviewed / in_advocacy`) + tiny UI to change it. **One column unlocks several mockup features at once.** |
| Nicer story titles (instead of deriving from summary) | Add `title text` column, set at save time. Tiny. |
| Multi-theme tagging (a story shows 2+ tags, like the mockup) | Change `category text` → `categories text[]` (or a `story_tags` join table). Medium; current single `category` is fine for v1. |
| "Used in advocacy" / which brief a story fed | Add `used_in_advocacy boolean` (+ later a `briefs` table). Small for the boolean; medium for full briefs. |

### C. Removed — too tricky for now (flagged)
| Feature | Why it's hard / what it would take |
| --- | --- |
| **Admin "Story Workflow" pipeline** | Needs `status` + transcription tracking + a real de-identification step + a theme-coding step + a review queue. Multi-feature, not one column. |
| **Automatic de-identification** (+ HIPAA "de-identified" claims) | Real PHI scrubbing (names/dates/locations) via regex + LLM pass, plus verification. Significant, and risky to fake in the UI. |
| **Avg. Time to Submit** | We never record session timing (record-start → submit). Needs client timing capture + a column. |
| **Per-user personalization** — "Good morning, Dr. Patel", reliable "my stories", per-doctor KPIs, impact goal | Needs real **auth + a users table + roles** (Policy Director vs Clinician). `doctor_name` free text isn't a reliable identity. Note: last commit mentions wanting "some sort of password" — that's the entry point. |
| Notifications bell | No event/notification source exists. |
| Global search | Deferrable (client-side search over loaded stories is easy later); cut now for clarity. |

---

## 7. Recommended first build

1. Re-theme to red + build the simplified shell (sidebar, top bar greeting + CTA, honest footer).
2. Admin dashboard: themes breakdown + this-week KPIs + stories-over-time + recent stories + restored proposal drafting — all from current data.
3. Doctor dashboard: Record CTA + 3-step strip + prompts + recent stories + affirmation.
4. *Then decide* on the one high-value small lift: **add a `status` column** (§6B) to bring back drafts/reviewed/advocacy badges, and whether `title`/multi-tags are worth it.
5. Auth/roles + de-identification remain a separate, larger track (§6C).
