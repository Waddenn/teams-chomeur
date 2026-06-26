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
  keywords: DEFAULT_KEYWORDS
};

const form = document.querySelector("#settings-form");
const enabled = document.querySelector("#enabled");
const keywords = document.querySelector("#keywords");
const status = document.querySelector("#status");
const keywordCount = document.querySelector("#keyword-count");
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
      keywords: parseKeywords(keywords.value)
    });

    showStatus("Reglages enregistres.");
  } catch {
    showStatus("Impossible d'enregistrer les reglages.");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area !== "local" ||
    (!changes.captionsActive && !changes.captionsStateUpdatedAt)
  ) {
    return;
  }

  load();
});

async function load() {
  const [localSettings, syncedSettings] = await Promise.all([
    chrome.storage.local.get([
      "enabled",
      "keywords",
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
