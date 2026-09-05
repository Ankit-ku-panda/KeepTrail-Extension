const $ = (selector) => document.querySelector(selector);
let activeRecordId = null;

init();

async function init() {
  const [{ settings = {} }, tabs] = await Promise.all([
    chrome.storage.local.get("settings"),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  const activeTab = tabs[0];
  $("#trackingToggle").checked = settings.trackingEnabled !== false;
  updateStatus(settings.trackingEnabled !== false, activeTab?.url, activeTab?.title);
  await loadToday(activeTab);
}

$("#trackingToggle").addEventListener("change", async (event) => {
  const enabled = event.target.checked;
  await chrome.runtime.sendMessage({ type: "SET_TRACKING", enabled });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  updateStatus(enabled, tab?.url, tab?.title);
});

$("#saveNote").addEventListener("click", saveNote);
$("#quickNote").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") saveNote();
});

$("#openDashboard").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  window.close();
});

async function loadToday(activeTab) {
  const { records = [], tabSessions = {} } = await chrome.storage.local.get(["records", "tabSessions"]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = records.filter((record) => record.startedAt >= start.getTime());
  $("#todayVisits").textContent = String(today.length);
  $("#todaySites").textContent = String(new Set(today.map((record) => record.domain)).size);
  $("#todayTime").textContent = compactDuration(today.reduce((sum, record) => sum + (record.durationMs || 0), 0));

  activeRecordId = activeTab?.id !== undefined ? tabSessions[activeTab.id] : null;
  const activeRecord = records.find((record) => record.id === activeRecordId);
  if (activeRecord) {
    $("#quickNote").value = activeRecord.note || "";
    renderRecentSteps(activeRecord.actions || []);
  } else {
    renderRecentSteps([]);
  }
}

function renderRecentSteps(actions) {
  const recent = actions.slice(-4);
  const list = $("#recentSteps");
  list.replaceChildren();
  $("#stepCount").textContent = `${actions.length} ${actions.length === 1 ? "step" : "steps"}`;
  $("#noRecentSteps").hidden = recent.length > 0;
  for (const action of recent) {
    const item = document.createElement("li");
    const index = actions.indexOf(action) + 1;
    item.innerHTML = "<span></span><div><strong></strong><small></small></div>";
    item.querySelector("span").textContent = String(index);
    item.querySelector("strong").textContent = actionSentence(action);
    item.querySelector("small").textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(action.at);
    list.append(item);
  }
}

async function saveNote() {
  const note = $("#quickNote").value.trim();
  if (!activeRecordId) {
    $("#saveState").textContent = "Open a normal website first";
    return;
  }
  const response = await chrome.runtime.sendMessage({ type: "UPDATE_RECORD", payload: { id: activeRecordId, changes: { note } } });
  if (!response?.ok) return;
  $("#saveState").textContent = "Saved ✓";
  setTimeout(() => { $("#saveState").textContent = "Saved only on this device"; }, 1800);
}

function updateStatus(enabled, rawUrl, title) {
  let site = title || "This page";
  try { site = new URL(rawUrl).hostname.replace(/^www\./, ""); } catch {}
  $("#statusTitle").textContent = enabled ? "Remembering this page" : "Tracking is paused";
  $("#currentSite").textContent = site;
  $("#statusCard").classList.toggle("paused", !enabled);
}

function compactDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function actionSentence(action) {
  const verbs = { click: "Clicked", open: "Opened", select: "Selected", check: "Checked", uncheck: "Unchecked", submit: "Submitted", expand: "Expanded", navigate: "Navigated to" };
  return `${verbs[action.type] || "Used"} ${action.label}`;
}
