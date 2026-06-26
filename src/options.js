const DEFAULT_KEYWORDS = [
  "pause",
  "appel",
  "exercice",
  "corrige",
  "correction",
  "devoir",
  "rendu",
  "projet",
  "eval",
  "evaluation",
  "partiel",
  "exam",
  "important",
  "attention",
  "deadline"
];

const DEFAULT_SETTINGS = {
  enabled: true,
  keywords: DEFAULT_KEYWORDS,
  watchedSpeakers: [],
  detectedSpeakers: []
};

const form = document.querySelector("#settings-form");
const enabled = document.querySelector("#enabled");
const keywords = document.querySelector("#keywords");
const status = document.querySelector("#status");
const speakerList = document.querySelector("#speaker-list");
const keywordCount = document.querySelector("#keyword-count");
const speakerCount = document.querySelector("#speaker-count");
const captionsWarning = document.querySelector("#captions-warning");
let statusTimer;
let saveTimer;

load();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings();
});

enabled.addEventListener("change", () => {
  saveSettings();
});

keywords.addEventListener("input", () => {
  updateKeywordCount();
  queueSaveSettings();
});

async function saveSettings() {
  try {
    await chrome.storage.local.set({
      enabled: enabled.checked,
      keywords: parseKeywords(keywords.value),
      watchedSpeakers: getSelectedSpeakers()
    });

    showStatus("Reglages enregistres.");
  } catch {
    showStatus("Impossible d'enregistrer les reglages.");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area !== "local" ||
    (!changes.detectedSpeakers && !changes.watchedSpeakers && !changes.captionsActive && !changes.captionsStateUpdatedAt)
  ) {
    return;
  }

  load();
});

speakerList.addEventListener("change", async (event) => {
  if (!event.target.matches("input[type='checkbox']")) {
    return;
  }

  try {
    await chrome.storage.local.set({
      watchedSpeakers: getSelectedSpeakers()
    });

    showStatus("Personnes surveillees mises a jour.");
  } catch {
    showStatus("Impossible d'enregistrer les personnes.");
  }
});

async function load() {
  const [localSettings, syncedSettings] = await Promise.all([
    chrome.storage.local.get([
      "enabled",
      "keywords",
      "watchedSpeakers",
      "detectedSpeakers",
      "captionsActive",
      "captionsStateUpdatedAt"
    ]),
    chrome.storage.sync.get(["enabled", "keywords"])
  ]);
  const settings = {
    ...DEFAULT_SETTINGS,
    ...syncedSettings,
    ...localSettings
  };

  enabled.checked = Boolean(settings.enabled);
  keywords.value = (settings.keywords || DEFAULT_SETTINGS.keywords).join("\n");
  updateKeywordCount();
  const visibleWatchedSpeakers = await reconcileWatchedSpeakers(
    settings.detectedSpeakers || [],
    settings.watchedSpeakers || []
  );
  renderSpeakers(settings.detectedSpeakers || [], visibleWatchedSpeakers);
  renderCaptionsWarning(settings.captionsActive, settings.captionsStateUpdatedAt);
}

function parseKeywords(value) {
  return [...new Set(value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function showStatus(message) {
  clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = setTimeout(() => {
    status.textContent = "";
  }, 2500);
}

function queueSaveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSettings();
  }, 450);
}

function updateKeywordCount() {
  const count = parseKeywords(keywords.value).length;
  keywordCount.textContent = `${count}`;
}

function renderCaptionsWarning(captionsActive, updatedAt) {
  const stateIsFresh = Number(updatedAt || 0) > Date.now() - 15000;
  captionsWarning.hidden = Boolean(captionsActive && stateIsFresh);
}

function renderSpeakers(detectedSpeakers, watchedSpeakers) {
  const speakers = sanitizeNames(detectedSpeakers);
  const selected = new Set(sanitizeNames(watchedSpeakers).map(normalizeName));
  speakerList.textContent = "";
  speakerCount.textContent = `${selected.size}/${speakers.length}`;

  if (speakers.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Aucune personne detectee pour le moment.";
    speakerList.append(empty);
    return;
  }

  for (const speaker of speakers) {
    const id = `speaker-${normalizeName(speaker).replace(/\s+/g, "-")}`;
    const row = document.createElement("label");
    row.className = "speaker-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.value = speaker;
    checkbox.checked = selected.has(normalizeName(speaker));

    const name = document.createElement("span");
    name.textContent = speaker;

    row.append(checkbox, name);
    speakerList.append(row);
  }
}

async function reconcileWatchedSpeakers(detectedSpeakers, watchedSpeakers) {
  const speakers = sanitizeNames(detectedSpeakers);
  const speakerKeys = new Set(speakers.map(normalizeName));
  const visibleWatchedSpeakers = sanitizeNames(watchedSpeakers)
    .filter((speaker) => speakerKeys.has(normalizeName(speaker)));

  if (visibleWatchedSpeakers.length !== sanitizeNames(watchedSpeakers).length) {
    await chrome.storage.local.set({ watchedSpeakers: visibleWatchedSpeakers });
  }

  return visibleWatchedSpeakers;
}

function getSelectedSpeakers() {
  return Array.from(speakerList.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value);
}

function sanitizeNames(names) {
  const namesByKey = new Map();

  for (const name of names || []) {
    const candidate = String(name || "").replace(/\s+/g, " ").trim().replace(/[,.]$/g, "");
    const candidateKey = normalizeName(candidate);
    if (candidateKey && !namesByKey.has(candidateKey)) {
      namesByKey.set(candidateKey, candidate);
    }
  }

  return [...namesByKey.values()].sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
