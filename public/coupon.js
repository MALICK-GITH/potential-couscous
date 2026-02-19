function formatOdd(value) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

let lastCouponData = null;
let lastCouponBackups = new Map();
const COUPON_HISTORY_KEY = "fc25_coupon_history_v1";
const DEFAULT_TICKET_SHIELD_DRIFT = 6;
const MULTI_PROFILES = ["safe", "balanced", "aggressive"];

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

function getDriftThreshold() {
  const input = document.getElementById("driftInput");
  const n = Number(input?.value);
  if (!Number.isFinite(n)) return DEFAULT_TICKET_SHIELD_DRIFT;
  return Math.max(2, Math.min(25, n));
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

function formatMinutes(mins) {
  const m = Math.max(0, Math.floor(Number(mins) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${r}m`;
}

function computeCouponInsights(coupon = [], riskProfile = "balanced") {
  if (!Array.isArray(coupon) || !coupon.length) {
    return {
      qualityScore: 0,
      correlationRisk: 100,
      minStartMinutes: null,
      confidenceAvg: 0,
      leagueDiversity: 0,
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const confidenceAvg = coupon.reduce((acc, x) => acc + toNumber(x.confiance, 0), 0) / coupon.length;
  const leagues = new Set(coupon.map((x) => String(x.league || "").trim()).filter(Boolean));
  const leagueDiversity = (leagues.size / coupon.length) * 100;

  const sameLeaguePairs = [];
  for (let i = 0; i < coupon.length; i += 1) {
    for (let j = i + 1; j < coupon.length; j += 1) {
      if (String(coupon[i].league || "") === String(coupon[j].league || "")) sameLeaguePairs.push(1);
    }
  }
  const pairCount = (coupon.length * (coupon.length - 1)) / 2 || 1;
  const correlationRisk = Math.round((sameLeaguePairs.length / pairCount) * 100);

  const starts = coupon
    .map((x) => toNumber(x.startTimeUnix, 0))
    .filter((x) => x > nowSec)
    .map((x) => Math.floor((x - nowSec) / 60));
  const minStartMinutes = starts.length ? Math.min(...starts) : null;
  const timingScore = minStartMinutes == null ? 30 : Math.max(0, Math.min(100, minStartMinutes * 2));

  const profileBoost = riskProfile === "safe" ? 8 : riskProfile === "aggressive" ? -4 : 0;
  const rawQuality =
    confidenceAvg * 0.48 + leagueDiversity * 0.22 + timingScore * 0.2 + (100 - correlationRisk) * 0.15 + profileBoost;
  const qualityScore = Math.max(5, Math.min(99, Math.round(rawQuality)));

  return {
    qualityScore,
    correlationRisk,
    minStartMinutes,
    confidenceAvg: Number(confidenceAvg.toFixed(1)),
    leagueDiversity: Number(leagueDiversity.toFixed(1)),
  };
}

function getStakeValue() {
  const stake = Number(document.getElementById("stakeInput")?.value);
  return Number.isFinite(stake) && stake > 0 ? stake : 0;
}

function payoutFromStake(stake, odd) {
  const o = Number(odd);
  if (!(stake > 0 && Number.isFinite(o) && o > 1)) return { payout: 0, net: 0 };
  const payout = Number((stake * o).toFixed(2));
  return { payout, net: Number((payout - stake).toFixed(2)) };
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
        startTimeUnix: m.startTimeUnix,
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
  const stickyBtn = document.getElementById("sendTelegramBtnSticky");
  const pdfBtn = document.getElementById("downloadPdfBtn");
  const pdfStickyBtn = document.getElementById("downloadPdfBtnSticky");
  const enabled = Boolean(lastCouponData && Array.isArray(lastCouponData.coupon) && lastCouponData.coupon.length > 0);
  if (btn) btn.disabled = !enabled;
  if (stickyBtn) stickyBtn.disabled = !enabled;
  if (pdfBtn) pdfBtn.disabled = !enabled;
  if (pdfStickyBtn) pdfStickyBtn.disabled = !enabled;
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
  lastCouponBackups = new Map();
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

  const insights = computeCouponInsights(picks, data.riskProfile || "balanced");
  const stake = getStakeValue();
  const pay = payoutFromStake(stake, data.summary?.combinedOdd);

  setResultHtml(`
    <h3>Coupon Optimise</h3>
    <div class="meta">
      <span>Selections: ${data.summary?.totalSelections ?? 0}</span>
      <span>Cote combinee: ${formatOdd(data.summary?.combinedOdd)}</span>
      <span>Confiance moyenne: ${data.summary?.averageConfidence ?? 0}%</span>
      <span>Profil: ${data.riskProfile || "balanced"}</span>
      <span>Ticket Shield: ACTIF</span>
      <span>Qualite: ${insights.qualityScore}/100</span>
      <span>Risque correlation: ${insights.correlationRisk}%</span>
      <span>Deadline: ${insights.minStartMinutes == null ? "-" : formatMinutes(insights.minStartMinutes)}</span>
      <span>Mise ${stake.toFixed(0)} => Retour ${pay.payout.toFixed(2)} | Net ${pay.net.toFixed(2)}</span>
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

async function buildBackupPlan(coupon = [], profile = "balanced") {
  const backups = new Map();
  for (const pick of coupon) {
    try {
      const res = await fetch(`/api/matches/${encodeURIComponent(pick.matchId)}/details`, { cache: "no-store" });
      const data = await readJsonSafe(res);
      if (!res.ok || !data.success) continue;
      const markets = Array.isArray(data.bettingMarkets) ? data.bettingMarkets : [];
      const alternatives = markets
        .filter((m) => String(m.nom) !== String(pick.pari))
        .sort((a, b) => Math.abs(Number(a.cote || 0) - Number(pick.cote || 0)) - Math.abs(Number(b.cote || 0) - Number(pick.cote || 0)));
      const candidate = alternatives.find((m) => Number(m.cote) > 1.2) || null;
      if (!candidate) continue;
      backups.set(String(pick.matchId), {
        pari: candidate.nom,
        odd: Number(candidate.cote),
        confidence: Math.max(48, Number(pick.confiance || 55) - 3),
        source: `PLAN_B_${profile.toUpperCase()}`,
      });
    } catch {}
  }
  return backups;
}

async function renderMultiStrategy() {
  const panel = document.getElementById("multiResult");
  const league = document.getElementById("leagueSelect")?.value || "all";
  const size = Math.max(1, Math.min(Number(document.getElementById("sizeInput")?.value) || 3, 12));
  panel.innerHTML = "<h3>Coupon Multi-Strategie</h3><p>Generation en cours...</p>";

  const cards = [];
  for (const profile of MULTI_PROFILES) {
    try {
      let data;
      try {
        const res = await fetch(`/api/coupon?size=${size}&league=${encodeURIComponent(league)}&risk=${profile}`, {
          cache: "no-store",
        });
        data = await readJsonSafe(res);
        if (!res.ok || !data.success) throw new Error();
      } catch {
        data = await generateCouponFallback(size, league, profile);
      }
      const picks = Array.isArray(data.coupon) ? data.coupon : [];
      const insights = computeCouponInsights(picks, profile);
      cards.push(`
        <article class="risk-card">
          <h4>${profile.toUpperCase()}</h4>
          <div>Selections: ${data.summary?.totalSelections ?? picks.length}</div>
          <div>Cote: ${formatOdd(data.summary?.combinedOdd)}</div>
          <div>Confiance: ${data.summary?.averageConfidence ?? 0}%</div>
          <div>Qualite: ${insights.qualityScore}/100</div>
          <div>Deadline: ${insights.minStartMinutes == null ? "-" : formatMinutes(insights.minStartMinutes)}</div>
        </article>
      `);
    } catch {
      cards.push(`<article class="risk-card"><h4>${profile.toUpperCase()}</h4><div>Indisponible</div></article>`);
    }
  }

  panel.innerHTML = `
    <h3>Coupon Multi-Strategie</h3>
    <div class="risk-grid">${cards.join("")}</div>
  `;
}

async function fetchValidationReport(payload) {
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
  return data;
}

function createCouponSummary(coupon = []) {
  const totalSelections = coupon.length;
  const combinedOdd = totalSelections ? Number(coupon.reduce((acc, x) => acc * Number(x.cote || 1), 1).toFixed(3)) : null;
  const averageConfidence = totalSelections
    ? Number((coupon.reduce((acc, x) => acc + Number(x.confiance || 0), 0) / totalSelections).toFixed(1))
    : 0;
  return { totalSelections, combinedOdd, averageConfidence };
}

function applyAdaptiveParlay(report) {
  const original = Array.isArray(lastCouponData?.coupon) ? lastCouponData.coupon : [];
  const byMatch = new Map(original.map((x) => [String(x.matchId), x]));
  const next = [];
  const blocked = [];
  let replaced = 0;

  for (const row of report.validatedSelections || []) {
    const base = byMatch.get(String(row.matchId));
    if (!base) continue;
    const reasons = Array.isArray(row.reasonCodes) ? row.reasonCodes : [];
    const hardBlock = reasons.includes("MATCH_ALREADY_STARTED");
    if (hardBlock) {
      blocked.push(`${row.teams || row.matchId} (deja commence)`);
      continue;
    }

    if (row.status === "ok") {
      next.push(base);
      continue;
    }

    if (row.recommendation?.pari && Number.isFinite(Number(row.recommendation?.odd))) {
      replaced += 1;
      next.push({
        ...base,
        pari: row.recommendation.pari,
        cote: Number(row.recommendation.odd),
        confiance: Number(row.recommendation.confidence || row.confidence || base.confiance || 50),
      });
      continue;
    }

    blocked.push(`${row.teams || row.matchId} (pas de remplacement)`);
  }

  return { coupon: next, replaced, blocked };
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
    const deadline = computeCouponInsights(lastCouponData.coupon, lastCouponData.riskProfile).minStartMinutes;
    if (deadline != null && deadline <= 1) {
      panel.innerHTML = "<p>Envoi bloque: deadline trop proche (moins de 1 minute).</p>";
      return;
    }

    const shieldPayload = {
      driftThresholdPercent: getDriftThreshold(),
      selections: lastCouponData.coupon.map((x) => ({
        matchId: x.matchId,
        pari: x.pari,
        cote: x.cote,
      })),
    };
    const shieldReport = await fetchValidationReport(shieldPayload);
    if (!lastCouponBackups.size) {
      lastCouponBackups = await buildBackupPlan(lastCouponData.coupon, lastCouponData.riskProfile || "balanced");
    }
    const adapted = applyAdaptiveParlay(shieldReport);
    if (adapted.blocked.length > 0) {
      const blockList = adapted.blocked.map((x) => `<li>${x}</li>`).join("");
      panel.innerHTML = `
        <h3>Ticket Shield IA</h3>
        <p class="ticket-status ticket-fix">ENVOI BLOQUE</p>
        <p>Ces selections sont invalides pour envoi:</p>
        <ul class="validation-list">${blockList}</ul>
      `;
      return;
    }

    if (adapted.replaced > 0) {
      adapted.coupon = adapted.coupon.map((x) => {
        const b = lastCouponBackups.get(String(x.matchId));
        return b && String(x.pari) === String(lastCouponData?.coupon?.find((c) => String(c.matchId) === String(x.matchId))?.pari)
          ? { ...x, pari: b.pari, cote: b.odd, confiance: b.confidence, source: b.source }
          : x;
      });
      lastCouponData = {
        ...lastCouponData,
        coupon: adapted.coupon,
        summary: createCouponSummary(adapted.coupon),
        warning: `Parlay adaptatif: ${adapted.replaced} selection(s) remplacee(s) par Ticket Shield.`,
      };
      renderCoupon(lastCouponData);
    }

    const payload = {
      coupon: lastCouponData.coupon,
      summary: lastCouponData.summary || {},
      riskProfile: lastCouponData.riskProfile || "balanced",
      ticketShield: {
        driftThresholdPercent: getDriftThreshold(),
        replacedSelections: adapted.replaced,
      },
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
        <p>${data.message || "Coupon envoye sur Telegram."}</p>
        <p>Ticket Shield IA: drift ${getDriftThreshold()}% | Remplacements: ${adapted.replaced}</p>
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

async function downloadCouponPdf() {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant PDF.</p>";
    return;
  }
  try {
    const res = await fetch("/api/coupon/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coupon: lastCouponData.coupon,
        summary: lastCouponData.summary || {},
        riskProfile: lastCouponData.riskProfile || "balanced",
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coupon-fc25-${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (panel) panel.innerHTML = "<p>PDF coupon telecharge avec succes.</p>";
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur PDF: ${error.message}</p>`;
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
    lastCouponBackups = await buildBackupPlan(Array.isArray(data?.coupon) ? data.coupon : [], risk);
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
      driftThresholdPercent: getDriftThreshold(),
      selections: lastCouponData.coupon.map((x) => ({
        matchId: x.matchId,
        pari: x.pari,
        cote: x.cote,
      })),
    };

    const data = await fetchValidationReport(payload);
    renderValidation(data);
  } catch (error) {
    panel.innerHTML = `<p>Erreur validation: ${error.message}</p>`;
  }
}

const generateBtn = document.getElementById("generateBtn");
const generateMultiBtn = document.getElementById("generateMultiBtn");
const validateBtn = document.getElementById("validateBtn");
const sendTelegramBtn = document.getElementById("sendTelegramBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const generateBtnSticky = document.getElementById("generateBtnSticky");
const validateBtnSticky = document.getElementById("validateBtnSticky");
const sendTelegramBtnSticky = document.getElementById("sendTelegramBtnSticky");
const downloadPdfBtnSticky = document.getElementById("downloadPdfBtnSticky");

if (generateBtn) generateBtn.addEventListener("click", generateCoupon);
if (generateMultiBtn) generateMultiBtn.addEventListener("click", renderMultiStrategy);
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
if (generateBtnSticky) {
  generateBtnSticky.addEventListener("click", generateCoupon);
}
if (validateBtnSticky) {
  validateBtnSticky.addEventListener("click", validateTicket);
}
if (sendTelegramBtnSticky) {
  sendTelegramBtnSticky.addEventListener("click", sendCouponToTelegram);
}
if (downloadPdfBtn) {
  downloadPdfBtn.addEventListener("click", downloadCouponPdf);
}
if (downloadPdfBtnSticky) {
  downloadPdfBtnSticky.addEventListener("click", downloadCouponPdf);
}

loadLeagues();
renderHistory();
updateSendButtonState();
const stakeInput = document.getElementById("stakeInput");
if (stakeInput) {
  stakeInput.addEventListener("input", () => {
    if (lastCouponData) renderCoupon(lastCouponData);
  });
}
