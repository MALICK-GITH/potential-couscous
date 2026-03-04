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
const ANTI_CORRELATION_KEY = "fc25_anti_correlation_v1";
const FREEZE_MINUTES_KEY = "fc25_freeze_minutes_v1";
const BANKROLL_PROFILE_KEY = "fc25_bankroll_profile_v1";
const LIVE_SIMULATION_KEY = "fc25_live_simulation_v1";
const WATCHLIST_KEY = "fc25_watchlist_v1";
const ALERT_CENTER_KEY = "fc25_alert_center_v1";
const ODDS_JOURNAL_KEY = "fc25_odds_journal_v1";
const AUTO_COUPON_INTERVAL_KEY = "fc25_auto_coupon_interval_v1";
const AUTO_COUPON_QUALITY_KEY = "fc25_auto_coupon_quality_v1";
const AUTO_COUPON_TG_KEY = "fc25_auto_coupon_tg_v1";
const LOW_DATA_MODE_KEY = "fc25_low_data_mode_v1";
const AUTO_HEAL_KEY = "fc25_auto_heal_v1";
const DEFAULT_PAGE_REFRESH_MINUTES = 5;
let pageRefreshCouponIntervalId = null;
let liveSimulationIntervalId = null;
let watchlistIntervalId = null;
let autoCouponSchedulerId = null;
let serverHistoryIntervalId = null;
let autoCouponRunning = false;
let autoHealRunning = false;
let couponCountdownIntervalId = null;
const stabilityCache = new Map();
let ticketSnapshotA = null;
let ticketSnapshotB = null;

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
  if (!Number.isFinite(n)) {
    const risk = normalizeRiskProfile(document.getElementById("riskSelect")?.value || "balanced");
    return risk === "ultra_safe" ? 4 : DEFAULT_TICKET_SHIELD_DRIFT;
  }
  const risk = normalizeRiskProfile(document.getElementById("riskSelect")?.value || "balanced");
  if (risk === "ultra_safe") return Math.max(2, Math.min(4, n));
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

function getAutoCouponIntervalMinutes() {
  const n = Number(localStorage.getItem(AUTO_COUPON_INTERVAL_KEY));
  if (!Number.isFinite(n)) return 15;
  return Math.max(1, Math.min(120, Math.floor(n)));
}

function setAutoCouponIntervalMinutes(value) {
  const safe = Math.max(1, Math.min(120, Math.floor(Number(value) || 15)));
  localStorage.setItem(AUTO_COUPON_INTERVAL_KEY, String(safe));
  return safe;
}

function getAutoCouponQualityThreshold() {
  const n = Number(localStorage.getItem(AUTO_COUPON_QUALITY_KEY));
  if (!Number.isFinite(n)) return 72;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

function setAutoCouponQualityThreshold(value) {
  const safe = Math.max(1, Math.min(100, Math.floor(Number(value) || 72)));
  localStorage.setItem(AUTO_COUPON_QUALITY_KEY, String(safe));
  return safe;
}

function isAutoCouponTelegramEnabled() {
  return localStorage.getItem(AUTO_COUPON_TG_KEY) === "1";
}

function setAutoCouponTelegramEnabled(value) {
  localStorage.setItem(AUTO_COUPON_TG_KEY, value ? "1" : "0");
}

function isLowDataModeEnabled() {
  return localStorage.getItem(LOW_DATA_MODE_KEY) === "1";
}

function setLowDataModeEnabled(value) {
  localStorage.setItem(LOW_DATA_MODE_KEY, value ? "1" : "0");
  document.body.classList.toggle("low-data", Boolean(value));
}

function isAutoHealEnabled() {
  return localStorage.getItem(AUTO_HEAL_KEY) !== "0";
}

function setAutoHealEnabled(value) {
  localStorage.setItem(AUTO_HEAL_KEY, value ? "1" : "0");
}

function readAlertCenter() {
  try {
    const raw = localStorage.getItem(ALERT_CENTER_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAlertCenter(items) {
  localStorage.setItem(ALERT_CENTER_KEY, JSON.stringify((Array.isArray(items) ? items : []).slice(0, 120)));
}

function readOddsJournal() {
  try {
    const raw = localStorage.getItem(ODDS_JOURNAL_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeOddsJournal(items) {
  localStorage.setItem(ODDS_JOURNAL_KEY, JSON.stringify((Array.isArray(items) ? items : []).slice(0, 2000)));
}

function pushAlert({ severity = "low", title = "Info", detail = "", type = "info" }) {
  const now = new Date().toISOString();
  const item = { at: now, severity, title, detail, type };
  const items = readAlertCenter();
  items.unshift(item);
  writeAlertCenter(items);
  renderAlertsPanel();

  if (severity === "high" && "Notification" in window) {
    if (Notification.permission === "granted") {
      try {
        new Notification(title, { body: detail || "Alerte coupon" });
      } catch {}
    }
  }
}

function notifyEvent(title, detail = "") {
  pushAlert({ severity: "low", title, detail, type: "event_notify" });
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body: detail || "Action terminee" });
    } catch {}
  }
}

function renderAlertsPanel() {
  const panel = document.getElementById("alertsPanel");
  if (!panel) return;
  const items = readAlertCenter();
  if (!items.length) {
    panel.innerHTML = "<h3>Centre d'Alertes</h3><p>Aucune alerte pour le moment.</p>";
    return;
  }
  const rows = items
    .slice(0, 12)
    .map(
      (x, i) => `<li class="sev-${x.severity || "low"}"><strong>${i + 1}. ${x.title}</strong><br /><span>${x.detail || "-"}</span><br /><span class="small-muted">${formatDateTime(
        x.at
      )}</span></li>`
    )
    .join("");
  panel.innerHTML = `
    <h3>Centre d'Alertes</h3>
    <button id="clearAlertsBtn" type="button">Vider alertes</button>
    <ul class="validation-list alert-list">${rows}</ul>
  `;
  const clearBtn = document.getElementById("clearAlertsBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      writeAlertCenter([]);
      renderAlertsPanel();
    });
  }
}

function appendOddsJournalSnapshot(stage = "unknown", picks = []) {
  if (!Array.isArray(picks) || !picks.length) return;
  const now = new Date().toISOString();
  const entries = picks.map((p) => ({
    at: now,
    stage,
    matchId: p.matchId,
    teams: `${p.teamHome || "?"} vs ${p.teamAway || "?"}`,
    league: p.league || "",
    pari: p.pari || "-",
    odd: Number(p.cote || 0),
  }));
  const all = readOddsJournal();
  writeOddsJournal([...entries, ...all]);
}

function renderOddsJournalPanel() {
  const panel = document.getElementById("oddsJournalPanel");
  if (!panel) return;
  const items = readOddsJournal();
  if (!items.length) {
    panel.innerHTML = "<h3>Journal des Cotes</h3><p>Aucune variation tracee.</p>";
    return;
  }

  const byKey = new Map();
  for (const x of items) {
    const key = `${x.matchId}|${x.pari}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(x);
  }

  const rows = [...byKey.values()]
    .slice(0, 12)
    .map((track) => {
      const sorted = track.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      const first = Number(sorted[0]?.odd || 0);
      const last = Number(sorted[sorted.length - 1]?.odd || 0);
      const diff = Number((last - first).toFixed(3));
      const pct = first > 0 ? Number((((last - first) / first) * 100).toFixed(2)) : 0;
      const t = sorted[sorted.length - 1];
      return `<li>
        <strong>${t.teams}</strong><br />
        ${t.pari} | debut ${formatOdd(first)} -> actuel ${formatOdd(last)} (${diff >= 0 ? "+" : ""}${diff} / ${pct >= 0 ? "+" : ""}${pct}%)<br />
        <span class="small-muted">Etapes: ${sorted.map((s) => `${s.stage}:${formatOdd(s.odd)}`).join(" | ")}</span>
      </li>`;
    })
    .join("");

  panel.innerHTML = `
    <h3>Journal des Cotes</h3>
    <button id="clearOddsJournalBtn" type="button">Vider journal cotes</button>
    <ul class="validation-list">${rows}</ul>
  `;
  const clearBtn = document.getElementById("clearOddsJournalBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      writeOddsJournal([]);
      renderOddsJournalPanel();
    });
  }
}

async function renderServerHistoryPanel() {
  const panel = document.getElementById("serverHistoryPanel");
  if (!panel) return;
  panel.innerHTML = "<h3>Historique serveur</h3><p>Chargement...</p>";
  try {
    const [statusRes, couponRes, tgRes, auditRes] = await Promise.all([
      fetch("/api/db/status", { cache: "no-store" }),
      fetch("/api/coupon/history?limit=8", { cache: "no-store" }),
      fetch("/api/telegram/history?limit=8", { cache: "no-store" }),
      fetch("/api/audit/history?limit=8", { cache: "no-store" }),
    ]);
    const status = await readJsonSafe(statusRes);
    const coupons = await readJsonSafe(couponRes);
    const telegram = await readJsonSafe(tgRes);
    const audits = await readJsonSafe(auditRes);
    const dbInfo = status?.db?.tables || {};

    const listCoupons = (coupons?.items || [])
      .slice(0, 5)
      .map((x, i) => `<li><strong>${i + 1}. ${formatDateTime(x.createdAt)}</strong> | ${x.summary?.totalSelections || 0} sel | cote ${formatOdd(x.summary?.combinedOdd)} | ${x.risk || "-"}</li>`)
      .join("");
    const listTelegram = (telegram?.items || [])
      .slice(0, 5)
      .map((x, i) => `<li><strong>${i + 1}. ${formatDateTime(x.createdAt)}</strong> | ${x.kind} | ${x.status}</li>`)
      .join("");
    const listAudits = (audits?.items || [])
      .slice(0, 5)
      .map((x, i) => `<li><strong>${i + 1}. ${x.auditId}</strong> | ${formatDateTime(x.createdAt)} | ${x.action}</li>`)
      .join("");

    panel.innerHTML = `
      <h3>Historique serveur</h3>
      <div class="meta">
        <span>Coupons DB: ${Number(dbInfo.coupon_generations || 0)}</span>
        <span>Validations DB: ${Number(dbInfo.coupon_validations || 0)}</span>
        <span>Telegram DB: ${Number(dbInfo.telegram_logs || 0)}</span>
        <span>Audit DB: ${Number(dbInfo.audit_reports || 0)}</span>
      </div>
      <p><strong>Derniers coupons</strong></p>
      <ul class="validation-list">${listCoupons || "<li>Aucun coupon serveur</li>"}</ul>
      <p><strong>Derniers envois Telegram</strong></p>
      <ul class="validation-list">${listTelegram || "<li>Aucun envoi Telegram</li>"}</ul>
      <p><strong>Derniers audits</strong></p>
      <ul class="validation-list">${listAudits || "<li>Aucun audit</li>"}</ul>
    `;
  } catch (error) {
    panel.innerHTML = `<h3>Historique serveur</h3><p>Erreur: ${error.message}</p>`;
    pushAlert({ severity: "medium", title: "Historique serveur indisponible", detail: error.message, type: "server_history" });
  }
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
  if (key === "ultra_safe" || key === "ultrasafe") {
    return { minOdd: 1.3, maxOdd: 1.95, minConfidence: 72, slope: 10, anchor: 1.55 };
  }
  if (key === "safe") return { minOdd: 1.2, maxOdd: 1.7, minConfidence: 62, slope: 8, anchor: 1.45 };
  if (key === "aggressive") return { minOdd: 1.55, maxOdd: 3.2, minConfidence: 45, slope: 6, anchor: 2.2 };
  return { minOdd: 1.3, maxOdd: 2.25, minConfidence: 50, slope: 11, anchor: 1.7 };
}

function normalizeRiskProfile(profile = "balanced") {
  const key = normalizeText(profile);
  if (key === "ultra_safe" || key === "ultrasafe") return "ultra_safe";
  if (key === "safe") return "safe";
  if (key === "aggressive") return "aggressive";
  return "balanced";
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
      reliabilityIndex: 0,
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
  const stabilityValues = coupon.map((x) => Number(x?.stabilityScore || 55)).filter((x) => Number.isFinite(x));
  const avgStability = stabilityValues.length
    ? stabilityValues.reduce((a, b) => a + b, 0) / stabilityValues.length
    : 55;
  const reliabilityIndex = clamp(
    Math.round(qualityScore * 0.45 + (100 - correlationRisk) * 0.2 + avgStability * 0.2 + timingScore * 0.15),
    1,
    100
  );

  return {
    qualityScore,
    reliabilityIndex,
    correlationRisk,
    minStartMinutes,
    confidenceAvg: Number(confidenceAvg.toFixed(1)),
    leagueDiversity: Number(leagueDiversity.toFixed(1)),
  };
}

function renderHealthPanel(coupon = [], riskProfile = "balanced", summary = {}) {
  const panel = document.getElementById("healthPanel");
  if (!panel) return;
  if (!Array.isArray(coupon) || !coupon.length) {
    panel.innerHTML = "<h3>Dashboard Sante du Coupon</h3><p>Genere un coupon pour calculer la sante globale.</p>";
    return;
  }
  const insights = computeCouponInsights(coupon, riskProfile);
  const drift = getDriftThreshold();
  const score = Number(insights.qualityScore || 0);
  const statusClass = score >= 75 ? "health-good" : score >= 60 ? "health-mid" : "health-bad";
  const statusLabel = score >= 75 ? "VERT" : score >= 60 ? "ORANGE" : "ROUGE";
  const startText =
    insights.minStartMinutes == null ? "-" : `${Math.max(0, Math.floor(insights.minStartMinutes))} min`;
  panel.innerHTML = `
    <h3>Dashboard Sante du Coupon</h3>
    <p><span class="health-score ${statusClass}">Sante ${score}/100 - ${statusLabel}</span></p>
    <div class="meta">
      <span>Fiabilite ticket: ${insights.reliabilityIndex}/100</span>
      <span>Stabilite: ${score >= 75 ? "Haute" : score >= 60 ? "Moyenne" : "Faible"}</span>
      <span>Correlation: ${insights.correlationRisk}%</span>
      <span>Confiance moyenne: ${Number(summary.averageConfidence || insights.confidenceAvg || 0)}%</span>
      <span>Demarrage min: ${startText}</span>
      <span>Seuil drift actif: ${drift}%</span>
    </div>
  `;
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

function buildReplayLines(pick, riskProfile = "balanced") {
  const conf = Number(pick?.confiance || 0);
  const odd = Number(pick?.cote || 0);
  const startMin = Math.max(0, Math.floor((Number(pick?.startTimeUnix || 0) - Math.floor(Date.now() / 1000)) / 60));
  const quality = computeDataQualityScore(pick);
  return [
    `Signal: confiance ${conf.toFixed(1)}% avec cote ${formatOdd(odd)} en mode ${riskProfile}.`,
    `Qualite donnees: ${quality.score}/100 (fraicheur ${quality.freshness}, stabilite ${quality.stability}, API ${quality.apiConfidence}).`,
    `Timing: demarrage dans ${startMin} min, donc ${startMin <= 8 ? "execution prioritaire" : "fenetre encore confortable"}.`,
  ];
}

function computeDataQualityScore(pick = {}) {
  const now = Date.now();
  const updatedAtMs = pick?.updatedAt ? new Date(pick.updatedAt).getTime() : now;
  const ageSec = Math.max(0, Math.floor((now - updatedAtMs) / 1000));
  const freshness = clamp(Math.round(100 - ageSec / 3), 15, 100);
  const stability = clamp(Math.round(Number(pick?.stabilityScore || 55)), 5, 100);
  const apiConfidence = clamp(Math.round(Number(pick?.confiance || 0)), 5, 100);
  const score = clamp(Math.round(freshness * 0.34 + stability * 0.36 + apiConfidence * 0.3), 5, 100);
  return { score, freshness, stability, apiConfidence };
}

function formatMatchLocalDateTime(unixSeconds) {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return formatDateTime(n * 1000);
}

function formatCountdownLabel(unixSeconds) {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const diff = Math.floor(n - Date.now() / 1000);
  if (diff <= 0) return "Demarre";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function startCouponCountdownTimer() {
  if (couponCountdownIntervalId) {
    clearInterval(couponCountdownIntervalId);
    couponCountdownIntervalId = null;
  }
  const run = () => {
    const nodes = document.querySelectorAll("[data-countdown-start]");
    for (const node of nodes) {
      const start = Number(node.getAttribute("data-countdown-start"));
      node.textContent = `T- ${formatCountdownLabel(start)}`;
    }
  };
  run();
  couponCountdownIntervalId = setInterval(run, 1000);
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
  const normalizedProfile = normalizeRiskProfile(profile);
  const effectiveSize = normalizedProfile === "ultra_safe" ? Math.min(3, size) : size;
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
  const cfg = riskConfig(normalizedProfile);
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
        statusText: m.statusText || "",
        infoText: m.infoText || "",
        statusCode: m.statusCode ?? null,
        phase: m.phase || "",
        pari: opt.pari,
        cote: Number(opt.cote),
        confiance: Number(opt.confiance.toFixed(1)),
        safetyScore,
      });
    } catch {}
  }

  candidates.sort((a, b) => b.safetyScore - a.safetyScore);
  let picks = candidates.slice(0, effectiveSize);
  if (normalizedProfile === "ultra_safe") {
    picks = enforceUltraSafePolicy(picks);
  }
  const combinedOdd = picks.length ? Number(picks.reduce((acc, x) => acc * x.cote, 1).toFixed(3)) : null;
  const averageConfidence = picks.length
    ? Number((picks.reduce((acc, x) => acc + x.confiance, 0) / picks.length).toFixed(1))
    : 0;

  return {
    success: true,
    riskProfile: normalizedProfile,
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
  const miniBtn = document.getElementById("sendTelegramMiniBtn");
  const packBtn = document.getElementById("sendPackBtn");
  const ladderTgBtn = document.getElementById("sendLadderTelegramBtn");
  const imageTelegramBtn = document.getElementById("sendTelegramImageBtn");
  const printBtn = document.getElementById("printA4Btn");
  const watchBtn = document.getElementById("watchlistFromCouponBtn");
  const stickyBtn = document.getElementById("sendTelegramBtnSticky");
  const stickyImageBtn = document.getElementById("sendTelegramImageBtnSticky");
  const replaceWeakBtn = document.getElementById("replaceWeakBtn");
  const imageBtn = document.getElementById("downloadImageBtn");
  const premiumImageBtn = document.getElementById("downloadPremiumImageBtn");
  const storyBtn = document.getElementById("downloadStoryBtn");
  const pdfQuickBtn = document.getElementById("downloadPdfQuickBtn");
  const pdfBtn = document.getElementById("downloadPdfBtn");
  const pdfDetailedBtn = document.getElementById("downloadPdfDetailedBtn");
  const exportBtn = document.getElementById("exportProBtn");
  const pdfStickyBtn = document.getElementById("downloadPdfBtnSticky");
  const simulateBtn = document.getElementById("simulateBankrollBtn");
  const enabled = Boolean(lastCouponData && Array.isArray(lastCouponData.coupon) && lastCouponData.coupon.length > 0);
  const frozen = enabled && isCouponFrozen(lastCouponData.coupon);
  if (btn) btn.disabled = !enabled;
  if (miniBtn) miniBtn.disabled = !enabled;
  if (packBtn) packBtn.disabled = !enabled;
  if (ladderTgBtn) ladderTgBtn.disabled = !(lastLadderData && Array.isArray(lastLadderData.items) && lastLadderData.items.length > 0);
  if (imageTelegramBtn) imageTelegramBtn.disabled = !enabled;
  if (printBtn) printBtn.disabled = !enabled;
  if (watchBtn) watchBtn.disabled = !enabled;
  if (stickyBtn) stickyBtn.disabled = !enabled;
  if (stickyImageBtn) stickyImageBtn.disabled = !enabled;
  if (replaceWeakBtn) replaceWeakBtn.disabled = !enabled || frozen;
  if (imageBtn) imageBtn.disabled = !enabled;
  if (premiumImageBtn) premiumImageBtn.disabled = !enabled;
  if (storyBtn) storyBtn.disabled = !enabled;
  if (pdfQuickBtn) pdfQuickBtn.disabled = !enabled;
  if (pdfBtn) pdfBtn.disabled = !enabled;
  if (pdfDetailedBtn) pdfDetailedBtn.disabled = !enabled;
  if (exportBtn) exportBtn.disabled = !enabled;
  if (pdfStickyBtn) pdfStickyBtn.disabled = !enabled;
  if (simulateBtn) simulateBtn.disabled = !enabled;
}

function getFreezeMinutes() {
  const input = document.getElementById("freezeMinutesInput");
  const raw = input?.value ?? localStorage.getItem(FREEZE_MINUTES_KEY);
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(30, Math.floor(n)));
}

function setFreezeMinutes(value) {
  const safe = Math.max(0, Math.min(30, Math.floor(Number(value) || 3)));
  localStorage.setItem(FREEZE_MINUTES_KEY, String(safe));
  return safe;
}

function isAntiCorrelationEnabled() {
  const v = localStorage.getItem(ANTI_CORRELATION_KEY);
  if (v == null) return true;
  return v === "1";
}

function setAntiCorrelationEnabled(value) {
  localStorage.setItem(ANTI_CORRELATION_KEY, value ? "1" : "0");
}

function getBankrollProfile() {
  const v = String(localStorage.getItem(BANKROLL_PROFILE_KEY) || "standard").toLowerCase();
  return ["conservateur", "standard", "attaque"].includes(v) ? v : "standard";
}

function setBankrollProfile(profile) {
  const safe = ["conservateur", "standard", "attaque"].includes(String(profile || "").toLowerCase())
    ? String(profile).toLowerCase()
    : "standard";
  localStorage.setItem(BANKROLL_PROFILE_KEY, safe);
  return safe;
}

function isLiveSimulationEnabled() {
  return localStorage.getItem(LIVE_SIMULATION_KEY) === "1";
}

function setLiveSimulationEnabled(value) {
  localStorage.setItem(LIVE_SIMULATION_KEY, value ? "1" : "0");
}

function readWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeWatchlist(items) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify((Array.isArray(items) ? items : []).slice(0, 120)));
}

function getWatchDelta() {
  const input = document.getElementById("watchDeltaInput");
  const n = Number(input?.value);
  if (!Number.isFinite(n)) return 0.15;
  return Math.max(0.01, Math.min(2, n));
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
    const anti = applyAntiCorrelation(Array.isArray(data?.coupon) ? data.coupon : [], size);
    const stake = Number((totalStake * profile.weight).toFixed(2));
    items.push({
      profile: profile.key,
      label: profile.label,
      weight: profile.weight,
      stake,
      coupon: anti.coupon,
      summary: createCouponSummary(anti.coupon),
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
    enforceStakeSafetyCap();
    await refreshLadderBeforeTelegram();
    const liveInLadder = (lastLadderData?.items || []).some((it) =>
      (Array.isArray(it?.coupon) ? it.coupon : []).some((x) => !isStrictUpcomingMatch(x, Math.floor(Date.now() / 1000)))
    );
    if (liveInLadder) {
      throw new Error("Kill switch live: ladder contient un match deja demarre.");
    }
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
    notifyEvent("Coupon envoye", `Ladder Telegram envoye (${lastLadderData.items.length} tickets).`);
    renderServerHistoryPanel();
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur Ladder Telegram: ${error.message}</p>`;
    pushAlert({ severity: "high", title: "Erreur Ladder Telegram", detail: error.message, type: "telegram_ladder_error" });
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

function isoWeekKey(dateIso) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function renderPerformanceReplay() {
  const panel = document.getElementById("performancePanel");
  if (!panel) return;
  const entries = readPerformanceLog();
  if (!entries.length) {
    panel.innerHTML = "<h3>Journal Performance</h3><p>Aucune donnee a rejouer.</p>";
    return;
  }

  const dayMap = new Map();
  const weekMap = new Map();
  for (const e of entries) {
    const dayKey = String(e?.at || "").slice(0, 10) || "unknown";
    const weekKey = isoWeekKey(e?.at);
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, { n: 0, q: 0 });
    if (!weekMap.has(weekKey)) weekMap.set(weekKey, { n: 0, q: 0 });
    dayMap.get(dayKey).n += 1;
    dayMap.get(dayKey).q += Number(e.quality) || 0;
    weekMap.get(weekKey).n += 1;
    weekMap.get(weekKey).q += Number(e.quality) || 0;
  }

  const toRows = (map) =>
    [...map.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .slice(-8)
      .map(([k, v], i, arr) => {
        const score = Number(((v.q / Math.max(1, v.n)) * 100).toFixed(1));
        const prev = i > 0 ? Number(((arr[i - 1][1].q / Math.max(1, arr[i - 1][1].n)) * 100).toFixed(1)) : score;
        const trend = score > prev ? "UP" : score < prev ? "DOWN" : "FLAT";
        return `<li><strong>${k}</strong> | Score: ${score}% | Volume: ${v.n} | Trend: ${trend}</li>`;
      })
      .join("");

  panel.innerHTML = `
    <h3>Replay Journal Performance</h3>
    <p><strong>Replay quotidien (8 derniers jours)</strong></p>
    <ul class="validation-list">${toRows(dayMap) || "<li>Aucune donnee</li>"}</ul>
    <p><strong>Replay hebdo (8 dernieres semaines)</strong></p>
    <ul class="validation-list">${toRows(weekMap) || "<li>Aucune donnee</li>"}</ul>
  `;
}

function renderWatchlistPanel() {
  const panel = document.getElementById("watchlistPanel");
  if (!panel) return;
  const items = readWatchlist();
  if (!items.length) {
    panel.innerHTML = "<h3>Watchlist Cotes</h3><p>Aucune surveillance active.</p>";
    return;
  }
  const rows = items
    .slice(0, 10)
    .map(
      (x, i) =>
        `<li><strong>${i + 1}. ${x.home} vs ${x.away}</strong> | Target: ${formatOdd(x.targetOdd)} | Actuelle: ${formatOdd(
          x.currentOdd
        )} | ${x.alerted ? "ALERTE ENVOYEE" : "EN ATTENTE"}</li>`
    )
    .join("");
  panel.innerHTML = `
    <h3>Watchlist Cotes</h3>
    <p>Delta cible: +${getWatchDelta().toFixed(2)}</p>
    <ul class="validation-list">${rows}</ul>
  `;
}

function buildWatchlistFromCoupon() {
  if (!lastCouponData?.coupon?.length) return;
  const delta = getWatchDelta();
  const list = lastCouponData.coupon.map((p) => ({
    matchId: p.matchId,
    home: p.teamHome,
    away: p.teamAway,
    league: p.league,
    pari: p.pari,
    baseOdd: Number(p.cote) || 0,
    targetOdd: Number(((Number(p.cote) || 0) + delta).toFixed(3)),
    currentOdd: Number(p.cote) || 0,
    alerted: false,
    updatedAt: new Date().toISOString(),
  }));
  writeWatchlist(list);
  renderWatchlistPanel();
}

async function updateWatchlistLive() {
  const list = readWatchlist();
  if (!list.length) return;
  let changed = false;
  for (const item of list) {
    try {
      const res = await fetch(`/api/matches/${encodeURIComponent(item.matchId)}/details`, { cache: "no-store" });
      const data = await readJsonSafe(res);
      if (!res.ok || !data?.success) continue;
      const markets = Array.isArray(data?.bettingMarkets) ? data.bettingMarkets : [];
      const m = markets.find((x) => String(x.nom || "") === String(item.pari || ""));
      const odd = Number(m?.cote);
      if (!Number.isFinite(odd) || odd <= 0) continue;
      item.currentOdd = odd;
      item.updatedAt = new Date().toISOString();
      if (!item.alerted && odd >= Number(item.targetOdd || 0)) {
        item.alerted = true;
        changed = true;
        const panel = document.getElementById("validation");
        if (panel) {
          panel.innerHTML = `<p class="ticket-status ticket-ok">Watchlist: cote cible atteinte pour ${item.home} vs ${item.away} (${formatOdd(
            odd
          )}).</p>`;
        }
        pushAlert({
          severity: "medium",
          title: "Watchlist: cible cote atteinte",
          detail: `${item.home} vs ${item.away} -> ${formatOdd(odd)}`,
          type: "watchlist_target",
        });
      }
      changed = true;
    } catch {
      // ignore transient errors
    }
  }
  if (changed) {
    writeWatchlist(list);
    renderWatchlistPanel();
  }
}

async function refreshLiveSimulation() {
  if (!isLiveSimulationEnabled() || !lastCouponData?.coupon?.length) return;
  await hydrateCouponStability(lastCouponData.coupon);
  if (isAutoHealEnabled()) {
    await autoHealCouponByDrift();
  }
  const picks = lastCouponData.coupon;
  const ev = computeCouponEV(picks);
  const stabilityValues = picks.map((x) => Number(x.stabilityScore)).filter((x) => Number.isFinite(x));
  const avgStability = stabilityValues.length
    ? Number((stabilityValues.reduce((a, b) => a + b, 0) / stabilityValues.length).toFixed(1))
    : null;
  const panel = document.getElementById("validation");
  if (panel) {
    panel.innerHTML = `<p>Simulation live: EV ${ev >= 0 ? "+" : ""}${ev.toFixed(3)} | Stabilite moyenne ${
      avgStability == null ? "-" : `${avgStability}/100`
    } | ${formatDateTime(new Date())}</p>`;
  }
}

async function autoHealCouponByDrift() {
  if (autoHealRunning || !lastCouponData?.coupon?.length) return;
  autoHealRunning = true;
  try {
    const threshold = getDriftThreshold();
    let replaced = 0;
    const events = [];
    const updated = [...lastCouponData.coupon];
    for (let i = 0; i < updated.length; i += 1) {
      const pick = updated[i];
      if (!pick?.matchId) continue;
      try {
        const res = await fetch(`/api/matches/${encodeURIComponent(pick.matchId)}/details`, { cache: "no-store" });
        const details = await readJsonSafe(res);
        if (!res.ok || !details?.success) continue;
        const markets = Array.isArray(details.bettingMarkets) ? details.bettingMarkets : [];
        const m = markets.find((x) => String(x.nom || "") === String(pick.pari || ""));
        const liveOdd = Number(m?.cote || 0);
        const baseOdd = Number(pick?.cote || 0);
        if (!(liveOdd > 0 && baseOdd > 0)) continue;
        const drift = Math.abs(((liveOdd - baseOdd) / baseOdd) * 100);
        if (drift <= threshold) continue;
        const rec = pickOptionFromDetails(details, lastCouponData.riskProfile || "balanced");
        if (!rec?.pari) continue;
        if (String(rec.pari) === String(pick.pari)) {
          updated[i] = { ...pick, cote: Number(rec.cote || liveOdd), updatedAt: new Date().toISOString() };
          events.push({
            matchId: pick.matchId,
            reason: "ODD_DRIFT_REFRESH",
            fromPari: pick.pari,
            toPari: pick.pari,
            fromOdd: baseOdd,
            toOdd: Number(rec.cote || liveOdd),
            driftPercent: Number(drift.toFixed(2)),
          });
        } else {
          updated[i] = {
            ...pick,
            pari: rec.pari,
            cote: Number(rec.cote || liveOdd),
            confiance: Number(rec.confiance || pick.confiance || 50),
            source: rec.source || "AUTO_HEAL",
            updatedAt: new Date().toISOString(),
          };
          replaced += 1;
          events.push({
            matchId: pick.matchId,
            reason: "ODD_DRIFT_REPLACE",
            fromPari: pick.pari,
            toPari: rec.pari,
            fromOdd: baseOdd,
            toOdd: Number(rec.cote || liveOdd),
            driftPercent: Number(drift.toFixed(2)),
          });
        }
      } catch {}
    }
    if (events.length > 0) {
      const before = lastCouponData.coupon.map((x) => ({ matchId: x.matchId, pari: x.pari, cote: x.cote }));
      lastCouponData = {
        ...lastCouponData,
        coupon: updated,
        summary: createCouponSummary(updated),
        warning: `Auto-heal actif: ${replaced} pick(s) ajustes automatiquement suite au drift.`,
      };
      renderCoupon(lastCouponData);
      const after = updated.map((x) => ({ matchId: x.matchId, pari: x.pari, cote: x.cote }));
      createAuditEntry(
        "auto_heal_drift",
        {
          driftThreshold: threshold,
          riskProfile: lastCouponData.riskProfile || "balanced",
          events,
          before,
          after,
        },
        { replaced, eventCount: events.length, ok: true }
      );
      pushAlert({
        severity: "medium",
        title: "Auto-heal drift execute",
        detail: `${events.length} ajustement(s), dont ${replaced} remplacement(s) automatique(s).`,
        type: "auto_heal",
      });
    }
  } finally {
    autoHealRunning = false;
  }
}

function restartLiveMonitors() {
  if (liveSimulationIntervalId) {
    clearInterval(liveSimulationIntervalId);
    liveSimulationIntervalId = null;
  }
  if (watchlistIntervalId) {
    clearInterval(watchlistIntervalId);
    watchlistIntervalId = null;
  }

  if (isLiveSimulationEnabled() || isAutoHealEnabled()) {
    const periodMs = isLowDataModeEnabled() ? 60000 : 30000;
    liveSimulationIntervalId = setInterval(() => {
      if (isLiveSimulationEnabled()) {
        refreshLiveSimulation();
      } else if (isAutoHealEnabled()) {
        autoHealCouponByDrift();
      }
    }, periodMs);
    watchlistIntervalId = setInterval(() => {
      if (!isLowDataModeEnabled()) updateWatchlistLive();
    }, periodMs);
  }
}

function restartServerHistoryMonitor() {
  if (serverHistoryIntervalId) {
    clearInterval(serverHistoryIntervalId);
    serverHistoryIntervalId = null;
  }
  serverHistoryIntervalId = setInterval(() => {
    renderServerHistoryPanel();
  }, 60000);
}

function applyBankrollProfilePreset(profile) {
  const safe = setBankrollProfile(profile);
  const sizeInput = document.getElementById("sizeInput");
  const driftInput = document.getElementById("driftInput");
  const freezeInput = document.getElementById("freezeMinutesInput");
  const riskSelect = document.getElementById("riskSelect");
  if (safe === "conservateur") {
    if (sizeInput) sizeInput.value = "2";
    if (driftInput) driftInput.value = "5";
    if (freezeInput) freezeInput.value = "6";
    if (riskSelect) riskSelect.value = "safe";
  } else if (safe === "attaque") {
    if (sizeInput) sizeInput.value = "5";
    if (driftInput) driftInput.value = "9";
    if (freezeInput) freezeInput.value = "1";
    if (riskSelect) riskSelect.value = "aggressive";
  } else {
    if (sizeInput) sizeInput.value = "3";
    if (driftInput) driftInput.value = "6";
    if (freezeInput) freezeInput.value = "3";
    if (riskSelect) riskSelect.value = "balanced";
  }
  setFreezeMinutes(freezeInput?.value || 3);
  updateSendButtonState();
  suggestStakeFromProfile();
}

function suggestStakeFromProfile() {
  const bankroll = Number(document.getElementById("bankrollInput")?.value || 0);
  const stakeInput = document.getElementById("stakeInput");
  if (!stakeInput || bankroll <= 0) return;
  const profile = getBankrollProfile();
  const risk = normalizeRiskProfile(document.getElementById("riskSelect")?.value || "balanced");
  const ratio = risk === "ultra_safe" || risk === "safe" ? 0.015 : profile === "conservateur" ? 0.02 : profile === "attaque" ? 0.08 : 0.04;
  const suggested = Math.max(100, Math.round((bankroll * ratio) / 100) * 100);
  stakeInput.value = String(suggested);
}

function enforceStakeSafetyCap() {
  const stakeInput = document.getElementById("stakeInput");
  const bankroll = Number(document.getElementById("bankrollInput")?.value || 0);
  const risk = normalizeRiskProfile(document.getElementById("riskSelect")?.value || "balanced");
  if (!stakeInput || bankroll <= 0) return;
  if (risk !== "safe" && risk !== "ultra_safe") return;
  const maxStake = Math.max(100, Math.floor((bankroll * 0.015) / 100) * 100);
  const current = Number(stakeInput.value || 0);
  if (current > maxStake) {
    stakeInput.value = String(maxStake);
    pushAlert({
      severity: "medium",
      title: "Stake cap safe applique",
      detail: `Mise limitee a 1.5% bankroll (${maxStake}).`,
      type: "stake_cap_safe",
    });
  }
}

async function createAuditEntry(action, payload, result) {
  try {
    const res = await fetch("/api/coupon/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload, result }),
    });
    const data = await readJsonSafe(res);
    if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || "Audit KO");
    return data.auditId || null;
  } catch {
    return null;
  }
}

async function exportProReport() {
  const panel = document.getElementById("validation");
  if (!lastCouponData?.coupon?.length) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant export pro.</p>";
    return;
  }
  try {
    if (panel) panel.innerHTML = "<p>Export rapport pro en cours...</p>";
    await enforceTicketShield("export rapport pro");
    await downloadCouponImage("default");
    await downloadCouponPdf("detailed");
    const autoTg = isAutoCouponTelegramEnabled();
    if (autoTg) {
      await sendCouponToTelegram(false);
    }
    const auditId = await createAuditEntry("coupon_export_pro", { coupon: lastCouponData }, { autoTelegram: autoTg, ok: true });
    if (panel) {
      panel.innerHTML = `
        <h3>Export Rapport Pro</h3>
        <p class="ticket-status ticket-ok">TERMINE</p>
        <p>Image + PDF detaille${autoTg ? " + Telegram" : ""} executes.</p>
        <p>ID Audit: <strong>${auditId || "N/A"}</strong></p>
      `;
    }
    pushAlert({
      severity: "low",
      title: "Rapport pro exporte",
      detail: `Export complet termine. Audit: ${auditId || "N/A"}`,
      type: "export_pro",
    });
    renderServerHistoryPanel();
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur export pro: ${error.message}</p>`;
    pushAlert({ severity: "high", title: "Echec export pro", detail: error.message, type: "export_pro_error" });
  }
}

function startAutoCouponScheduler() {
  if (autoCouponSchedulerId) {
    clearInterval(autoCouponSchedulerId);
    autoCouponSchedulerId = null;
  }
  if (!isAutoCouponEnabled()) return;
  const minutes = getAutoCouponIntervalMinutes();
  const ms = minutes * 60 * 1000;
  autoCouponSchedulerId = setInterval(async () => {
    if (autoCouponRunning) return;
    autoCouponRunning = true;
    try {
      await generateCoupon();
      const insights = computeCouponInsights(lastCouponData?.coupon || [], lastCouponData?.riskProfile || "balanced");
      const threshold = getAutoCouponQualityThreshold();
      if (Number(insights.qualityScore || 0) >= threshold) {
        pushAlert({
          severity: "low",
          title: "Auto-coupon valide",
          detail: `Qualite ${insights.qualityScore}/100 >= ${threshold}`,
          type: "auto_coupon",
        });
        if (isAutoCouponTelegramEnabled()) {
          await sendCouponToTelegram(false);
        }
      } else {
        pushAlert({
          severity: "medium",
          title: "Auto-coupon sous seuil",
          detail: `Qualite ${insights.qualityScore}/100 < ${threshold}`,
          type: "auto_coupon_quality",
        });
      }
    } catch (error) {
      pushAlert({ severity: "high", title: "Auto-coupon echec", detail: error.message, type: "auto_coupon_error" });
    } finally {
      autoCouponRunning = false;
    }
  }, ms);
}

function renderPostTicketReport(report) {
  const panel = document.getElementById("postTicketPanel");
  if (!panel) return;
  const rows = Array.isArray(report?.validatedSelections) ? report.validatedSelections : [];
  if (!rows.length) {
    panel.innerHTML = "<h3>Rapport Post-Ticket</h3><p>Aucune donnee.</p>";
    return;
  }
  const reasonCount = new Map();
  for (const row of rows) {
    for (const r of row.reasonCodes || []) {
      reasonCount.set(r, (reasonCount.get(r) || 0) + 1);
    }
  }
  const reasons = [...reasonCount.entries()].sort((a, b) => b[1] - a[1]);
  const best = rows.filter((x) => x.status === "ok").length;
  const total = rows.length;
  panel.innerHTML = `
    <h3>Rapport Post-Ticket</h3>
    <div class="meta">
      <span>Lignes: ${total}</span>
      <span>Propres: ${best}</span>
      <span>A corriger: ${total - best}</span>
    </div>
    <p><strong>Causes dominantes</strong></p>
    <ul class="validation-list">
      ${
        reasons.length
          ? reasons.map((x) => `<li>${x[0]}: ${x[1]}</li>`).join("")
          : "<li>Aucune cause critique</li>"
      }
    </ul>
  `;
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
    enforceStakeSafetyCap();
    await replaceStartedSelectionsBeforeTelegram();
    await preflightTelegramSafety();
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
    appendOddsJournalSnapshot("telegram_pack", lastCouponData.coupon);
    renderOddsJournalPanel();
    pushAlert({
      severity: "low",
      title: "Pack Telegram envoye",
      detail: `${lastCouponData.summary?.totalSelections ?? 0} selections envoyees`,
      type: "telegram_pack_sent",
    });
    notifyEvent("Coupon envoye", "Pack Telegram (texte + image + PDF) envoye.");
    renderServerHistoryPanel();
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur pack Telegram: ${error.message}</p>`;
    pushAlert({ severity: "high", title: "Erreur pack Telegram", detail: error.message, type: "telegram_pack_error" });
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
    const qualityHost = document.getElementById(`quality-${id}`);
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
      pick.updatedAt = new Date().toISOString();
      const q = computeDataQualityScore(pick);
      pick.qualityScore = q.score;
      if (qualityHost) qualityHost.textContent = `Qualite donnees: ${q.score}/100`;
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

function getStartedSelectionsLocal(coupon = []) {
  const nowSec = Math.floor(Date.now() / 1000);
  return (Array.isArray(coupon) ? coupon : []).filter((x) => !isStrictUpcomingMatch(x, nowSec));
}

async function preflightTelegramSafety() {
  if (!lastCouponData?.coupon?.length) return;
  const started = getStartedSelectionsLocal(lastCouponData.coupon);
  if (started.length) {
    pushAlert({
      severity: "high",
      title: "Kill switch live actif",
      detail: `${started.length} match(s) deja demarre(s). Envoi bloque puis remplacement requis.`,
      type: "kill_switch_live",
    });
    throw new Error("Kill switch live: un ou plusieurs matchs ont deja commence.");
  }

  const insights = computeCouponInsights(lastCouponData.coupon, lastCouponData.riskProfile || "balanced");
  const minStart = Number(insights?.minStartMinutes);
  // Double-check automatique au plus pres de T-120s.
  if (Number.isFinite(minStart) && minStart <= 2) {
    const payload = {
      driftThresholdPercent: getDriftThreshold(),
      selections: lastCouponData.coupon.map((x) => ({
        matchId: x.matchId,
        pari: x.pari,
        cote: x.cote,
      })),
    };
    const report = await fetchValidationReport(payload);
    if (String(report?.status || "") !== "TICKET_OK") {
      renderValidation(report);
      throw new Error("Double-check T-120s: ticket non valide, envoi Telegram bloque.");
    }
  }
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
    .map((p, i) => {
      const q = computeDataQualityScore(p);
      const replay = buildReplayLines(p, data.riskProfile || "balanced")
        .map((x) => `<li>${x}</li>`)
        .join("");
      return `
      <li>
        <strong>${i + 1}. ${p.teamHome} vs ${p.teamAway}</strong>
        <span>Ligue: ${p.league || "Non specifiee"}</span>
        <span>Heure locale: ${formatMatchLocalDateTime(p.startTimeUnix)} | <strong data-countdown-start="${Number(
        p.startTimeUnix || 0
      )}">T- ${formatCountdownLabel(p.startTimeUnix)}</strong></span>
        <span>${p.pari}</span>
        <span>Cote ${formatOdd(p.cote)} | Confiance ${p.confiance}%</span>
        <span>EV ${computePickEV(p) >= 0 ? "+" : ""}${computePickEV(p).toFixed(3)}</span>
        <div class="confidence-track"><i style="width:${Math.max(4, Math.min(100, Number(p.confiance) || 0))}%"></i><em>${Number(
          p.confiance || 0
        ).toFixed(0)}%</em></div>
        <span class="stability-badge" id="stability-${String(p.matchId)}">Stabilite: calcul...</span>
        <span class="quality-badge" id="quality-${String(p.matchId)}">Qualite donnees: ${q.score}/100</span>
        <div class="coach-pick-line">${explainPickSimple(p, data.riskProfile || "balanced")}</div>
        <ul class="replay-list">${replay}</ul>
        <a href="/match.html?id=${encodeURIComponent(p.matchId)}">Voir detail match</a>
      </li>
    `;
    })
    .join("");

  const insights = computeCouponInsights(picks, data.riskProfile || "balanced");
  const freeze = isCouponFrozen(picks);
  const stake = getStakeValue();
  const pay = payoutFromStake(stake, data.summary?.combinedOdd);
  const couponEv = computeCouponEV(picks);

  setResultHtml(`
    <h3>Coupon Optimise</h3>
    <div class="meta">
      <span>Selections: ${data.summary?.totalSelections ?? 0}</span>
      <span>Cote combinee: ${formatOdd(data.summary?.combinedOdd)}</span>
      <span>Confiance moyenne: ${data.summary?.averageConfidence ?? 0}%</span>
      <span>Profil: ${data.riskProfile || "balanced"}</span>
      <span>Ticket Shield: ACTIF</span>
      <span>Qualite: ${insights.qualityScore}/100</span>
      <span>Fiabilite ticket: ${insights.reliabilityIndex}/100</span>
      <span>Risque correlation: ${insights.correlationRisk}%</span>
      <span>Deadline: ${insights.minStartMinutes == null ? "-" : formatMinutes(insights.minStartMinutes)}</span>
      <span>Mise ${stake.toFixed(0)} => Retour ${pay.payout.toFixed(2)} | Net ${pay.net.toFixed(2)}</span>
      <span>EV total: ${couponEv >= 0 ? "+" : ""}${couponEv.toFixed(3)}</span>
      <span>Freeze ticket: ${freeze ? "ACTIF" : "OFF"} (${getFreezeMinutes()} min)</span>
    </div>
    <ol>${items}</ol>
    ${
      insights.correlationRisk >= 55
        ? `<p class="correlation-alert">Alerte correlation: ${insights.correlationRisk}% (plusieurs picks proches). Utilise "Remplacer Pick Faible" avant validation.</p>`
        : ""
    }
    <p class="warning">${data.warning || ""}</p>
  `);
  renderHealthPanel(picks, data.riskProfile || "balanced", data.summary || {});
  startCouponCountdownTimer();
  appendOddsJournalSnapshot("generation", picks);
  renderOddsJournalPanel();
  if (Number(insights.qualityScore || 0) < 60) {
    pushAlert({
      severity: "medium",
      title: "Qualite coupon faible",
      detail: `Qualite ${insights.qualityScore}/100, pense a remplacer un pick.`,
      type: "coupon_quality",
    });
  }
  const validationPanel = document.getElementById("validation");
  if (validationPanel) {
    validationPanel.innerHTML = "<p>Ticket genere. Clique sur <strong>Valider Ticket Pro</strong>.</p>";
  }
  addHistoryEntry({
    type: "coupon",
    at: new Date().toISOString(),
    note: `${data.summary?.totalSelections ?? 0} selections | cote ${formatOdd(data.summary?.combinedOdd)} | profil ${data.riskProfile || "balanced"}`,
  });
  if (!isLowDataModeEnabled()) {
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
  suggestStakeFromProfile();
  renderTicketComparePanel();
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
      const anti = applyAntiCorrelation(Array.isArray(data?.coupon) ? data.coupon : [], size);
      const picks = anti.coupon;
      const insights = computeCouponInsights(picks, profile);
      const evTotal = computeCouponEV(picks);
      const odd = Number(data.summary?.combinedOdd || 1);
      const p = clamp(Number(data.summary?.averageConfidence || 0) / 100, 0.03, 0.97);
      const expectedNet = Number((stake * (odd * p - 1)).toFixed(2));
      const riskIndex = clamp(Math.round((100 - insights.qualityScore) * 0.55 + insights.correlationRisk * 0.45), 1, 99);
      ranking.push({ profile, expectedNet, riskIndex, quality: insights.qualityScore, evTotal });
      cards.push(`
        <article class="risk-card">
          <h4>${profile.toUpperCase()}</h4>
          <div>Selections: ${data.summary?.totalSelections ?? picks.length}</div>
          <div>Cote: ${formatOdd(data.summary?.combinedOdd)}</div>
          <div>Confiance: ${data.summary?.averageConfidence ?? 0}%</div>
          <div>Qualite: ${insights.qualityScore}/100</div>
          <div>EV total: ${evTotal >= 0 ? "+" : ""}${evTotal.toFixed(3)}</div>
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

function buildTicketSnapshot(label = "A") {
  if (!lastCouponData?.coupon?.length) return null;
  const summary = lastCouponData.summary || createCouponSummary(lastCouponData.coupon);
  const insights = computeCouponInsights(lastCouponData.coupon, lastCouponData.riskProfile || "balanced");
  const stake = getStakeValue();
  const odd = Number(summary.combinedOdd || 1);
  const p = clamp(Number(summary.averageConfidence || 0) / 100, 0.03, 0.97);
  const expectedNet = Number((stake * (odd * p - 1)).toFixed(2));
  const riskIndex = clamp(Math.round((100 - insights.qualityScore) * 0.55 + insights.correlationRisk * 0.45), 1, 99);
  return {
    label,
    at: new Date().toISOString(),
    riskProfile: lastCouponData.riskProfile || "balanced",
    summary,
    insights,
    stake,
    expectedNet,
    riskIndex,
    picks: lastCouponData.coupon.map((x) => ({
      teamHome: x.teamHome,
      teamAway: x.teamAway,
      pari: x.pari,
      cote: x.cote,
      confiance: x.confiance,
      startTimeUnix: x.startTimeUnix,
    })),
  };
}

function renderTicketComparePanel() {
  const panel = document.getElementById("ticketComparePanel");
  if (!panel) return;
  const hasA = Boolean(ticketSnapshotA);
  const hasB = Boolean(ticketSnapshotB);
  const compareBtn = document.getElementById("compareTicketBtn");
  const saveABtn = document.getElementById("saveTicketABtn");
  const saveBBtn = document.getElementById("saveTicketBBtn");
  if (compareBtn) compareBtn.disabled = !(hasA && hasB);
  if (saveABtn) saveABtn.disabled = !lastCouponData?.coupon?.length;
  if (saveBBtn) saveBBtn.disabled = !lastCouponData?.coupon?.length;

  if (!hasA && !hasB) return;
  const card = (t) =>
    t
      ? `<div class="risk-card">
          <h4>Ticket ${t.label}</h4>
          <div>Profil: ${t.riskProfile}</div>
          <div>Qualite: ${t.insights?.qualityScore || 0}/100</div>
          <div>Risque: ${t.riskIndex}/100</div>
          <div>Gain net estime: ${t.expectedNet.toFixed(2)}</div>
          <div>Cote: ${formatOdd(t.summary?.combinedOdd)}</div>
        </div>`
      : `<div class="risk-card"><h4>Ticket -</h4><div>Non defini</div></div>`;
  let decision = "";
  if (hasA && hasB) {
    const qa = Number(ticketSnapshotA?.insights?.qualityScore || 0);
    const qb = Number(ticketSnapshotB?.insights?.qualityScore || 0);
    const ra = Number(ticketSnapshotA?.riskIndex || 0);
    const rb = Number(ticketSnapshotB?.riskIndex || 0);
    const choose = qb > qa || (qb === qa && rb < ra) ? "B" : "A";
    decision = `<p>Comparateur: meilleur compromis actuel <strong>Ticket ${choose}</strong>.</p>`;
  }
  panel.innerHTML = `
    <h3>Comparateur Tickets A/B</h3>
    <div class="actions">
      <button id="saveTicketABtn" type="button" ${lastCouponData?.coupon?.length ? "" : "disabled"}>Sauver Ticket A</button>
      <button id="saveTicketBBtn" type="button" ${lastCouponData?.coupon?.length ? "" : "disabled"}>Sauver Ticket B</button>
      <button id="compareTicketBtn" type="button" ${hasA && hasB ? "" : "disabled"}>Comparer A vs B</button>
    </div>
    ${decision}
    <div class="risk-grid">${card(ticketSnapshotA)}${card(ticketSnapshotB)}</div>
  `;
  const saveANew = document.getElementById("saveTicketABtn");
  const saveBNew = document.getElementById("saveTicketBBtn");
  const compareNew = document.getElementById("compareTicketBtn");
  if (saveANew) {
    saveANew.addEventListener("click", () => {
      ticketSnapshotA = buildTicketSnapshot("A");
      renderTicketComparePanel();
    });
  }
  if (saveBNew) {
    saveBNew.addEventListener("click", () => {
      ticketSnapshotB = buildTicketSnapshot("B");
      renderTicketComparePanel();
    });
  }
  if (compareNew) {
    compareNew.addEventListener("click", () => {
      renderTicketComparePanel();
    });
  }
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

function enforceUltraSafePolicy(coupon = []) {
  const nowSec = Math.floor(Date.now() / 1000);
  const filtered = (Array.isArray(coupon) ? coupon : [])
    .filter((x) => isStrictUpcomingMatch(x, nowSec))
    .filter((x) => Number(x?.cote) >= 1.3 && Number(x?.cote) <= 1.95)
    .filter((x) => Number(x?.confiance) >= 72)
    .slice(0, 3)
    .map((x) => ({ ...x }));
  return filtered;
}

function applyAntiCorrelation(coupon = [], targetSize = 3) {
  if (!Array.isArray(coupon) || !coupon.length || !isAntiCorrelationEnabled()) {
    return { coupon: Array.isArray(coupon) ? coupon : [], removed: 0, maxPerLeague: null };
  }
  const safeTarget = Math.max(1, Number(targetSize) || coupon.length || 1);
  const maxPerLeague = Math.max(1, Math.ceil(safeTarget / 3));
  const sorted = [...coupon].sort((a, b) => Number(b?.confiance || 0) - Number(a?.confiance || 0));
  const counts = new Map();
  const filtered = [];
  let removed = 0;
  for (const pick of sorted) {
    const league = String(pick?.league || "AUTRE");
    const c = counts.get(league) || 0;
    if (c >= maxPerLeague) {
      removed += 1;
      continue;
    }
    counts.set(league, c + 1);
    filtered.push(pick);
    if (filtered.length >= safeTarget) break;
  }
  return { coupon: filtered, removed, maxPerLeague };
}

function computePickEV(pick) {
  const p = clamp(Number(pick?.confiance || 0) / 100, 0.01, 0.99);
  const odd = Math.max(1, Number(pick?.cote || 1));
  return Number((odd * p - 1).toFixed(3));
}

function computeCouponEV(coupon = []) {
  return Number((coupon.reduce((acc, p) => acc + computePickEV(p), 0)).toFixed(3));
}

function isCouponFrozen(coupon = [], freezeMinutes = getFreezeMinutes()) {
  if (!Array.isArray(coupon) || !coupon.length) return false;
  const insights = computeCouponInsights(coupon, lastCouponData?.riskProfile || "balanced");
  const minStart = Number(insights?.minStartMinutes);
  if (!Number.isFinite(minStart)) return false;
  return minStart <= Number(freezeMinutes);
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
  const toFix = Number(report?.summary?.toFix || 0);
  if (toFix > 0) {
    pushAlert({
      severity: toFix >= 2 ? "high" : "medium",
      title: "Validation ticket: corrections requises",
      detail: `${toFix} selection(s) a corriger avant envoi.`,
      type: "validation_fix",
    });
  }
  const maxDrift = Math.max(
    0,
    ...(Array.isArray(report?.validatedSelections)
      ? report.validatedSelections.map((x) => Number(x?.driftPercent || 0))
      : [0])
  );
  if (maxDrift >= getDriftThreshold() + 3) {
    pushAlert({
      severity: "high",
      title: "Drift fort detecte",
      detail: `Drift max ${maxDrift.toFixed(2)}%`,
      type: "drift",
    });
  }
  appendOddsJournalSnapshot("validation", Array.isArray(lastCouponData?.coupon) ? lastCouponData.coupon : []);
  renderOddsJournalPanel();
  renderHealthPanel(lastCouponData?.coupon || [], lastCouponData?.riskProfile || "balanced", lastCouponData?.summary || {});
  addHistoryEntry({
    type: "validation",
    at: new Date().toISOString(),
    note: `${statusLabel} | total ${report.summary?.total ?? 0} | a corriger ${report.summary?.toFix ?? 0}`,
  });
}

async function sendCouponToTelegram(sendImage = false, mini = false) {
  const panel = document.getElementById("validation");
  if (!lastCouponData || !Array.isArray(lastCouponData.coupon) || lastCouponData.coupon.length === 0) {
    if (panel) panel.innerHTML = "<p>Genere d'abord un coupon avant envoi Telegram.</p>";
    return;
  }

  if (panel) panel.innerHTML = `<p>Envoi Telegram ${mini ? "mini" : sendImage ? "image" : "texte"} en cours...</p>`;

  try {
    enforceStakeSafetyCap();
    await replaceStartedSelectionsBeforeTelegram();
    await preflightTelegramSafety();
    await maybeStartAlertAndReplace();
    const adapted = await enforceTicketShield("envoi Telegram");

    const payload = {
      coupon: lastCouponData.coupon,
      summary: lastCouponData.summary || {},
      riskProfile: lastCouponData.riskProfile || "balanced",
      sendImage,
      mini: Boolean(mini && !sendImage),
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
        <p>${data.message || `Coupon ${mini ? "mini" : sendImage ? "image" : "texte"} envoye sur Telegram.`}</p>
        <p>Ticket Shield IA: drift ${getDriftThreshold()}% | Remplacements: ${adapted.replaced}</p>
      `;
    }
    addHistoryEntry({
      type: "telegram",
      at: new Date().toISOString(),
      note: `Coupon ${mini ? "mini" : sendImage ? "image" : "texte"} envoye Telegram | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
    });
    appendOddsJournalSnapshot(sendImage ? "telegram_image" : mini ? "telegram_mini" : "telegram_text", lastCouponData.coupon);
    renderOddsJournalPanel();
    pushAlert({
      severity: "low",
      title: "Envoi Telegram reussi",
      detail: `Mode ${mini ? "mini" : sendImage ? "image" : "texte"} | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
      type: "telegram_sent",
    });
    notifyEvent("Coupon envoye", `Telegram ${mini ? "mini" : sendImage ? "image" : "texte"} reussi.`);
    renderServerHistoryPanel();
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur Telegram: ${error.message}</p>`;
    pushAlert({ severity: "high", title: "Erreur Telegram", detail: error.message, type: "telegram_error" });
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
    notifyEvent("Coupon envoye", `PDF ${label} telecharge.`);
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur PDF: ${error.message}</p>`;
    pushAlert({ severity: "high", title: "Erreur PDF", detail: error.message, type: "pdf_error" });
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
    notifyEvent("Coupon envoye", "Pack PDF (resume + detaille) lance.");
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur PDF pack: ${error.message}</p>`;
    pushAlert({ severity: "high", title: "Erreur PDF pack", detail: error.message, type: "pdf_pack_error" });
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
    await enforceTicketShield(mode === "story" ? "export story" : mode === "premium" ? "export image premium" : "export image");
    const format = mode === "story" ? "jpg" : "png";
    const blob = await fetchCouponImageBlob(mode, format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = mode === "story" ? "story" : mode === "premium" ? "premium" : "image";
    a.download = `coupon-fc25-${suffix}-${Date.now()}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (panel) {
      panel.innerHTML = `<p>${
        mode === "story" ? "Snap Story" : mode === "premium" ? "Image premium" : "Image coupon"
      } telecharge${mode === "story" ? "" : "e"}.</p><div class="coupon-image-preview"><img src="${url}" alt="Apercu coupon image"/></div>`;
    }
    addHistoryEntry({
      type: "pdf",
      at: new Date().toISOString(),
      note: `Export ${
        mode === "story" ? "snap story" : mode === "premium" ? "image premium" : "image coupon"
      } | ${lastCouponData.summary?.totalSelections ?? 0} selections`,
    });
    notifyEvent(
      "Coupon envoye",
      `${mode === "story" ? "Snap story" : mode === "premium" ? "Image premium" : "Image coupon"} telecharge${
        mode === "story" ? "" : "e"
      }.`
    );
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    if (panel) panel.innerHTML = `<p>Erreur image: ${error.message}</p>`;
    pushAlert({ severity: "high", title: "Erreur image coupon", detail: error.message, type: "image_error" });
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
      const risk = normalizeRiskProfile(document.getElementById("riskSelect")?.value || "balanced");
      if (risk === "ultra_safe") {
        const driftInput = document.getElementById("driftInput");
        if (driftInput) driftInput.value = "4";
      }
      const apiRisk = risk === "ultra_safe" ? "safe" : risk;
      const requestedSize = risk === "ultra_safe" ? Math.min(3, size) : size;
      let data;
    try {
      const res = await fetch(
        `/api/coupon?size=${requestedSize}&league=${encodeURIComponent(league)}&risk=${encodeURIComponent(apiRisk)}`,
        { cache: "no-store" }
      );
      data = await readJsonSafe(res);
      if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur /api/coupon");
      } catch (primaryErr) {
        data = await generateCouponFallback(requestedSize, league, risk);
        if (!data?.success) throw primaryErr;
      }
      let baseCoupon = Array.isArray(data?.coupon) ? data.coupon : [];
      if (risk === "ultra_safe") {
        baseCoupon = enforceUltraSafePolicy(baseCoupon);
      }
      const anti = applyAntiCorrelation(baseCoupon, requestedSize);
      data = {
        ...data,
        riskProfile: risk,
        coupon: anti.coupon,
        summary: createCouponSummary(anti.coupon),
        warning: anti.removed > 0
          ? `Anti-correlation actif: ${anti.removed} pick(s) retire(s), max ${anti.maxPerLeague} par ligue. ${data?.warning || ""}`
          : data?.warning,
      };
      if (risk === "ultra_safe") {
        data.warning = `Mode Ultra-Safe: max 3 matchs, cote 1.30-1.95, confiance >=72%, pre-match uniquement. ${data.warning || ""}`;
      }
      renderCoupon(data);
      lastCouponBackups = await buildBackupPlan(Array.isArray(data?.coupon) ? data.coupon : [], risk);
      renderServerHistoryPanel();
      pushAlert({
        severity: "low",
        title: "Coupon genere",
        detail: `${data?.summary?.totalSelections || 0} selections | qualite ${computeCouponInsights(data?.coupon || [], risk).qualityScore}/100`,
        type: "coupon_generated",
      });
    } catch (error) {
    setResultHtml(`<p>Erreur: ${error.message}</p>`);
    pushAlert({ severity: "high", title: "Echec generation coupon", detail: error.message, type: "coupon_error" });
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
    if (isCouponFrozen(lastCouponData.coupon)) {
      throw new Error(`Freeze actif: adaptation Ticket Shield bloquee (<= ${getFreezeMinutes()} min).`);
    }
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
  pushAlert({
    severity: minStart <= 2 ? "high" : "medium",
    title: "Match proche du demarrage",
    detail: `Un match commence dans ${Math.max(0, Math.floor(minStart))} min.`,
    type: "start_alert",
  });
  if (minStart <= 2) {
    await replaceWeakSelection();
    return;
  }
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
    enforceStakeSafetyCap();
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
    renderPostTicketReport(data);
    renderServerHistoryPanel();
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
  if (isCouponFrozen(lastCouponData.coupon)) {
    if (panel) panel.innerHTML = `<p>Freeze actif: remplacement bloque (<= ${getFreezeMinutes()} min avant debut).</p>`;
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
const sendTelegramMiniBtn = document.getElementById("sendTelegramMiniBtn");
const sendLadderTelegramBtn = document.getElementById("sendLadderTelegramBtn");
const sendPackBtn = document.getElementById("sendPackBtn");
const sendTelegramImageBtn = document.getElementById("sendTelegramImageBtn");
const printA4Btn = document.getElementById("printA4Btn");
const analyzeJournalBtn = document.getElementById("analyzeJournalBtn");
const replayJournalBtn = document.getElementById("replayJournalBtn");
const watchlistFromCouponBtn = document.getElementById("watchlistFromCouponBtn");
const downloadImageBtn = document.getElementById("downloadImageBtn");
const downloadPremiumImageBtn = document.getElementById("downloadPremiumImageBtn");
const downloadStoryBtn = document.getElementById("downloadStoryBtn");
const downloadPdfQuickBtn = document.getElementById("downloadPdfQuickBtn");
const downloadPdfBtn = document.getElementById("downloadPdfBtn");
const downloadPdfDetailedBtn = document.getElementById("downloadPdfDetailedBtn");
const exportProBtn = document.getElementById("exportProBtn");
const generateBtnSticky = document.getElementById("generateBtnSticky");
const validateBtnSticky = document.getElementById("validateBtnSticky");
const sendTelegramBtnSticky = document.getElementById("sendTelegramBtnSticky");
const sendTelegramImageBtnSticky = document.getElementById("sendTelegramImageBtnSticky");
const downloadPdfBtnSticky = document.getElementById("downloadPdfBtnSticky");
const saveTicketABtn = document.getElementById("saveTicketABtn");
const saveTicketBBtn = document.getElementById("saveTicketBBtn");
const compareTicketBtn = document.getElementById("compareTicketBtn");

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
if (sendTelegramMiniBtn) {
  sendTelegramMiniBtn.addEventListener("click", () => sendCouponToTelegram(false, true));
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
if (replayJournalBtn) {
  replayJournalBtn.addEventListener("click", renderPerformanceReplay);
}
if (watchlistFromCouponBtn) {
  watchlistFromCouponBtn.addEventListener("click", buildWatchlistFromCoupon);
}
if (downloadImageBtn) {
  downloadImageBtn.addEventListener("click", () => downloadCouponImage("default"));
}
if (downloadPremiumImageBtn) {
  downloadPremiumImageBtn.addEventListener("click", () => downloadCouponImage("premium"));
}
if (downloadStoryBtn) {
  downloadStoryBtn.addEventListener("click", () => downloadCouponImage("story"));
}
if (saveTicketABtn) {
  saveTicketABtn.addEventListener("click", () => {
    ticketSnapshotA = buildTicketSnapshot("A");
    renderTicketComparePanel();
  });
}
if (saveTicketBBtn) {
  saveTicketBBtn.addEventListener("click", () => {
    ticketSnapshotB = buildTicketSnapshot("B");
    renderTicketComparePanel();
  });
}
if (compareTicketBtn) {
  compareTicketBtn.addEventListener("click", renderTicketComparePanel);
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
if (exportProBtn) {
  exportProBtn.addEventListener("click", exportProReport);
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
      startAutoCouponScheduler();
    });
  }

  const autoIntervalInput = document.getElementById("autoCouponIntervalInput");
  if (autoIntervalInput) {
    autoIntervalInput.value = String(getAutoCouponIntervalMinutes());
    autoIntervalInput.addEventListener("change", () => {
      const v = setAutoCouponIntervalMinutes(autoIntervalInput.value);
      autoIntervalInput.value = String(v);
      startAutoCouponScheduler();
    });
  }

  const autoQualityInput = document.getElementById("autoCouponQualityInput");
  if (autoQualityInput) {
    autoQualityInput.value = String(getAutoCouponQualityThreshold());
    autoQualityInput.addEventListener("change", () => {
      const v = setAutoCouponQualityThreshold(autoQualityInput.value);
      autoQualityInput.value = String(v);
    });
  }

  const autoTelegramSwitch = document.getElementById("autoCouponTelegramSwitch");
  if (autoTelegramSwitch) {
    autoTelegramSwitch.checked = isAutoCouponTelegramEnabled();
    autoTelegramSwitch.addEventListener("change", () => {
      setAutoCouponTelegramEnabled(autoTelegramSwitch.checked);
    });
  }

  const bankrollProfileSelect = document.getElementById("bankrollProfileSelect");
  if (bankrollProfileSelect) {
    bankrollProfileSelect.value = getBankrollProfile();
    bankrollProfileSelect.addEventListener("change", () => {
      applyBankrollProfilePreset(bankrollProfileSelect.value);
    });
  }

  const riskSelect = document.getElementById("riskSelect");
  if (riskSelect) {
    riskSelect.value = normalizeRiskProfile(riskSelect.value || "balanced");
    riskSelect.addEventListener("change", () => {
      const risk = normalizeRiskProfile(riskSelect.value || "balanced");
      if (risk === "ultra_safe") {
        const driftInput = document.getElementById("driftInput");
        const sizeInput = document.getElementById("sizeInput");
        if (driftInput) driftInput.value = "4";
        if (sizeInput && Number(sizeInput.value || 0) > 3) sizeInput.value = "3";
      }
      suggestStakeFromProfile();
      enforceStakeSafetyCap();
    });
  }

  const antiSwitch = document.getElementById("antiCorrelationSwitch");
  if (antiSwitch) {
    antiSwitch.checked = isAntiCorrelationEnabled();
    antiSwitch.addEventListener("change", () => {
      setAntiCorrelationEnabled(antiSwitch.checked);
      if (lastCouponData?.coupon?.length) {
        const size = Math.max(1, Math.min(Number(document.getElementById("sizeInput")?.value) || lastCouponData.coupon.length, 12));
        const anti = applyAntiCorrelation(lastCouponData.coupon, size);
        lastCouponData = {
          ...lastCouponData,
          coupon: anti.coupon,
          summary: createCouponSummary(anti.coupon),
          warning: anti.removed > 0
            ? `Anti-correlation actif: ${anti.removed} pick(s) retire(s), max ${anti.maxPerLeague} par ligue.`
            : lastCouponData.warning,
        };
        renderCoupon(lastCouponData);
      }
    });
  }

  const freezeInput = document.getElementById("freezeMinutesInput");
  if (freezeInput) {
    freezeInput.value = String(getFreezeMinutes());
    freezeInput.addEventListener("change", () => {
      const m = setFreezeMinutes(freezeInput.value);
      freezeInput.value = String(m);
      updateSendButtonState();
    });
  }

  const liveSimSwitch = document.getElementById("liveSimSwitch");
  if (liveSimSwitch) {
    liveSimSwitch.checked = isLiveSimulationEnabled();
    liveSimSwitch.addEventListener("change", () => {
      setLiveSimulationEnabled(liveSimSwitch.checked);
      restartLiveMonitors();
    });
  }

  const autoHealSwitch = document.getElementById("autoHealSwitch");
  if (autoHealSwitch) {
    autoHealSwitch.checked = isAutoHealEnabled();
    autoHealSwitch.addEventListener("change", () => {
      setAutoHealEnabled(autoHealSwitch.checked);
    });
  }

  const lowDataSwitch = document.getElementById("lowDataSwitch");
  if (lowDataSwitch) {
    lowDataSwitch.checked = isLowDataModeEnabled();
    setLowDataModeEnabled(lowDataSwitch.checked);
    lowDataSwitch.addEventListener("change", () => {
      setLowDataModeEnabled(lowDataSwitch.checked);
      restartLiveMonitors();
      renderTicketComparePanel();
    });
  }

  await loadLeagues();
  renderHistory();
  renderAlertsPanel();
  renderOddsJournalPanel();
  renderServerHistoryPanel();
  renderPerformanceJournal();
  renderWatchlistPanel();
  renderTicketComparePanel();
  updateSendButtonState();
  restartLiveMonitors();
  restartServerHistoryMonitor();
  startAutoCouponScheduler();
  suggestStakeFromProfile();
  enforceStakeSafetyCap();

  if ("Notification" in window && Notification.permission === "default") {
    try {
      Notification.requestPermission();
    } catch {}
  }

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
    enforceStakeSafetyCap();
    if (lastCouponData) renderCoupon(lastCouponData);
  });
}
const bankrollInput = document.getElementById("bankrollInput");
if (bankrollInput) {
  bankrollInput.addEventListener("input", () => {
    enforceStakeSafetyCap();
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
      "send_telegram_mini",
      "send_ladder_telegram",
      "send_telegram_image",
      "send_telegram_pack",
      "print_a4",
      "analyze_journal",
      "replay_journal",
      "download_image",
      "download_image_premium",
      "download_story",
      "download_pdf_quick",
      "download_pdf_summary",
      "download_pdf_detailed",
      "export_pro_report",
      "set_coupon_form",
      "set_auto_coupon",
      "set_auto_coupon_interval",
      "set_auto_coupon_quality",
      "set_auto_coupon_telegram",
      "set_refresh_minutes",
      "set_anti_correlation",
      "set_freeze_minutes",
      "set_bankroll_profile",
      "set_live_simulation",
      "set_auto_heal",
      "set_low_data_mode",
      "build_watchlist",
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
      if (action === "send_telegram_mini") return sendCouponToTelegram(false, true);
      if (action === "send_ladder_telegram") return sendLadderToTelegram();
      if (action === "send_telegram_image") return sendCouponToTelegram(true);
      if (action === "send_telegram_pack") return sendCouponPackToTelegram();
      if (action === "print_a4") return openPrintA4Mode();
      if (action === "analyze_journal") return renderPerformanceJournal();
      if (action === "replay_journal") return renderPerformanceReplay();
      if (action === "build_watchlist") return buildWatchlistFromCoupon();
      if (action === "download_image") return downloadCouponImage("default");
      if (action === "download_image_premium") return downloadCouponImage("premium");
      if (action === "download_story") return downloadCouponImage("story");
      if (action === "download_pdf_quick") return downloadCouponPdf("quick");
      if (action === "download_pdf_summary") return downloadCouponPdf("summary");
      if (action === "download_pdf_detailed") return downloadCouponPdf("detailed");
      if (action === "export_pro_report") return exportProReport();
      if (action === "set_auto_coupon") {
        const enabled = Boolean(payload?.enabled);
        setAutoCouponEnabled(enabled);
        const sw = document.getElementById("autoCouponSwitch");
        if (sw) sw.checked = enabled;
        startAutoCouponScheduler();
        return true;
      }
      if (action === "set_auto_coupon_interval") {
        const m = setAutoCouponIntervalMinutes(payload?.minutes);
        const input = document.getElementById("autoCouponIntervalInput");
        if (input) input.value = String(m);
        startAutoCouponScheduler();
        return true;
      }
      if (action === "set_auto_coupon_quality") {
        const q = setAutoCouponQualityThreshold(payload?.quality);
        const input = document.getElementById("autoCouponQualityInput");
        if (input) input.value = String(q);
        return true;
      }
      if (action === "set_auto_coupon_telegram") {
        const enabled = payload?.enabled !== false;
        setAutoCouponTelegramEnabled(enabled);
        const sw = document.getElementById("autoCouponTelegramSwitch");
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
      if (action === "set_anti_correlation") {
        const enabled = payload?.enabled !== false;
        setAntiCorrelationEnabled(enabled);
        const sw = document.getElementById("antiCorrelationSwitch");
        if (sw) sw.checked = enabled;
        return true;
      }
      if (action === "set_freeze_minutes") {
        const m = setFreezeMinutes(payload?.minutes);
        const input = document.getElementById("freezeMinutesInput");
        if (input) input.value = String(m);
        updateSendButtonState();
        return true;
      }
      if (action === "set_bankroll_profile") {
        const p = setBankrollProfile(payload?.profile);
        const input = document.getElementById("bankrollProfileSelect");
        if (input) input.value = p;
        applyBankrollProfilePreset(p);
        return true;
      }
      if (action === "set_live_simulation") {
        const enabled = payload?.enabled !== false;
        setLiveSimulationEnabled(enabled);
        const sw = document.getElementById("liveSimSwitch");
        if (sw) sw.checked = enabled;
        restartLiveMonitors();
        return true;
      }
      if (action === "set_auto_heal") {
        const enabled = payload?.enabled !== false;
        setAutoHealEnabled(enabled);
        const sw = document.getElementById("autoHealSwitch");
        if (sw) sw.checked = enabled;
        return true;
      }
      if (action === "set_low_data_mode") {
        const enabled = payload?.enabled !== false;
        setLowDataModeEnabled(enabled);
        const sw = document.getElementById("lowDataSwitch");
        if (sw) sw.checked = enabled;
        restartLiveMonitors();
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
