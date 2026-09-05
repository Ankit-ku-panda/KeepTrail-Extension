(() => {
  if (window.top !== window) return;

  let visitId = null;
  let currentUrl = location.href;
  let clicks = 0;
  let keyActions = 0;
  let maxScroll = 0;
  let lastTick = Date.now();
  let lastActivity = Date.now();
  let captureActivity = true;
  let captureSteps = true;
  let trackingAllowed = true;

  const send = (message) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(response || null);
      });
    } catch {
      resolve(null);
    }
  });

  async function startVisit(navigationType = "visit") {
    await flush();
    currentUrl = location.href;
    const state = await send({ type: "GET_TRACKING_STATE", url: currentUrl });
    trackingAllowed = Boolean(state?.enabled && !state?.excluded);
    captureActivity = state?.captureActivity !== false;
    captureSteps = state?.captureSteps !== false;
    if (!trackingAllowed) {
      visitId = null;
      return;
    }

    const response = await send({
      type: "VISIT_START",
      payload: {
        url: currentUrl,
        title: document.title,
        referrer: document.referrer,
        navigationType
      }
    });
    visitId = response?.visitId || null;
    lastTick = Date.now();
    lastActivity = Date.now();
    resetCounters();
  }

  async function flush() {
    if (!visitId) return;
    const now = Date.now();
    const recentlyActive = now - lastActivity < 60000;
    const activeMs = document.visibilityState === "visible" && recentlyActive
      ? Math.min(now - lastTick, 30000)
      : 0;
    const payload = {
      visitId,
      activeMs,
      clicks: captureActivity ? clicks : 0,
      keyActions: captureActivity ? keyActions : 0,
      maxScroll: captureActivity ? maxScroll : 0,
      title: document.title
    };
    lastTick = now;
    resetCounters();
    await send({ type: "VISIT_UPDATE", payload });
  }

  function resetCounters() {
    clicks = 0;
    keyActions = 0;
    maxScroll = 0;
  }

  function markActivity() {
    lastActivity = Date.now();
  }

  document.addEventListener("click", (event) => {
    markActivity();
    clicks += 1;
    captureClickStep(event);
  }, { capture: true, passive: true });

  document.addEventListener("change", (event) => {
    captureChangeStep(event);
  }, { capture: true, passive: true });

  document.addEventListener("submit", (event) => {
    if (!captureSteps || !visitId) return;
    const form = event.target;
    const label = cleanLabel(form.getAttribute?.("aria-label") || form.getAttribute?.("name") || form.getAttribute?.("id") || "form");
    logStep("submit", label, form, location.href);
  }, { capture: true, passive: true });

  document.addEventListener("keydown", (event) => {
    markActivity();
    if (!event.repeat) keyActions += 1;
  }, { capture: true, passive: true });

  document.addEventListener("scroll", () => {
    markActivity();
    const root = document.documentElement;
    const scrollable = Math.max(1, root.scrollHeight - innerHeight);
    maxScroll = Math.max(maxScroll, Math.round((scrollY / scrollable) * 100));
  }, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
    else {
      lastTick = Date.now();
      lastActivity = Date.now();
    }
  });

  window.addEventListener("pagehide", flush);
  setInterval(flush, 15000);

  function checkNavigation(type) {
    setTimeout(() => {
      if (location.href !== currentUrl) startVisit(type);
    }, 0);
  }

  function captureClickStep(event) {
    if (!captureSteps || !visitId) return;
    const pathTarget = event.composedPath?.()[0];
    const rawTarget = pathTarget instanceof Element ? pathTarget : event.target instanceof Element ? event.target : null;
    if (!rawTarget || isSensitiveControl(rawTarget)) return;
    const element = rawTarget.closest('a[href], button, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="radio"], [role="switch"], [tabindex]:not([tabindex="-1"]), input[type="button"], input[type="submit"]');
    if (!element || element.matches('[aria-disabled="true"], :disabled')) return;

    const label = safeLabel(element, element.matches("a, [role=link]") ? "Link" : "Button");
    const targetUrl = element.matches("a[href]") ? absoluteUrl(element.getAttribute("href")) : location.href;
    const actionType = element.matches("a[href], [role=link]") ? "open" : element.matches("summary") ? "expand" : "click";
    logStep(actionType, label, element, targetUrl);
  }

  function captureChangeStep(event) {
    if (!captureSteps || !visitId) return;
    const element = event.target instanceof Element ? event.target : null;
    if (!element || isSensitiveControl(element)) return;

    if (element.matches('input[type="checkbox"], input[type="radio"]')) {
      const label = safeLabel(element, element.type === "checkbox" ? "Option" : "Choice");
      logStep(element.checked ? "check" : "uncheck", label, element, location.href);
      return;
    }

    if (element.matches("select")) {
      const field = safeLabel(element, "Menu");
      const choice = cleanLabel(element.selectedOptions?.[0]?.textContent || "Selected option");
      logStep("select", `${field}: ${choice}`, element, location.href);
    }
  }

  function logStep(actionType, label, element, targetUrl) {
    const clean = cleanLabel(label);
    if (!clean) return;
    send({
      type: "ACTION_LOG",
      payload: {
        visitId,
        actionType,
        label: clean,
        element: element?.tagName?.toLowerCase() || "control",
        pageUrl: location.href,
        targetUrl
      }
    });
  }

  function safeLabel(element, fallback) {
    const labelledBy = element.getAttribute?.("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      : "";
    const nativeLabel = element.labels ? [...element.labels].map((label) => label.textContent || "").join(" ") : "";
    const text = element.getAttribute?.("aria-label")
      || labelledText
      || nativeLabel
      || element.innerText
      || element.textContent
      || element.getAttribute?.("title")
      || element.getAttribute?.("alt")
      || (element.matches?.('input[type="button"], input[type="submit"]') ? element.value : "")
      || fallback;
    return cleanLabel(text);
  }

  function cleanLabel(value) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  }

  function isSensitiveControl(element) {
    return Boolean(element.closest('input[type="password"], input[type="file"], textarea, [contenteditable="true"], [contenteditable=""]'));
  }

  function absoluteUrl(value) {
    try { return new URL(value, location.href).href; } catch { return location.href; }
  }

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      checkNavigation(method);
      return result;
    };
  }

  window.addEventListener("popstate", () => checkNavigation("back/forward"));
  window.addEventListener("hashchange", () => checkNavigation("hash change"));

  // Content scripts run in an isolated JavaScript world. Polling makes SPA
  // detection reliable even when a site's own pushState cannot be patched.
  setInterval(() => {
    if (location.href !== currentUrl) startVisit("in-page navigation");
  }, 1000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startVisit(performance.getEntriesByType("navigation")[0]?.type || "visit"), { once: true });
  } else {
    startVisit(performance.getEntriesByType("navigation")[0]?.type || "visit");
  }
})();
