(function initChatWidget() {
  const key = "fc25_chat_history_v1";

  function getContext() {
    const params = new URLSearchParams(window.location.search);
    const matchId = params.get("id") || "";
    const leagueSelect = document.getElementById("leagueSelect");
    const league = leagueSelect ? String(leagueSelect.value || "") : "";
    const sizeInput = document.getElementById("sizeInput");
    const riskSelect = document.getElementById("riskSelect");
    const cardsVisible = document.querySelectorAll(".match-card, .match-item, .match-row, .match").length;
    const title = document.querySelector("h1")?.textContent?.trim() || "";

    return {
      page: window.location.pathname,
      matchId,
      league,
      realtime: {
        now: Date.now(),
        online: navigator.onLine,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        title,
        cardsVisible,
        couponSize: sizeInput ? Number(sizeInput.value || 0) : null,
        couponRisk: riskSelect ? String(riskSelect.value || "") : null,
      },
    };
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(key);
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(key, JSON.stringify(history.slice(-30)));
    } catch {
      // Storage may be blocked in some mobile/private contexts.
    }
  }

  function createUI() {
    const fab = document.createElement("button");
    fab.className = "chat-fab";
    fab.type = "button";
    fab.textContent = "AI";
    fab.setAttribute("aria-label", "Ouvrir le chat AI");

    const panel = document.createElement("section");
    panel.className = "chat-panel chat-hidden";
    panel.innerHTML = `
      <div class="chat-head">
        <span>SOLITAIRE AI</span>
        <div class="chat-head-actions">
          <button type="button" class="chat-clear">Effacer</button>
          <button type="button" class="chat-close">X</button>
        </div>
      </div>
      <div class="chat-log" id="chatLog"></div>
      <form class="chat-form" id="chatForm">
        <textarea class="chat-input" id="chatInput" placeholder="Pose une question (match, coupon, risque)..."></textarea>
        <button class="chat-send" type="submit">Envoyer</button>
      </form>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    const log = panel.querySelector("#chatLog");
    const form = panel.querySelector("#chatForm");
    const input = panel.querySelector("#chatInput");
    const closeBtn = panel.querySelector(".chat-close");
    const clearBtn = panel.querySelector(".chat-clear");
    let busy = false;
    let history = loadHistory();

    function render() {
      if (!log) return;
      log.innerHTML = history
        .map((m) => `<div class="chat-msg ${m.role === "user" ? "chat-user" : "chat-ai"}">${m.text}</div>`)
        .join("");
      log.scrollTop = log.scrollHeight;
    }

    function push(role, text) {
      history.push({ role, text: String(text || "") });
      saveHistory(history);
      render();
    }

    if (history.length === 0) {
      push("ai", "Salut, je suis SOLITAIRE AI. Je peux t'aider pour les matchs, cotes et coupons.");
    } else {
      render();
    }

    fab.addEventListener("click", () => {
      panel.classList.toggle("chat-hidden");
    });

    closeBtn.addEventListener("click", () => panel.classList.add("chat-hidden"));
    clearBtn.addEventListener("click", () => {
      history = [];
      saveHistory(history);
      push("ai", "Historique efface. Je suis pret pour une nouvelle session.");
    });

    function applyAction(action) {
      if (!action || typeof action !== "object") return;
      const type = String(action.type || "");
      if (type === "open_page" && action.target) {
        window.location.href = String(action.target);
      } else if (type === "refresh_page") {
        window.location.reload();
      } else if (type === "clear_chat") {
        history = [];
        saveHistory(history);
        push("ai", "Chat efface par commande IA.");
      } else if (type === "set_coupon_form") {
        const sizeInput = document.getElementById("sizeInput");
        const riskSelect = document.getElementById("riskSelect");
        const leagueSelect = document.getElementById("leagueSelect");
        if (sizeInput && action.size) sizeInput.value = String(action.size);
        if (riskSelect && action.risk) riskSelect.value = String(action.risk);
        if (leagueSelect && action.league) leagueSelect.value = String(action.league);
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const text = String(input.value || "").trim();
      if (!text) return;
      input.value = "";
      push("user", text);
      busy = true;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            context: getContext(),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || data.error || "Erreur chat");
        }
        push("ai", data.answer || "Aucune reponse.");
        const actions = Array.isArray(data.actions) ? data.actions : [];
        for (const a of actions) applyAction(a);
      } catch (err) {
        push("ai", `Erreur: ${err.message}`);
      } finally {
        busy = false;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createUI);
  } else {
    createUI();
  }
})();
