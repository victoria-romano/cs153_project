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
  "Access to care",
  "Cost and coverage barriers",
  "Care coordination",
  "Administrative burden",
]);

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
  console.log(`CareStory AI running at http://${HOST}:${PORT}`);
});

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      supabaseConfigured: hasSupabaseConfig(),
      openAiConfigured: hasOpenAiConfig(),
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

async function listStories() {
  return supabaseFetch("/rest/v1/stories?select=*&order=created_at.desc");
}

async function createStory(body) {
  if (!body.doctorName || !body.transcript) {
    throw httpError(400, "Doctor name and transcript are required.");
  }

  const rows = await supabaseFetch("/rest/v1/stories", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      doctor_name: body.doctorName,
      specialty: body.specialty || null,
      encounter_date: body.encounterDate || null,
      reference_code: body.referenceCode || null,
      transcript: body.transcript,
    }),
  });

  return rows[0];
}

async function getStory(id) {
  const rows = await supabaseFetch(`/rest/v1/stories?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows[0]) {
    throw httpError(404, "Story not found.");
  }
  return rows[0];
}

async function updateStory(id, fields) {
  const rows = await supabaseFetch(`/rest/v1/stories?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(fields),
  });
  return rows[0];
}

async function summarizeStory(id) {
  const story = await getStory(id);
  const summary = await openAiText([
    { role: "system", content: SUMMARY_PROMPT },
    { role: "user", content: `Story ID: ${story.id}\n\nTranscript:\n${story.transcript}` },
  ]);

  return updateStory(id, { summary });
}

async function categorizeStory(id) {
  const story = await getStory(id);
  const category = await openAiText([
    {
      role: "system",
      content: `${CATEGORY_PROMPT}\n\nAllowed categories:\n${POLICY_CATEGORIES.join("\n")}`,
    },
    { role: "user", content: story.transcript },
  ]);

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
