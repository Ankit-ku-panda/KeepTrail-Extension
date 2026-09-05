const DEFAULT_SETTINGS = { trackingEnabled: true, captureActivity: true, captureSteps: true, excludedDomains: [], retentionDays: 90 };
let records = [];
let settings = { ...DEFAULT_SETTINGS };
let favoritesOnly = false;
let editingId = null;
const $ = (selector) => document.querySelector(selector);

init();

async function init() {
  const stored = await chrome.storage.local.get(["records", "settings"]);
  records = stored.records || [];
  settings = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  bindEvents();
  fillSettings();
  populateSites();
  render();
}

function bindEvents() {
  $("#searchInput").addEventListener("input", render);
  $("#dateFilter").addEventListener("change", render);
  $("#siteFilter").addEventListener("change", render);
  $("#favoritesFilter").addEventListener("click", () => {
    favoritesOnly = !favoritesOnly;
    $("#favoritesFilter").setAttribute("aria-pressed", String(favoritesOnly));
    $("#favoritesFilter").textContent = favoritesOnly ? "★ Favorites" : "☆ Favorites";
    render();
  });
  $("#exportCsv").addEventListener("click", exportCsv);
  $("#exportJson").addEventListener("click", exportJson);
  $("#replayProcess").addEventListener("click", openProcessReplay);
  $("#closeProcessDialog").addEventListener("click", () => $("#processDialog").close());
  $("#openSettings").addEventListener("click", () => $("#settingsDialog").showModal());
  $("#dialogSave").addEventListener("click", saveDialogNote);
  $("#saveSettings").addEventListener("click", saveSettings);
  $("#clearData").addEventListener("click", clearAllData);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.records) {
      records = changes.records.newValue || [];
      populateSites();
      render();
    }
  });
}

function getFilteredRecords() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const range = $("#dateFilter").value;
  const domain = $("#siteFilter").value;
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let cutoff = 0;
  if (range === "today") cutoff = today.getTime();
  else if (range !== "all") cutoff = now - Number(range) * 86400000;

  return records
    .filter((record) => record.startedAt >= cutoff)
    .filter((record) => domain === "all" || record.domain === domain)
    .filter((record) => !favoritesOnly || record.favorite)
    .filter((record) => !query || [record.siteName, record.domain, record.title, record.url, record.note, record.category, ...(record.actions || []).map((action) => action.label)].join(" ").toLowerCase().includes(query))
    .sort((a, b) => b.startedAt - a.startedAt);
}

function render() {
  const filtered = getFilteredRecords();
  renderMetrics(filtered);
  renderTimeline(filtered);
  renderSiteBreakdown(filtered);
  $("#resultCount").textContent = `${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;
  $("#emptyState").hidden = filtered.length > 0;
  $("#dateEyebrow").textContent = $("#dateFilter").selectedOptions[0].textContent.toUpperCase();
}

function renderMetrics(filtered) {
  const domains = new Set(filtered.map((record) => record.domain));
  const totalTime = filtered.reduce((sum, record) => sum + (record.durationMs || 0), 0);
  const interactions = filtered.reduce((sum, record) => sum + (record.actions?.length || 0), 0);
  const counts = countBy(filtered, (record) => record.domain);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  $("#metricVisits").textContent = filtered.length.toLocaleString();
  $("#metricSites").textContent = domains.size.toLocaleString();
  $("#metricInteractions").textContent = interactions.toLocaleString();
  $("#totalFocus").textContent = formatDuration(totalTime);
  $("#metricTopSite").textContent = top?.[0] || "—";
  $("#topSiteVisits").textContent = top ? `${top[1]} ${top[1] === 1 ? "visit" : "visits"}` : "No activity yet";
}

function renderTimeline(filtered) {
  const timeline = $("#timeline");
  timeline.replaceChildren();
  const template = $("#timelineTemplate");
  let previousDay = "";

  for (const record of filtered) {
    const day = dayLabel(record.startedAt);
    if (day !== previousDay) {
      const divider = document.createElement("div");
      divider.className = "day-divider";
      divider.textContent = day;
      timeline.append(divider);
      previousDay = day;
    }

    const node = template.content.cloneNode(true);
    const article = node.querySelector(".timeline-item");
    const avatar = node.querySelector(".site-avatar");
    avatar.textContent = (record.siteName || record.domain || "?")[0].toUpperCase();
    avatar.style.setProperty("--site-color", colorFor(record.domain));
    node.querySelector(".site-name").textContent = record.siteName || record.domain;
    node.querySelector(".time-label").textContent = formatTime(record.startedAt);
    node.querySelector(".page-title").textContent = record.title || record.url;
    const link = node.querySelector(".page-url");
    link.href = record.url;
    link.textContent = compactUrl(record.url);
    const favorite = node.querySelector(".favorite-button");
    favorite.textContent = record.favorite ? "★" : "☆";
    favorite.classList.toggle("active", record.favorite);
    favorite.addEventListener("click", () => updateRecord(record.id, { favorite: !record.favorite }));

    const chips = node.querySelector(".activity-chips");
    const chipValues = [
      ["◷", formatDuration(record.durationMs || 0)],
      ["⌁", record.category || "Web page"],
      record.clicks ? ["↗", `${record.clicks} clicks`] : null,
      record.actions?.length ? ["▶", `${record.actions.length} process steps`] : null,
      record.maxScroll ? ["↕", `${record.maxScroll}% scrolled`] : null,
      record.navigationType && record.navigationType !== "visit" ? ["↶", humanNavigation(record.navigationType)] : null
    ].filter(Boolean);
    for (const [icon, label] of chipValues) {
      const chip = document.createElement("span");
      chip.textContent = `${icon} ${label}`;
      chips.append(chip);
    }

    const actions = record.actions || [];
    const processToggle = node.querySelector(".process-toggle");
    const processList = node.querySelector(".process-list");
    if (actions.length) {
      processToggle.hidden = false;
      processToggle.querySelector("small").textContent = `${actions.length} ${actions.length === 1 ? "recorded step" : "recorded steps"}`;
      processToggle.addEventListener("click", () => {
        const expanded = processToggle.getAttribute("aria-expanded") === "true";
        processToggle.setAttribute("aria-expanded", String(!expanded));
        processToggle.querySelector("strong").textContent = expanded ? "View process" : "Hide process";
        processList.hidden = expanded;
        if (!expanded && !processList.dataset.rendered) {
          renderProcessSteps(processList, actions);
          processList.dataset.rendered = "true";
        }
      });
    }

    const note = node.querySelector(".memory-note");
    note.textContent = record.note || "";
    note.hidden = !record.note;
    const noteButton = node.querySelector(".note-button");
    noteButton.textContent = record.note ? "✎ Edit note" : "＋ Add note";
    noteButton.addEventListener("click", () => openNote(record));
    node.querySelector(".delete-button").addEventListener("click", () => deleteRecord(record.id));
    article.dataset.id = record.id;
    timeline.append(node);
  }
}

function renderSiteBreakdown(filtered) {
  const totals = {};
  for (const record of filtered) totals[record.domain] = (totals[record.domain] || 0) + Math.max(record.durationMs || 0, 1000);
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = entries[0]?.[1] || 1;
  const container = $("#siteBreakdown");
  container.replaceChildren();
  if (!entries.length) {
    container.innerHTML = '<p class="muted">Your top websites will appear here.</p>';
    return;
  }
  for (const [domain, duration] of entries) {
    const row = document.createElement("div");
    row.className = "site-row";
    row.innerHTML = `<div><strong></strong><span></span></div><div class="progress"><i></i></div>`;
    row.querySelector("strong").textContent = domain;
    row.querySelector("span").textContent = formatDuration(duration);
    row.querySelector("i").style.width = `${Math.max(5, duration / max * 100)}%`;
    row.querySelector("i").style.background = colorFor(domain);
    container.append(row);
  }
}

function openNote(record) {
  editingId = record.id;
  $("#dialogPageTitle").textContent = record.title || record.url;
  $("#dialogNote").value = record.note || "";
  $("#noteDialog").showModal();
  setTimeout(() => $("#dialogNote").focus(), 50);
}

function openProcessReplay() {
  const allSteps = getFilteredRecords()
    .flatMap((record) => (record.actions || []).map((action) => ({ ...action, siteName: record.siteName, pageTitle: record.title, recordUrl: record.url })))
    .sort((a, b) => a.at - b.at);
  const steps = allSteps.slice(-1000);
  const list = $("#processReplayList");
  list.replaceChildren();
  $("#processReplayEmpty").hidden = steps.length > 0;
  $("#processDialogSummary").textContent = steps.length
    ? `${steps.length === allSteps.length ? steps.length : `Latest ${steps.length} of ${allSteps.length}`} ${steps.length === 1 ? "step" : "steps"} shown in the exact order you performed them.`
    : "Review the controls and pages you used in exact time order.";

  for (const [index, action] of steps.entries()) {
    const item = document.createElement("li");
    item.className = "replay-step";
    item.innerHTML = '<span class="replay-number"></span><div class="replay-copy"><small></small><strong></strong><p></p></div>';
    item.querySelector(".replay-number").textContent = String(index + 1);
    item.querySelector("small").textContent = `${formatDateTime(action.at)} · ${action.siteName || "Website"}`;
    item.querySelector("strong").textContent = actionSentence(action);
    item.querySelector("p").textContent = action.pageTitle || compactUrl(action.pageUrl || action.recordUrl);
    if (action.targetUrl && action.targetUrl !== action.pageUrl) {
      const link = document.createElement("a");
      link.href = action.targetUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `Result: ${compactUrl(action.targetUrl)}`;
      item.querySelector(".replay-copy").append(link);
    }
    list.append(item);
  }
  $("#processDialog").showModal();
}

function renderProcessSteps(list, actions) {
  list.replaceChildren();
  actions.forEach((action, index) => {
    const item = document.createElement("li");
    item.className = "process-step";
    item.innerHTML = '<span class="step-number"></span><div><strong></strong><small></small></div>';
    item.querySelector(".step-number").textContent = String(index + 1);
    item.querySelector("strong").textContent = actionSentence(action);
    const details = [formatTimeWithSeconds(action.at), action.element].filter(Boolean).join(" · ");
    item.querySelector("small").textContent = details;
    if (action.targetUrl && action.targetUrl !== action.pageUrl) {
      const link = document.createElement("a");
      link.href = action.targetUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = compactUrl(action.targetUrl);
      item.querySelector("div").append(link);
    }
    list.append(item);
  });
}

async function saveDialogNote(event) {
  event.preventDefault();
  await updateRecord(editingId, { note: $("#dialogNote").value.trim() });
  $("#noteDialog").close();
}

async function updateRecord(id, changes) {
  await chrome.runtime.sendMessage({ type: "UPDATE_RECORD", payload: { id, changes } });
}

async function deleteRecord(id) {
  await chrome.runtime.sendMessage({ type: "DELETE_RECORD", id });
}

function fillSettings() {
  $("#settingTracking").checked = settings.trackingEnabled;
  $("#settingActivity").checked = settings.captureActivity;
  $("#settingSteps").checked = settings.captureSteps;
  $("#retentionDays").value = String(settings.retentionDays);
  $("#excludedDomains").value = settings.excludedDomains.join("\n");
}

async function saveSettings(event) {
  event.preventDefault();
  settings = {
    ...settings,
    trackingEnabled: $("#settingTracking").checked,
    captureActivity: $("#settingActivity").checked,
    captureSteps: $("#settingSteps").checked,
    retentionDays: Number($("#retentionDays").value),
    excludedDomains: $("#excludedDomains").value.split(/\n|,/).map(normalizeDomain).filter(Boolean)
  };
  await chrome.storage.local.set({ settings });
  $("#settingsDialog").close();
}

async function clearAllData(event) {
  event.preventDefault();
  if (!confirm("Delete every TrailMind memory? This cannot be undone.")) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_RECORDS" });
  records = [];
  $("#settingsDialog").close();
  populateSites();
  render();
}

function populateSites() {
  const select = $("#siteFilter");
  const current = select.value;
  const domains = [...new Set(records.map((record) => record.domain).filter(Boolean))].sort();
  select.replaceChildren(new Option("All websites", "all"), ...domains.map((domain) => new Option(domain, domain)));
  select.value = domains.includes(current) ? current : "all";
}

function exportJson() {
  download(`trailmind-${dateStamp()}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), records }, null, 2), "application/json");
}

function exportCsv() {
  const headers = ["Date", "Time", "Website", "Domain", "Title", "URL", "Category", "Focused seconds", "Clicks", "Key actions", "Scroll percent", "Navigation", "Process steps", "Note", "Favorite"];
  const rows = records.map((record) => [
    new Date(record.startedAt).toLocaleDateString(), new Date(record.startedAt).toLocaleTimeString(), record.siteName, record.domain,
    record.title, record.url, record.category, Math.round((record.durationMs || 0) / 1000), record.clicks, record.keyActions,
    record.maxScroll, record.navigationType, processSummary(record.actions || []), record.note, record.favorite
  ]);
  download(`trailmind-${dateStamp()}.csv`, [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv");
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function countBy(items, getter) {
  return items.reduce((out, item) => { const key = getter(item); out[key] = (out[key] || 0) + 1; return out; }, {});
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds ? `${seconds}s` : "<1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatTime(timestamp) { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp); }
function formatTimeWithSeconds(timestamp) { return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(timestamp); }
function formatDateTime(timestamp) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(timestamp); }
function dayLabel(timestamp) {
  const date = new Date(timestamp); const today = new Date(); const yesterday = new Date(Date.now() - 86400000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(date);
}
function compactUrl(rawUrl) { try { const url = new URL(rawUrl); return `${url.hostname}${url.pathname}${url.search}`.slice(0, 110); } catch { return rawUrl; } }
function normalizeDomain(value) { try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } }
function colorFor(value = "") { const colors = ["#6d5ef8", "#00b8a9", "#ff8a5b", "#e85aad", "#3b82f6", "#a3e635"]; let hash = 0; for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0; return colors[Math.abs(hash) % colors.length]; }
function csvCell(value) { const string = String(value ?? ""); return `"${string.replace(/"/g, '""')}"`; }
function dateStamp() { return new Date().toISOString().slice(0, 10); }
function humanNavigation(value) { return ({ pushState: "In-page navigation", replaceState: "Page state changed", "back/forward": "Back / forward", reload: "Reloaded", navigate: "Opened" })[value] || value; }
function actionSentence(action) { const verbs = { click: "Clicked", open: "Opened", select: "Selected", check: "Checked", uncheck: "Unchecked", submit: "Submitted", expand: "Expanded", navigate: "Navigated to" }; return `${verbs[action.type] || "Used"} ${action.label}`; }
function processSummary(actions) { return actions.map((action, index) => `${index + 1}. ${actionSentence(action)}${action.targetUrl && action.targetUrl !== action.pageUrl ? ` (${action.targetUrl})` : ""}`).join(" → "); }
