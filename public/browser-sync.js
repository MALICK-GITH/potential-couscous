(function () {
  const BANNER_ID = "browserSyncBanner";
  const INSTALL_BTN_ID = "installPwaBtn";
  let deferredInstallPrompt = null;
  let hiddenAt = Date.now();
  const RELOAD_DELAY_ON_RETURN_MS = 90 * 1000;

  function ensureBanner() {
    let banner = document.getElementById(BANNER_ID);
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.style.position = "fixed";
    banner.style.right = "12px";
    banner.style.bottom = "12px";
    banner.style.zIndex = "9999";
    banner.style.padding = "8px 12px";
    banner.style.borderRadius = "12px";
    banner.style.border = "1px solid rgba(125,255,173,0.35)";
    banner.style.background = "rgba(9,17,34,0.92)";
    banner.style.color = "#d9f7e8";
    banner.style.fontFamily = "Sora, sans-serif";
    banner.style.fontSize = "12px";
    banner.style.display = "none";
    document.body.appendChild(banner);
    return banner;
  }

  function showBanner(text, ok) {
    const banner = ensureBanner();
    banner.textContent = text;
    banner.style.display = "block";
    banner.style.borderColor = ok ? "rgba(125,255,173,0.35)" : "rgba(255,122,122,0.4)";
    banner.style.color = ok ? "#d9f7e8" : "#ffe3e3";
    setTimeout(() => {
      if (banner) banner.style.display = "none";
    }, 3500);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", async () => {
      try {
        await navigator.serviceWorker.register("/sw.js");
      } catch (_e) {
        // no-op: app keeps running without SW
      }
    });
  }

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      addInstallButton();
    });
  }

  function addInstallButton() {
    if (document.getElementById(INSTALL_BTN_ID)) return;
    const btn = document.createElement("button");
    btn.id = INSTALL_BTN_ID;
    btn.type = "button";
    btn.textContent = "Installer App";
    btn.style.position = "fixed";
    btn.style.left = "12px";
    btn.style.bottom = "12px";
    btn.style.zIndex = "9999";
    btn.style.border = "1px solid rgba(59,231,255,0.5)";
    btn.style.background = "rgba(8,22,42,0.94)";
    btn.style.color = "#d8f3ff";
    btn.style.padding = "8px 12px";
    btn.style.borderRadius = "10px";
    btn.style.fontFamily = "Chakra Petch, sans-serif";
    btn.style.fontWeight = "700";
    btn.addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      try {
        await deferredInstallPrompt.userChoice;
      } catch (_e) {
        // ignore
      }
      deferredInstallPrompt = null;
      btn.remove();
    });
    document.body.appendChild(btn);
  }

  function setupConnectivitySync() {
    window.addEventListener("online", () => showBanner("Connexion retablie. Sync active.", true));
    window.addEventListener("offline", () => showBanner("Mode hors ligne actif.", false));
  }

  function setupVisibilitySync() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const elapsed = Date.now() - hiddenAt;
      if (elapsed >= RELOAD_DELAY_ON_RETURN_MS) {
        const evt = new CustomEvent("fc25:resume-sync", { detail: { elapsedMs: elapsed } });
        window.dispatchEvent(evt);
      }
    });

    window.addEventListener("fc25:resume-sync", () => {
      if (!navigator.onLine) return;
      // Reprise simple et fiable: reload la page pour repartir sur les donnees les plus fraiches.
      window.location.reload();
    });
  }

  function setupBrowserFusion() {
    registerServiceWorker();
    setupInstallPrompt();
    setupConnectivitySync();
    setupVisibilitySync();
  }

  setupBrowserFusion();
})();
