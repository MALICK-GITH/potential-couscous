function formatOdd(value) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

let lastCouponData = null;
let lastCouponBackups = new Map();
let lastLadderData = null;
const COUPON_HISTORY_KEY = "fc25_coupon_history_v1";
const DEFAULT_TICKET_SHIELD_DRIFT = 6;
const MULTI_PROFILES = ["safe", "balanced", "aggressive"];
const LADDER_PROFILES = [
  { key: "safe", weight: 0.6, label: "SAFE" },
  { key: "balanced", weight: 0.3, label: "BALANCED" },
  { key: "aggressive", weight: 0.1, label: "AGGRESSIVE" },
];
const AUTO_COUPON_STORAGE_KEY = "fc25_auto_coupon_v1";
const PAGE_REFRESH_COUPON_STORAGE_KEY = "fc25_coupon_refresh_minutes_v1";
const PERFORMANCE_LOG_KEY = "fc25_performance_log_v1";
const DEFAULT_PAGE_REFRESH_MINUTES = 5;
let pageRefreshCouponIntervalId = null;
const stabilityCache = new Map();

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatDateTime(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

function getStartAlertThresholdMinutes() {
  const input = document.getElementById("startAlertInput");
  const n = Number(input?.value);
  if (!Number.isFinite(n)) return 8;
  return Math.max(1, Math.min(30, n));
}

function getPageRefreshMinutesCoupon() {
  const stored = Number(localStorage.getItem(PAGE_REFRESH_COUPON_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_PAGE_REFRESH_MINUTES;
  return Math.max(1, Math.min(60, stored));
}

function setPageRefreshMinutesCoupon(value) {
  const safe = Math.max(1, Math.min(60, Number(value) || DEFAULT_PAGE_REFRESH_MINUTES));
  localStorage.setItem(PAGE_REFRESH_COUPON_STORAGE_KEY, String(safe));
  return safe;
}

function startCouponPageRefreshTimer(minutes) {
  if (pageRefreshCouponIntervalId) {
    clearInterval(pageRefreshCouponIntervalId);
    pageRefreshCouponIntervalId = null;
  }
  const ms = Math.max(1, Number(minutes) || DEFAULT_PAGE_REFRESH_MINUTES) * 60 * 1000;
  pageRefreshCouponIntervalId = setInterval(() => {
    window.location.reload();
  }, ms);
}

function isAutoCouponEnabled() {
  return localStorage.getItem(AUTO_COUPON_STORAGE_KEY) === "1";
}

function setAutoCouponEnabled(value) {
  localStorage.setItem(AUTO_COUPON_STORAGE_KEY, value ? "1" : "0");
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

function explainPickSimple(pick, riskProfile = "balanced") {
  const conf = Number(pick?.confiance || 0);
  const odd = Number(pick?.cote || 0);
  const startMin = Math.max(0, Math.floor((Number(pick?.startTimeUnix || 0) - Math.floor(Date.now() / 1000)) / 60));
  const riskText = conf >= 75 ? "profil stable" : conf >= 60 ? "profil moyen" : "profil volatil";
  const oddText = odd >= 2.3 ? "cote agressive" : odd >= 1.7 ? "cote equilibree" : "cote prudente";
  return `Coach IA: ${riskText}, ${oddText}, depart ${startMin} min, mode ${riskProfile}.`;
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
        <strong>${i + 1}. ${
          x.type === "validation"
            ? "Validation"
            : x.type === "telegram"
            ? "Telegram"
            : x.type === "pdf"
            ? "PDF"
            : "Coupon"
        } - ${new Date(x.at).toLocaleString("fr-FR")}</strong>
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
  const packBtn = document.getElementById("sendPackBtn");
  const ladderTgBtn = document.getElementById("sendLadderTelegramBtn");
  const imageTelegramBtn = document.getElementById("sendTelegramImageBtn");
  const printBtn = document.getElementById("printA4Btn");
  const stickyBtn = document.getElementById("sendTelegramBtnSticky");
  const stickyImageBtn = document.getElementById("sendTelegramImageBtnSticky");
  const replaceWeakBtn = document.getElementById("replaceWeakBtn");
  const imageBtn = document.getElementById("downloadImageBtn");
  const storyBtn = document.getElementById("downloadStoryBtn");
  const pdfQuickBtn = document.getElementById("downloadPdfQuickBtn");
  const pdfBtn = document.getElementById("downloadPdfBtn");
  const pdfDetailedBtn = document.getElementById("downloadPdfDetailedBtn");
  const pdfStickyBtn = document.getElementById("downloadPdfBtnSticky");
  const simulateBtn = document.getElementById("simulateBankrollBtn");
  const enabled = Boolean(lastCouponData && Array.isArray(lastCouponData.coupon) && lastCouponData.coupon.length > 0);
  if (btn) btn.disabled = !enabled;
  if (packBtn) packBtn.disabled = !enabled;
  if (ladderTgBtn) ladderTgBtn.disabled = !(lastLadderData && Array.isArray(lastLadderData.items) && lastLadderData.items.length > 0);
  if (imageTelegramBtn) imageTelegramBtn.disabled = !enabled;
  if (printBtn) printBtn.disabled = !enabled;
  if (stickyBtn) stickyBtn.disabled = !enabled;
  if (stickyImageBtn) stickyImageBtn.disabled = !enabled;
  if (replaceWeakBtn) replaceWeakBtn.disabled = !enabled;
  if (imageBtn) imageBtn.disabled = !enabled;
  if (storyBtn) storyBtn.disabled = !enabled;
  if (pdfQuickBtn) pdfQuickBtn.disabled = !enabled;
  if (pdfBtn) pdfBtn.disabled = !enabled;
  if (pdfDetailedBtn) pdfDetailedBtn.disabled = !enabled;
  if (pdfStickyBtn) pdfStickyBtn.disabled = !enabled;
  if (simulateBtn) simulateBtn.disabled = !enabled;
}

function renderLadderPanel(data) {
  const panel = document.getElementById("ladderPanel");
  if (!panel) return;
  if (!data || !Array.isArray(data.items) || !data.items.length) {
    panel.innerHTML = "<h3>Coupon Ladder IA</h3><p>Aucun ladder genere.</p>";
    return;
  }
  const cards = data.items
    .map((it, idx) => {
      const summary = it.summary || {};
      const picks = Array.isArray(it.coupon) ? it.coupon : [];
      const preview = picks
        .slice(0, 3)
        .map((p) => `${p.teamHome} vs ${p.teamAway} | ${p.pari} (${formatOdd(p.cote)})`)
        .join("<br />");
      return `
        <article class="risk-card">
          <h4>${idx + 1}. ${it.label}</h4>
          <div>Mise: ${it.stake.toFixed(0)}</div>
          <div>Selections: ${summary.totalSelections ?? picks.length}</div>
          <div>Cote: ${formatOdd(summary.combinedOdd)}</div>
          <div>Confiance: ${summary.averageConfidence ?? 0}%</div>
          <div>${preview || "Aucun pick"}</div>
        </article>
      `;
    })
    .join("");
  panel.innerHTML = `
    <h3>Coupon Ladder IA</h3>
    <p>Repartition automatique 60/30/10 active.</p>
    <div class="risk-grid">${cards}</div>
  `;
}

async function generateLadderCoupons() {
  const panel = document.getElementById("ladderPanel");
  const league = document.getElementById("leagueSelect")?.value || "all";
  const size = Math.max(1, Math.min(Number(document.getElementById("sizeInput")?.value) || 3, 12));
  const totalStake = getStakeValue();
  if (panel) panel.innerHTML = "<h3>Coupon Ladder IA</h3><p>Generation en cours...</p>";
  const items = [];
  for (const profile of LADDER_PROFILES) {
    let data;
    try {
      const res = await fetch(`/api/coupon?size=${size}&league=${encodeURIComponent(league)}&risk=${profile.key}`, {
        cache: "no-store",
      });
      data = await readJsonSafe(res);
      if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur API coupon");
    } catch {
      data = await generateCouponFallback(size, league, profile.key);
    }
    const stake = Number((totalStake * profile.weight).toFixed(2));
    items.push({
      profile: profile.key,
      label: profile.label,
      weight: profile.weight,
      stake,
      coupon: Array.isArray(data.coupon) ? data.coupon : [],
      summary: data.summary || createCouponSummary(Array.isArray(data.coupon) ? data.coupon : []),
    });
  }
  lastLadderData = {
    at: new Date().toISOString(),
    totalStake,
    items,
  };
  renderLadderPanel(lastLadderData);
  updateSendButtonState();
}

async function sendLadderToTelegram() {
  const panel = document.getElementById("validation");
  if (!lastLadderData || !Array.isArray(lastLadderData.items) || !lastLadderData.items.length) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un Ladder avant envoi Telegram.</p>";
    return;
  }
  if (panel) panel.innerHTML = "<p>Envoi Ladder vers Telegram...</p>";
  try {
    await refreshLadderBeforeTelegram();
    const res = await fetch("/api/coupon/ladder/send-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastLadderData),
    });
    const data = await readJsonSafe(res);
    if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || "Erreur envoi Ladder Telegram");
    if (panel) panel.innerHTML = `<p class="ticket-status ticket-ok">${data.message || "Ladder envoye sur Telegram."}</p>`;
    addHistoryEntry({
      type: "telegram",
      at: new Date().toISOString(),
      note: `Ladder Telegram envoye (${lastLadderData.items.length} tickets)`,
    });
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur Ladder Telegram: ${error.message}</p>`;
  }
}

function readPerformanceLog() {
  try {
    const raw = localStorage.getItem(PERFORMANCE_LOG_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePerformanceLog(items) {
  localStorage.setItem(PERFORMANCE_LOG_KEY, JSON.stringify(items.slice(0, 600)));
}

function oddsBucket(odd) {
  const o = Number(odd);
  if (!Number.isFinite(o) || o <= 0) return "unknown";
  if (o < 2) return "1.00-1.99";
  if (o < 2.2) return "2.00-2.19";
  if (o < 3) return "2.20-2.99";
  return "3.00+";
}

function classifyOptionType(pari = "") {
  const t = normalizeText(pari);
  if (t.includes("handicap")) return "handicap";
  if (t.includes("double chance") || t.includes("1x") || t.includes("x2")) return "double_chance";
  if (t.includes("plus de") || t.includes("over")) return "over";
  if (t.includes("moins de") || t.includes("under")) return "under";
  if (t.includes("v1") || t.includes("v2") || t.includes("nul") || t.includes("1x2")) return "1x2";
  return "autre";
}

function addPerformanceFromValidation(report) {
  if (!report || !Array.isArray(report.validatedSelections) || !lastCouponData?.coupon?.length) return;
  const now = new Date().toISOString();
  const byMatch = new Map(lastCouponData.coupon.map((p) => [String(p.matchId), p]));
  const prev = readPerformanceLog();
  const next = [];
  for (const row of report.validatedSelections) {
    const pick = byMatch.get(String(row.matchId));
    if (!pick) continue;
    const ok = String(row.status || "") === "ok";
    next.push({
      at: now,
      league: pick.league || row.league || "Inconnue",
      optionType: classifyOptionType(pick.pari),
      odd: Number(pick.cote) || 0,
      quality: ok ? 1 : 0,
      riskProfile: lastCouponData.riskProfile || "balanced",
    });
  }
  if (!next.length) return;
  writePerformanceLog([...next, ...prev]);
}

function aggregatePerformance(entries, keyName) {
  const map = new Map();
  for (const e of entries) {
    const key = String(e?.[keyName] || "Inconnu");
    if (!map.has(key)) map.set(key, { key, n: 0, q: 0 });
    const cur = map.get(key);
    cur.n += 1;
    cur.q += Number(e.quality) || 0;
  }
  return [...map.values()]
    .map((x) => ({
      key: x.key,
      count: x.n,
      score: Number(((x.q / Math.max(1, x.n)) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count);
}

function renderPerformanceJournal() {
  const panel = document.getElementById("performancePanel");
  if (!panel) return;
  const entries = readPerformanceLog();
  if (!entries.length) {
    panel.innerHTML = "<h3>Journal Performance</h3><p>Aucune donnee pour le moment.</p>";
    return;
  }
  const byLeague = aggregatePerformance(entries, "league").slice(0, 5);
  const byType = aggregatePerformance(entries, "optionType").slice(0, 5);
  const byProfile = aggregatePerformance(entries, "riskProfile");

  const withBucket = entries.map((x) => ({ ...x, oddBucket: oddsBucket(x.odd) }));
  const byOddBucket = aggregatePerformance(withBucket, "oddBucket").slice(0, 4);
  const bestProfile = byProfile[0]?.key || "balanced";

  const toLines = (arr, label) =>
    arr
      .map((x, i) => `<li><strong>${i + 1}. ${x.key}</strong> | ${label}: ${x.score}% | Volume: ${x.count}</li>`)
      .join("");

  panel.innerHTML = `
    <h3>Journal Performance</h3>
    <div class="meta">
      <span>Observations: ${entries.length}</span>
      <span>Profil recommande: ${bestProfile.toUpperCase()}</span>
    </div>
    <p><strong>Par ligue</strong></p>
    <ul class="validation-list">${toLines(byLeague, "Score qualite") || "<li>Aucune donnee</li>"}</ul>
    <p><strong>Par type de pari</strong></p>
    <ul class="validation-list">${toLines(byType, "Score qualite") || "<li>Aucune donnee</li>"}</ul>
    <p><strong>Par tranche de cote</strong></p>
    <ul class="validation-list">${toLines(byOddBucket, "Score qualite") || "<li>Aucune donnee</li>"}</ul>
  `;

  const riskSelect = document.getElementById("riskSelect");
  if (riskSelect && entries.length >= 8 && MULTI_PROFILES.includes(bestProfile)) {
    riskSelect.value = bestProfile;
  }
}

async function openPrintA4Mode() {
  const panel = document.getElementById("validation");
  if (!lastCouponData?.coupon?.length) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon.</p>";
    return;
  }
  try {
    const res = await fetch("/api/coupon/print-a4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coupon: lastCouponData.coupon,
        summary: lastCouponData.summary || {},
        riskProfile: lastCouponData.riskProfile || "balanced",
      }),
    });
    const html = await res.text();
    if (!res.ok) throw new Error(html || `HTTP ${res.status}`);
    const w = window.open("", "_blank");
    if (!w) throw new Error("Popup bloquee: autorise les popups pour l'impression.");
    w.document.open();
    w.document.write(html);
    w.document.close();
    if (panel) panel.innerHTML = "<p>Mode imprimable A4 ouvert. Lance l'impression.</p>";
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur impression A4: ${error.message}</p>`;
  }
}

async function sendCouponPackToTelegram() {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant envoi groupe.</p>";
    return;
  }

  if (panel) panel.innerHTML = "<p>Envoi groupe en cours (texte + image + PDF)...</p>";

  try {
    await replaceStartedSelectionsBeforeTelegram();
    await maybeStartAlertAndReplace();
    const adapted = await enforceTicketShield("envoi groupe Telegram");
    const payload = {
      coupon: lastCouponData.coupon,
      summary: lastCouponData.summary || {},
      riskProfile: lastCouponData.riskProfile || "balanced",
      imageFormat: "png",
      ticketShield: {
        driftThresholdPercent: getDriftThreshold(),
        replacedSelections: adapted.replaced,
      },
    };
    const res = await fetch("/api/coupon/send-telegram-pack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonSafe(res);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || data?.message || "Erreur envoi groupe Telegram");
    }
    if (panel) {
      panel.innerHTML = `
        <h3>Envoi Groupe Telegram</h3>
        <p class="ticket-status ticket-ok">ENVOI REUSSI</p>
        <p>${data.message || "Pack envoye."}</p>
        <p>Ticket Shield IA: drift ${getDriftThreshold()}% | Remplacements: ${adapted.replaced}</p>
      `;
    }
    addHistoryEntry({
      type: "telegram",
      at: new Date().toISOString(),
      note: `Pack Telegram envoye (texte+image+PDF) | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
    });
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur pack Telegram: ${error.message}</p>`;
  }
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

function computeMatchStability(pick, details) {
  const markets = Array.isArray(details?.bettingMarkets) ? details.bettingMarkets : [];
  const selected = markets.find((m) => String(m.nom || "") === String(pick?.pari || ""));
  const selectedOdd = toNumber(pick?.cote, 0);
  const liveOdd = toNumber(selected?.cote, selectedOdd);
  const driftPct = selectedOdd > 0 ? Math.abs(((liveOdd - selectedOdd) / selectedOdd) * 100) : 0;

  const odds1x2 = details?.match?.odds1x2 || {};
  const baseOdds = [toNumber(odds1x2.home, 0), toNumber(odds1x2.draw, 0), toNumber(odds1x2.away, 0)].filter((x) => x > 0);
  const spread = baseOdds.length ? Math.max(...baseOdds) - Math.min(...baseOdds) : 0.8;

  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = toNumber(pick?.startTimeUnix, 0);
  const minutesToStart = startSec > nowSec ? Math.floor((startSec - nowSec) / 60) : 0;

  const volatilityScore = clamp(100 - driftPct * 9 - spread * 10, 0, 100);
  const timeScore = clamp(minutesToStart * 2.2, 0, 100);
  const liquidityScore = clamp((markets.length / 120) * 100, 8, 100);
  const stability = Math.round(volatilityScore * 0.45 + timeScore * 0.35 + liquidityScore * 0.2);

  return {
    stability,
    driftPct: Number(driftPct.toFixed(2)),
    marketCount: markets.length,
    minutesToStart,
  };
}

async function hydrateCouponStability(picks = []) {
  if (!Array.isArray(picks) || !picks.length) return;
  for (const pick of picks) {
    const id = String(pick.matchId || "");
    if (!id) continue;
    const host = document.getElementById(`stability-${id}`);
    try {
      let data = stabilityCache.get(id);
      if (!data) {
        const res = await fetch(`/api/matches/${encodeURIComponent(id)}/details`, { cache: "no-store" });
        const details = await readJsonSafe(res);
        if (!res.ok || !details?.success) throw new Error("details indisponibles");
        data = computeMatchStability(pick, details);
        stabilityCache.set(id, data);
      }
      if (host) {
        host.textContent = `Stabilite ${data.stability}/100 | Drift ${data.driftPct}% | Marches ${data.marketCount}`;
      }
      pick.stabilityScore = data.stability;
    } catch {
      if (host) host.textContent = "Stabilite: indisponible";
    }
  }
}

async function replaceStartedSelectionsBeforeTelegram() {
  if (!lastCouponData?.coupon?.length) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const started = lastCouponData.coupon.filter((x) => !isStrictUpcomingMatch(x, nowSec));
  if (!started.length) return;

  const needed = started.length;
  const risk = lastCouponData.riskProfile || "balanced";
  const league = document.getElementById("leagueSelect")?.value || "all";
  let data;
  try {
    const res = await fetch(`/api/coupon?size=${needed + 2}&league=${encodeURIComponent(league)}&risk=${encodeURIComponent(risk)}`, {
      cache: "no-store",
    });
    data = await readJsonSafe(res);
    if (!res.ok || !data?.success) throw new Error("api indisponible");
  } catch {
    data = await generateCouponFallback(needed + 2, league, risk);
  }
  const fresh = (Array.isArray(data?.coupon) ? data.coupon : []).filter((x) => isStrictUpcomingMatch(x, nowSec));
  const existingIds = new Set(lastCouponData.coupon.map((x) => String(x.matchId)));
  const replacements = fresh.filter((x) => !existingIds.has(String(x.matchId))).slice(0, needed);
  if (replacements.length < needed) {
    throw new Error("Impossible de remplacer tous les matchs deja en live.");
  }

  let idx = 0;
  const updated = lastCouponData.coupon.map((x) => {
    if (isStrictUpcomingMatch(x, nowSec)) return x;
    const next = replacements[idx];
    idx += 1;
    return next;
  });
  lastCouponData = {
    ...lastCouponData,
    coupon: updated,
    summary: createCouponSummary(updated),
    warning: `${needed} match(s) live remplace(s) automatiquement avant envoi Telegram.`,
  };
  renderCoupon(lastCouponData);
}

async function refreshLadderBeforeTelegram() {
  if (!lastLadderData?.items?.length) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const league = document.getElementById("leagueSelect")?.value || "all";
  const items = [];
  for (const item of lastLadderData.items) {
    const coupon = Array.isArray(item?.coupon) ? item.coupon : [];
    const hasStarted = coupon.some((x) => !isStrictUpcomingMatch(x, nowSec));
    if (!hasStarted) {
      items.push(item);
      continue;
    }
    let data;
    try {
      const res = await fetch(
        `/api/coupon?size=${Math.max(1, coupon.length)}&league=${encodeURIComponent(league)}&risk=${encodeURIComponent(item.profile || "balanced")}`,
        { cache: "no-store" }
      );
      data = await readJsonSafe(res);
      if (!res.ok || !data?.success) throw new Error("api indisponible");
    } catch {
      data = await generateCouponFallback(Math.max(1, coupon.length), league, item.profile || "balanced");
    }
    items.push({
      ...item,
      coupon: Array.isArray(data?.coupon) ? data.coupon : coupon,
      summary: data?.summary || createCouponSummary(Array.isArray(data?.coupon) ? data.coupon : coupon),
    });
  }
  lastLadderData = { ...lastLadderData, items };
  renderLadderPanel(lastLadderData);
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
        <div class="confidence-track"><i style="width:${Math.max(4, Math.min(100, Number(p.confiance) || 0))}%"></i><em>${Number(
          p.confiance || 0
        ).toFixed(0)}%</em></div>
        <span class="stability-badge" id="stability-${String(p.matchId)}">Stabilite: calcul...</span>
        <div class="coach-pick-line">${explainPickSimple(p, data.riskProfile || "balanced")}</div>
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
    ${
      insights.correlationRisk >= 55
        ? `<p class="correlation-alert">Alerte correlation: ${insights.correlationRisk}% (plusieurs picks proches). Utilise "Remplacer Pick Faible" avant validation.</p>`
        : ""
    }
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
  hydrateCouponStability(picks).then(() => {
    const values = picks.map((x) => Number(x.stabilityScore)).filter((x) => Number.isFinite(x));
    if (!values.length) return;
    const avg = Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
    const meta = document.querySelector("#result .meta");
    if (!meta) return;
    const exists = [...meta.querySelectorAll("span")].some((x) => String(x.textContent || "").includes("Stabilite moyenne"));
    if (exists) return;
    const span = document.createElement("span");
    span.textContent = `Stabilite moyenne: ${avg}/100`;
    meta.appendChild(span);
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
  const stake = getStakeValue();
  panel.innerHTML = "<h3>Coupon Multi-Strategie</h3><p>Generation en cours...</p>";

  const cards = [];
  const ranking = [];
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
      const odd = Number(data.summary?.combinedOdd || 1);
      const p = clamp(Number(data.summary?.averageConfidence || 0) / 100, 0.03, 0.97);
      const expectedNet = Number((stake * (odd * p - 1)).toFixed(2));
      const riskIndex = clamp(Math.round((100 - insights.qualityScore) * 0.55 + insights.correlationRisk * 0.45), 1, 99);
      ranking.push({ profile, expectedNet, riskIndex, quality: insights.qualityScore });
      cards.push(`
        <article class="risk-card">
          <h4>${profile.toUpperCase()}</h4>
          <div>Selections: ${data.summary?.totalSelections ?? picks.length}</div>
          <div>Cote: ${formatOdd(data.summary?.combinedOdd)}</div>
          <div>Confiance: ${data.summary?.averageConfidence ?? 0}%</div>
          <div>Qualite: ${insights.qualityScore}/100</div>
          <div>Gain attendu (net): ${expectedNet.toFixed(2)}</div>
          <div>Indice risque: ${riskIndex}/100</div>
          <div>Deadline: ${insights.minStartMinutes == null ? "-" : formatMinutes(insights.minStartMinutes)}</div>
        </article>
      `);
    } catch {
      cards.push(`<article class="risk-card"><h4>${profile.toUpperCase()}</h4><div>Indisponible</div></article>`);
    }
  }

  ranking.sort((a, b) => b.quality - a.quality || b.expectedNet - a.expectedNet);
  const top = ranking[0];

  panel.innerHTML = `
    <h3>Coupon Multi-Strategie</h3>
    ${
      top
        ? `<p>Comparateur: meilleur compromis actuel <strong>${top.profile.toUpperCase()}</strong> (qualite ${top.quality}/100, risque ${top.riskIndex}/100).</p>`
        : ""
    }
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

async function sendCouponToTelegram(sendImage = false) {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant envoi Telegram.</p>";
    return;
  }

  if (panel) panel.innerHTML = `<p>Envoi Telegram ${sendImage ? "image" : "texte"} en cours...</p>`;

  try {
    await replaceStartedSelectionsBeforeTelegram();
    await maybeStartAlertAndReplace();
    const adapted = await enforceTicketShield("envoi Telegram");

    const payload = {
      coupon: lastCouponData.coupon,
      summary: lastCouponData.summary || {},
      riskProfile: lastCouponData.riskProfile || "balanced",
      sendImage,
      imageFormat: sendImage ? "png" : "png",
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
        <p>${data.message || `Coupon ${sendImage ? "image" : "texte"} envoye sur Telegram.`}</p>
        <p>Ticket Shield IA: drift ${getDriftThreshold()}% | Remplacements: ${adapted.replaced}</p>
      `;
    }
    addHistoryEntry({
      type: "telegram",
      at: new Date().toISOString(),
      note: `Coupon ${sendImage ? "image" : "texte"} envoye Telegram | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
    });
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur Telegram: ${error.message}</p>`;
  }
}

async function fetchCouponPdfBlob(mode = "summary") {
  const insights = computeCouponInsights(lastCouponData?.coupon || [], lastCouponData?.riskProfile || "balanced");
  const backupPlan = [...(lastCouponBackups || new Map()).entries()].map(([matchId, b]) => ({
    matchId,
    pari: b?.pari || "-",
    cote: Number(b?.odd || 0),
    confiance: Number(b?.confidence || 0),
    source: b?.source || "PLAN_B",
  }));
  const payload = {
    coupon: lastCouponData.coupon,
    summary: lastCouponData.summary || {},
    riskProfile: lastCouponData.riskProfile || "balanced",
    insights,
    backupPlan,
    mode,
  };
  const endpoints =
    mode === "detailed"
      ? ["/api/coupon/pdf/detailed", "/api/coupon/pdf", "/api/pdf/coupon", "/api/download/coupon"]
      : mode === "quick"
      ? ["/api/coupon/pdf/quick", "/api/coupon/pdf/summary", "/api/coupon/pdf", "/api/pdf/coupon", "/api/download/coupon"]
      : ["/api/coupon/pdf/summary", "/api/coupon/pdf", "/api/pdf/coupon", "/api/download/coupon"];
  let blob = null;
  let lastErr = "Erreur PDF";
  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      blob = await res.blob();
      break;
    }
    const text = await res.text();
    if (String(text).includes("Route API introuvable")) {
      lastErr = "Serveur ancien actif. Redemarre npm start puis recharge la page.";
    } else {
      lastErr = text || `HTTP ${res.status}`;
    }
  }
  if (!blob) throw new Error(lastErr);
  return blob;
}

async function downloadCouponPdf(mode = "summary") {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant PDF.</p>";
    return;
  }
  try {
    await enforceTicketShield("export PDF");
    const blob = await fetchCouponPdfBlob(mode);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = mode === "detailed" ? "detail" : mode === "quick" ? "rapide" : "resume";
    a.download = `coupon-fc25-${suffix}-${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    const label = mode === "detailed" ? "detaille" : mode === "quick" ? "ultra-court" : "resume";
    if (panel) panel.innerHTML = `<p>PDF ${label} telecharge avec succes.</p>`;
    addHistoryEntry({
      type: "pdf",
      at: new Date().toISOString(),
      note: `Export PDF ${label} | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
    });
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur PDF: ${error.message}</p>`;
  }
}

async function downloadCouponPdfPack() {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant PDF.</p>";
    return;
  }
  try {
    await downloadCouponPdf("summary");
    setTimeout(() => {
      downloadCouponPdf("detailed");
    }, 550);
    if (panel) panel.innerHTML = "<p>Pack Multi-PDF lance: resume + detaille.</p>";
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur PDF pack: ${error.message}</p>`;
  }
}

async function fetchCouponImageBlob(mode = "default", format = "png") {
  const insights = computeCouponInsights(lastCouponData?.coupon || [], lastCouponData?.riskProfile || "balanced");
  const safeFormat = String(format || "").toLowerCase() === "jpg" ? "jpg" : "png";
  const payload = {
    coupon: lastCouponData.coupon,
    summary: lastCouponData.summary || {},
    riskProfile: lastCouponData.riskProfile || "balanced",
    insights,
    mode,
    format: safeFormat,
  };
  const endpoints = mode === "story" ? ["/api/coupon/image/story", "/api/coupon/image"] : ["/api/coupon/image"];
  let blob = null;
  let lastErr = "Erreur image coupon";
  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      blob = await res.blob();
      break;
    }
    const text = await res.text();
    lastErr = text || `HTTP ${res.status}`;
  }
  if (!blob) throw new Error(lastErr);
  return blob;
}

async function downloadCouponImage(mode = "default") {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant image.</p>";
    return;
  }
  try {
    await enforceTicketShield(mode === "story" ? "export story" : "export image");
    const format = mode === "story" ? "jpg" : "png";
    const blob = await fetchCouponImageBlob(mode, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coupon-fc25-${mode === "story" ? "story" : "image"}-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (panel) {
      panel.innerHTML = `<p>${mode === "story" ? "Snap Story" : "Image coupon"} telecharge${mode === "story" ? "" : "e"}.</p><div class="coupon-image-preview"><img src="${url}" alt="Apercu coupon image"/></div>`;
    }
    addHistoryEntry({
      type: "pdf",
      at: new Date().toISOString(),
      note: `Export ${mode === "story" ? "snap story" : "image coupon"} | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
    });
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur image: ${error.message}</p>`;
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

async function enforceTicketShield(actionLabel = "action") {
  const deadline = computeCouponInsights(lastCouponData.coupon, lastCouponData.riskProfile).minStartMinutes;
  if (deadline != null && deadline <= 1) {
    throw new Error(`${actionLabel} bloque: deadline trop proche (moins de 1 minute).`);
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
    throw new Error(`Ticket Shield bloque ${actionLabel}: ${adapted.blocked.join(" | ")}`);
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
  return adapted;
}

async function maybeStartAlertAndReplace() {
  if (!lastCouponData?.coupon?.length) return;
  const threshold = getStartAlertThresholdMinutes();
  const insights = computeCouponInsights(lastCouponData.coupon, lastCouponData.riskProfile || "balanced");
  const minStart = Number(insights?.minStartMinutes);
  if (!Number.isFinite(minStart) || minStart > threshold) return;
  const wantsReplace = window.confirm(
    `Alerte intelligente: un match demarre dans ${Math.max(0, Math.floor(minStart))} min. Veux-tu remplacer le pick le plus faible maintenant ?`
  );
  if (wantsReplace) {
    await replaceWeakSelection();
  }
}

function runBankrollSimulationCore({ bankrollStart, stake, odd, winProbability, rounds = 30, trials = 1000 }) {
  const start = Math.max(0, Number(bankrollStart) || 0);
  const s = Math.max(1, Number(stake) || 1);
  const o = Math.max(1.01, Number(odd) || 1.01);
  const p = Math.max(0.02, Math.min(0.98, Number(winProbability) || 0.5));
  const finalBankrolls = [];
  let ruinCount = 0;

  for (let t = 0; t < trials; t += 1) {
    let bank = start;
    for (let r = 0; r < rounds; r += 1) {
      const bet = Math.min(s, bank);
      if (bet <= 0) break;
      const win = Math.random() < p;
      bank = win ? bank + bet * (o - 1) : bank - bet;
    }
    if (bank <= 0) ruinCount += 1;
    finalBankrolls.push(bank);
  }

  finalBankrolls.sort((a, b) => a - b);
  const idx = (ratio) => finalBankrolls[Math.max(0, Math.min(finalBankrolls.length - 1, Math.floor(finalBankrolls.length * ratio)))];
  return {
    ruinProbability: Number(((ruinCount / trials) * 100).toFixed(1)),
    median: Number(idx(0.5).toFixed(2)),
    p10: Number(idx(0.1).toFixed(2)),
    p90: Number(idx(0.9).toFixed(2)),
  };
}

function simulateBankrollBeforeValidation() {
  const panel = document.getElementById("bankrollPanel");
  if (!panel) return;
  if (!lastCouponData?.coupon?.length) {
    panel.innerHTML = "<h3>Simulateur Bankroll</h3><p>Genere d'abord un coupon.</p>";
    return;
  }
  const bankroll = Number(document.getElementById("bankrollInput")?.value || 0);
  const stake = getStakeValue();
  const summary = lastCouponData.summary || {};
  const avgConf = Number(summary.averageConfidence || 0);
  const odd = Number(summary.combinedOdd || 1);
  const p = Math.max(0.03, Math.min(0.95, avgConf / 100));
  const sim = runBankrollSimulationCore({
    bankrollStart: bankroll,
    stake,
    odd,
    winProbability: p,
    rounds: 30,
    trials: 1200,
  });

  panel.innerHTML = `
    <h3>Simulateur Bankroll</h3>
    <div class="meta">
      <span>Bankroll: ${bankroll.toFixed(0)}</span>
      <span>Mise: ${stake.toFixed(0)}</span>
      <span>Cote coupon: ${formatOdd(odd)}</span>
      <span>Prob. gagnee estimee: ${(p * 100).toFixed(1)}%</span>
    </div>
    <ul class="validation-list">
      <li><strong>Risque de ruine (30 tickets):</strong> ${sim.ruinProbability}%</li>
      <li><strong>Bankroll mediane:</strong> ${sim.median.toFixed(2)}</li>
      <li><strong>Scenario prudent (P10):</strong> ${sim.p10.toFixed(2)}</li>
      <li><strong>Scenario haut (P90):</strong> ${sim.p90.toFixed(2)}</li>
    </ul>
  `;
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
    await maybeStartAlertAndReplace();
    simulateBankrollBeforeValidation();
    const insights = computeCouponInsights(lastCouponData.coupon, lastCouponData.riskProfile || "balanced");
    if (insights.correlationRisk >= 55) {
      panel.innerHTML =
        `<p class="correlation-alert">Alerte: correlation elevee (${insights.correlationRisk}%). ` +
        `Validation continuee, mais recommande: clique "Remplacer Pick Faible".</p>` +
        "<p>Validation ticket en cours...</p>";
    }
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
    addPerformanceFromValidation(data);
    renderPerformanceJournal();
  } catch (error) {
    panel.innerHTML = `<p>Erreur validation: ${error.message}</p>`;
  }
}

async function replaceWeakSelection() {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant remplacement.</p>";
    return;
  }
  if (panel) panel.innerHTML = "<p>Recherche du pick le plus faible...</p>";
  try {
    const picks = [...lastCouponData.coupon];
    const targetIndex = picks
      .map((p, i) => ({ i, conf: Number(p?.confiance || 0), odd: Number(p?.cote || 99) }))
      .sort((a, b) => a.conf - b.conf || b.odd - a.odd)[0]?.i;
    if (!Number.isInteger(targetIndex)) throw new Error("Aucune selection a optimiser.");
    const target = picks[targetIndex];

    if (!lastCouponBackups.size) {
      lastCouponBackups = await buildBackupPlan(picks, lastCouponData.riskProfile || "balanced");
    }

    let replacement = null;
    try {
      const res = await fetch(`/api/matches/${encodeURIComponent(target.matchId)}/details`, { cache: "no-store" });
      const details = await readJsonSafe(res);
      if (res.ok && details?.success) {
        const rec = pickOptionFromDetails(details, lastCouponData.riskProfile || "balanced");
        if (rec && String(rec.pari) !== String(target.pari)) {
          replacement = { pari: rec.pari, cote: Number(rec.cote), confiance: Number(rec.confiance || target.confiance), source: rec.source };
        }
      }
    } catch {}

    if (!replacement) {
      const b = lastCouponBackups.get(String(target.matchId));
      if (b && String(b.pari) !== String(target.pari)) {
        replacement = { pari: b.pari, cote: Number(b.odd), confiance: Number(b.confidence || target.confiance), source: b.source || "PLAN_B" };
      }
    }

    if (!replacement) throw new Error("Aucun remplacement fiable trouve pour ce pick.");

    picks[targetIndex] = { ...target, ...replacement };
    lastCouponData = {
      ...lastCouponData,
      coupon: picks,
      summary: createCouponSummary(picks),
      warning: `Pick faible remplace: ${target.teamHome} vs ${target.teamAway} -> ${replacement.pari}`,
    };
    renderCoupon(lastCouponData);
    addHistoryEntry({
      type: "coupon",
      at: new Date().toISOString(),
      note: `Remplacement faible: ${target.pari} -> ${replacement.pari} (${target.matchId})`,
    });
    if (panel) panel.innerHTML = "<p>Pick faible remplace avec succes.</p>";
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur remplacement: ${error.message}</p>`;
  }
}

const generateBtn = document.getElementById("generateBtn");
const generateLadderBtn = document.getElementById("generateLadderBtn");
const generateMultiBtn = document.getElementById("generateMultiBtn");
const replaceWeakBtn = document.getElementById("replaceWeakBtn");
const simulateBankrollBtn = document.getElementById("simulateBankrollBtn");
const validateBtn = document.getElementById("validateBtn");
const sendTelegramBtn = document.getElementById("sendTelegramBtn");
const sendLadderTelegramBtn = document.getElementById("sendLadderTelegramBtn");
const sendPackBtn = document.getElementById("sendPackBtn");
const sendTelegramImageBtn = document.getElementById("sendTelegramImageBtn");
const printA4Btn = document.getElementById("printA4Btn");
const analyzeJournalBtn = document.getElementById("analyzeJournalBtn");
const downloadImageBtn = document.getElementById("downloadImageBtn");
const downloadStoryBtn = document.getElementById("downloadStoryBtn");
const downloadPdfQuickBtn = document.getElementById("downloadPdfQuickBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const downloadPdfDetailedBtn = document.getElementById("downloadPdfDetailedBtn");
const generateBtnSticky = document.getElementById("generateBtnSticky");
const validateBtnSticky = document.getElementById("validateBtnSticky");
const sendTelegramBtnSticky = document.getElementById("sendTelegramBtnSticky");
const sendTelegramImageBtnSticky = document.getElementById("sendTelegramImageBtnSticky");
const downloadPdfBtnSticky = document.getElementById("downloadPdfBtnSticky");

if (generateBtn) generateBtn.addEventListener("click", generateCoupon);
if (generateLadderBtn) generateLadderBtn.addEventListener("click", generateLadderCoupons);
if (generateMultiBtn) generateMultiBtn.addEventListener("click", renderMultiStrategy);
if (replaceWeakBtn) replaceWeakBtn.addEventListener("click", replaceWeakSelection);
if (simulateBankrollBtn) simulateBankrollBtn.addEventListener("click", simulateBankrollBeforeValidation);
if (validateBtn) {
  validateBtn.addEventListener("click", validateTicket);
  validateBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    validateTicket();
  });
}
if (sendTelegramBtn) {
  sendTelegramBtn.addEventListener("click", () => sendCouponToTelegram(false));
  sendTelegramBtn.addEventListener("touchend", (e) => {
    e.preventDefault();
    sendCouponToTelegram(false);
  });
}
if (sendLadderTelegramBtn) {
  sendLadderTelegramBtn.addEventListener("click", sendLadderToTelegram);
}
if (sendPackBtn) {
  sendPackBtn.addEventListener("click", sendCouponPackToTelegram);
}
if (sendTelegramImageBtn) {
  sendTelegramImageBtn.addEventListener("click", () => sendCouponToTelegram(true));
}
if (printA4Btn) {
  printA4Btn.addEventListener("click", openPrintA4Mode);
}
if (analyzeJournalBtn) {
  analyzeJournalBtn.addEventListener("click", renderPerformanceJournal);
}
if (downloadImageBtn) {
  downloadImageBtn.addEventListener("click", () => downloadCouponImage("default"));
}
if (downloadStoryBtn) {
  downloadStoryBtn.addEventListener("click", () => downloadCouponImage("story"));
}
if (generateBtnSticky) {
  generateBtnSticky.addEventListener("click", generateCoupon);
}
if (validateBtnSticky) {
  validateBtnSticky.addEventListener("click", validateTicket);
}
if (sendTelegramBtnSticky) {
  sendTelegramBtnSticky.addEventListener("click", () => sendCouponToTelegram(false));
}
if (sendTelegramImageBtnSticky) {
  sendTelegramImageBtnSticky.addEventListener("click", () => sendCouponToTelegram(true));
}
if (downloadPdfBtn) {
  downloadPdfBtn.addEventListener("click", () => downloadCouponPdf("summary"));
}
if (downloadPdfQuickBtn) {
  downloadPdfQuickBtn.addEventListener("click", () => downloadCouponPdf("quick"));
}
if (downloadPdfDetailedBtn) {
  downloadPdfDetailedBtn.addEventListener("click", () => downloadCouponPdf("detailed"));
}
if (downloadPdfBtnSticky) {
  downloadPdfBtnSticky.addEventListener("click", downloadCouponPdfPack);
}

async function initCouponPage() {
  const refreshInput = document.getElementById("refreshMinutesCouponInput");
  if (refreshInput) {
    const m = getPageRefreshMinutesCoupon();
    refreshInput.value = String(m);
    startCouponPageRefreshTimer(m);
    refreshInput.addEventListener("change", () => {
      const next = setPageRefreshMinutesCoupon(refreshInput.value);
      refreshInput.value = String(next);
      startCouponPageRefreshTimer(next);
    });
  } else {
    startCouponPageRefreshTimer(getPageRefreshMinutesCoupon());
  }

  const autoSwitch = document.getElementById("autoCouponSwitch");
  if (autoSwitch) {
    autoSwitch.checked = isAutoCouponEnabled();
    autoSwitch.addEventListener("change", () => {
      setAutoCouponEnabled(autoSwitch.checked);
    });
  }

  await loadLeagues();
  renderHistory();
  renderPerformanceJournal();
  updateSendButtonState();

  if (isAutoCouponEnabled()) {
    setTimeout(() => {
      generateCoupon();
    }, 250);
  }
}

initCouponPage();

const stakeInput = document.getElementById("stakeInput");
if (stakeInput) {
  stakeInput.addEventListener("input", () => {
    if (lastCouponData) renderCoupon(lastCouponData);
  });
}
const bankrollInput = document.getElementById("bankrollInput");
if (bankrollInput) {
  bankrollInput.addEventListener("input", () => {
    if (lastCouponData) simulateBankrollBeforeValidation();
  });
}

function registerCouponSiteControl() {
  window.SiteControl = {
    page: "coupon",
    actions: [
      "generate_coupon",
      "generate_ladder",
      "generate_multi",
      "validate_ticket",
      "replace_weak_pick",
      "simulate_bankroll",
      "send_telegram_text",
      "send_ladder_telegram",
      "send_telegram_image",
      "send_telegram_pack",
      "print_a4",
      "analyze_journal",
      "download_image",
      "download_story",
      "download_pdf_quick",
      "download_pdf_summary",
      "download_pdf_detailed",
      "set_coupon_form",
      "set_auto_coupon",
      "set_refresh_minutes",
    ],
    async execute(name, payload = {}) {
      const action = String(name || "").toLowerCase();
      if (action === "generate_coupon") return generateCoupon();
      if (action === "generate_ladder") return generateLadderCoupons();
      if (action === "generate_multi") return renderMultiStrategy();
      if (action === "validate_ticket") return validateTicket();
      if (action === "replace_weak_pick") return replaceWeakSelection();
      if (action === "simulate_bankroll") return simulateBankrollBeforeValidation();
      if (action === "send_telegram_text") return sendCouponToTelegram(false);
      if (action === "send_ladder_telegram") return sendLadderToTelegram();
      if (action === "send_telegram_image") return sendCouponToTelegram(true);
      if (action === "send_telegram_pack") return sendCouponPackToTelegram();
      if (action === "print_a4") return openPrintA4Mode();
      if (action === "analyze_journal") return renderPerformanceJournal();
      if (action === "download_image") return downloadCouponImage("default");
      if (action === "download_story") return downloadCouponImage("story");
      if (action === "download_pdf_quick") return downloadCouponPdf("quick");
      if (action === "download_pdf_summary") return downloadCouponPdf("summary");
      if (action === "download_pdf_detailed") return downloadCouponPdf("detailed");
      if (action === "set_auto_coupon") {
        const enabled = Boolean(payload?.enabled);
        setAutoCouponEnabled(enabled);
        const sw = document.getElementById("autoCouponSwitch");
        if (sw) sw.checked = enabled;
        return true;
      }
      if (action === "set_refresh_minutes") {
        const m = setPageRefreshMinutesCoupon(payload?.minutes);
        const input = document.getElementById("refreshMinutesCouponInput");
        if (input) input.value = String(m);
        startCouponPageRefreshTimer(m);
        return true;
      }
      if (action === "set_coupon_form") {
        const sizeInput = document.getElementById("sizeInput");
        const riskSelect = document.getElementById("riskSelect");
        const leagueSelect = document.getElementById("leagueSelect");
        if (sizeInput && payload?.size) sizeInput.value = String(payload.size);
        if (riskSelect && payload?.risk) riskSelect.value = String(payload.risk);
        if (leagueSelect && payload?.league) {
          const wanted = String(payload.league);
          leagueSelect.value = Array.from(leagueSelect.options).some((o) => o.value === wanted) ? wanted : "all";
        }
        return true;
      }
      return false;
    },
  };
}

registerCouponSiteControl();
