# CareStory AI Prototype

A small v0 web app for collecting doctor-spoken patient stories, storing
transcripts in Supabase, and helping administrators summarize, categorize, and
turn relevant stories into policy proposal drafts.

## What is built

- Doctor view with browser audio recording.
- OpenAI transcription endpoint.
- Supabase-backed story storage.
- Story list with summary and category actions.
- Batch action to analyze missing summaries/categories.
- Free-text policy proposal generator that uses stored transcripts as evidence.

## Setup

1. Create a Supabase project.
2. Run `supabase-schema.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env`.
4. Fill in:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` with either a service role key or secret server key
   - `OPENAI_API_KEY`
5. Replace `POLICY_CATEGORIES` and the three prompt values when you have the
   final category list and AI instructions.
6. Start the app:

```bash
npm start
```

Then open `http://localhost:5173`.

## Prototype notes

This is intentionally simple. The server owns all Supabase and OpenAI calls so
API keys are not exposed in the browser. The administrator view has no login in
this v0 prototype, so only run it locally or behind a trusted access layer.

Supabase's publishable key is useful for client-side Supabase apps, but this
prototype needs `SUPABASE_SERVICE_ROLE_KEY` to hold a service role key or newer
secret server key because row level security is enabled on the `stories` table.

Before handling real clinical information, add production authentication,
authorization, audit logs, data retention rules, consent workflows, PHI review,
and any required HIPAA/business associate agreements.
