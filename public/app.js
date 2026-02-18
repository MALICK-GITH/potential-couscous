let allMatches = [];
let currentModeLabel = "";
let currentMatchMode = "upcoming";
const previousOddsByMatch = new Map();
const STRONG_ODD_CHANGE_PERCENT = 9;
const ODD_ALERT_COOLDOWN_MS = 90 * 1000;
const oddAlertLastShown = new Map();

function formatTime(unixSeconds) {
  if (!unixSeconds) return "Heure non disponible";
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatOdd(value) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

function scoreText(score) {
  if (!score || typeof score !== "object" || Object.keys(score).length === 0) return "Score: -";
  const h = score.S1 ?? score.SA ?? score.H ?? score.Home ?? "?";
  const a = score.S2 ?? score.SB ?? score.A ?? score.Away ?? "?";
  return `Score: ${h}-${a}`;
}

function extractScore(score) {
  if (!score || typeof score !== "object") return { home: "?", away: "?" };
  const home = score.S1 ?? score.SA ?? score.H ?? score.Home ?? "?";
  const away = score.S2 ?? score.SB ?? score.A ?? score.Away ?? "?";
  return { home, away };
}

function teamBadge(name) {
  const clean = String(name || "").trim();
  if (!clean) return "??";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createTeamLogo(name, logoUrl, fallbackUrl, isAway = false) {
  const fallback = teamBadge(name);
  const safeName = escapeHtml(name);
  const awayClass = isAway ? " away" : "";
  if (!logoUrl) {
    return `<div class="team-logo logo-fallback${awayClass}"><span class="team-logo-fallback">${fallback}</span></div>`;
  }
  const safeFallbackUrl = fallbackUrl ? ` data-fallback-src="${escapeHtml(fallbackUrl)}"` : "";
  return `
    <div class="team-logo${awayClass}">
      <img class="team-logo-img" src="${logoUrl}" alt="Logo ${safeName}" loading="lazy"${safeFallbackUrl} />
      <span class="team-logo-fallback">${fallback}</span>
    </div>
  `;
}

function createStat(title, value) {
  const el = document.createElement("article");
  el.className = "stat-box";
  el.innerHTML = `<small>${title}</small><strong>${value}</strong>`;
  return el;
}

function uniqueLeagues(matches) {
  const map = new Map();
  matches.forEach((match) => {
    const league = String(match.league || "").trim();
    if (league && !map.has(league.toLowerCase())) map.set(league.toLowerCase(), league);
  });
  return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "fr"));
}

function normalizeText(v) {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function classifyMatch(match) {
  const nowSec = Math.floor(Date.now() / 1000);
  const start = Number(match?.startTimeUnix || 0);
  const statusCode = Number(match?.statusCode || 0);
  const info = normalizeText(match?.infoText || "");
  const status = normalizeText(match?.statusText || "");
  const phase = normalizeText(match?.phase || "");

  const isFinishedByText =
    status.includes("termine") ||
    phase.includes("termine") ||
    info.includes("termine");

  const isUpcomingBySignal =
    statusCode === 128 ||
    info.includes("avant le debut") ||
    status.includes("debut dans");

  const isLiveByText =
    phase.includes("mi-temps") ||
    status.includes("minute") ||
    status.includes("mi-temps") ||
    info.includes("1ere mi-temps") ||
    info.includes("2eme mi-temps");

  if (isFinishedByText) return "finished";
  if (isUpcomingBySignal && start > nowSec) return "upcoming";
  if (isLiveByText) return "live";
  if (start > nowSec) return "upcoming";
  return "live";
}

function populateLeagueFilter(matches) {
  const select = document.getElementById("leagueSelect");
  const currentValue = select.value || "all";
  const leagues = uniqueLeagues(matches);

  select.innerHTML = '<option value="all">Toutes les ligues</option>';
  leagues.forEach((league) => {
    const option = document.createElement("option");
    option.value = league;
    option.textContent = league;
    select.appendChild(option);
  });

  if ([...select.options].some((opt) => opt.value === currentValue)) {
    select.value = currentValue;
  }
}

function createMatchCard(match, index) {
  const card = document.createElement("article");
  card.className = "match-card";
  card.style.animationDelay = `${Math.min(index * 0.04, 0.6)}s`;
  const score = extractScore(match.score);
  const status = match.statusText || "A venir";

  const detailLink = document.createElement("a");
  detailLink.className = "detail-btn";
  detailLink.href = `/match.html?id=${encodeURIComponent(match.id)}`;
  detailLink.textContent = "Detail predictions";

  card.innerHTML = `
    <div class="league-row">
      <p class="league">${match.league || "Ligue virtuelle"}</p>
      <span class="status-pill">${status}</span>
    </div>
    <div class="scoreboard">
      <div class="team-col">
        ${createTeamLogo(match.teamHome, match.teamHomeLogo, match.teamHomeLogoFallback)}
        <p class="team-name">${match.teamHome}</p>
      </div>
      <div class="score-center">${score.home} - ${score.away}</div>
      <div class="team-col">
        ${createTeamLogo(match.teamAway, match.teamAwayLogo, match.teamAwayLogoFallback, true)}
        <p class="team-name">${match.teamAway}</p>
      </div>
    </div>
    <div class="odds-row">
      <div class="odd-box ${match.trend?.home || ""}"><span>${match.teamHome}</span><strong>${formatOdd(match.odds1x2?.home)}</strong></div>
      <div class="odd-box ${match.trend?.draw || ""}"><span>Nul</span><strong>${formatOdd(match.odds1x2?.draw)}</strong></div>
      <div class="odd-box ${match.trend?.away || ""}"><span>${match.teamAway}</span><strong>${formatOdd(match.odds1x2?.away)}</strong></div>
    </div>
    <p class="kickoff">Coup d'envoi: ${formatTime(match.startTimeUnix)} | ${scoreText(match.score)}</p>
  `;

  card.appendChild(detailLink);
  card.querySelectorAll(".team-logo-img").forEach((img) => {
    img.addEventListener("error", () => {
      const wrapper = img.closest(".team-logo");
      const fallbackSrc = img.getAttribute("data-fallback-src");
      if (fallbackSrc && img.src !== fallbackSrc) {
        img.src = fallbackSrc;
        img.removeAttribute("data-fallback-src");
        return;
      }
      if (wrapper) wrapper.classList.add("logo-fallback");
    });
  });
  return card;
}

function normalizeOdd(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

function diffTrend(previous, next) {
  if (!Number.isFinite(previous) || !Number.isFinite(next)) return "";
  const diff = next - previous;
  if (Math.abs(diff) < 0.001) return "";
  return diff < 0 ? "odd-up" : "odd-down";
}

function changePercent(previous, next) {
  if (!Number.isFinite(previous) || !Number.isFinite(next) || previous <= 0) return null;
  return Math.abs(((next - previous) / previous) * 100);
}

function pushOddAlert(message) {
  const wrap = document.getElementById("oddAlerts");
  if (!wrap) return;
  const card = document.createElement("article");
  card.className = "odd-alert-card";
  card.textContent = message;
  wrap.appendChild(card);
  setTimeout(() => {
    card.classList.add("out");
    setTimeout(() => card.remove(), 420);
  }, 3800);
}

function enrichWithTrend(matches) {
  const alerts = [];
  const enriched = (matches || []).map((match) => {
    const key = String(match.id);
    const prev = previousOddsByMatch.get(key) || {};
    const next = {
      home: normalizeOdd(match?.odds1x2?.home),
      draw: normalizeOdd(match?.odds1x2?.draw),
      away: normalizeOdd(match?.odds1x2?.away),
    };
    previousOddsByMatch.set(key, next);

    const checks = [
      ["1", prev.home, next.home],
      ["X", prev.draw, next.draw],
      ["2", prev.away, next.away],
    ];

    for (const [label, oldOdd, newOdd] of checks) {
      const pct = changePercent(oldOdd, newOdd);
      if (pct == null || pct < STRONG_ODD_CHANGE_PERCENT) continue;
      const dir = newOdd < oldOdd ? "baisse" : "hausse";
      const alertKey = `${key}:${label}:${dir}`;
      const now = Date.now();
      const last = oddAlertLastShown.get(alertKey) || 0;
      if (now - last < ODD_ALERT_COOLDOWN_MS) continue;
      oddAlertLastShown.set(alertKey, now);
      alerts.push(
        `${match.teamHome} vs ${match.teamAway}: cote ${label} en ${dir} forte (${pct.toFixed(1)}%)`
      );
    }

    return {
      ...match,
      trend: {
        home: diffTrend(prev.home, next.home),
        draw: diffTrend(prev.draw, next.draw),
        away: diffTrend(prev.away, next.away),
      },
    };
  });
  if (alerts.length) {
    setTimeout(() => alerts.forEach((msg) => pushOddAlert(msg)), 120);
  }
  return enriched;
}

function renderMatches() {
  const subTitle = document.getElementById("subTitle");
  const matchesWrap = document.getElementById("matches");
  const emptyState = document.getElementById("emptyState");
  const leagueSelect = document.getElementById("leagueSelect");
  const selectedLeague = leagueSelect.value;

  const byLeague =
    selectedLeague === "all"
      ? allMatches
      : allMatches.filter((match) => match.league === selectedLeague);
  const filtered = byLeague.filter((match) => classifyMatch(match) === currentMatchMode);

  const leagueLabel = selectedLeague === "all" ? "toutes ligues" : `ligue: ${selectedLeague}`;
  const modeLabel =
    currentMatchMode === "upcoming" ? "A venir" : currentMatchMode === "live" ? "En cours" : "Termines";
  subTitle.textContent = `${filtered.length} match(s) (${leagueLabel}, ${modeLabel}) - ${currentModeLabel}`;

  matchesWrap.innerHTML = "";
  emptyState.classList.toggle("hidden", filtered.length > 0);
  if (filtered.length > 0) {
    filtered.forEach((match, index) => matchesWrap.appendChild(createMatchCard(match, index)));
    activateAmbientOddsPulse(matchesWrap);
  }
}

function activateAmbientOddsPulse(root) {
  const boxes = Array.from(root.querySelectorAll(".odd-box"));
  if (!boxes.length) return;
  boxes.forEach((b) => b.classList.remove("odd-live"));
  const sampleCount = Math.min(3, boxes.length);
  for (let i = 0; i < sampleCount; i += 1) {
    const idx = Math.floor(Math.random() * boxes.length);
    boxes[idx].classList.add("odd-live");
  }
}

async function loadMatches() {
  const subTitle = document.getElementById("subTitle");
  const statsWrap = document.getElementById("stats");
  const emptyState = document.getElementById("emptyState");
  const updatedAt = document.getElementById("updatedAt");

  subTitle.textContent = "Chargement en cours...";
  statsWrap.innerHTML = "";
  emptyState.classList.add("hidden");

  try {
    const res = await fetch("/api/matches", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.message || "Reponse API invalide");

    const rawMatches = Array.isArray(data.matches) ? data.matches : [];
    allMatches = enrichWithTrend(rawMatches);
    const mode = data.filterMode === "keyword-penalty" ? "filtre mot-cle" : "fallback groupe gr=285";
    currentModeLabel = `mode: ${mode}`;

    statsWrap.appendChild(createStat("Total API", data.totalFromApi ?? "-"));
    statsWrap.appendChild(createStat("Sport 85", data.totalSport85 ?? "-"));
    statsWrap.appendChild(createStat("Penalty", data.totalPenalty ?? "-"));
    statsWrap.appendChild(createStat("Ligues", uniqueLeagues(allMatches).length));

    populateLeagueFilter(allMatches);
    renderMatches();
    updatedAt.textContent = `Derniere mise a jour: ${new Date(data.fetchedAt).toLocaleString("fr-FR")}`;
  } catch (error) {
    subTitle.textContent = "Erreur de chargement";
    emptyState.classList.remove("hidden");
    emptyState.textContent = `Erreur: ${error.message}`;
    updatedAt.textContent = "";
  }
}

document.getElementById("refreshBtn").addEventListener("click", loadMatches);
document.getElementById("leagueSelect").addEventListener("change", renderMatches);
document.querySelectorAll(".match-mode").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentMatchMode = btn.dataset.mode || "upcoming";
    document.querySelectorAll(".match-mode").forEach((b) => b.classList.toggle("active", b === btn));
    renderMatches();
  });
});
loadMatches();
setInterval(() => {
  const wrap = document.getElementById("matches");
  if (wrap) activateAmbientOddsPulse(wrap);
}, 2300);
