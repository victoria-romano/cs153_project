const PROMPTS = [
  { ico: "📄", label: "Insurance denials or prior authorization", cat: "Insurance Denials" },
  { ico: "💲", label: "Cost of care or medication delays", cat: "Cost of Care" },
  { ico: "🚌", label: "Transportation or missed appointments", cat: "Transportation" },
  { ico: "💬", label: "Language or communication barriers", cat: "Language Barriers" },
  { ico: "🍎", label: "Food insecurity or housing instability", cat: "Food Insecurity" },
  { ico: "♿", label: "Disability access or accommodation issues", cat: "Disability Access" },
  { ico: "•••", label: "Other barriers to care", cat: "Other" },
];

const THEME_ICONS = {
  "Medicaid Access": "🏛️",
  "Insurance Denials": "📄",
  "Cost of Care": "💲",
  Transportation: "🚌",
  "Language Barriers": "💬",
  "Food Insecurity": "🍎",
  "Disability Access": "♿",
  Other: "•••",
};

const STATUS_LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  reviewed: "Reviewed",
  in_advocacy: "Used in advocacy",
};

const NAV = {
  doctor: [
    ["🏠", "Dashboard"],
    ["📚", "My stories"],
    ["💡", "Prompts"],
    ["📖", "Resources"],
    ["📈", "Impact"],
    ["⚙️", "Settings"],
  ],
  admin: [
    ["🏠", "Dashboard"],
    ["📚", "Stories"],
    ["🏷️", "Themes"],
    ["📋", "Advocacy briefs"],
    ["📊", "Reports"],
    ["⚙️", "Settings"],
  ],
};

const ADVOCACY_GOAL = 50;

const state = {
  stories: [],
  role: "doctor",
  chartMode: "weekly",
  selectedStoryId: null,
  categories: [],
  demoMode: false,
  mediaRecorder: null,
  audioChunks: [],
};

const $ = (id) => document.getElementById(id);

// ---------------- helpers ----------------

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function daysAgo(value) {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
}

function isSubmitted(story) {
  return story.status && story.status !== "draft";
}

async function apiFetch(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Something went wrong.");
  }
  return payload;
}

// ---------------- aggregation ----------------

function themeBreakdown() {
  const counts = {};
  for (const s of state.stories) {
    const key = s.category || "Other";
    counts[key] = (counts[key] || 0) + 1;
  }
  const total = state.stories.length || 1;
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

function topBarrierThisWeek() {
  const week = state.stories.filter((s) => daysAgo(s.created_at) < 7);
  const pool = week.length ? week : state.stories;
  const counts = {};
  for (const s of pool) {
    const key = s.category || "Other";
    counts[key] = (counts[key] || 0) + 1;
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [name, count] = ranked[0];
  return { name, count, pct: Math.round((count / pool.length) * 100) };
}

function weeklyBuckets(n = 6) {
  const counts = new Array(n).fill(0);
  const now = Date.now();
  for (const s of state.stories) {
    const b = Math.floor(daysAgo(s.created_at) / 7);
    if (b >= 0 && b < n) counts[n - 1 - b]++;
  }
  return counts.map((count, i) => {
    const startDaysAgo = (n - 1 - i) * 7 + 6;
    const d = new Date(now - startDaysAgo * 86400000);
    return { label: `${d.getMonth() + 1}/${d.getDate()}`, count };
  });
}

function monthlyBuckets(n = 6) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const count = state.stories.filter((s) => {
      const sd = new Date(s.created_at);
      return sd.getFullYear() === d.getFullYear() && sd.getMonth() === d.getMonth();
    }).length;
    out.push({ label: d.toLocaleDateString(undefined, { month: "short" }), count });
  }
  return out;
}

// ---------------- rendering ----------------

function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function renderChrome() {
  const isDoctor = state.role === "doctor";

  document.querySelectorAll(".role-switch button").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.role === state.role);
  });

  $("doctor-dash").classList.toggle("is-hidden", !isDoctor);
  $("admin-dash").classList.toggle("is-hidden", isDoctor);

  $("greeting").textContent = greetingWord();
  $("subtitle").textContent = isDoctor
    ? "Thank you for raising your voice for your patients."
    : "Here's what's happening with the stories you've collected.";

  $("top-record").classList.toggle("is-hidden", !isDoctor);
  $("sidebar-record").classList.toggle("is-hidden", !isDoctor);
  $("demo-badge").classList.toggle("is-hidden", !state.demoMode);

  // nav
  const nav = $("nav");
  nav.innerHTML = "";
  NAV[state.role].forEach(([ico, label], i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `nav-item${i === 0 ? " is-active" : ""}`;
    btn.title = i === 0 ? "" : "Preview only in this prototype";
    btn.innerHTML = `<span class="nav-ico">${ico}</span> ${escapeHtml(label)}`;
    btn.addEventListener("click", () => {
      nav.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("is-active"));
      btn.classList.add("is-active");
    });
    nav.appendChild(btn);
  });

  $("last-updated").textContent = `Last updated ${new Date().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function storyCardHtml(story, index) {
  const cat = story.category || "Other";
  const quote = story.summary || story.transcript || "";
  return `
    <button class="story-card" data-id="${escapeHtml(story.id)}">
      <div class="story-row">
        <span class="story-id">S${index + 1}</span>
        <div class="story-main">
          <div class="story-title">${escapeHtml(story.title || "Patient story")}</div>
          <p class="story-quote">${escapeHtml(quote)}</p>
          <div class="story-meta">
            <span class="tag" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</span>
            <span class="status" data-status="${escapeHtml(story.status || "submitted")}">${
              STATUS_LABELS[story.status] || "Submitted"
            }</span>
            <span class="story-date">${formatDate(story.created_at)}</span>
          </div>
        </div>
      </div>
    </button>`;
}

function renderStoryLists() {
  const recent = state.stories.slice(0, 6);
  const html = recent.length
    ? recent.map((s, i) => storyCardHtml(s, i)).join("")
    : '<p class="muted" style="padding:18px;">No stories yet. Record one to get started.</p>';

  ["doctor-stories", "admin-stories"].forEach((id) => {
    const el = $(id);
    el.innerHTML = html;
    el.querySelectorAll(".story-card").forEach((card) => {
      card.addEventListener("click", () => openDetail(card.dataset.id));
    });
  });
}

function renderDoctorKpis() {
  const submitted = state.stories.filter(isSubmitted);
  const drafts = state.stories.filter((s) => s.status === "draft");
  const week = submitted.filter((s) => daysAgo(s.created_at) < 7);
  const advocacy = state.stories.filter((s) => s.status === "in_advocacy");

  $("doc-total").textContent = submitted.length;
  $("doc-drafts").textContent = drafts.length;
  $("doc-week").textContent = week.length;
  $("doc-advocacy").textContent = advocacy.length;
  const pct = submitted.length ? Math.round((advocacy.length / submitted.length) * 100) : 0;
  $("doc-advocacy-sub").textContent = `${pct}% of submissions`;

  const ringPct = Math.min(100, Math.round((submitted.length / ADVOCACY_GOAL) * 100));
  $("impact-ring").style.setProperty("--val", ringPct);
  $("impact-pct").textContent = `${ringPct}%`;
  $("impact-copy").textContent = `${submitted.length} of ${ADVOCACY_GOAL} stories toward the 2025 goal. You're helping shape a more equitable health system.`;
}

function renderAdminKpis() {
  const week = state.stories.filter((s) => daysAgo(s.created_at) < 7);
  const reviewed = state.stories.filter((s) => s.status === "reviewed" || s.status === "in_advocacy");
  const advocacy = state.stories.filter((s) => s.status === "in_advocacy");

  $("adm-week").textContent = week.length;
  $("adm-reviewed").textContent = reviewed.length;
  $("adm-advocacy").textContent = advocacy.length;

  const barrier = topBarrierThisWeek();
  $("adm-barrier").textContent = barrier ? barrier.name : "—";
  $("adm-barrier-sub").textContent = barrier
    ? `${barrier.count} stories · ${barrier.pct}% of recent`
    : "No stories yet";
}

function renderThemes() {
  const themes = themeBreakdown();
  const max = themes.length ? themes[0].count : 1;
  $("theme-list").innerHTML = themes
    .map(
      (t) => `
      <div class="theme-row">
        <span class="theme-ico">${THEME_ICONS[t.name] || "•••"}</span>
        <div class="theme-main">
          <div class="theme-name">${escapeHtml(t.name)}</div>
          <div class="theme-bar"><span style="width:${Math.round((t.count / max) * 100)}%"></span></div>
        </div>
        <div class="theme-num"><b>${t.count}</b> · ${t.pct}%</div>
      </div>`,
    )
    .join("");
}

function renderChart() {
  const buckets = state.chartMode === "weekly" ? weeklyBuckets() : monthlyBuckets();
  const max = Math.max(...buckets.map((b) => b.count), 1);
  $("chart").innerHTML = buckets
    .map(
      (b) => `
      <div class="chart-col">
        <div class="chart-bar" style="height:${b.count ? Math.max(6, (b.count / max) * 100) : 3}%">
          <span>${b.count}</span>
        </div>
        <div class="chart-x">${escapeHtml(b.label)}</div>
      </div>`,
    )
    .join("");
  document.querySelectorAll("#chart-toggle button").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mode === state.chartMode);
  });
}

function renderPrompts() {
  const list = $("prompt-list");
  list.innerHTML = PROMPTS.map(
    (p) => `
    <button class="prompt-row" type="button" data-cat="${escapeHtml(p.cat)}">
      <span class="prompt-ico">${p.ico}</span>
      <span>${escapeHtml(p.label)}</span>
      <span class="chev">›</span>
    </button>`,
  ).join("");
  list.querySelectorAll(".prompt-row").forEach((row) => {
    row.addEventListener("click", () => openRecordModal(row.dataset.cat));
  });
}

function renderAll() {
  renderChrome();
  renderDoctorKpis();
  renderAdminKpis();
  renderStoryLists();
  renderThemes();
  renderChart();
}

// ---------------- data ----------------

async function loadStories() {
  try {
    const payload = await apiFetch("/api/stories");
    state.stories = payload.stories || [];
  } catch (error) {
    state.stories = [];
    console.error(error);
  }
  renderAll();
}

async function loadConfig() {
  try {
    const health = await apiFetch("/api/health");
    state.demoMode = Boolean(health.demoMode);
    state.categories = health.categories || [];
  } catch (error) {
    console.error(error);
  }
  populateFocusArea();
}

function populateFocusArea() {
  const sel = $("focus-area");
  const cats = state.categories.length
    ? state.categories
    : Object.keys(THEME_ICONS);
  sel.innerHTML =
    '<option value="">General / not sure</option>' +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}

// ---------------- record modal ----------------

function openRecordModal(focusCategory) {
  $("record-modal").classList.remove("is-hidden");
  if (focusCategory) $("focus-area").value = focusCategory;
  $("doctor-name").focus();
}

function closeRecordModal() {
  $("record-modal").classList.add("is-hidden");
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);
    state.mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) state.audioChunks.push(e.data);
    });
    state.mediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((t) => t.stop());
      await transcribeRecording();
    });
    state.mediaRecorder.start();
    $("record-btn").disabled = true;
    $("stop-btn").disabled = false;
    setRecordingStatus("Recording", true);
    setDoctorMessage("Recording in progress…");
  } catch (error) {
    setDoctorMessage(error.message);
  }
}

function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") return;
  $("stop-btn").disabled = true;
  state.mediaRecorder.stop();
  setRecordingStatus("Transcribing");
  setDoctorMessage("Uploading audio for transcription…");
}

async function transcribeRecording() {
  try {
    const audioBlob = new Blob(state.audioChunks, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("audio", audioBlob, "story.webm");
    const payload = await apiFetch("/api/transcribe", { method: "POST", body: formData });
    $("transcript").value = payload.transcript || "";
    setDoctorMessage("Transcript ready. Review it, then submit.");
  } catch (error) {
    setDoctorMessage(`${error.message} You can type or paste the transcript instead.`);
  } finally {
    $("record-btn").disabled = false;
    $("stop-btn").disabled = true;
    setRecordingStatus("Ready");
  }
}

function setDoctorMessage(msg) {
  $("doctor-message").textContent = msg;
}

function setRecordingStatus(msg, isRecording = false) {
  const el = $("recording-status");
  el.textContent = msg;
  el.classList.toggle("is-recording", isRecording);
}

async function saveStory(status) {
  const body = {
    doctorName: $("doctor-name").value.trim(),
    specialty: $("specialty").value.trim(),
    encounterDate: $("encounter-date").value || null,
    transcript: $("transcript").value.trim(),
    category: $("focus-area").value || null,
    status,
  };
  if (!body.doctorName || !body.transcript) {
    setDoctorMessage("Doctor name and transcript are required.");
    return;
  }
  setDoctorMessage("Saving…");
  try {
    await apiFetch("/api/stories", { method: "POST", body: JSON.stringify(body) });
    $("story-form").reset();
    $("encounter-date").valueAsDate = new Date();
    setDoctorMessage(status === "draft" ? "Saved as draft." : "Story submitted. Thank you!");
    closeRecordModal();
    await loadStories();
  } catch (error) {
    setDoctorMessage(error.message);
  }
}

// ---------------- detail modal ----------------

function selectedStory() {
  return state.stories.find((s) => s.id === state.selectedStoryId) || null;
}

function openDetail(id) {
  state.selectedStoryId = id;
  const story = selectedStory();
  if (!story) return;
  $("detail-title").textContent = story.title || "Patient story";
  $("detail-meta").textContent = [
    story.doctor_name,
    story.specialty,
    story.category || "Uncategorized",
    formatDate(story.created_at),
  ]
    .filter(Boolean)
    .join(" · ");
  const statusEl = $("detail-status");
  statusEl.dataset.status = story.status || "submitted";
  statusEl.textContent = STATUS_LABELS[story.status] || "Submitted";
  $("detail-summary").textContent = story.summary || "No summary yet.";
  $("detail-transcript").textContent = story.transcript || "";
  $("detail-modal").classList.remove("is-hidden");
}

function closeDetail() {
  $("detail-modal").classList.add("is-hidden");
}

function replaceStory(updated) {
  const i = state.stories.findIndex((s) => s.id === updated.id);
  if (i >= 0) state.stories[i] = updated;
  renderAll();
  openDetail(updated.id);
}

async function detailAction(button, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Working…";
  try {
    const updated = await fn();
    if (updated) replaceStory(updated);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ---------------- proposal ----------------

async function draftProposal(event) {
  event.preventDefault();
  $("proposal-output").textContent = "Drafting proposal…";
  try {
    const payload = await apiFetch("/api/policy-proposal", {
      method: "POST",
      body: JSON.stringify({ policyIdea: $("policy-idea").value.trim() }),
    });
    $("proposal-output").textContent = payload.proposal;
  } catch (error) {
    $("proposal-output").textContent = error.message;
  }
}

// ---------------- wiring ----------------

document.querySelectorAll(".role-switch button").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.role = btn.dataset.role;
    renderChrome();
  });
});

$("sidebar-record").addEventListener("click", () => openRecordModal());
$("top-record").addEventListener("click", () => openRecordModal());
$("steps-record").addEventListener("click", () => openRecordModal());
$("write-instead").addEventListener("click", (e) => {
  e.preventDefault();
  openRecordModal();
});
$("record-close").addEventListener("click", closeRecordModal);
$("record-btn").addEventListener("click", startRecording);
$("stop-btn").addEventListener("click", stopRecording);
$("save-draft-btn").addEventListener("click", () => saveStory("draft"));
$("story-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveStory("submitted");
});

$("detail-close").addEventListener("click", closeDetail);
$("summarize-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, async () => {
    const { story } = await apiFetch(`/api/stories/${state.selectedStoryId}/summary`, { method: "POST" });
    return story;
  }),
);
$("categorize-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, async () => {
    const { story } = await apiFetch(`/api/stories/${state.selectedStoryId}/category`, { method: "POST" });
    return story;
  }),
);
$("mark-reviewed-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, async () => {
    const { story } = await apiFetch(`/api/stories/${state.selectedStoryId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "reviewed" }),
    });
    return story;
  }),
);
$("use-advocacy-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, async () => {
    const { story } = await apiFetch(`/api/stories/${state.selectedStoryId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "in_advocacy" }),
    });
    return story;
  }),
);

document.querySelectorAll("#chart-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.chartMode = btn.dataset.mode;
    renderChart();
  });
});

$("proposal-form").addEventListener("submit", draftProposal);

[$("record-modal"), $("detail-modal")].forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("is-hidden");
  });
});

// ---------------- init ----------------

$("encounter-date").valueAsDate = new Date();
renderPrompts();
renderChrome();
(async () => {
  await loadConfig();
  await loadStories();
})();
