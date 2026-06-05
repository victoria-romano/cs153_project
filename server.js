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
  "Language Barriers",
  "Transportation",
  "Cost of Care",
  "Vaccine-Preventable Diseases",
  "Immigration-Related Concerns",
  "Other",
]);

const STORY_STATUSES = [
  "draft",
  "submitted",
  "reviewed",
  "in_advocacy",
  "shared_with_policymakers",
];

const POLICY_BRIEF_PROMPT =
  process.env.POLICY_BRIEF_PROMPT ||
  [
    "You are drafting a living policy brief for the Stanford Office of Child Health Equity.",
    "Synthesize ALL of the supplied de-identified clinician stories on a single theme into one coherent brief.",
    "Your job is to make it visible that the brief aggregates evidence across multiple stories — every story supplied must appear at least once in the Evidence Base section, and the strongest 3-5 should also be quoted under Representative Stories.",
    "",
    "Follow this template EXACTLY, using these Markdown headings in this order:",
    "",
    "# Living Policy Brief: <Theme>",
    "*Synthesized from <N> clinician stories | Drafted <today's date>*",
    "",
    "## Executive Summary",
    "(2-3 sentences. What is the recurring barrier and why it matters for pediatric care.)",
    "",
    "## The Pattern",
    "(One short paragraph. Describe what is happening across the stories. Reference how many stories support each sub-pattern when relevant.)",
    "",
    "## Evidence Base",
    "(A bulleted list with ONE bullet per supplied story. Format each bullet as: `- [<short-id>] (<Provider>) one-line takeaway from this story.` Include every story in the input, in chronological order, newest first.)",
    "",
    "## Representative Stories",
    "(3-5 bullets quoting or paraphrasing the most illustrative stories in more depth. Cite by short story ID in brackets, e.g. [abcd1234]. These should be drawn from the same set listed in Evidence Base.)",
    "",
    "## Downstream Impact on Pediatric Care",
    "(One short paragraph on clinical, developmental, and system-level effects.)",
    "",
    "## Policy Recommendations",
    "(3 numbered, concrete, actionable recommendations. Each should be grounded in patterns visible in the supplied stories.)",
    "",
    "## Methodology Note",
    "Synthesized from de-identified clinician stories submitted via Storybook. Story IDs are pseudonymous identifiers that trace back to the original transcript in the secure OCHE workspace. Names in stories are illustrative.",
    "",
    "Hard rules: do not invent facts beyond what the stories support; do not include real patient identifiers; keep the whole brief under ~700 words.",
  ].join("\n");

const SUMMARY_PROMPT =
  process.env.SUMMARY_PROMPT ||
  "Summarize this doctor story in 2-4 concise sentences. Preserve the policy-relevant facts.";

const CATEGORY_PROMPT =
  process.env.CATEGORY_PROMPT ||
  "Choose the one category that best fits this story. Return only the category name.";

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
  console.log(`Storybook running at http://${HOST}:${PORT}`);
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

    // Advocacy actions auto-regenerate the living brief for the story's theme,
    // so a brief gets created/refreshed the moment a story is escalated.
    let brief = null;
    if (
      (body.status === "in_advocacy" || body.status === "shared_with_policymakers") &&
      story.category &&
      POLICY_CATEGORIES.includes(story.category)
    ) {
      try {
        brief = await regeneratePolicyBrief(story.category);
      } catch (error) {
        console.warn("Auto-brief regeneration failed:", error.message);
      }
    }

    sendJson(res, 200, { story, brief });
    return;
  }

  if (req.method === "GET" && path === "/api/policy-briefs") {
    const briefs = await listPolicyBriefs();
    sendJson(res, 200, { briefs });
    return;
  }

  const briefMatch = path.match(/^\/api\/policy-briefs\/([^/]+)$/);
  if (req.method === "POST" && briefMatch) {
    const theme = decodeURIComponent(briefMatch[1]);
    const brief = await regeneratePolicyBrief(theme);
    sendJson(res, 200, { brief });
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
  if (!body.transcript) {
    throw httpError(400, "Transcript is required.");
  }

  const isAnonymous = Boolean(body.anonymous);
  const doctorName = isAnonymous ? "Anonymous clinician" : (body.doctorName || "").trim();
  if (!isAnonymous && !doctorName) {
    throw httpError(400, "Provider name is required (or check 'Submit anonymously').");
  }

  const record = {
    doctor_name: doctorName,
    specialty: isAnonymous ? null : (body.specialty || null),
    encounter_date: body.encounterDate || null,
    reference_code: body.referenceCode || null,
    transcript: body.transcript,
    title: body.title || deriveTitle(body.transcript),
    category: body.category || null,
    status: STORY_STATUSES.includes(body.status) ? body.status : "submitted",
  };

  // If no focus area was chosen and we have OpenAI, auto-categorize before
  // saving so every story lands with one of the six predefined labels.
  if (!record.category && record.status !== "draft" && hasOpenAiConfig()) {
    try {
      const guess = await openAiText([
        {
          role: "system",
          content: `${CATEGORY_PROMPT}\n\nAllowed categories:\n${POLICY_CATEGORIES.join("\n")}`,
        },
        { role: "user", content: record.transcript },
      ]);
      record.category = normalizeCategory(guess);
    } catch (error) {
      console.warn("Auto-categorize on submit failed:", error.message);
    }
  }

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

// --- Policy briefs (one living brief per theme) ---

const demoBriefStore = DEMO_MODE ? new Map() : null;

async function listPolicyBriefs() {
  if (DEMO_MODE) {
    return [...demoBriefStore.values()].sort(
      (a, b) => new Date(b.updated_at) - new Date(a.updated_at),
    );
  }
  return supabaseFetch("/rest/v1/policy_briefs?select=*&order=updated_at.desc");
}

async function regeneratePolicyBrief(theme) {
  if (!POLICY_CATEGORIES.includes(theme)) {
    throw httpError(400, `Unknown theme: ${theme}`);
  }

  const stories = (await listStories()).filter(
    (s) => (s.category || "Other") === theme && isSubmittedStatus(s.status),
  );

  if (!stories.length) {
    throw httpError(400, `No submitted stories yet under "${theme}". Submit a story first.`);
  }

  const briefText = hasOpenAiConfig()
    ? await openAiBriefText(theme, stories)
    : localBrief(theme, stories);

  const record = {
    theme,
    brief: briefText,
    story_count: stories.length,
    updated_at: new Date().toISOString(),
  };

  if (DEMO_MODE) {
    demoBriefStore.set(theme, record);
    return record;
  }

  const rows = await supabaseFetch(
    `/rest/v1/policy_briefs?on_conflict=theme`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(record),
    },
  );
  return rows[0];
}

function isSubmittedStatus(status) {
  return status && status !== "draft";
}

async function openAiBriefText(theme, stories) {
  const ordered = [...stories].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );
  const today = new Date().toISOString().slice(0, 10);

  const evidence = ordered
    .map((story) =>
      [
        `Story ID: ${story.id}`,
        `Short ID: ${String(story.id).slice(0, 8)}`,
        `Provider: ${story.doctor_name || "Anonymous"}`,
        `Submitted: ${(story.created_at || "").slice(0, 10)}`,
        `Status: ${story.status || "submitted"}`,
        `Category: ${theme}`,
        `Summary: ${story.summary || "—"}`,
        `Transcript: ${story.transcript}`,
      ].join("\n"),
    )
    .join("\n\n---\n\n");

  return openAiText([
    { role: "system", content: POLICY_BRIEF_PROMPT },
    {
      role: "user",
      content: [
        `Theme: ${theme}`,
        `Today: ${today}`,
        `Stories under this theme: ${ordered.length}`,
        ``,
        `Use the "Short ID" value (8 characters) in your bracketed citations.`,
        `Every story below must appear once in Evidence Base.`,
        ``,
        evidence,
      ].join("\n"),
    },
  ]);
}

function localBrief(theme, stories) {
  const today = new Date().toISOString().slice(0, 10);
  const shortId = (id) => String(id).slice(0, 8);
  const ordered = [...stories].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );

  const evidenceBase = ordered.map((s) => {
    const provider = s.doctor_name || "Anonymous";
    const takeaway = (s.summary || s.transcript || "").replace(/\s+/g, " ").slice(0, 140).trim();
    return `- [${shortId(s.id)}] (${provider}) ${takeaway}`;
  });

  const representative = ordered.slice(0, 4).map((s) => {
    const quote = (s.summary || s.transcript || "").replace(/\s+/g, " ").slice(0, 220).trim();
    return `- [${shortId(s.id)}] ${quote}`;
  });

  return [
    `# Living Policy Brief: ${theme}`,
    `*Synthesized from ${ordered.length} clinician ${ordered.length === 1 ? "story" : "stories"} | Drafted ${today}*`,
    ``,
    `> Demo draft — add OPENAI_API_KEY for an AI-synthesized brief.`,
    ``,
    `## Executive Summary`,
    `Clinicians repeatedly report that "${theme.toLowerCase()}" is creating delays, missed care, and avoidable downstream costs for pediatric patients. The pattern is consistent across ${ordered.length} ${ordered.length === 1 ? "submission" : "submissions"} and warrants a coordinated policy response.`,
    ``,
    `## The Pattern`,
    `Across the ${ordered.length} submitted ${ordered.length === 1 ? "story" : "stories"}, providers describe the same barrier surfacing in different visit contexts and family situations — suggesting a systemic gap rather than isolated incidents.`,
    ``,
    `## Evidence Base`,
    ...evidenceBase,
    ``,
    `## Representative Stories`,
    ...representative,
    ``,
    `## Downstream Impact on Pediatric Care`,
    `Affected children experience delayed diagnoses, interrupted treatment, and increased acute-care utilization. Families face cumulative time, financial, and emotional costs that compound over the course of childhood.`,
    ``,
    `## Policy Recommendations`,
    `1. Targeted reimbursement or coverage changes addressing the specific bottleneck identified in these stories.`,
    `2. Workflow and access investments at the clinic level (interpreter access, transportation vouchers, schedule flexibility).`,
    `3. Cross-agency data sharing to proactively surface families at risk of falling through the gaps.`,
    ``,
    `## Methodology Note`,
    `Synthesized from de-identified clinician stories submitted via Storybook. Story IDs are pseudonymous identifiers that trace back to the original transcript in the secure OCHE workspace. Names in stories are illustrative.`,
  ].join("\n");
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
  "Language Barriers": ["interpreter", "language", "translate", "english", "consent form", "spanish"],
  Transportation: ["bus", "transport", "ride", "car seat", "travel", "drive", "too far", "stroller"],
  "Cost of Care": ["afford", "cost", "copay", "expensive", "out-of-pocket", "ration", "insulin", "deductible"],
  "Vaccine-Preventable Diseases": [
    "vaccine",
    "vaccination",
    "immuniz",
    "measles",
    "mmr",
    "pertussis",
    "whooping cough",
    "flu shot",
    "hpv",
    "polio",
    "outbreak",
    "anti-vax",
    "refused vaccine",
  ],
  "Immigration-Related Concerns": [
    "immigration",
    "immigrant",
    "undocumented",
    "ice",
    "deportation",
    "visa",
    "asylum",
    "refugee",
    "afraid to come",
    "afraid to seek",
    "public charge",
    "green card",
  ],
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

// --- Demo dataset (used only when Supabase is unconfigured) ---

function buildDemoStories() {
  // All names below are FICTIONAL. No real patients or providers are referenced.
  // [daysAgo, provider, specialty, category, status, title, quote]
  const rows = [
    [1, "Provider A", "Pediatrics", "Vaccine-Preventable Diseases", "in_advocacy", "Toddler hospitalized for pertussis after missed vaccines", "The family missed several well-child visits and the toddler ended up admitted with whooping cough. The parents told me they wanted the vaccines but couldn't get the time off work to come in."],
    [2, "Provider A", "Pediatrics", "Cost of Care", "reviewed", "Family rationing inhaler refills", "The family couldn't afford the monthly refills so they stretched the inhaler out. The child ended up in urgent care twice in three months."],
    [3, "Provider B", "Family Medicine", "Transportation", "submitted", "Missed appointments after the bus route changed", "The bus stop moved and the caregiver couldn't walk that far with the stroller, so they missed the follow-up visits."],
    [4, "Provider B", "Family Medicine", "Language Barriers", "draft", "No interpreter for discharge instructions", "The caregiver had her teenage daughter translate the discharge papers because no interpreter was available. She didn't fully understand the medication schedule."],
    [5, "Provider C", "Pediatrics", "Immigration-Related Concerns", "submitted", "Family afraid to come in after ICE activity in the neighborhood", "The family canceled three visits in a row after immigration enforcement was reported nearby. The child went without asthma follow-up for two months."],
    [6, "Provider C", "Pediatrics", "Cost of Care", "reviewed", "Choosing between groceries and medication", "The caregiver told me they have to choose every month between buying healthy food for the family and paying for their child's prescriptions."],
    [7, "Provider A", "Pediatrics", "Vaccine-Preventable Diseases", "submitted", "Measles exposure at school, child unvaccinated due to misinformation", "Parents had delayed the MMR after reading misinformation online. When measles circulated at the school, the child had to be excluded for three weeks."],
    [8, "Provider D", "Pediatrics", "Immigration-Related Concerns", "in_advocacy", "Caregiver declined Medicaid enrollment, citing public charge fears", "The family qualifies for coverage but declined to enroll out of fear it would affect their immigration case, even after I explained current rules."],
    [10, "Provider D", "Pediatrics", "Language Barriers", "reviewed", "Telehealth visit failed without an interpreter line", "The video visit had no interpreter option, so the appointment was cut short and we had to reschedule in person."],
    [11, "Provider C", "Pediatrics", "Language Barriers", "submitted", "Caregiver couldn't understand vaccine consent form", "The consent form was only in English and the family wasn't sure what they were agreeing to. They eventually declined the vaccine."],
    [13, "Provider B", "Family Medicine", "Transportation", "submitted", "Two-hour trip each way for pediatric specialist", "The family takes three buses to reach the only pediatric specialist that takes their insurance."],
    [15, "Provider A", "Pediatrics", "Cost of Care", "reviewed", "Skipped follow-up labs due to cost", "The family skipped the recommended lab work because the out-of-pocket cost was too high."],
    [17, "Provider D", "Pediatrics", "Vaccine-Preventable Diseases", "submitted", "Vaccine refused after community-wide misinformation campaign", "Several families in the same neighborhood refused HPV vaccination after a flyer circulated with false claims. We're seeing a cluster of declines."],
    [19, "Provider C", "Pediatrics", "Immigration-Related Concerns", "submitted", "Mixed-status family avoiding the ER for child's seizure", "The caregiver waited at home through a febrile seizure because she was afraid going to the ER would trigger questions about her status."],
    [21, "Provider B", "Family Medicine", "Other", "submitted", "Long ER waits for routine pediatric care", "Without a regular doctor the family uses the ER for everything and waits many hours each time."],
    [23, "Provider A", "Pediatrics", "Language Barriers", "reviewed", "Phone interpreter line was busy during the entire visit", "I tried the interpreter line three times and couldn't get through, so I muddled through the visit using a translation app."],
    [26, "Provider D", "Pediatrics", "Transportation", "submitted", "No car seat, couldn't take discharge ride", "The family couldn't take the hospital ride home because they didn't have a car seat that fit."],
    [28, "Provider C", "Pediatrics", "Cost of Care", "submitted", "Specialist copay delayed neurology evaluation", "The specialist copay was too high so the family kept rescheduling. The seizure workup was delayed for months."],
    [31, "Provider B", "Family Medicine", "Vaccine-Preventable Diseases", "submitted", "Flu outbreak at daycare among under-vaccinated kids", "Most of the daycare's flu cases this season were in kids whose families said they meant to vaccinate but never made it to the appointment."],
    [34, "Provider A", "Pediatrics", "Immigration-Related Concerns", "submitted", "Parent skipped own care to avoid documenting the family", "The mother stopped going to her own appointments because she was worried it would create a paper trail that affected her kids' immigration case."],
    [37, "Provider D", "Pediatrics", "Other", "submitted", "Housing instability disrupting continuity of care", "The family has moved three times this year and we keep losing track of immunizations and follow-up needs."],
    [40, "Provider C", "Pediatrics", "Transportation", "submitted", "Ride share canceled, family missed asthma follow-up", "The ride share didn't show and the family had no backup, so they missed an asthma follow-up during peak allergy season."],
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
