const notificationIcon = chrome.runtime.getURL("icons/icon-128.png");
const recentNotifications = new Map();
const DUPLICATE_WINDOW_MS = 120000;
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
const PREVIOUS_BROAD_DEFAULT_KEYWORDS = [
  ...DEFAULT_KEYWORDS,
  "k8s",
  "api",
  "docker",
  "git",
  "github",
  "devops"
];

chrome.runtime.onInstalled.addListener(async () => {
  const [localSettings, syncedSettings] = await Promise.all([
    chrome.storage.local.get(["keywords", "enabled"]),
    chrome.storage.sync.get(["keywords", "enabled"])
  ]);
  const storedKeywords = localSettings.keywords ?? syncedSettings.keywords;
  const shouldUpgradeDefaultKeywords = isLegacyDefaultKeywords(storedKeywords);

  await chrome.storage.local.set({
    enabled: localSettings.enabled ?? syncedSettings.enabled ?? true,
    keywords: shouldUpgradeDefaultKeywords ? DEFAULT_KEYWORDS : storedKeywords ?? DEFAULT_KEYWORDS
  });
});

function isLegacyDefaultKeywords(keywords) {
  if (!Array.isArray(keywords)) {
    return false;
  }

  const normalized = keywords.map(normalize).sort();
  const legacyDefault = ["exercice", "k8s"].map(normalize).sort();
  const broadDefault = PREVIOUS_BROAD_DEFAULT_KEYWORDS.map(normalize).sort();

  return sameStringList(normalized, legacyDefault) || sameStringList(normalized, broadDefault);
}

function sameStringList(left, right) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "TEAMS_KEYWORD_HIT") {
    handleNotification({
      duplicateType: "keyword",
      title: `Mot detecte: ${String(message.word || "").trim()}`,
      message: String(message.excerpt || "").trim() || `Le mot "${String(message.word || "").trim()}" est apparu dans Teams.`
    }, sender);
  }

});

function handleNotification(notification, sender) {
  const tabId = sender.tab?.id;
  const duplicateKey = makeDuplicateKey(notification, tabId);

  if (isDuplicate(duplicateKey)) {
    return;
  }

  chrome.notifications.getPermissionLevel((permissionLevel) => {
    if (permissionLevel !== "granted") {
      return;
    }

    recentNotifications.set(duplicateKey, Date.now());
    pruneRecentNotifications();

    chrome.notifications.create({
      type: "basic",
      iconUrl: notificationIcon,
      title: notification.title,
      message: notification.message,
      priority: 2
    });

    if (tabId !== undefined) {
      chrome.action.setBadgeText({ tabId, text: "!" });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#6264A7" });
      setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }), 8000);
    }
  });
}

function isDuplicate(key) {
  const lastSeen = recentNotifications.get(key) || 0;
  return Date.now() - lastSeen < DUPLICATE_WINDOW_MS;
}

function pruneRecentNotifications() {
  const oldestAllowed = Date.now() - DUPLICATE_WINDOW_MS;
  for (const [key, lastSeen] of recentNotifications) {
    if (lastSeen < oldestAllowed) {
      recentNotifications.delete(key);
    }
  }
}

function makeDuplicateKey(notification, tabId) {
  return [
    tabId ?? "unknown-tab",
    notification.duplicateType,
    normalize(notification.title),
    normalize(notification.message).slice(0, 240)
  ].join("|");
}

function normalize(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
