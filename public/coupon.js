function formatOdd(value) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

let lastCouponData = null;
const COUPON_HISTORY_KEY = "fc25_coupon_history_v1";

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isStrictUpcomingMatch(match, nowSec) {
  const start = toNumber(match?.startTimeUnix, 0);
  if (start <= nowSec) return false;

  const gs = toNumber(match?.statusCode, 0);
  const info = normalizeText(match?.infoText || "");
  const sls = normalizeText(match?.statusText || "");
  const phase = normalizeText(match?.phase || "");

  const preByCode = gs === 128;
  const preByInfo = info.includes("avant le debut");
  const preBySls = sls.includes("debut dans");
  const inPlayMarkers =
    phase.includes("mi-temps") ||
    phase.includes("jeu termine") ||
    info.includes("match termine");

  if (inPlayMarkers) return false;
  return preByCode || preByInfo || preBySls;
}

async function readJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const htmlHint = text.trim().startsWith("<")
      ? "Le serveur a renvoye une page HTML au lieu d'un JSON."
      : "Reponse non-JSON.";
    throw new Error(`${htmlHint} (HTTP ${response.status})`);
  }
}

function riskConfig(profile = "balanced") {
  const key = normalizeText(profile);
  if (key === "safe") return { minOdd: 1.2, maxOdd: 1.7, minConfidence: 62, slope: 8, anchor: 1.45 };
  if (key === "aggressive") return { minOdd: 1.55, maxOdd: 3.2, minConfidence: 45, slope: 6, anchor: 2.2 };
  return { minOdd: 1.3, maxOdd: 2.25, minConfidence: 50, slope: 11, anchor: 1.7 };
}

function pickOptionFromDetails(details, profile = "balanced") {
  const cfg = riskConfig(profile);
  const master = details?.prediction?.maitre?.decision_finale || {};
  const top = details?.prediction?.analyse_avancee?.top_3_recommandations || [];
  const markets = Array.isArray(details?.bettingMarkets) ? details.bettingMarkets : [];
  const byName = new Map(markets.map((m) => [m.nom, m]));
  const m = byName.get(master.pari_choisi);
  if (m && Number(master.confiance_numerique) >= cfg.minConfidence && m.cote >= cfg.minOdd && m.cote <= cfg.maxOdd) {
    return { pari: m.nom, cote: m.cote, confiance: Number(master.confiance_numerique), source: "MAITRE" };
  }
  const bestTop = top
    .filter((x) => Number.isFinite(Number(x?.cote)) && Number(x.cote) >= cfg.minOdd && Number(x.cote) <= cfg.maxOdd)
    .sort((a, b) => Number(b.score_composite || 0) - Number(a.score_composite || 0))[0];
  if (bestTop) {
    return { pari: bestTop.pari, cote: Number(bestTop.cote), confiance: Number(bestTop.score_composite || 50), source: "TOP3" };
  }
  const fallback = markets
    .filter((x) => Number.isFinite(Number(x?.cote)) && Number(x.cote) >= cfg.minOdd && Number(x.cote) <= cfg.maxOdd)
    .sort((a, b) => Number(a.cote) - Number(b.cote))[0];
  if (!fallback) return null;
  return { pari: fallback.nom, cote: Number(fallback.cote), confiance: 45, source: "FALLBACK" };
}

function readHistory() {
  try {
    const raw = localStorage.getItem(COUPON_HISTORY_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(COUPON_HISTORY_KEY, JSON.stringify(items.slice(0, 40)));
}

function addHistoryEntry(entry) {
  const items = readHistory();
  items.unshift(entry);
  writeHistory(items);
  renderHistory();
}

function renderHistory() {
  const panel = document.getElementById("historyPanel");
  if (!panel) return;
  const items = readHistory();
  if (!items.length) {
    panel.innerHTML = "<h3>Historique local</h3><p>Aucun historique pour le moment.</p>";
    return;
  }
  const rows = items
    .slice(0, 8)
    .map(
      (x, i) => `
      <li>
        <strong>${i + 1}. ${x.type === "validation" ? "Validation" : x.type === "telegram" ? "Telegram" : "Coupon"} - ${new Date(x.at).toLocaleString("fr-FR")}</strong>
        <span>${x.note}</span>
      </li>
    `
    )
    .join("");
  panel.innerHTML = `
    <h3>Historique local</h3>
    <button id="clearHistoryBtn" type="button">Vider historique</button>
    <ul class="history-list">${rows}</ul>
  `;
  const clearBtn = document.getElementById("clearHistoryBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      writeHistory([]);
      renderHistory();
    });
  }
}

async function generateCouponFallback(size, league, profile = "balanced") {
  const listRes = await fetch("/api/matches", { cache: "no-store" });
  const listData = await readJsonSafe(listRes);
  if (!listRes.ok || !listData.success) {
    throw new Error(listData.error || listData.message || "Erreur liste matchs");
  }

  const normLeague = String(league || "all").trim().toLowerCase();
  const nowSec = Math.floor(Date.now() / 1000);
  const base = Array.isArray(listData.matches) ? listData.matches : [];
  const filteredByLeague =
    normLeague === "all" ? base : base.filter((m) => String(m.league || "").trim().toLowerCase() === normLeague);
  const filtered = filteredByLeague.filter((m) => isStrictUpcomingMatch(m, nowSec));

  const sample = filtered.slice(0, 20);
  const cfg = riskConfig(profile);
  const candidates = [];
  for (const m of sample) {
    try {
      const dRes = await fetch(`/api/matches/${encodeURIComponent(m.id)}/details`, { cache: "no-store" });
      const dData = await readJsonSafe(dRes);
      if (!dRes.ok || !dData.success) continue;
      const opt = pickOptionFromDetails(dData, profile);
      if (!opt) continue;
      const safetyScore = Number((opt.confiance - Math.abs(opt.cote - cfg.anchor) * cfg.slope).toFixed(2));
      candidates.push({
        matchId: m.id,
        teamHome: m.teamHome,
        teamAway: m.teamAway,
        league: m.league,
        pari: opt.pari,
        cote: Number(opt.cote),
        confiance: Number(opt.confiance.toFixed(1)),
        safetyScore,
      });
    } catch {}
  }

  candidates.sort((a, b) => b.safetyScore - a.safetyScore);
  const picks = candidates.slice(0, size);
  const combinedOdd = picks.length ? Number(picks.reduce((acc, x) => acc * x.cote, 1).toFixed(3)) : null;
  const averageConfidence = picks.length
    ? Number((picks.reduce((acc, x) => acc + x.confiance, 0) / picks.length).toFixed(1))
    : 0;

  return {
    success: true,
    riskProfile: profile,
    coupon: picks,
    summary: { totalSelections: picks.length, combinedOdd, averageConfidence },
    warning:
      "Mode fallback actif: coupon calcule localement car /api/coupon indisponible.",
  };
}

function setResultHtml(html) {
  const el = document.getElementById("result");
  if (el) el.innerHTML = html;
}

function updateSendButtonState() {
  const btn = document.getElementById("sendTelegramBtn");
  if (!btn) return;
  const enabled = Boolean(lastCouponData && Array.isArray(lastCouponData.coupon) && lastCouponData.coupon.length > 0);
  btn.disabled = !enabled;
}

async function loadLeagues() {
  try {
    const res = await fetch("/api/matches", { cache: "no-store" });
    const data = await readJsonSafe(res);
    if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur /api/matches");
    const select = document.getElementById("leagueSelect");
    const leagues = [...new Set((data.matches || []).map((m) => String(m.league || "").trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "fr")
    );
    leagues.forEach((league) => {
      const option = document.createElement("option");
      option.value = league;
      option.textContent = league;
      select.appendChild(option);
    });
  } catch (error) {
    setResultHtml(`<p>Erreur chargement ligues: ${error.message}</p>`);
  }
}

function renderCoupon(data) {
  lastCouponData = data;
  const picks = Array.isArray(data?.coupon) ? data.coupon : [];
  updateSendButtonState();
  if (!picks.length) {
    setResultHtml(`
      <h3>Coupon Optimise</h3>
      <p>Aucune selection disponible.</p>
      <p class="warning">${data?.warning || ""}</p>
    `);
    return;
  }

  const items = picks
    .map(
      (p, i) => `
      <li>
        <strong>${i + 1}. ${p.teamHome} vs ${p.teamAway}</strong>
        <span>Ligue: ${p.league || "Non specifiee"}</span>
        <span>${p.pari}</span>
        <span>Cote ${formatOdd(p.cote)} | Confiance ${p.confiance}%</span>
        <a href="/match.html?id=${encodeURIComponent(p.matchId)}">Voir detail match</a>
      </li>
    `
    )
    .join("");

  setResultHtml(`
    <h3>Coupon Optimise</h3>
    <div class="meta">
      <span>Selections: ${data.summary?.totalSelections ?? 0}</span>
      <span>Cote combinee: ${formatOdd(data.summary?.combinedOdd)}</span>
      <span>Confiance moyenne: ${data.summary?.averageConfidence ?? 0}%</span>
      <span>Profil: ${data.riskProfile || "balanced"}</span>
    </div>
    <ol>${items}</ol>
    <p class="warning">${data.warning || ""}</p>
  `);
  const validationPanel = document.getElementById("validation");
  if (validationPanel) {
    validationPanel.innerHTML = "<p>Ticket genere. Clique sur <strong>Valider Ticket Pro</strong>.</p>";
  }
  addHistoryEntry({
    type: "coupon",
    at: new Date().toISOString(),
    note: `${data.summary?.totalSelections ?? 0} selections | cote ${formatOdd(data.summary?.combinedOdd)} | profil ${data.riskProfile || "balanced"}`,
  });
}

function renderValidation(report) {
  let panel = document.getElementById("validation");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "validation";
    panel.className = "panel";
    const root = document.querySelector("main.page");
    if (root) root.appendChild(panel);
  }
  const statusClass = report.status === "TICKET_OK" ? "ticket-ok" : "ticket-fix";
  const statusLabel = report.status === "TICKET_OK" ? "TICKET OK" : "TICKET A CORRIGER";

  const rows = (report.validatedSelections || [])
    .map((s) => {
      const rec = s.recommendation
        ? `Suggestion: ${s.recommendation.pari} | cote ${formatOdd(s.recommendation.odd)} | conf ${s.recommendation.confidence}%`
        : "Aucune suggestion disponible";
      const drift = s.driftPercent != null ? `${s.driftPercent}%` : "-";
      return `
        <li>
          <strong>${s.teams || s.matchId}</strong><br />
          Etat: ${s.status.toUpperCase()} | Confiance: ${s.confidence}% | Drift: ${drift}<br />
          ${rec}
        </li>
      `;
    })
    .join("");

  panel.innerHTML = `
    <h3>Validation Ticket Pro</h3>
    <p><span class="ticket-status ${statusClass}">${statusLabel}</span></p>
    <div class="meta">
      <span>Total: ${report.summary?.total ?? 0}</span>
      <span>OK: ${report.summary?.ok ?? 0}</span>
      <span>A corriger: ${report.summary?.toFix ?? 0}</span>
      <span>Seuil drift: ${report.driftThresholdPercent ?? 6}%</span>
    </div>
    <ul class="validation-list">${rows || "<li>Aucune ligne de ticket</li>"}</ul>
  `;
  addHistoryEntry({
    type: "validation",
    at: new Date().toISOString(),
    note: `${statusLabel} | total ${report.summary?.total ?? 0} | a corriger ${report.summary?.toFix ?? 0}`,
  });
}

async function sendCouponToTelegram() {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant envoi Telegram.</p>";
    return;
  }

  if (panel) panel.innerHTML = "<p>Envoi Telegram en cours...</p>";

  try {
    const payload = {
      coupon: lastCouponData.coupon,
      summary: lastCouponData.summary || {},
      riskProfile: lastCouponData.riskProfile || "balanced",
    };
    const res = await fetch("/api/coupon/send-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonSafe(res);
    if (!res.ok || !data.success) {
      const rawMsg = data.error || data.message || "Erreur envoi Telegram";
      if (String(rawMsg).toLowerCase().includes("route api introuvable")) {
        throw new Error("Le serveur actif est ancien. Redemarre npm start puis recharge la page.");
      }
      throw new Error(rawMsg);
    }

    if (panel) {
      panel.innerHTML = `
        <h3>Envoi Telegram</h3>
        <p class="ticket-status ticket-ok">ENVOI REUSSI</p>
        <p>${data.message || "Coupon envoye dans ton canal Telegram."}</p>
      `;
    }
    addHistoryEntry({
      type: "telegram",
      at: new Date().toISOString(),
      note: `Coupon envoye Telegram | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
    });
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur Telegram: ${error.message}</p>`;
  }
}

async function generateCoupon() {
  const sizeInput = document.getElementById("sizeInput");
  const leagueSelect = document.getElementById("leagueSelect");
  const size = Math.max(1, Math.min(Number(sizeInput.value) || 3, 12));
  sizeInput.value = String(size);
  setResultHtml("<p>Generation du coupon en cours...</p>");

  try {
    const league = leagueSelect.value || "all";
    const risk = document.getElementById("riskSelect")?.value || "balanced";
    let data;
    try {
      const res = await fetch(
        `/api/coupon?size=${size}&league=${encodeURIComponent(league)}&risk=${encodeURIComponent(risk)}`,
        { cache: "no-store" }
      );
      data = await readJsonSafe(res);
      if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur /api/coupon");
    } catch (primaryErr) {
      data = await generateCouponFallback(size, league, risk);
      if (!data?.success) throw primaryErr;
    }
    renderCoupon(data);
  } catch (error) {
    setResultHtml(`<p>Erreur: ${error.message}</p>`);
  }
}

async function validateTicketFallback(payload) {
  const selections = Array.isArray(payload?.selections) ? payload.selections : [];
  const nowSec = Math.floor(Date.now() / 1000);
  const driftThresholdPercent = toNumber(payload?.driftThresholdPercent, 6);
  const validatedSelections = [];
  const issues = [];

  for (const sel of selections) {
    const matchId = String(sel?.matchId || "");
    try {
      const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/details`, { cache: "no-store" });
      const details = await readJsonSafe(res);
      if (!res.ok || !details.success) {
        validatedSelections.push({ matchId, status: "invalid", reasonCodes: ["MATCH_NOT_FOUND"], recommendation: null });
        issues.push({ code: "MATCH_NOT_FOUND", matchId, message: `Match ${matchId} introuvable.` });
        continue;
      }

      const match = details.match || {};
      const selectedPari = String(sel?.pari || "");
      const selectedOdd = toNumber(sel?.cote, 0);
      const market = (details.bettingMarkets || []).find((m) => String(m.nom) === selectedPari);
      const currentOdd = market ? toNumber(market.cote, 0) : 0;
      const started = !isStrictUpcomingMatch(match, nowSec);
      const driftPercent =
        selectedOdd > 0 && currentOdd > 0
          ? Number((Math.abs(((currentOdd - selectedOdd) / selectedOdd) * 100)).toFixed(2))
          : null;
      const driftExceeded = driftPercent != null && driftPercent > driftThresholdPercent;

      const recommendation = pickOptionFromDetails(details);
      const confidence = recommendation && recommendation.pari === selectedPari ? toNumber(recommendation.confiance, 0) : 50;
      const reasonCodes = [];
      if (started) reasonCodes.push("MATCH_ALREADY_STARTED");
      if (!market) reasonCodes.push("MARKET_UNAVAILABLE");
      if (driftExceeded) reasonCodes.push("ODD_DRIFT");
      if (confidence < 50) reasonCodes.push("LOW_CONFIDENCE");
      const status = reasonCodes.length ? "replace" : "ok";

      validatedSelections.push({
        matchId,
        teams: `${match.teamHome || "?"} vs ${match.teamAway || "?"}`,
        league: match.league || "",
        status,
        selected: { pari: selectedPari, odd: selectedOdd || null },
        current: { pari: market?.nom || null, odd: currentOdd || null },
        confidence: Number(confidence.toFixed(1)),
        driftPercent,
        reasonCodes,
        recommendation: recommendation
          ? {
              pari: recommendation.pari,
              odd: toNumber(recommendation.cote, 0),
              confidence: Number(toNumber(recommendation.confiance, 0).toFixed(1)),
              source: recommendation.source,
            }
          : null,
      });

      if (status !== "ok") {
        issues.push({
          code: reasonCodes[0] || "REPLACE_REQUIRED",
          matchId,
          message: `${match.teamHome || "?"} vs ${match.teamAway || "?"}: correction recommandee (${reasonCodes.join(", ")}).`,
        });
      }
    } catch {
      validatedSelections.push({ matchId, status: "invalid", reasonCodes: ["DETAILS_UNAVAILABLE"], recommendation: null });
      issues.push({ code: "DETAILS_UNAVAILABLE", matchId, message: `Impossible de verifier le match ${matchId}.` });
    }
  }

  const ok = validatedSelections.filter((x) => x.status === "ok").length;
  const toFix = validatedSelections.length - ok;
  return {
    success: true,
    validatedAt: new Date().toISOString(),
    status: toFix === 0 ? "TICKET_OK" : "TICKET_A_CORRIGER",
    driftThresholdPercent,
    summary: { total: validatedSelections.length, ok, toFix },
    issues,
    validatedSelections,
  };
}

async function validateTicket() {
  let panel = document.getElementById("validation");
  if (!panel) {
    panel = document.createElement("section");
    panel.id = "validation";
    panel.className = "panel";
    const root = document.querySelector("main.page");
    if (root) root.appendChild(panel);
  }
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    panel.innerHTML = "<p>Genere d'abord un coupon avant validation.</p>";
    return;
  }

  panel.innerHTML = "<p>Validation ticket en cours...</p>";

  try {
    const payload = {
      driftThresholdPercent: 6,
      selections: lastCouponData.coupon.map((x) => ({
        matchId: x.matchId,
        pari: x.pari,
        cote: x.cote,
      })),
    };

    let data;
    try {
      const res = await fetch("/api/coupon/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await readJsonSafe(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "Erreur validation ticket");
      }
    } catch {
      data = await validateTicketFallback(payload);
    }
    renderValidation(data);
  } catch (error) {
    panel.innerHTML = `<p>Erreur validation: ${error.message}</p>`;
  }
}

const generateBtn = document.getElementById("generateBtn");
const validateBtn = document.getElementById("validateBtn");
const sendTelegramBtn = document.getElementById("sendTelegramBtn");

if (generateBtn) generateBtn.addEventListener("click", generateCoupon);
if (validateBtn) {
  validateBtn.addEventListener("click", validateTicket);
  validateBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    validateTicket();
  });
}
if (sendTelegramBtn) {
  sendTelegramBtn.addEventListener("click", sendCouponToTelegram);
  sendTelegramBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    sendCouponToTelegram();
  });
}

loadLeagues();
renderHistory();
updateSendButtonState();
