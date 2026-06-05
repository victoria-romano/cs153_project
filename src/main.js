const PROMPTS = [
  {
    ico: "💬",
    label: "Language or communication barriers",
    cat: "Language Barriers",
    intro:
      "Think about a recent visit where language got in the way of good care. These prompts can help jog your memory.",
    questions: [
      "Have you had a visit recently where no interpreter was available — in person, by phone, or in the patient portal?",
      "Have you watched a family rely on a child or relative to translate medical information?",
      "Have you handed out discharge papers, consent forms, or after-visit summaries that were only available in English?",
      "Has a family declined a vaccine, procedure, or follow-up because they didn't fully understand what was being recommended?",
      "Has limited English proficiency caused a missed appointment, a misunderstood medication schedule, or a return ED visit?",
    ],
  },
  {
    ico: "🚌",
    label: "Transportation barriers",
    cat: "Transportation",
    intro:
      "Transportation failures often look like 'no-shows' in the chart. What got in the way of patients reaching you?",
    questions: [
      "Has a family missed an appointment because of a bus route change, lack of a car seat, or distance to your clinic?",
      "Have you needed to delay a referral because the only specialist was unreachable without a car?",
      "Has a family been forced to choose between a clinic visit and a work shift, school pickup, or another medical visit?",
      "Have rideshare or medical transport benefits fallen through (cancelations, eligibility issues, hours)?",
      "Have you seen children sent home from the hospital with no safe way to actually get home?",
    ],
  },
  {
    ico: "💲",
    label: "Cost of care or medication",
    cat: "Cost of Care",
    intro:
      "Cost barriers can show up as 'non-adherence,' but the story underneath is usually different.",
    questions: [
      "Have you seen a family ration or skip medication because of cost?",
      "Has a high copay or deductible kept a child away from a specialist, lab, or imaging study?",
      "Have you written for a less-effective drug because the preferred one wasn't affordable?",
      "Has a family been surprised by a bill that changed their behavior at future visits?",
      "Have you watched a family choose between food, rent, and a child's prescription?",
    ],
  },
  {
    ico: "💉",
    label: "Vaccine-preventable diseases",
    cat: "Vaccine-Preventable Diseases",
    intro:
      "Stories from the front line of vaccination — both the barriers families face and the consequences when vaccines are missed.",
    questions: [
      "Have you seen a child get sick (or be exposed and excluded from school) from a vaccine-preventable illness?",
      "Has a family declined or delayed a vaccine because of misinformation circulating in their community?",
      "Have logistical barriers — clinic hours, transportation, time off work — caused a child to fall behind on the schedule?",
      "Have you encountered specific narratives or sources that are driving hesitancy in your patient panel?",
      "Have you seen clusters of under-vaccination or outbreaks tied to a particular school, daycare, or neighborhood?",
    ],
  },
  {
    ico: "🛂",
    label: "Immigration-related concerns or barriers",
    cat: "Immigration-Related Concerns",
    intro:
      "Immigration-related fear can keep families out of care entirely. These stories help quantify a barrier that often goes undocumented.",
    questions: [
      "Has a family declined to enroll in Medicaid, WIC, or other benefits out of fear of immigration consequences (e.g. public-charge concerns)?",
      "Have you seen visits canceled or delayed after immigration enforcement activity in the community?",
      "Has fear of disclosing status caused a family to avoid the ED, decline a referral, or under-report a child's symptoms?",
      "Have you cared for a child whose caregiver was detained, deported, or separated from them?",
      "Have you struggled to find culturally and linguistically appropriate care for an asylum-seeking, refugee, or newly arrived family?",
    ],
  },
  {
    ico: "•••",
    label: "Other barriers to care",
    cat: "Other",
    intro:
      "Any structural barrier that affected a child's care and doesn't fit cleanly above — housing, schooling, custody, mental health access, etc.",
    questions: [
      "What barrier did you encounter recently that you don't see represented in any of the other categories?",
      "Was there a system or policy failure that affected this child's care?",
      "What would have to change for this story to have ended differently?",
      "Is this a one-off case, or are you seeing a pattern?",
    ],
  },
];

const THEME_ICONS = {
  "Language Barriers": "💬",
  Transportation: "🚌",
  "Cost of Care": "💲",
  "Vaccine-Preventable Diseases": "💉",
  "Immigration-Related Concerns": "🛂",
  Other: "•••",
};

const STATUS_LABELS = {
  draft: "Draft",
  submitted: "Submitted",
  reviewed: "Reviewed",
  in_advocacy: "Used in advocacy",
  shared_with_policymakers: "Shared with policymakers",
};

const ADVOCACY_GOAL = 50;
const IDENTITY_KEY = "storybook.providerName";

const state = {
  stories: [],
  briefs: [],
  role: "doctor",
  chartMode: "weekly",
  selectedStoryId: null,
  selectedTheme: null,
  categories: [],
  demoMode: false,
  mediaRecorder: null,
  audioChunks: [],
  providerName: localStorage.getItem(IDENTITY_KEY) || "",
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

// ---------------- identity scoping ----------------

function visibleStories() {
  if (state.role === "admin") return state.stories;
  if (!state.providerName) return state.stories;
  const me = state.providerName.trim().toLowerCase();
  return state.stories.filter(
    (s) => (s.doctor_name || "").trim().toLowerCase() === me,
  );
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
    ? state.providerName
      ? `Signed in as ${state.providerName}. Thank you for raising your voice for your patients.`
      : "Thank you for raising your voice for your patients."
    : "Here's what's happening with the stories you've collected.";

  $("top-record").classList.toggle("is-hidden", !isDoctor);
  $("sidebar-record").classList.toggle("is-hidden", !isDoctor);
  $("demo-badge").classList.toggle("is-hidden", !state.demoMode);

  $("provider-id-name").textContent = state.providerName || "Not signed in";
  $("provider-id-card").classList.toggle("is-signed-in", Boolean(state.providerName));

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
  const doctorPool = visibleStories();
  const doctorRecent = doctorPool.slice(0, 6);
  const adminRecent = state.stories.slice(0, 6);

  const doctorHtml = doctorRecent.length
    ? doctorRecent.map((s, i) => storyCardHtml(s, i)).join("")
    : `<p class="muted" style="padding:18px;">${
        state.providerName
          ? `No stories yet under "${escapeHtml(state.providerName)}". Record one to get started.`
          : "No stories yet. Record one to get started."
      }</p>`;

  const adminHtml = adminRecent.length
    ? adminRecent.map((s, i) => storyCardHtml(s, i)).join("")
    : '<p class="muted" style="padding:18px;">No stories yet.</p>';

  const docEl = $("doctor-stories");
  docEl.innerHTML = doctorHtml;
  docEl.querySelectorAll(".story-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
  });

  const admEl = $("admin-stories");
  admEl.innerHTML = adminHtml;
  admEl.querySelectorAll(".story-card").forEach((card) => {
    card.addEventListener("click", () => openDetail(card.dataset.id));
  });
}

function renderDoctorKpis() {
  const pool = visibleStories();
  const submitted = pool.filter(isSubmitted);
  const drafts = pool.filter((s) => s.status === "draft");
  const week = submitted.filter((s) => daysAgo(s.created_at) < 7);
  const advocacy = pool.filter(
    (s) => s.status === "in_advocacy" || s.status === "shared_with_policymakers",
  );

  $("doc-total").textContent = submitted.length;
  $("doc-total-sub").textContent = state.providerName
    ? `under ${state.providerName}`
    : "across the program";
  $("doc-drafts").textContent = drafts.length;
  $("doc-week").textContent = week.length;
  $("doc-advocacy").textContent = advocacy.length;
  const pct = submitted.length ? Math.round((advocacy.length / submitted.length) * 100) : 0;
  $("doc-advocacy-sub").textContent = `${pct}% of your submissions`;

  const ringPct = Math.min(100, Math.round((submitted.length / ADVOCACY_GOAL) * 100));
  $("impact-ring").style.setProperty("--val", ringPct);
  $("impact-pct").textContent = `${ringPct}%`;
  $("impact-copy").textContent = `${submitted.length} of ${ADVOCACY_GOAL} stories toward the 2025 goal. You're helping shape a more equitable health system.`;
}

function renderAdminKpis() {
  const week = state.stories.filter((s) => daysAgo(s.created_at) < 7);
  const reviewed = state.stories.filter(
    (s) =>
      s.status === "reviewed" ||
      s.status === "in_advocacy" ||
      s.status === "shared_with_policymakers",
  );
  const advocacy = state.stories.filter(
    (s) => s.status === "in_advocacy" || s.status === "shared_with_policymakers",
  );

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
      <button class="theme-row" type="button" data-theme="${escapeHtml(t.name)}">
        <span class="theme-ico">${THEME_ICONS[t.name] || "•••"}</span>
        <div class="theme-main">
          <div class="theme-name">${escapeHtml(t.name)}</div>
          <div class="theme-bar"><span style="width:${Math.round((t.count / max) * 100)}%"></span></div>
        </div>
        <div class="theme-num"><b>${t.count}</b> · ${t.pct}%</div>
      </button>`,
    )
    .join("");
  $("theme-list").querySelectorAll(".theme-row").forEach((row) => {
    row.addEventListener("click", () => openBriefModal(row.dataset.theme));
  });
}

function renderBriefsList() {
  const list = $("briefs-list");
  const count = state.briefs.length;
  $("briefs-count").textContent = count ? `${count} brief${count === 1 ? "" : "s"}` : "";
  if (!count) {
    list.innerHTML =
      '<p class="muted" style="margin: 0;">No briefs drafted yet. Click a theme above to draft one.</p>';
    return;
  }
  list.innerHTML = state.briefs
    .map(
      (b) => `
      <button class="brief-row" type="button" data-theme="${escapeHtml(b.theme)}">
        <span class="theme-ico">${THEME_ICONS[b.theme] || "•••"}</span>
        <div class="brief-main">
          <div class="brief-title">${escapeHtml(b.theme)}</div>
          <div class="brief-meta">
            <span>${b.story_count} ${b.story_count === 1 ? "story" : "stories"} synthesized</span>
            <span>·</span>
            <span>Updated ${formatDate(b.updated_at)}</span>
          </div>
        </div>
        <span class="chev">›</span>
      </button>`,
    )
    .join("");
  list.querySelectorAll(".brief-row").forEach((row) => {
    row.addEventListener("click", () => openBriefModal(row.dataset.theme));
  });
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
    row.addEventListener("click", () => openPromptModal(row.dataset.cat));
  });
}

function renderAll() {
  renderChrome();
  renderDoctorKpis();
  renderAdminKpis();
  renderStoryLists();
  renderThemes();
  renderChart();
  renderBriefsList();
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

async function loadBriefs() {
  try {
    const payload = await apiFetch("/api/policy-briefs");
    state.briefs = payload.briefs || [];
  } catch (error) {
    state.briefs = [];
    console.error(error);
  }
  renderBriefsList();
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
  const cats = state.categories.length
    ? state.categories
    : Object.keys(THEME_ICONS);
  const html =
    '<option value="">General / not sure</option>' +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  $("focus-area").innerHTML = html;
  $("focus-area-anon").innerHTML = html;
}

// ---------------- record modal ----------------

function openRecordModal(focusCategory) {
  $("record-modal").classList.remove("is-hidden");
  if (focusCategory) {
    $("focus-area").value = focusCategory;
    $("focus-area-anon").value = focusCategory;
  }
  if (state.providerName) {
    $("doctor-name").value = state.providerName;
  }
  applyAnonState();
  if (!$("anon-toggle").checked) {
    $("doctor-name").focus();
  } else {
    $("transcript").focus();
  }
}

function closeRecordModal() {
  $("record-modal").classList.add("is-hidden");
}

function applyAnonState() {
  const isAnon = $("anon-toggle").checked;
  $("identified-fields").style.display = isAnon ? "none" : "";
  $("anon-fields").style.display = isAnon ? "" : "none";
  $("doctor-name").required = !isAnon;
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
  const isAnon = $("anon-toggle").checked;
  const body = {
    anonymous: isAnon,
    doctorName: isAnon ? "" : $("doctor-name").value.trim(),
    specialty: isAnon ? "" : $("specialty").value.trim(),
    encounterDate:
      (isAnon ? $("encounter-date-anon").value : $("encounter-date").value) || null,
    transcript: $("transcript").value.trim(),
    category:
      (isAnon ? $("focus-area-anon").value : $("focus-area").value) || null,
    status,
  };
  if (!body.transcript) {
    setDoctorMessage("Transcript is required.");
    return;
  }
  if (!isAnon && !body.doctorName) {
    setDoctorMessage("Provider name is required (or check 'Submit anonymously').");
    return;
  }
  setDoctorMessage("Saving…");
  try {
    await apiFetch("/api/stories", { method: "POST", body: JSON.stringify(body) });
    $("story-form").reset();
    applyAnonState();
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

function outcomeNoteFor(story) {
  if (!story) return "";
  const theme = story.category;
  const briefNote = theme
    ? ` The living policy brief for ${theme} now reflects this story.`
    : "";
  switch (story.status) {
    case "reviewed":
      return "✅ The OCHE team has reviewed this story.";
    case "in_advocacy":
      return `📣 This story is being used in current advocacy work.${briefNote}`;
    case "shared_with_policymakers":
      return `🏛️ This story has been shared with policymakers as part of an advocacy package.${briefNote}`;
    default:
      return "";
  }
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

  // Hide OCHE-only actions when viewing in clinician role
  $("oche-actions").classList.toggle("is-hidden", state.role !== "admin");

  const outcome = outcomeNoteFor(story);
  const outcomeEl = $("detail-outcome");
  if (outcome) {
    outcomeEl.textContent = outcome;
    outcomeEl.classList.remove("is-hidden");
  } else {
    outcomeEl.classList.add("is-hidden");
  }

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
    const result = await fn();
    if (result && result.story) replaceStory(result.story);
    if (result && result.brief) mergeBrief(result.brief);
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function mergeBrief(brief) {
  const i = state.briefs.findIndex((b) => b.theme === brief.theme);
  if (i >= 0) state.briefs[i] = brief;
  else state.briefs.unshift(brief);
  renderBriefsList();
}

// ---------------- prompt-questions modal ----------------

function openPromptModal(cat) {
  const prompt = PROMPTS.find((p) => p.cat === cat) || PROMPTS[PROMPTS.length - 1];
  $("prompt-modal-title").innerHTML = `${prompt.ico} ${escapeHtml(prompt.label)}`;
  $("prompt-modal-intro").textContent = prompt.intro;
  $("prompt-questions").innerHTML = prompt.questions
    .map((q) => `<li>${escapeHtml(q)}</li>`)
    .join("");
  $("prompt-record-btn").dataset.cat = prompt.cat;
  $("prompt-modal").classList.remove("is-hidden");
}

function closePromptModal() {
  $("prompt-modal").classList.add("is-hidden");
}

// ---------------- policy brief modal ----------------

function findBriefForTheme(theme) {
  return state.briefs.find((b) => b.theme === theme) || null;
}

function renderBriefInModal(theme) {
  const brief = findBriefForTheme(theme);
  if (brief) {
    $("brief-output").textContent = brief.brief;
    $("brief-modal-meta").textContent = `${brief.story_count} ${
      brief.story_count === 1 ? "story" : "stories"
    } synthesized · last updated ${formatDate(brief.updated_at)}`;
  } else {
    $("brief-output").textContent =
      'No brief drafted for this theme yet. Click "Regenerate" to synthesize one from submitted stories.';
    $("brief-modal-meta").textContent = "No brief yet for this theme.";
  }
}

function openBriefModal(theme) {
  state.selectedTheme = theme;
  $("brief-modal-title").textContent = `${THEME_ICONS[theme] || "•••"} ${theme} — living policy brief`;
  renderBriefInModal(theme);
  $("brief-modal").classList.remove("is-hidden");
}

function closeBriefModal() {
  $("brief-modal").classList.add("is-hidden");
}

async function regenerateBrief() {
  const theme = state.selectedTheme;
  if (!theme) return;
  const btn = $("brief-regen-btn");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Synthesizing from stories…";
  $("brief-output").textContent = "Synthesizing from submitted stories…";
  try {
    const { brief } = await apiFetch(
      `/api/policy-briefs/${encodeURIComponent(theme)}`,
      { method: "POST" },
    );
    const i = state.briefs.findIndex((b) => b.theme === brief.theme);
    if (i >= 0) state.briefs[i] = brief;
    else state.briefs.unshift(brief);
    renderBriefsList();
    renderBriefInModal(theme);
  } catch (error) {
    $("brief-output").textContent = error.message;
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

// ---------------- identity modal ----------------

function openIdentityModal() {
  $("identity-input").value = state.providerName || "";
  $("identity-modal").classList.remove("is-hidden");
  $("identity-input").focus();
}

function closeIdentityModal() {
  $("identity-modal").classList.add("is-hidden");
}

function saveIdentity() {
  const name = $("identity-input").value.trim();
  if (name) {
    localStorage.setItem(IDENTITY_KEY, name);
    state.providerName = name;
  } else {
    localStorage.removeItem(IDENTITY_KEY);
    state.providerName = "";
  }
  closeIdentityModal();
  renderAll();
}

function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
  state.providerName = "";
  closeIdentityModal();
  renderAll();
}

// ---------------- wiring ----------------

document.querySelectorAll(".role-switch button").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.role = btn.dataset.role;
    renderAll();
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
$("anon-toggle").addEventListener("change", applyAnonState);
$("story-form").addEventListener("submit", (e) => {
  e.preventDefault();
  saveStory("submitted");
});

$("detail-close").addEventListener("click", closeDetail);
$("summarize-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, () =>
    apiFetch(`/api/stories/${state.selectedStoryId}/summary`, { method: "POST" }),
  ),
);
$("categorize-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, () =>
    apiFetch(`/api/stories/${state.selectedStoryId}/category`, { method: "POST" }),
  ),
);
$("mark-reviewed-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, () =>
    apiFetch(`/api/stories/${state.selectedStoryId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "reviewed" }),
    }),
  ),
);
$("use-advocacy-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, () =>
    apiFetch(`/api/stories/${state.selectedStoryId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "in_advocacy" }),
    }),
  ),
);
$("shared-policymakers-btn").addEventListener("click", (e) =>
  detailAction(e.currentTarget, () =>
    apiFetch(`/api/stories/${state.selectedStoryId}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "shared_with_policymakers" }),
    }),
  ),
);

document.querySelectorAll("#chart-toggle button").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.chartMode = btn.dataset.mode;
    renderChart();
  });
});

$("prompt-modal-close").addEventListener("click", closePromptModal);
$("prompt-cancel-btn").addEventListener("click", closePromptModal);
$("prompt-record-btn").addEventListener("click", () => {
  const cat = $("prompt-record-btn").dataset.cat || "";
  closePromptModal();
  openRecordModal(cat);
});

$("brief-modal-close").addEventListener("click", closeBriefModal);
$("brief-regen-btn").addEventListener("click", regenerateBrief);

$("provider-id-edit").addEventListener("click", openIdentityModal);
$("identity-close").addEventListener("click", closeIdentityModal);
$("identity-save").addEventListener("click", saveIdentity);
$("identity-clear").addEventListener("click", clearIdentity);

[
  $("record-modal"),
  $("detail-modal"),
  $("prompt-modal"),
  $("brief-modal"),
  $("identity-modal"),
].forEach((modal) => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("is-hidden");
  });
});

// ---------------- init ----------------

$("encounter-date").valueAsDate = new Date();
renderPrompts();
applyAnonState();
renderChrome();
(async () => {
  await loadConfig();
  await loadStories();
  await loadBriefs();
})();
