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
  watchedSpeakers: []
};

const SETTINGS_KEYS = new Set(["enabled", "keywords", "watchedSpeakers"]);

const ACTIVE_CAPTION_SELECTORS = [
  "[data-tid='closed-caption-renderer-wrapper']",
  "[data-tid='closed-caption-v2-window-wrapper']",
  "[aria-label='Live Captions']"
];

const CAPTION_SELECTOR_CANDIDATES = [
  ...ACTIVE_CAPTION_SELECTORS,
  "[data-tid*='caption' i]",
  "[data-tid*='subtitle' i]",
  "[aria-label*='caption' i]",
  "[aria-label*='sous-titre' i]",
  "[aria-label*='subtitle' i]",
  "[class*='caption' i]",
  "[class*='subtitle' i]"
];

let settings = { ...DEFAULT_SETTINGS };
let observer;
let captionObserver;
let pollTimer;
let lastSeenText = "";
let visibleKeywords = new Set();
let visibleSpeakers = new Set();
let lastStoredSpeakersKey = "";
let storeSpeakersTimer;
let captionsPreferenceTimer;
let lastCaptionsStateKey = "";
let lastCaptionsStateStoredAt = 0;

init();

async function init() {
  settings = await loadSettings();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    const settingsChanged = Object.keys(changes).some((key) => SETTINGS_KEYS.has(key));
    if (!settingsChanged) {
      return;
    }

    for (const [key, change] of Object.entries(changes)) {
      if (SETTINGS_KEYS.has(key)) {
        settings[key] = change.newValue;
      }
    }

    lastSeenText = "";
    visibleKeywords.clear();
    visibleSpeakers.clear();
    scanForKeywords();
  });

  startWatcher();
  startCaptionsPreferenceWatcher();
}

async function loadSettings() {
  const [localSettings, syncedSettings] = await Promise.all([
    chrome.storage.local.get(["enabled", "keywords", "watchedSpeakers"]),
    chrome.storage.sync.get(["enabled", "keywords"])
  ]);
  const stored = {
    ...syncedSettings,
    ...localSettings
  };

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    keywords: sanitizeKeywords(stored.keywords ?? DEFAULT_SETTINGS.keywords),
    watchedSpeakers: sanitizeNames(stored.watchedSpeakers ?? DEFAULT_SETTINGS.watchedSpeakers)
  };
}

function startWatcher() {
  observer?.disconnect();
  captionObserver?.disconnect();
  clearInterval(pollTimer);

  const scan = debounce(() => {
    attachCaptionObserver();
    scanForKeywords();
  }, 75);

  observer = new MutationObserver(scan);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  attachCaptionObserver();
  pollTimer = setInterval(scanForKeywords, 500);
  scanForKeywords();
}

function startCaptionsPreferenceWatcher() {
  ensureStickyCaptionsPreference();
  clearInterval(captionsPreferenceTimer);
  captionsPreferenceTimer = setInterval(ensureStickyCaptionsPreference, 5000);
}

function ensureStickyCaptionsPreference() {
  const settingsKey = findClosedCaptionsSettingsKey() || deriveClosedCaptionsSettingsKey();
  if (!settingsKey) {
    return;
  }

  const currentSettings = readJsonLocalStorage(settingsKey);
  const nextSettings = {
    ...currentSettings,
    stickyClosedCaptions: true,
    id: currentSettings.id || deriveCurrentUserId() || undefined
  };

  try {
    localStorage.setItem(settingsKey, JSON.stringify(nextSettings));
  } catch {
    // Teams storage can be unavailable in unusual browser privacy modes.
  }
}

function findClosedCaptionsSettingsKey() {
  return Object.keys(localStorage)
    .find((key) => key.endsWith(".react-web-client.closed-captions-settings"));
}

function deriveClosedCaptionsSettingsKey() {
  const reactClientKey = Object.keys(localStorage)
    .find((key) => /^tmp\.[^.]+\.[^.]+\.react-web-client\./.test(key));

  if (!reactClientKey) {
    return "";
  }

  const prefix = reactClientKey.match(/^(tmp\.[^.]+\.[^.]+\.react-web-client)\./)?.[1];
  return prefix ? `${prefix}.closed-captions-settings` : "";
}

function deriveCurrentUserId() {
  const cachedUser = readJsonLocalStorage("tmp.react-web-client.cachedPrimaryUser");
  if (cachedUser?.userId) {
    return cachedUser.userId;
  }

  const reactClientKey = Object.keys(localStorage)
    .find((key) => /^tmp\.[^.]+\.[^.]+\.react-web-client\./.test(key));

  return reactClientKey?.match(/^tmp\.[^.]+\.([^.]+)\.react-web-client\./)?.[1] || "";
}

function readJsonLocalStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function attachCaptionObserver() {
  const captionRoot = getActiveCaptionRoot();
  if (!captionRoot || captionObserver?.target === captionRoot) {
    return;
  }

  captionObserver?.disconnect();
  captionObserver = new MutationObserver(() => scanForKeywords());
  captionObserver.target = captionRoot;
  captionObserver.observe(captionRoot, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function scanForKeywords() {
  if (!settings.enabled) {
    visibleKeywords.clear();
    visibleSpeakers.clear();
    return;
  }

  const activeCaptionRoot = getActiveCaptionRoot();
  const captionEntries = activeCaptionRoot ? getRecentCaptionEntries(activeCaptionRoot) : [];
  storeCaptionsState(Boolean(activeCaptionRoot));
  storeDetectedSpeakers(captionEntries);
  if (!activeCaptionRoot) {
    lastSeenText = "";
    visibleKeywords.clear();
    visibleSpeakers.clear();
    return;
  }

  const text = compactText(captionEntries.map((entry) => entry.text).join(" "));
  if (!text) {
    lastSeenText = "";
    visibleKeywords.clear();
    visibleSpeakers.clear();
    return;
  }

  if (text === lastSeenText) {
    return;
  }

  lastSeenText = text;
  scanSpeakerAlerts(captionEntries);
  scanKeywordAlerts(text);
}

function storeCaptionsState(active) {
  const key = `${active}`;
  const now = Date.now();
  if (key === lastCaptionsStateKey && now - lastCaptionsStateStoredAt < 2000) {
    return;
  }

  lastCaptionsStateKey = key;
  lastCaptionsStateStoredAt = now;
  chrome.storage.local.set({
    captionsActive: active,
    captionsStateUpdatedAt: now
  });
}

function scanKeywordAlerts(text) {
  const keywords = sanitizeKeywords(settings.keywords);
  if (keywords.length === 0) {
    visibleKeywords.clear();
    return;
  }

  const normalizedText = normalize(text);
  const currentVisibleKeywords = new Set();
  const notifiedWords = new Set();

  for (const keyword of keywords) {
    const normalizedKeyword = normalize(keyword);
    if (!normalizedKeyword || !hasKeyword(normalizedText, normalizedKeyword)) {
      continue;
    }

    currentVisibleKeywords.add(normalizedKeyword);
    if (!visibleKeywords.has(normalizedKeyword) && !notifiedWords.has(normalizedKeyword)) {
      notify(keyword, text);
      notifiedWords.add(normalizedKeyword);
    }
  }

  visibleKeywords = currentVisibleKeywords;
}

function scanSpeakerAlerts(captionEntries) {
  const watchedSpeakers = new Set(sanitizeNames(settings.watchedSpeakers).map(normalizeName));
  if (watchedSpeakers.size === 0) {
    visibleSpeakers.clear();
    return;
  }

  const currentVisibleSpeakers = new Set();
  const notifiedSpeakers = new Set();

  for (const entry of captionEntries) {
    const speakerKey = normalizeName(entry.speaker);
    if (!speakerKey || !watchedSpeakers.has(speakerKey)) {
      continue;
    }

    currentVisibleSpeakers.add(speakerKey);
    if (!visibleSpeakers.has(speakerKey) && !notifiedSpeakers.has(speakerKey)) {
      notifySpeaker(entry.speaker, entry.text);
      notifiedSpeakers.add(speakerKey);
    }
  }

  visibleSpeakers = currentVisibleSpeakers;
}

function getCaptionEntries() {
  const captionRoot = getCaptionRoot();
  if (captionRoot) {
    return getRecentCaptionEntries(captionRoot);
  }

  for (const selector of CAPTION_SELECTOR_CANDIDATES) {
    const nodes = safeQuerySelectorAll(selector);
    const text = compactText(nodes.map((node) => node.innerText || node.textContent).join(" "));
    if (text.length >= 2) {
      return [{ speaker: "", text }];
    }
  }

  const fallbackText = getLikelyBottomCaptionText();
  return fallbackText ? [{ speaker: "", text: fallbackText }] : [];
}

function getRecentCaptionEntries(captionRoot) {
  const rootRect = captionRoot.getBoundingClientRect();
  const captionBlocks = getVisibleCaptionBlocks(captionRoot, rootRect).slice(-3);

  if (captionBlocks.length > 0) {
    return captionBlocks
      .map((block) => ({
        speaker: getCaptionAuthor(block),
        text: getCaptionBlockText(block)
      }))
      .filter((entry) => entry.text);
  }

  const textNodes = Array.from(captionRoot.querySelectorAll("[data-tid='closed-caption-text']"))
    .filter((node) => isInCaptionViewport(node, rootRect))
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .slice(-3);

  if (textNodes.length > 0) {
    return textNodes
      .map((node) => ({
        speaker: getCaptionAuthor(node.closest(".fui-ChatMessageCompact") || node.parentElement),
        text: compactText(node.textContent || "")
      }))
      .filter((entry) => entry.text);
  }

  const visibleBlocks = Array.from(captionRoot.querySelectorAll("div, span, p"))
    .filter((node) => {
      const text = compactText(node.innerText || node.textContent || "");
      return text.length >= 2 && text.length <= 350 && isInCaptionViewport(node, rootRect);
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
    .slice(-3);

  if (visibleBlocks.length > 0) {
    return visibleBlocks
      .map((node) => ({
        speaker: getCaptionAuthor(node),
        text: compactText(stripCaptionAuthors(node))
      }))
      .filter((entry) => entry.text);
  }

  const text = compactText(captionRoot.innerText || captionRoot.textContent || "").slice(-700);
  return text ? [{ speaker: "", text }] : [];
}

function getVisibleCaptionBlocks(captionRoot, rootRect) {
  return Array.from(captionRoot.querySelectorAll(".fui-ChatMessageCompact, [data-tid='closed-caption-text']"))
    .map((node) => node.closest(".fui-ChatMessageCompact") || node)
    .filter((node, index, nodes) => nodes.indexOf(node) === index)
    .filter((node) => {
      const text = getCaptionBlockText(node);
      return text.length >= 2 && isInCaptionViewport(node, rootRect);
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
}

function getCaptionAuthor(node) {
  if (!node) {
    return "";
  }

  const author = node.querySelector?.("[data-tid='author'], .fui-ChatMessageCompact__author");
  return sanitizeName(author?.textContent || "");
}

function getCaptionBlockText(node) {
  if (!node) {
    return "";
  }

  const captionTexts = Array.from(node.querySelectorAll?.("[data-tid='closed-caption-text']") || []);
  if (captionTexts.length > 0) {
    return compactText(captionTexts.map((captionText) => captionText.textContent || "").join(" "));
  }

  return compactText(stripCaptionAuthors(node));
}

function stripCaptionAuthors(node) {
  const clone = node.cloneNode(true);
  for (const author of clone.querySelectorAll("[data-tid='author'], .fui-ChatMessageCompact__author")) {
    author.remove();
  }

  return clone.innerText || clone.textContent || "";
}

function isInCaptionViewport(node, rootRect) {
  const rect = node.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom >= rootRect.top &&
    rect.top <= rootRect.bottom
  );
}

function getCaptionRoot() {
  for (const selector of CAPTION_SELECTOR_CANDIDATES) {
    const root = safeQuerySelectorAll(selector)
      .find((node) => compactText(node.innerText || node.textContent || "").length >= 2);
    if (root) {
      return root;
    }
  }

  return null;
}

function getActiveCaptionRoot() {
  for (const selector of ACTIVE_CAPTION_SELECTORS) {
    const root = safeQuerySelectorAll(selector)
      .find((node) => compactText(node.innerText || node.textContent || "").length >= 2);
    if (root) {
      return root;
    }
  }

  return null;
}

function getLikelyBottomCaptionText() {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const nodes = Array.from(document.querySelectorAll("div, span, p"))
    .filter((node) => {
      const text = compactText(node.innerText || node.textContent || "");
      if (text.length < 2 || text.length > 700) {
        return false;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 12) {
        return false;
      }

      const isBottomHalf = rect.top > viewportHeight * 0.48;
      const avoidsTeamsChrome = rect.left > 70 && rect.top < viewportHeight - 20;
      const avoidsChatPane = rect.left < viewportWidth * 0.74;

      return isBottomHalf && avoidsTeamsChrome && avoidsChatPane;
    })
    .sort((a, b) => scoreCaptionNode(b, viewportHeight, viewportWidth) - scoreCaptionNode(a, viewportHeight, viewportWidth))
    .slice(0, 8);

  return compactText(nodes.map((node) => node.innerText || node.textContent).join(" "));
}

function scoreCaptionNode(node, viewportHeight, viewportWidth) {
  const rect = node.getBoundingClientRect();
  const horizontalCenter = rect.left + rect.width / 2;
  const verticalCenter = rect.top + rect.height / 2;
  const centerDistance = Math.abs(horizontalCenter - viewportWidth * 0.38);
  const bottomDistance = Math.abs(verticalCenter - viewportHeight * 0.84);
  const sizeScore = Math.min(rect.width, 900) / 9 + Math.min(rect.height, 220);

  return sizeScore - centerDistance / 8 - bottomDistance / 3;
}

function notify(word, text) {
  chrome.runtime.sendMessage({
    type: "TEAMS_KEYWORD_HIT",
    word,
    excerpt: makeExcerpt(text, word)
  });
}

function notifySpeaker(speaker, text) {
  chrome.runtime.sendMessage({
    type: "TEAMS_SPEAKER_HIT",
    speaker,
    excerpt: compactText(text).slice(0, 180)
  });
}

function storeDetectedSpeakers(captionEntries) {
  if (storeSpeakersTimer) {
    return;
  }

  storeSpeakersTimer = setTimeout(async () => {
    storeSpeakersTimer = undefined;
    const participantNames = detectMeetingParticipantNames();
    const captionSpeakerNames = captionEntries.map((entry) => entry.speaker);
    const detectedSpeakers = sanitizeNames(
      participantNames.length > 0 ? participantNames : captionSpeakerNames
    )
      .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
    const key = detectedSpeakers.map(normalizeName).join("|");

    if (key === lastStoredSpeakersKey) {
      return;
    }

    lastStoredSpeakersKey = key;
    await chrome.storage.local.set({
      detectedSpeakers,
      detectedSpeakersUpdatedAt: Date.now()
    });
  }, 1000);
}

function detectMeetingParticipantNames() {
  const rosterParticipants = Array.from(document.querySelectorAll("[data-tid^='participantsInCall-']"))
    .map(parseRosterParticipantName)
    .filter(Boolean);

  if (rosterParticipants.length > 0) {
    return rosterParticipants;
  }

  const labelledParticipants = Array.from(document.querySelectorAll("[role='menuitem'][aria-label]"))
    .filter(isLikelyParticipantTile)
    .map((node) => parseParticipantName(node.getAttribute("aria-label") || ""))
    .filter(Boolean);

  if (labelledParticipants.length > 0) {
    return labelledParticipants;
  }

  return Array.from(document.querySelectorAll("[data-tid='participant-info-nametag']"))
    .map((node) => sanitizeName(node.textContent || ""))
    .filter(Boolean);
}

function parseRosterParticipantName(node) {
  const dataTidName = (node.getAttribute("data-tid") || "").replace(/^participantsInCall-/, "");
  if (dataTidName) {
    return sanitizeName(dataTidName);
  }

  return parseParticipantName(node.getAttribute("aria-label") || node.textContent || "");
}

function isLikelyParticipantTile(node) {
  const label = node.getAttribute("aria-label") || "";
  const dataTid = node.getAttribute("data-tid") || "";
  const text = compactText(node.textContent || "");

  if (!label || /previous page|next page|content shared by/i.test(label)) {
    return false;
  }

  return (
    /context menu|has context menu|muted|video is on|myself video|unverified|external unfamiliar/i.test(label) ||
    dataTid.includes("@") ||
    Boolean(text && node.querySelector("[data-tid='participant-info-nametag'], [data-tid='participant-name-decorator-layer']"))
  );
}

function parseParticipantName(label) {
  const clean = compactText(label)
    .replace(/^Myself video,\s*/i, "")
    .replace(/^Content shared by\s+/i, "")
    .replace(/\b(Unverified|External unfamiliar|Muted|Video is on|Context menu is available|Has context menu)\b/gi, "")
    .replace(/\s*,.*$/g, "");

  if (!clean || /^(previous page|next page|myself video)$/i.test(clean)) {
    return "";
  }

  return sanitizeName(clean);
}

function makeExcerpt(text, word) {
  const clean = compactText(text);
  const index = normalize(clean).indexOf(normalize(word));
  if (index === -1) {
    return clean.slice(-180);
  }

  const start = Math.max(0, index - 80);
  return clean.slice(start, start + 180);
}

function safeQuerySelectorAll(selector) {
  try {
    return Array.from(document.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function sanitizeKeywords(keywords) {
  return [...new Set((keywords || [])
    .map((keyword) => String(keyword).trim())
    .filter(Boolean))];
}

function sanitizeNames(names) {
  const namesByKey = new Map();

  for (const name of names || []) {
    const candidate = sanitizeName(name);
    const candidateKey = normalizeName(candidate);
    if (candidateKey && !namesByKey.has(candidateKey)) {
      namesByKey.set(candidateKey, candidate);
    }
  }

  return [...namesByKey.values()];
}

function sanitizeName(name) {
  return compactText(String(name || "").replace(/\s+/g, " ")).replace(/[,.]$/g, "");
}

function normalizeName(value) {
  return normalize(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasKeyword(text, keyword) {
  if (!keyword) {
    return false;
  }

  const escapedKeyword = escapeRegExp(keyword).replace(/\s+/g, "\\s+");
  const pattern = `(^|[^\\p{L}\\p{N}_])${escapedKeyword}($|[^\\p{L}\\p{N}_])`;

  return new RegExp(pattern, "u").test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactText(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function debounce(callback, delay) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(callback, delay);
  };
}
