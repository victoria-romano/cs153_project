const state = {
  stories: [],
  selectedStoryId: null,
  mediaRecorder: null,
  audioChunks: [],
};

const els = {
  tabs: document.querySelectorAll("[data-view-target]"),
  views: {
    doctor: document.getElementById("doctor-view"),
    admin: document.getElementById("admin-view"),
  },
  recordingStatus: document.getElementById("recording-status"),
  recordBtn: document.getElementById("record-btn"),
  stopBtn: document.getElementById("stop-btn"),
  storyForm: document.getElementById("story-form"),
  doctorName: document.getElementById("doctor-name"),
  specialty: document.getElementById("specialty"),
  encounterDate: document.getElementById("encounter-date"),
  referenceCode: document.getElementById("reference-code"),
  transcript: document.getElementById("transcript"),
  doctorMessage: document.getElementById("doctor-message"),
  adminContent: document.getElementById("admin-content"),
  refreshBtn: document.getElementById("refresh-btn"),
  analyzeAllBtn: document.getElementById("analyze-all-btn"),
  storyList: document.getElementById("story-list"),
  storyCount: document.getElementById("story-count"),
  emptyState: document.getElementById("empty-state"),
  storyDetail: document.getElementById("story-detail"),
  selectedDoctor: document.getElementById("selected-doctor"),
  selectedTitle: document.getElementById("selected-title"),
  selectedCategory: document.getElementById("selected-category"),
  selectedSummary: document.getElementById("selected-summary"),
  selectedTranscript: document.getElementById("selected-transcript"),
  summarizeBtn: document.getElementById("summarize-btn"),
  categorizeBtn: document.getElementById("categorize-btn"),
  proposalForm: document.getElementById("proposal-form"),
  policyIdea: document.getElementById("policy-idea"),
  proposalOutput: document.getElementById("proposal-output"),
};

function formatDate(value) {
  if (!value) {
    return "No encounter date";
  }
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function storyTitle(story) {
  return `${story.doctor_name || "Unknown doctor"} - ${formatDate(story.encounter_date)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function setDoctorMessage(message) {
  els.doctorMessage.textContent = message;
}

function setRecordingStatus(message, isRecording = false) {
  els.recordingStatus.textContent = message;
  els.recordingStatus.classList.toggle("is-recording", isRecording);
}

function switchView(viewName) {
  els.tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.viewTarget === viewName);
  });

  Object.entries(els.views).forEach(([name, view]) => {
    view.classList.toggle("is-active", name === viewName);
  });

  if (viewName === "admin") {
    loadStories();
  }
}

function selectedStory() {
  return state.stories.find((story) => story.id === state.selectedStoryId) || null;
}

function renderStoryList() {
  els.storyCount.textContent = `${state.stories.length} ${
    state.stories.length === 1 ? "story" : "stories"
  }`;

  if (state.stories.length === 0) {
    els.storyList.innerHTML = '<p class="empty-state">No stories have been saved yet.</p>';
    renderSelectedStory();
    return;
  }

  els.storyList.innerHTML = "";
  state.stories.forEach((story) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "story-card";
    button.classList.toggle("is-selected", story.id === state.selectedStoryId);
    button.innerHTML = `
      <strong>${escapeHtml(storyTitle(story))}</strong>
      <span>${escapeHtml(story.specialty || "No specialty")} | ${escapeHtml(
        story.category || "Uncategorized",
      )}</span>
      <span>${escapeHtml(story.summary ? story.summary.slice(0, 120) : "No summary yet.")}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedStoryId = story.id;
      renderStoryList();
      renderSelectedStory();
    });
    els.storyList.appendChild(button);
  });

  renderSelectedStory();
}

function renderSelectedStory() {
  const story = selectedStory();

  els.emptyState.classList.toggle("is-hidden", Boolean(story));
  els.storyDetail.classList.toggle("is-hidden", !story);

  if (!story) {
    return;
  }

  els.selectedDoctor.textContent = story.doctor_name || "Story";
  els.selectedTitle.textContent = formatDate(story.encounter_date);
  els.selectedCategory.textContent = story.category || "Uncategorized";
  els.selectedSummary.textContent = story.summary || "No summary yet.";
  els.selectedTranscript.textContent = story.transcript || "";
}

async function loadStories() {
  els.storyList.innerHTML = '<p class="empty-state">Loading stories...</p>';
  let payload;

  try {
    payload = await apiFetch("/api/stories");
  } catch (error) {
    state.stories = [];
    state.selectedStoryId = null;
    els.storyCount.textContent = "0 stories";
    els.storyList.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    renderSelectedStory();
    return;
  }

  state.stories = payload.stories || [];

  if (!selectedStory() && state.stories.length > 0) {
    state.selectedStoryId = state.stories[0].id;
  }

  renderStoryList();
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    state.mediaRecorder = new MediaRecorder(stream);

    state.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    });

    state.mediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      await transcribeRecording();
    });

    state.mediaRecorder.start();
    els.recordBtn.disabled = true;
    els.stopBtn.disabled = false;
    setRecordingStatus("Recording", true);
    setDoctorMessage("Recording in progress...");
  } catch (error) {
    setDoctorMessage(error.message);
  }
}

async function stopRecording() {
  if (!state.mediaRecorder || state.mediaRecorder.state === "inactive") {
    return;
  }

  els.stopBtn.disabled = true;
  state.mediaRecorder.stop();
  setRecordingStatus("Transcribing");
  setDoctorMessage("Uploading audio for transcription...");
}

async function transcribeRecording() {
  try {
    const audioBlob = new Blob(state.audioChunks, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("audio", audioBlob, "story.webm");

    const payload = await apiFetch("/api/transcribe", {
      method: "POST",
      body: formData,
    });

    els.transcript.value = payload.transcript || "";
    setDoctorMessage("Transcript ready. Review it, then save the story.");
  } catch (error) {
    setDoctorMessage(error.message);
  } finally {
    els.recordBtn.disabled = false;
    els.stopBtn.disabled = true;
    setRecordingStatus("Ready");
  }
}

async function saveStory(event) {
  event.preventDefault();
  setDoctorMessage("Saving story...");

  const body = {
    doctorName: els.doctorName.value.trim(),
    specialty: els.specialty.value.trim(),
    encounterDate: els.encounterDate.value || null,
    referenceCode: els.referenceCode.value.trim(),
    transcript: els.transcript.value.trim(),
  };

  try {
    await apiFetch("/api/stories", {
      method: "POST",
      body: JSON.stringify(body),
    });

    els.storyForm.reset();
    setDoctorMessage("Story saved to Supabase.");
  } catch (error) {
    setDoctorMessage(error.message);
  }
}

async function runStoryAnalysis(kind) {
  const story = selectedStory();
  if (!story) {
    return;
  }

  const button = kind === "summary" ? els.summarizeBtn : els.categorizeBtn;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = kind === "summary" ? "Summarizing..." : "Categorizing...";

  try {
    const payload = await apiFetch(`/api/stories/${story.id}/${kind}`, {
      method: "POST",
    });
    const index = state.stories.findIndex((item) => item.id === story.id);
    state.stories[index] = payload.story;
    renderStoryList();
    renderSelectedStory();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function analyzeMissingStories() {
  els.analyzeAllBtn.disabled = true;
  els.analyzeAllBtn.textContent = "Analyzing...";

  try {
    for (const story of state.stories) {
      if (!story.summary) {
        await apiFetch(`/api/stories/${story.id}/summary`, { method: "POST" });
      }
      if (!story.category) {
        await apiFetch(`/api/stories/${story.id}/category`, { method: "POST" });
      }
    }
    await loadStories();
  } catch (error) {
    alert(error.message);
  } finally {
    els.analyzeAllBtn.disabled = false;
    els.analyzeAllBtn.textContent = "Analyze missing";
  }
}

async function draftProposal(event) {
  event.preventDefault();
  els.proposalOutput.textContent = "Drafting proposal...";

  try {
    const payload = await apiFetch("/api/policy-proposal", {
      method: "POST",
      body: JSON.stringify({ policyIdea: els.policyIdea.value.trim() }),
    });
    els.proposalOutput.textContent = payload.proposal;
  } catch (error) {
    els.proposalOutput.textContent = error.message;
  }
}

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.viewTarget));
});
els.recordBtn.addEventListener("click", startRecording);
els.stopBtn.addEventListener("click", stopRecording);
els.storyForm.addEventListener("submit", saveStory);
els.refreshBtn.addEventListener("click", loadStories);
els.summarizeBtn.addEventListener("click", () => runStoryAnalysis("summary"));
els.categorizeBtn.addEventListener("click", () => runStoryAnalysis("category"));
els.analyzeAllBtn.addEventListener("click", analyzeMissingStories);
els.proposalForm.addEventListener("submit", draftProposal);

els.encounterDate.valueAsDate = new Date();
