const DEFAULT_SETTINGS = {
  trackingEnabled: true,
  captureActivity: true,
  captureSteps: true,
  excludedDomains: [],
  retentionDays: 90,
  maxRecords: 10000,
  maxActionsPerVisit: 200
};

let writeQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  cleanupOldRecords();
  updateBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "VISIT_START") {
    enqueue(() => startVisit(message.payload, sender.tab)).then(sendResponse);
    return true;
  }

  if (message.type === "VISIT_UPDATE") {
    enqueue(() => updateVisit(message.payload)).then(sendResponse);
    return true;
  }

  if (message.type === "ACTION_LOG") {
    enqueue(() => logAction(message.payload)).then(sendResponse);
    return true;
  }

  if (message.type === "UPDATE_RECORD") {
    enqueue(() => updateRecord(message.payload)).then(sendResponse);
    return true;
  }

  if (message.type === "DELETE_RECORD") {
    enqueue(() => deleteRecord(message.id)).then(sendResponse);
    return true;
  }

  if (message.type === "CLEAR_RECORDS") {
    enqueue(clearRecords).then(sendResponse);
    return true;
  }

  if (message.type === "GET_TRACKING_STATE") {
    getSettings().then((settings) => sendResponse({
      enabled: settings.trackingEnabled,
      captureActivity: settings.captureActivity,
      captureSteps: settings.captureSteps,
      excluded: isExcluded(message.url, settings.excludedDomains)
    }));
    return true;
  }

  if (message.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    sendResponse({ ok: true });
  }

  if (message.type === "SET_TRACKING") {
    setTracking(Boolean(message.enabled)).then(sendResponse);
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => closeTabSession(tabId));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") updateBadge();
});

function enqueue(operation) {
  const next = writeQueue.then(operation, operation);
  writeQueue = next.catch(() => undefined);
  return next;
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function setTracking(enabled) {
  const settings = await getSettings();
  settings.trackingEnabled = enabled;
  await chrome.storage.local.set({ settings });
  await updateBadge();
  return { ok: true, enabled };
}

async function startVisit(payload, tab) {
  const settings = await getSettings();
  if (!settings.trackingEnabled || !isTrackable(payload.url) || isExcluded(payload.url, settings.excludedDomains)) {
    return { tracked: false };
  }

  const now = Date.now();
  const visitId = crypto.randomUUID();
  const { records = [], tabSessions = {} } = await chrome.storage.local.get(["records", "tabSessions"]);
  const tabId = tab?.id;

  let previousVisitId = "";
  if (tabId !== undefined && tabSessions[tabId]) {
    const previous = records.find((record) => record.id === tabSessions[tabId]);
    if (previous) {
      previousVisitId = previous.id;
      previous.endedAt = Math.max(previous.endedAt || 0, now);
      const lastAction = previous.actions?.at(-1);
      if (lastAction && now - lastAction.at < 15000 && (!lastAction.targetUrl || lastAction.targetUrl === lastAction.pageUrl)) {
        lastAction.targetUrl = safeUrl(payload.url);
        lastAction.resultedInNavigation = true;
      }
    }
  }

  const urlData = describeUrl(payload.url);
  const record = {
    id: visitId,
    tabId,
    siteName: urlData.siteName,
    domain: urlData.domain,
    url: payload.url,
    title: cleanText(payload.title) || urlData.siteName,
    category: payload.category || urlData.category,
    navigationType: payload.navigationType || "visit",
    previousVisitId,
    referrer: safeUrl(payload.referrer),
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    clicks: 0,
    keyActions: 0,
    maxScroll: 0,
    actions: [],
    note: "",
    favorite: false
  };

  records.push(record);
  const pruned = prune(records, settings);
  if (tabId !== undefined) tabSessions[tabId] = visitId;
  await chrome.storage.local.set({ records: pruned, tabSessions });
  await updateBadge();
  return { tracked: true, visitId };
}

async function updateVisit(payload) {
  if (!payload.visitId) return { ok: false };
  const settings = await getSettings();
  const { records = [] } = await chrome.storage.local.get("records");
  const record = records.find((item) => item.id === payload.visitId);
  if (!record) return { ok: false };
  if (!settings.trackingEnabled || isExcluded(record.url, settings.excludedDomains)) return { ok: false, paused: true };

  record.endedAt = Date.now();
  record.durationMs += clampNumber(payload.activeMs, 0, 30000);
  if (settings.captureActivity) {
    record.clicks += clampNumber(payload.clicks, 0, 500);
    record.keyActions += clampNumber(payload.keyActions, 0, 2000);
    record.maxScroll = Math.max(record.maxScroll, clampNumber(payload.maxScroll, 0, 100));
  }
  if (payload.title) record.title = cleanText(payload.title) || record.title;
  await chrome.storage.local.set({ records });
  return { ok: true };
}

async function logAction(payload) {
  if (!payload.visitId) return { ok: false };
  const settings = await getSettings();
  if (!settings.trackingEnabled || !settings.captureSteps) return { ok: false, paused: true };

  const { records = [] } = await chrome.storage.local.get("records");
  const record = records.find((item) => item.id === payload.visitId);
  if (!record || isExcluded(record.url, settings.excludedDomains)) return { ok: false };

  const label = cleanText(payload.label).slice(0, 120);
  const type = allowedActionType(payload.actionType);
  if (!label || !type) return { ok: false };

  record.actions ||= [];
  const previous = record.actions.at(-1);
  const now = Date.now();
  if (previous && previous.type === type && previous.label === label && now - previous.at < 500) {
    return { ok: true, duplicate: true };
  }

  record.actions.push({
    id: crypto.randomUUID(),
    at: now,
    type,
    label,
    element: cleanText(payload.element).slice(0, 40),
    pageUrl: safeUrl(payload.pageUrl || record.url),
    targetUrl: safeUrl(payload.targetUrl)
  });
  if (record.actions.length > settings.maxActionsPerVisit) {
    record.actions = record.actions.slice(-settings.maxActionsPerVisit);
  }
  record.endedAt = now;
  await chrome.storage.local.set({ records });
  return { ok: true, stepNumber: record.actions.length };
}

async function closeTabSession(tabId) {
  const { records = [], tabSessions = {} } = await chrome.storage.local.get(["records", "tabSessions"]);
  const id = tabSessions[tabId];
  if (!id) return;
  const record = records.find((item) => item.id === id);
  if (record) record.endedAt = Date.now();
  delete tabSessions[tabId];
  await chrome.storage.local.set({ records, tabSessions });
}

async function updateRecord(payload) {
  const { records = [] } = await chrome.storage.local.get("records");
  const record = records.find((item) => item.id === payload?.id);
  if (!record) return { ok: false };
  if (Object.hasOwn(payload.changes || {}, "note")) record.note = String(payload.changes.note || "").slice(0, 500);
  if (Object.hasOwn(payload.changes || {}, "favorite")) record.favorite = Boolean(payload.changes.favorite);
  await chrome.storage.local.set({ records });
  return { ok: true };
}

async function deleteRecord(id) {
  const { records = [], tabSessions = {} } = await chrome.storage.local.get(["records", "tabSessions"]);
  const nextRecords = records.filter((record) => record.id !== id);
  for (const [tabId, recordId] of Object.entries(tabSessions)) {
    if (recordId === id) delete tabSessions[tabId];
  }
  await chrome.storage.local.set({ records: nextRecords, tabSessions });
  return { ok: true };
}

async function clearRecords() {
  await chrome.storage.local.set({ records: [], tabSessions: {} });
  return { ok: true };
}

async function cleanupOldRecords() {
  const settings = await getSettings();
  const { records = [] } = await chrome.storage.local.get("records");
  await chrome.storage.local.set({ records: prune(records, settings) });
}

function prune(records, settings) {
  const cutoff = Date.now() - settings.retentionDays * 86400000;
  return records
    .filter((record) => record.startedAt >= cutoff || record.favorite || record.note)
    .slice(-settings.maxRecords);
}

async function updateBadge() {
  const settings = await getSettings();
  await chrome.action.setBadgeText({ text: settings.trackingEnabled ? "●" : "Ⅱ" });
  await chrome.action.setBadgeBackgroundColor({ color: settings.trackingEnabled ? "#6D5EF8" : "#6B7280" });
  await chrome.action.setTitle({ title: settings.trackingEnabled ? "TrailMind is remembering" : "TrailMind is paused" });
}

function describeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const domain = url.hostname.replace(/^www\./, "");
    const siteName = domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    return { domain, siteName, category: inferCategory(domain, url.pathname) };
  } catch {
    return { domain: "unknown", siteName: "Unknown", category: "Web page" };
  }
}

function inferCategory(domain, path) {
  if (domain === "github.com") {
    if (/\/pull(s)?(\/|$)/.test(path)) return "GitHub pull request";
    if (/\/issues?(\/|$)/.test(path)) return "GitHub issue";
    if (/\/actions(\/|$)/.test(path)) return "GitHub Actions";
    if (/\/commit(s)?(\/|$)/.test(path)) return "GitHub commit";
    if (/\/settings(\/|$)/.test(path)) return "GitHub settings";
    if (path.split("/").filter(Boolean).length >= 2) return "GitHub repository";
    return "GitHub";
  }
  if (/youtube\.com$/.test(domain)) return path.startsWith("/watch") ? "Watched video" : "YouTube";
  if (/docs\.google\.com$/.test(domain)) return "Google document";
  if (/mail\.google\.com$/.test(domain)) return "Email";
  return "Web page";
}

function isTrackable(rawUrl) {
  return /^(https?|file):/.test(rawUrl || "");
}

function isExcluded(rawUrl, excludedDomains) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return excludedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return true;
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return /^(https?|file):/.test(url.protocol) ? url.href.slice(0, 2000) : "";
  } catch {
    return "";
  }
}

function clampNumber(value, min, max) {
  const number = Number(value) || 0;
  return Math.min(max, Math.max(min, number));
}

function allowedActionType(value) {
  const allowed = new Set(["click", "open", "select", "check", "uncheck", "submit", "expand", "navigate"]);
  return allowed.has(value) ? value : "";
}
