const API_URL =
  "https://1xbet.com/service-api/LiveFeed/Get1x2_VZip?sports=85&count=40&lng=fr&gr=285&mode=4&country=96&getEmpty=true&virtualSports=true&noFilterBlockEvent=true";
const { genererPredictionUnifiee, detectBetType } = require("./unifiedPrediction");
const { evaluateMatch } = require("./extraPowerFilter");

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

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
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

function toLogoProxyUrl(fileName) {
  const clean = String(fileName || "").trim();
  if (!clean) return null;
  return `/api/logo/${encodeURIComponent(clean)}`;
}

function toTeamBadgeUrl(teamName) {
  const clean = String(teamName || "").trim();
  return `/api/team-badge?name=${encodeURIComponent(clean || "Equipe")}`;
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
    if (t === 180) return "Total Pair/Impair - Pair";
    if (t === 181) return "Total Pair/Impair - Impair";
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
  const homeLogoFile = Array.isArray(event?.O1IMG) ? event.O1IMG[0] : null;
  const awayLogoFile = Array.isArray(event?.O2IMG) ? event.O2IMG[0] : null;
  const homeBadge = toTeamBadgeUrl(event.O1 || "Equipe 1");
  const awayBadge = toTeamBadgeUrl(event.O2 || "Equipe 2");
  const homeProxy = toLogoProxyUrl(homeLogoFile);
  const awayProxy = toLogoProxyUrl(awayLogoFile);
  return {
    id: event.I,
    teamHome: event.O1 || "Equipe 1",
    teamAway: event.O2 || "Equipe 2",
    teamHomeLogo: homeProxy || homeBadge,
    teamAwayLogo: awayProxy || awayBadge,
    teamHomeLogoFallback: homeBadge,
    teamAwayLogoFallback: awayBadge,
    teamHomeLogoFile: homeLogoFile || null,
    teamAwayLogoFile: awayLogoFile || null,
    league: event.L || event.LE || "Competition virtuelle",
    startTimeUnix: Number(event.S) || null,
    sportId: Number(event.SI) || null,
    statusText: event.SC?.SLS || event.SC?.I || "En attente",
    infoText: event.SC?.I || "",
    statusCode: Number(event.SC?.GS) || null,
    phase: event.SC?.CPS || "",
    score: event.SC?.FS || {},
    context,
    odds1x2: extractOneXTwo(event),
    betsCount: extractAllBets(event).length,
  };
}

function impliedOneXTwoPercents(odds = {}) {
  const h = Number(odds?.home);
  const d = Number(odds?.draw);
  const a = Number(odds?.away);
  if (![h, d, a].every((x) => Number.isFinite(x) && x > 1)) {
    return { home: 0, draw: 0, away: 0 };
  }
  const ih = 1 / h;
  const id = 1 / d;
  const ia = 1 / a;
  const sum = ih + id + ia || 1;
  return {
    home: (ih / sum) * 100,
    draw: (id / sum) * 100,
    away: (ia / sum) * 100,
  };
}

function parseConsensusBots(prediction) {
  const raw = String(prediction?.maitre?.analyse_bots?.consensus || "");
  const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return 0;
  return Number(match[1]) || 0;
}

function inferPickSide(pari, teamHome, teamAway) {
  const p = normalizeText(pari || "");
  const home = normalizeText(teamHome || "");
  const away = normalizeText(teamAway || "");
  if (away && p.includes(away)) return "AWAY";
  if (home && p.includes(home)) return "HOME";
  if (p.startsWith("2 ") || p.includes(" victoire ") || p.includes("x2")) return "AWAY";
  if (p.startsWith("1 ") || p.includes("1x")) return "HOME";
  return "HOME";
}

function syntheticFluxSeries(base, momentum, swings = [0, 2, 4, 6, 4, 2, 0, -1, 1, 2]) {
  return swings.map((s, i) => clamp(base + momentum * (i / (swings.length - 1)) + s, 0, 100));
}

function buildExtraFilterInput(details, pickedPari) {
  const action = String(details?.prediction?.maitre?.decision_finale?.action || "");
  const confidence = Number(details?.prediction?.maitre?.decision_finale?.confiance_numerique || 0);
  const consensusBots = parseConsensusBots(details?.prediction);
  const implied = impliedOneXTwoPercents(details?.match?.odds1x2 || {});
  const ctx = details?.match?.context || {};
  const s1 = Number(ctx.score1 || 0);
  const s2 = Number(ctx.score2 || 0);
  const minute = Number(ctx.minute || 0);

  const homeMomentum = clamp((s1 - s2) * 3 + (minute > 45 ? 2 : 0), -12, 12);
  const awayMomentum = clamp((s2 - s1) * 3 + (minute > 45 ? 2 : 0), -12, 12);
  const drawBase = clamp(implied.draw - Math.abs(s1 - s2) * 2 - (minute > 70 ? 4 : 0), 3, 45);

  return {
    confidence,
    consensusBots,
    winHome: Number(implied.home.toFixed(1)),
    winAway: Number(implied.away.toFixed(1)),
    action,
    pickSide: inferPickSide(pickedPari, details?.match?.teamHome, details?.match?.teamAway),
    homeFlux: syntheticFluxSeries(implied.home, homeMomentum),
    awayFlux: syntheticFluxSeries(implied.away, awayMomentum),
    zoneNull: syntheticFluxSeries(drawBase, -Math.abs(homeMomentum - awayMomentum) / 2, [0, 1, 1, 0, -1, -2, -1, 0, 1, 0]),
  };
}

function isStrictUpcomingEvent(event, nowSec) {
  const start = Number(event?.S);
  if (!Number.isFinite(start) || start <= nowSec) return false;

  const gs = Number(event?.SC?.GS);
  const info = normalizeText(event?.SC?.I || "");
  const sls = normalizeText(event?.SC?.SLS || "");
  const cps = normalizeText(event?.SC?.CPS || "");

  const preByCode = gs === 128;
  const preByInfo = info.includes("avant le debut") || info.includes("avant le debut du jeu");
  const preBySls = sls.includes("debut dans");
  const inPlayMarkers =
    cps.includes("mi-temps") ||
    cps.includes("1ere mi-temps") ||
    cps.includes("2eme mi-temps") ||
    cps.includes("jeu termine") ||
    info.includes("match termine");

  if (inPlayMarkers) return false;
  return preByCode || preByInfo || preBySls;
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
  const details = buildMatchPredictionDetails(found);
  const pickedPari = details?.prediction?.maitre?.decision_finale?.pari_choisi || "";
  const evalInput = buildExtraFilterInput(details, pickedPari);
  const extraFilter = evaluateMatch(evalInput, { totalMatches: events.length }, { minMatches: 50 });
  return {
    ...details,
    extraPowerFilter: extraFilter,
  };
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

function riskConfig(profile = "balanced") {
  const key = normalizeText(profile);
  if (key === "safe") {
    return { minOdd: 1.2, maxOdd: 1.7, minConfidence: 62, slope: 8 };
  }
  if (key === "aggressive") {
    return { minOdd: 1.55, maxOdd: 3.2, minConfidence: 45, slope: 6 };
  }
  return { minOdd: 1.3, maxOdd: 2.25, minConfidence: 50, slope: 11 };
}

function pickCouponOption(details, profile = "balanced") {
  const cfg = riskConfig(profile);
  const master = details?.prediction?.maitre?.decision_finale || {};
  const top = details?.prediction?.analyse_avancee?.top_3_recommandations || [];
  const marketByName = new Map((details?.bettingMarkets || []).map((m) => [m.nom, m]));

  const masterMarket = marketByName.get(master.pari_choisi);
  if (
    masterMarket &&
    Number.isFinite(master.confiance_numerique) &&
    master.confiance_numerique >= cfg.minConfidence &&
    masterMarket.cote >= cfg.minOdd &&
    masterMarket.cote <= cfg.maxOdd
  ) {
    return {
      pari: masterMarket.nom,
      cote: masterMarket.cote,
      confiance: master.confiance_numerique,
      source: "MAITRE",
    };
  }

  const bestTop = top
    .filter((x) => Number.isFinite(x?.cote) && x.cote >= cfg.minOdd && x.cote <= cfg.maxOdd)
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
    .filter((m) => m.cote >= cfg.minOdd && m.cote <= cfg.maxOdd)
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

async function getCouponSelection(size = 3, league = "all", profile = "balanced") {
  const payload = await fetchLiveFeedRaw();
  const nowSec = Math.floor(Date.now() / 1000);
  const events = Array.isArray(payload?.Value) ? payload.Value : [];
  const sportEvents = events.filter((event) => Number(event?.SI) === 85);
  const penaltyOnly = sportEvents.filter(isPenaltyEvent);
  const sourceEvents = penaltyOnly.length > 0 ? penaltyOnly : sportEvents;
  const selectedLeague = normalizeLeague(league);
  const eventsFiltered =
    selectedLeague && selectedLeague !== "all"
      ? sourceEvents.filter((e) => normalizeLeague(e?.L || e?.LE || "") === selectedLeague)
      : sourceEvents;
  const upcomingEvents = eventsFiltered.filter((e) => isStrictUpcomingEvent(e, nowSec));

  const allDetails = upcomingEvents.map((event) => buildMatchPredictionDetails(event));
  const cfg = riskConfig(profile);
  const filterMeta = { totalMatches: sourceEvents.length };
  const filterActive = filterMeta.totalMatches >= 50;
  const candidates = allDetails
    .map((details) => {
      const option = pickCouponOption(details, profile);
      if (!option) return null;
      const filterInput = buildExtraFilterInput(details, option.pari);
      const extraFilter = evaluateMatch(filterInput, filterMeta, { minMatches: 50 });
      if (filterActive && !extraFilter.playable) return null;
      const anchor = profile === "safe" ? 1.45 : profile === "aggressive" ? 2.2 : 1.7;
      const safetyScore = option.confiance - Math.abs(option.cote - anchor) * cfg.slope + (extraFilter.score || 0) * 0.22;
      return {
        matchId: details.match.id,
        teamHome: details.match.teamHome,
        teamAway: details.match.teamAway,
        league: details.match.league,
        startTimeUnix: details.match.startTimeUnix,
        statusText: details.match.statusText || "",
        infoText: details.match.infoText || "",
        statusCode: details.match.statusCode ?? null,
        phase: details.match.phase || "",
        pari: option.pari,
        cote: option.cote,
        confiance: Number(option.confiance.toFixed(1)),
        source: option.source,
        extraFilter,
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
    totalUpcomingMatches: upcomingEvents.length,
    leagueFilter: league || "all",
    riskProfile: profile,
    extraFilter: {
      active: filterActive,
      totalMatches: filterMeta.totalMatches,
      minMatches: 50,
      rule: filterActive ? "PLAY uniquement" : "FILTER_LOCKED (<50)",
    },
    coupon: picks,
    summary: {
      totalSelections: picks.length,
      combinedOdd,
      averageConfidence: avgConfidence,
    },
    riskConfig: cfg,
    warning:
      "Aucune combinaison n'est garantie gagnante. Ce coupon est une optimisation algorithmique.",
  };
}

function computeSelectionConfidence(details, selectionPari) {
  const target = String(selectionPari || "");
  const master = details?.prediction?.maitre?.decision_finale || {};
  if (master.pari_choisi === target) {
    return Number(master.confiance_numerique || 0);
  }

  let best = 0;
  const bots = Object.values(details?.prediction?.bots || {});
  for (const bot of bots) {
    for (const p of bot?.paris_recommandes || []) {
      if (String(p?.nom || "") === target) {
        best = Math.max(best, Number(p?.confiance || 0));
      }
    }
  }
  return Number(best || 0);
}

async function validateCouponTicket(ticket, options = {}) {
  const driftThreshold = Number(options?.driftThresholdPercent) > 0 ? Number(options.driftThresholdPercent) : 6;
  const nowSec = Math.floor(Date.now() / 1000);
  const selections = Array.isArray(ticket?.selections) ? ticket.selections : [];

  if (selections.length === 0) {
    return {
      validatedAt: new Date().toISOString(),
      status: "TICKET_A_CORRIGER",
      summary: { total: 0, ok: 0, toFix: 0 },
      issues: [{ code: "EMPTY_TICKET", message: "Aucune selection fournie." }],
      validatedSelections: [],
    };
  }

  const payload = await fetchLiveFeedRaw();
  const events = Array.isArray(payload?.Value) ? payload.Value : [];
  const eventsById = new Map(events.map((e) => [String(e?.I), e]));
  const validatedSelections = [];
  const issues = [];

  for (const sel of selections) {
    const matchId = String(sel?.matchId || "");
    const event = eventsById.get(matchId);
    if (!event) {
      validatedSelections.push({
        matchId,
        status: "invalid",
        reason: "MATCH_NOT_FOUND",
      });
      issues.push({ code: "MATCH_NOT_FOUND", matchId, message: `Match ${matchId} introuvable.` });
      continue;
    }

    const details = buildMatchPredictionDetails(event);
    const match = details.match;
    const selectedPari = String(sel?.pari || "");
    const selectedOdd = Number(sel?.cote);
    const market = (details.bettingMarkets || []).find((m) => String(m.nom) === selectedPari);
    const currentOdd = market ? Number(market.cote) : null;
    const started = !isStrictUpcomingEvent(event, nowSec);

    let driftPct = null;
    let driftExceeded = false;
    if (Number.isFinite(selectedOdd) && selectedOdd > 0 && Number.isFinite(currentOdd) && currentOdd > 0) {
      driftPct = Number((Math.abs(((currentOdd - selectedOdd) / selectedOdd) * 100)).toFixed(2));
      driftExceeded = driftPct > driftThreshold;
    }

    const confidence = computeSelectionConfidence(details, selectedPari);
    const recommended = pickCouponOption(details);
    const shouldReplace =
      started ||
      !market ||
      driftExceeded ||
      confidence < 50;

    const status = shouldReplace ? "replace" : "ok";
    const reasonCodes = [];
    if (started) reasonCodes.push("MATCH_ALREADY_STARTED");
    if (!market) reasonCodes.push("MARKET_UNAVAILABLE");
    if (driftExceeded) reasonCodes.push("ODD_DRIFT");
    if (confidence < 50) reasonCodes.push("LOW_CONFIDENCE");

    const row = {
      matchId,
      teams: `${match.teamHome} vs ${match.teamAway}`,
      league: match.league,
      status,
      selected: {
        pari: selectedPari,
        odd: Number.isFinite(selectedOdd) ? selectedOdd : null,
      },
      current: {
        pari: market?.nom || null,
        odd: Number.isFinite(currentOdd) ? currentOdd : null,
      },
      confidence: Number(confidence.toFixed(1)),
      driftPercent: driftPct,
      reasonCodes,
      recommendation: recommended
        ? {
            pari: recommended.pari,
            odd: recommended.cote,
            confidence: Number(recommended.confiance?.toFixed ? recommended.confiance.toFixed(1) : recommended.confiance),
            source: recommended.source,
          }
        : null,
    };

    validatedSelections.push(row);
    if (status !== "ok") {
      issues.push({
        code: reasonCodes[0] || "REPLACE_REQUIRED",
        matchId,
        message: `${row.teams}: correction recommandee (${reasonCodes.join(", ") || "raison inconnue"}).`,
      });
    }
  }

  const ok = validatedSelections.filter((x) => x.status === "ok").length;
  const toFix = validatedSelections.length - ok;
  return {
    validatedAt: new Date().toISOString(),
    status: toFix === 0 ? "TICKET_OK" : "TICKET_A_CORRIGER",
    driftThresholdPercent: driftThreshold,
    summary: {
      total: validatedSelections.length,
      ok,
      toFix,
    },
    issues,
    validatedSelections,
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
  validateCouponTicket,
  isStrictUpcomingEvent,
};
