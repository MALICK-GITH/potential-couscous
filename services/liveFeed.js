const API_URL =
  "https://1xbet.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=40&lng=fr&gr=285&mode=4&country=96&getEmpty=true&virtualSports=true&noFilterBlockEvent=true";
const { genererPredictionUnifiee, detectBetType } = require("./unifiedPrediction");

const PENALTY_KEYWORDS = [
  "penalty",
  "penalties",
  "tir au but",
  "tirs au but",
  "shootout",
  "penaltis",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toMatchText(event) {
  return normalizeText(
    [
      event.L,
      event.LE,
      event.LR,
      event.N,
      event.O1,
      event.O2,
      event.TN,
      event.SN,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isPenaltyEvent(event) {
  const text = toMatchText(event);
  return PENALTY_KEYWORDS.some((word) => text.includes(normalizeText(word)));
}

function extractOneXTwo(event) {
  const source = Array.isArray(event.E) ? event.E : [];
  const oneXTwo = source.filter((item) => Number(item.G) === 1);
  const pick = (type) => {
    const outcome = oneXTwo.find((item) => Number(item.T) === type);
    return outcome?.C ?? null;
  };
  return {
    home: pick(1),
    draw: pick(2),
    away: pick(3),
  };
}

function parseScoreContext(event) {
  const fs = event?.SC?.FS || {};
  const score1 = Number(fs.S1 ?? fs.H ?? fs.Home ?? fs.SA ?? 0) || 0;
  const score2 = Number(fs.S2 ?? fs.A ?? fs.Away ?? fs.SB ?? 0) || 0;

  let minute = 0;
  const cps = String(event?.SC?.CPS || "");
  const matchMinute = cps.match(/^(\d{1,2})/);
  if (matchMinute) {
    minute = Number(matchMinute[1]) || 0;
  }

  return { score1, score2, minute };
}

function formatLine(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function translateBetOption(g, t, line, event) {
  const home = event.O1 || "Equipe 1";
  const away = event.O2 || "Equipe 2";
  const p = formatLine(line);

  if (g === 1) {
    if (t === 1) return `1 - Victoire ${home}`;
    if (t === 2) return "X - Match nul";
    if (t === 3) return `2 - Victoire ${away}`;
  }

  if (g === 8) {
    if (t === 4) return `1X - ${home} ou nul`;
    if (t === 5) return "12 - Pas de match nul";
    if (t === 6) return `X2 - ${away} ou nul`;
  }

  if (g === 2) {
    if (t === 7) return `Handicap ${home} (${p || "0"})`;
    if (t === 8) return `Handicap ${away} (${p || "0"})`;
  }

  if (g === 17) {
    if (t === 9) return `Plus de ${p || "?"} buts`;
    if (t === 10) return `Moins de ${p || "?"} buts`;
  }

  if (g === 15) {
    if (t === 11) return `Total ${home} - Plus de ${p || "?"}`;
    if (t === 12) return `Total ${home} - Moins de ${p || "?"}`;
  }

  if (g === 62) {
    if (t === 13) return `Total ${away} - Plus de ${p || "?"}`;
    if (t === 14) return `Total ${away} - Moins de ${p || "?"}`;
  }

  if (g === 19) {
    if (t === 180) return "Les deux equipes marquent - Oui";
    if (t === 181) return "Les deux equipes marquent - Non";
  }

  return `Marche ${g}/${t}${p ? ` (${p})` : ""}`;
}

function extractAllBets(event) {
  const direct = Array.isArray(event?.E) ? event.E : [];
  const alternativeGroups = Array.isArray(event?.AE) ? event.AE : [];
  const alternative = alternativeGroups.flatMap((group) => (Array.isArray(group?.ME) ? group.ME : []));
  const all = [...direct, ...alternative];
  const map = new Map();

  for (const row of all) {
    const g = Number(row?.G);
    const t = Number(row?.T);
    const line = Number(row?.P);
    const cote = Number(row?.C);
    if (!Number.isFinite(cote) || cote <= 1) continue;
    const key = `${g}-${t}-${Number.isFinite(line) ? line : "na"}-${cote}`;
    if (map.has(key)) continue;
    const nom = translateBetOption(g, t, line, event);
    map.set(key, {
      key,
      nom,
      cote,
      code: { g, t, line: Number.isFinite(line) ? line : null },
      type: detectBetType(nom),
    });
  }

  return [...map.values()];
}

function simplifyEvent(event) {
  const context = parseScoreContext(event);
  return {
    id: event.I,
    teamHome: event.O1 || "Equipe 1",
    teamAway: event.O2 || "Equipe 2",
    league: event.L || event.LE || "Competition virtuelle",
    startTimeUnix: Number(event.S) || null,
    sportId: Number(event.SI) || null,
    statusText: event.SC?.SLS || event.SC?.I || "En attente",
    infoText: event.SC?.I || "",
    score: event.SC?.FS || {},
    context,
    odds1x2: extractOneXTwo(event),
    betsCount: extractAllBets(event).length,
  };
}

function schemaOf(value, depth = 2) {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.length > 0 ? schemaOf(value[0], depth - 1) : null,
    };
  }
  if (typeof value !== "object") return { type: typeof value };
  if (depth <= 0) return { type: "object" };
  const entries = {};
  for (const key of Object.keys(value).slice(0, 50)) {
    entries[key] = schemaOf(value[key], depth - 1);
  }
  return {
    type: "object",
    keys: Object.keys(value),
    props: entries,
  };
}

async function fetchLiveFeedRaw() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const response = await fetch(API_URL, {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getPenaltyMatches() {
  const payload = await fetchLiveFeedRaw();
  const events = Array.isArray(payload?.Value) ? payload.Value : [];
  const sportEvents = events.filter((event) => Number(event?.SI) === 85);
  const penaltyOnly = sportEvents.filter(isPenaltyEvent);
  const selected = penaltyOnly.length > 0 ? penaltyOnly : sportEvents;
  const filterMode =
    penaltyOnly.length > 0
      ? "keyword-penalty"
      : "group-fallback-gr-285";

  return {
    fetchedAt: new Date().toISOString(),
    totalFromApi: events.length,
    totalSport85: sportEvents.length,
    totalPenalty: penaltyOnly.length,
    filterMode,
    matches: selected.map(simplifyEvent),
  };
}

async function getMatchPredictionDetails(matchId) {
  const payload = await fetchLiveFeedRaw();
  const events = Array.isArray(payload?.Value) ? payload.Value : [];
  const found = events.find((event) => String(event?.I) === String(matchId));
  if (!found) {
    throw new Error("Match introuvable dans le flux actuel.");
  }

  return buildMatchPredictionDetails(found);
}

function buildMatchPredictionDetails(event) {
  const match = simplifyEvent(event);
  const bets = extractAllBets(event);
  const prediction = genererPredictionUnifiee({
    team1: match.teamHome,
    team2: match.teamAway,
    league: match.league,
    context: match.context,
    bets,
  });

  return {
    match,
    bettingMarkets: bets,
    prediction,
  };
}

function pickCouponOption(details) {
  const master = details?.prediction?.maitre?.decision_finale || {};
  const top = details?.prediction?.analyse_avancee?.top_3_recommandations || [];
  const marketByName = new Map((details?.bettingMarkets || []).map((m) => [m.nom, m]));

  const masterMarket = marketByName.get(master.pari_choisi);
  if (
    masterMarket &&
    Number.isFinite(master.confiance_numerique) &&
    master.confiance_numerique >= 50 &&
    masterMarket.cote >= 1.25 &&
    masterMarket.cote <= 2.2
  ) {
    return {
      pari: masterMarket.nom,
      cote: masterMarket.cote,
      confiance: master.confiance_numerique,
      source: "MAITRE",
    };
  }

  const bestTop = top
    .filter((x) => Number.isFinite(x?.cote) && x.cote >= 1.25 && x.cote <= 2.2)
    .sort((a, b) => b.score_composite - a.score_composite)[0];
  if (bestTop) {
    return {
      pari: bestTop.pari,
      cote: bestTop.cote,
      confiance: bestTop.score_composite || 50,
      source: "TOP3",
    };
  }

  const fallback = (details?.bettingMarkets || [])
    .filter((m) => m.cote >= 1.25 && m.cote <= 2.1)
    .sort((a, b) => a.cote - b.cote)[0];
  if (!fallback) return null;
  return {
    pari: fallback.nom,
    cote: fallback.cote,
    confiance: 45,
    source: "FALLBACK",
  };
}

function normalizeLeague(value) {
  return normalizeText(String(value || "").trim());
}

async function getCouponSelection(size = 3, league = "all") {
  const payload = await fetchLiveFeedRaw();
  const events = Array.isArray(payload?.Value) ? payload.Value : [];
  const sportEvents = events.filter((event) => Number(event?.SI) === 85);
  const penaltyOnly = sportEvents.filter(isPenaltyEvent);
  const sourceEvents = penaltyOnly.length > 0 ? penaltyOnly : sportEvents;
  const selectedLeague = normalizeLeague(league);
  const eventsFiltered =
    selectedLeague && selectedLeague !== "all"
      ? sourceEvents.filter((e) => normalizeLeague(e?.L || e?.LE || "") === selectedLeague)
      : sourceEvents;

  const allDetails = eventsFiltered.map((event) => buildMatchPredictionDetails(event));
  const candidates = allDetails
    .map((details) => {
      const option = pickCouponOption(details);
      if (!option) return null;
      const safetyScore = option.confiance - Math.abs(option.cote - 1.65) * 11;
      return {
        matchId: details.match.id,
        teamHome: details.match.teamHome,
        teamAway: details.match.teamAway,
        league: details.match.league,
        startTimeUnix: details.match.startTimeUnix,
        pari: option.pari,
        cote: option.cote,
        confiance: Number(option.confiance.toFixed(1)),
        source: option.source,
        safetyScore: Number(safetyScore.toFixed(2)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.safetyScore - a.safetyScore);

  const wanted = Math.max(1, Math.min(parseInt(String(size), 10) || 3, 12));
  const picks = candidates.slice(0, wanted);
  const combinedOdd =
    picks.length > 0 ? Number(picks.reduce((acc, p) => acc * p.cote, 1).toFixed(3)) : null;
  const avgConfidence =
    picks.length > 0
      ? Number((picks.reduce((acc, p) => acc + p.confiance, 0) / picks.length).toFixed(1))
      : 0;

  return {
    generatedAt: new Date().toISOString(),
    requestedMatches: wanted,
    availableCandidates: candidates.length,
    leagueFilter: league || "all",
    coupon: picks,
    summary: {
      totalSelections: picks.length,
      combinedOdd,
      averageConfidence: avgConfidence,
    },
    warning:
      "Aucune combinaison n'est garantie gagnante. Ce coupon est une optimisation algorithmique.",
  };
}

async function getStructure() {
  const payload = await fetchLiveFeedRaw();
  const firstEvent =
    Array.isArray(payload?.Value) && payload.Value.length > 0 ? payload.Value[0] : null;

  return {
    fetchedAt: new Date().toISOString(),
    topLevelKeys: Object.keys(payload || {}),
    notes: {
      listField: "Value",
      eventId: "I",
      teams: "O1/O2",
      league: "L (LE/LR variantes langue)",
      scoreBlock: "SC",
      oneXTwoMarkets: "E avec G=1, T=1|2|3, cote dans C",
    },
    schema: {
      payload: schemaOf(payload, 2),
      firstEvent: schemaOf(firstEvent, 2),
      firstMarketE: schemaOf(firstEvent?.E?.[0] || null, 2),
      scoreSC: schemaOf(firstEvent?.SC || null, 2),
    },
  };
}

module.exports = {
  API_URL,
  fetchLiveFeedRaw,
  getPenaltyMatches,
  getStructure,
  getMatchPredictionDetails,
  getCouponSelection,
};
