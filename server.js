import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

loadEnvFile();

const PORT = Number(process.env.PORT || 5173);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
const OPENAI_TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";

const POLICY_CATEGORIES = parseList(process.env.POLICY_CATEGORIES, [
  "Medicaid Access",
  "Insurance Denials",
  "Cost of Care",
  "Transportation",
  "Language Barriers",
  "Food Insecurity",
  "Disability Access",
  "Other",
]);

const STORY_STATUSES = ["draft", "submitted", "reviewed", "in_advocacy"];

const SUMMARY_PROMPT =
  process.env.SUMMARY_PROMPT ||
  "Summarize this doctor story in 2-4 concise sentences. Preserve the policy-relevant facts.";

const CATEGORY_PROMPT =
  process.env.CATEGORY_PROMPT ||
  "Choose the one category that best fits this story. Return only the category name.";

const POLICY_PROMPT =
  process.env.POLICY_PROMPT ||
  "Write a formal policy proposal. Use only the supplied transcript evidence, cite supporting story IDs inline, and include a short evidence section.";

const HOST = process.env.HOST || "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, statusForError(error), { error: error.message || "Unexpected server error." });
  }
}).listen(PORT, HOST, () => {
  console.log(`StoryBridge running at http://${HOST}:${PORT}`);
});

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      supabaseConfigured: hasSupabaseConfig(),
      openAiConfigured: hasOpenAiConfig(),
      demoMode: !hasSupabaseConfig(),
      categories: POLICY_CATEGORIES,
    });
    return;
  }

  if (req.method === "POST" && path === "/api/transcribe") {
    const audio = await readMultipartFile(req);
    const transcript = await transcribeAudio(audio);
    sendJson(res, 200, { transcript });
    return;
  }

  if (req.method === "GET" && path === "/api/stories") {
    const stories = await listStories();
    sendJson(res, 200, { stories });
    return;
  }

  if (req.method === "POST" && path === "/api/stories") {
    const body = await readJson(req);
    const story = await createStory(body);
    sendJson(res, 201, { story });
    return;
  }

  const summaryMatch = path.match(/^\/api\/stories\/([^/]+)\/summary$/);
  if (req.method === "POST" && summaryMatch) {
    const story = await summarizeStory(summaryMatch[1]);
    sendJson(res, 200, { story });
    return;
  }

  const categoryMatch = path.match(/^\/api\/stories\/([^/]+)\/category$/);
  if (req.method === "POST" && categoryMatch) {
    const story = await categorizeStory(categoryMatch[1]);
    sendJson(res, 200, { story });
    return;
  }

  const statusMatch = path.match(/^\/api\/stories\/([^/]+)\/status$/);
  if (req.method === "POST" && statusMatch) {
    const body = await readJson(req);
    if (!STORY_STATUSES.includes(body.status)) {
      throw httpError(400, `Status must be one of: ${STORY_STATUSES.join(", ")}.`);
    }
    const story = await updateStory(statusMatch[1], { status: body.status });
    sendJson(res, 200, { story });
    return;
  }

  if (req.method === "POST" && path === "/api/policy-proposal") {
    const body = await readJson(req);
    const proposal = await draftPolicyProposal(body.policyIdea);
    sendJson(res, 200, { proposal });
    return;
  }

  sendJson(res, 404, { error: "Route not found." });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(ROOT, requestedPath);

  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "File not found." });
    return;
  }

  res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

// When Supabase is not configured we run in demo mode against an in-memory
// store so the UI is fully viewable without keys. Writes persist until restart.
const DEMO_MODE = !hasSupabaseConfig();
const demoStore = DEMO_MODE ? buildDemoStories() : [];

async function listStories() {
  if (DEMO_MODE) {
    return [...demoStore].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return supabaseFetch("/rest/v1/stories?select=*&order=created_at.desc");
}

async function createStory(body) {
  if (!body.doctorName || !body.transcript) {
    throw httpError(400, "Doctor name and transcript are required.");
  }

  const record = {
    doctor_name: body.doctorName,
    specialty: body.specialty || null,
    encounter_date: body.encounterDate || null,
    reference_code: body.referenceCode || null,
    transcript: body.transcript,
    title: body.title || deriveTitle(body.transcript),
    category: body.category || null,
    status: STORY_STATUSES.includes(body.status) ? body.status : "submitted",
  };

  if (DEMO_MODE) {
    const story = {
      id: `demo-${Date.now()}`,
      created_at: new Date().toISOString(),
      summary: null,
      ...record,
    };
    demoStore.push(story);
    return story;
  }

  const rows = await supabaseFetch("/rest/v1/stories", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(record),
  });

  return rows[0];
}

async function getStory(id) {
  if (DEMO_MODE) {
    const story = demoStore.find((item) => item.id === id);
    if (!story) {
      throw httpError(404, "Story not found.");
    }
    return story;
  }

  const rows = await supabaseFetch(`/rest/v1/stories?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows[0]) {
    throw httpError(404, "Story not found.");
  }
  return rows[0];
}

async function updateStory(id, fields) {
  if (DEMO_MODE) {
    const story = demoStore.find((item) => item.id === id);
    if (!story) {
      throw httpError(404, "Story not found.");
    }
    Object.assign(story, fields);
    return story;
  }

  const rows = await supabaseFetch(`/rest/v1/stories?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(fields),
  });
  return rows[0];
}

function deriveTitle(transcript) {
  const firstSentence = String(transcript || "").trim().split(/(?<=[.!?])\s/)[0] || "";
  const clean = firstSentence.replace(/\s+/g, " ").trim();
  if (!clean) {
    return "Patient story";
  }
  return clean.length > 70 ? `${clean.slice(0, 67)}...` : clean;
}

async function summarizeStory(id) {
  const story = await getStory(id);
  const summary = hasOpenAiConfig()
    ? await openAiText([
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: `Story ID: ${story.id}\n\nTranscript:\n${story.transcript}` },
      ])
    : localSummary(story.transcript);

  return updateStory(id, { summary });
}

async function categorizeStory(id) {
  const story = await getStory(id);
  const category = hasOpenAiConfig()
    ? await openAiText([
        {
          role: "system",
          content: `${CATEGORY_PROMPT}\n\nAllowed categories:\n${POLICY_CATEGORIES.join("\n")}`,
        },
        { role: "user", content: story.transcript },
      ])
    : localCategory(story.transcript);

  return updateStory(id, { category: normalizeCategory(category) });
}

async function draftPolicyProposal(policyIdea) {
  if (!policyIdea) {
    throw httpError(400, "Policy idea is required.");
  }

  const stories = await listStories();
  const evidence = stories
    .map((story) => {
      const summary = story.summary || "No summary yet.";
      return [
        `Story ID: ${story.id}`,
        `Doctor: ${story.doctor_name || "Unknown"}`,
        `Category: ${story.category || "Uncategorized"}`,
        `Summary: ${summary}`,
        `Transcript: ${story.transcript}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  if (!hasOpenAiConfig()) {
    return localProposal(policyIdea, stories);
  }

  return openAiText([
    { role: "system", content: POLICY_PROMPT },
    {
      role: "user",
      content: `Policy idea:\n${policyIdea}\n\nAvailable transcript evidence:\n${evidence}`,
    },
  ]);
}

async function transcribeAudio(audio) {
  requireOpenAi();

  const formData = new FormData();
  formData.append("model", OPENAI_TRANSCRIPTION_MODEL);
  formData.append("file", new Blob([audio.buffer], { type: audio.contentType }), audio.filename);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  });

  const payload = await response.json();
  if (!response.ok) {
    throw httpError(response.status, payload.error?.message || "OpenAI transcription failed.");
  }

  return payload.text || "";
}

async function openAiText(messages) {
  requireOpenAi();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TEXT_MODEL,
      temperature: 0.2,
      messages,
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw httpError(response.status, payload.error?.message || "OpenAI request failed.");
  }

  return payload.choices?.[0]?.message?.content?.trim() || "";
}

async function supabaseFetch(path, options = {}) {
  if (!hasSupabaseConfig()) {
    throw httpError(500, "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw httpError(response.status, payload?.message || payload?.error || "Supabase request failed.");
  }

  return payload;
}

function normalizeCategory(value) {
  const cleaned = value.trim().replace(/^["']|["']$/g, "");
  const match = POLICY_CATEGORIES.find(
    (category) => category.toLowerCase() === cleaned.toLowerCase(),
  );
  return match || cleaned;
}

function requireOpenAi() {
  if (!hasOpenAiConfig()) {
    throw httpError(500, "OpenAI is not configured. Add OPENAI_API_KEY.");
  }
}

function hasSupabaseConfig() {
  return (
    Boolean(SUPABASE_URL) &&
    Boolean(SUPABASE_SERVICE_ROLE_KEY) &&
    !SUPABASE_URL.includes("your-project") &&
    !SUPABASE_SERVICE_ROLE_KEY.startsWith("replace-with") &&
    !SUPABASE_SERVICE_ROLE_KEY.includes("your-service-role-key")
  );
}

function hasOpenAiConfig() {
  return Boolean(OPENAI_API_KEY) && !OPENAI_API_KEY.includes("your-openai-key");
}

async function readJson(req) {
  const text = await readRequestBody(req, "utf8");
  return text ? JSON.parse(text) : {};
}

async function readRequestBody(req, encoding = null) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);
  return encoding ? buffer.toString(encoding) : buffer;
}

async function readMultipartFile(req) {
  const contentType = req.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];
  if (!boundary) {
    throw httpError(400, "Expected multipart audio upload.");
  }

  const buffer = await readRequestBody(req);
  const body = buffer.toString("binary");
  const parts = body.split(`--${boundary}`);
  const filePart = parts.find((part) => part.includes('name="audio"'));

  if (!filePart) {
    throw httpError(400, "Audio file is required.");
  }

  const [rawHeaders, rawBody] = filePart.split("\r\n\r\n");
  const filename = rawHeaders.match(/filename="([^"]+)"/)?.[1] || "story.webm";
  const fileContentType = rawHeaders.match(/Content-Type:\s*([^\r\n]+)/i)?.[1] || "audio/webm";
  const binaryBody = rawBody.slice(0, -2);

  return {
    filename,
    contentType: fileContentType,
    buffer: Buffer.from(binaryBody, "binary"),
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function statusForError(error) {
  return error.status || 500;
}

function parseList(value, fallback) {
  if (!value) {
    return fallback;
  }
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

// --- Local (no-OpenAI) fallbacks so demo mode stays interactive ---

function localSummary(transcript) {
  const text = String(transcript || "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "No transcript to summarize.";
  }
  const sentences = text.split(/(?<=[.!?])\s/).slice(0, 2).join(" ");
  const summary = sentences || text.slice(0, 240);
  return summary.length > 280 ? `${summary.slice(0, 277)}...` : summary;
}

const CATEGORY_KEYWORDS = {
  "Medicaid Access": ["medicaid", "coverage", "renewal", "enroll", "plan dropped", "lost coverage"],
  "Insurance Denials": ["denied", "denial", "prior auth", "authorization", "claim", "appeal"],
  "Cost of Care": ["afford", "cost", "copay", "expensive", "out-of-pocket", "ration", "insulin"],
  Transportation: ["bus", "transport", "ride", "car seat", "travel", "drive", "too far", "stroller"],
  "Language Barriers": ["interpreter", "language", "translate", "english", "consent form"],
  "Food Insecurity": ["food", "groceries", "formula", "wic", "pantry", "hunger", "meal"],
  "Disability Access": ["wheelchair", "ramp", "accessible", "accommodation", "disability", "exam table"],
};

function localCategory(transcript) {
  const text = String(transcript || "").toLowerCase();
  let best = "Other";
  let bestScore = 0;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((sum, kw) => (text.includes(kw) ? sum + 1 : sum), 0);
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

function localProposal(policyIdea, stories) {
  const counts = {};
  for (const story of stories) {
    const key = story.category || "Uncategorized";
    counts[key] = (counts[key] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topThemes = ranked.slice(0, 3).map(([name, n]) => `${name} (${n})`).join(", ");
  const cited = stories.slice(0, 5).map((s) => `- [${s.id}] ${s.title || deriveTitle(s.transcript)}`);

  return [
    `POLICY PROPOSAL (demo draft — add OPENAI_API_KEY for an AI-written version)`,
    ``,
    `Proposal: ${policyIdea}`,
    ``,
    `Background:`,
    `Across ${stories.length} collected patient stories, the most frequently reported barriers are ${topThemes || "not yet categorized"}. These first-hand accounts point to a recurring gap that this proposal seeks to address.`,
    ``,
    `Recommendation:`,
    `Adopt the policy idea above, prioritizing the highest-volume barriers and tracking outcomes against the themes that patients report most often.`,
    ``,
    `Supporting evidence (story IDs):`,
    ...cited,
  ].join("\n");
}

// --- Demo dataset (used only when Supabase is unconfigured) ---

function buildDemoStories() {
  // [daysAgo, doctor, specialty, category, status, title, quote]
  const rows = [
    [1, "Dr. Aisha Patel", "Family Medicine", "Insurance Denials", "in_advocacy", "Child denied asthma inhaler over prior auth", "The pharmacy said the inhaler needed prior authorization again, so my son went four days without it and ended up in urgent care."],
    [2, "Dr. Aisha Patel", "Family Medicine", "Cost of Care", "reviewed", "Family rationing insulin for diabetic teen", "We couldn't afford the full insulin dose so we stretched it out. I was terrified every single day."],
    [3, "Dr. Marcus Lee", "Pediatrics", "Transportation", "submitted", "Missed appointments after bus route changed", "The bus stop moved and I can't walk that far with the stroller, so we missed the follow-up visits."],
    [4, "Dr. Marcus Lee", "Pediatrics", "Language Barriers", "draft", "No interpreter for discharge instructions", "I had my daughter translate the discharge papers because no interpreter was available. I didn't fully understand the medication schedule."],
    [5, "Dr. Sara Kim", "Pediatrics", "Medicaid Access", "submitted", "Coverage lapsed during Medicaid renewal", "Our Medicaid renewal got stuck in paperwork and my kids lost coverage for two months."],
    [6, "Dr. Sara Kim", "Pediatrics", "Food Insecurity", "reviewed", "Choosing between groceries and medication", "Every month I have to choose between buying healthy food for my family and paying for my child's prescriptions."],
    [7, "Dr. Aisha Patel", "Family Medicine", "Disability Access", "submitted", "No wheelchair access at the clinic entrance", "There was no ramp at the side entrance and we had to wait outside in the cold for help."],
    [8, "Dr. Omar Haddad", "Pediatrics", "Medicaid Access", "in_advocacy", "Specialist won't accept our Medicaid plan", "Three specialists turned us away because they don't take our Medicaid plan. The wait for one that does is months."],
    [10, "Dr. Omar Haddad", "Pediatrics", "Insurance Denials", "reviewed", "Denied again, no explanation given", "This is the third time the claim was denied. The letters are confusing and there's no one to call for help."],
    [11, "Dr. Sara Kim", "Pediatrics", "Language Barriers", "submitted", "Parent couldn't understand vaccine consent form", "The consent form was only in English and the family wasn't sure what they were agreeing to."],
    [13, "Dr. Marcus Lee", "Pediatrics", "Transportation", "submitted", "Two-hour trip each way for pediatric specialist", "We take three buses to reach the only pediatric specialist that takes our insurance."],
    [15, "Dr. Aisha Patel", "Family Medicine", "Cost of Care", "reviewed", "Skipped follow-up labs due to cost", "We skipped the recommended lab work because the out-of-pocket cost was too high."],
    [17, "Dr. Omar Haddad", "Pediatrics", "Medicaid Access", "submitted", "Lost dental coverage mid-treatment", "Our plan dropped pediatric dental and we had to stop my son's treatment halfway through."],
    [19, "Dr. Sara Kim", "Pediatrics", "Food Insecurity", "submitted", "WIC didn't cover the only formula baby tolerates", "The only formula my baby tolerates wasn't covered, so we diluted feeds to make it last."],
    [21, "Dr. Marcus Lee", "Pediatrics", "Other", "submitted", "Long ER waits for routine pediatric care", "Without a regular doctor we use the ER for everything and wait many hours each time."],
    [23, "Dr. Aisha Patel", "Family Medicine", "Language Barriers", "reviewed", "Telehealth visit failed without interpreter line", "The video visit had no interpreter option, so the appointment was cut short."],
    [26, "Dr. Omar Haddad", "Pediatrics", "Transportation", "submitted", "No car seat, couldn't take discharge ride", "We couldn't take the hospital ride home because we didn't have a car seat that fit."],
    [28, "Dr. Sara Kim", "Pediatrics", "Insurance Denials", "submitted", "Prior auth delayed seizure medication", "The prior authorization for my daughter's seizure medication took two weeks while she waited."],
    [31, "Dr. Marcus Lee", "Pediatrics", "Medicaid Access", "submitted", "Newborn not added to Medicaid for weeks", "It took almost a month to get our newborn added to Medicaid, so we delayed the first check-ups."],
    [34, "Dr. Aisha Patel", "Family Medicine", "Cost of Care", "submitted", "High copay kept us from the asthma specialist", "The specialist copay was too high so we kept managing the asthma at home."],
    [37, "Dr. Omar Haddad", "Pediatrics", "Disability Access", "submitted", "No accessible exam table for child with CP", "The clinic had no height-adjustable table, making the exam difficult and unsafe."],
    [40, "Dr. Sara Kim", "Pediatrics", "Food Insecurity", "submitted", "Food pantry hours conflict with clinic visits", "The only food pantry is open the same hours as our clinic, so we miss one or the other."],
  ];

  const dayMs = 24 * 60 * 60 * 1000;
  return rows.map((row, index) => {
    const [daysAgo, doctor, specialty, category, status, title, quote] = row;
    const created = new Date(Date.now() - daysAgo * dayMs);
    return {
      id: `demo-${index + 1}`,
      created_at: created.toISOString(),
      doctor_name: doctor,
      specialty,
      encounter_date: created.toISOString().slice(0, 10),
      reference_code: null,
      transcript: quote,
      summary: status === "draft" ? null : quote,
      category,
      title,
      status,
    };
  });
}

function loadEnvFile() {
  const path = join(ROOT, ".env");
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
