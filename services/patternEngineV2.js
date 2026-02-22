const crypto = require("crypto");

function parseScore(scoreStr) {
  const m = String(scoreStr || "").trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return { home: null, away: null, total: null };
  const home = Number(m[1]);
  const away = Number(m[2]);
  return { home, away, total: home + away };
}

function toNumber(value, def = null) {
  if (value === "" || value === null || value === undefined) return def;
  const n = Number(value);
  return Number.isFinite(n) ? n : def;
}

function normalizeLigue(ligue) {
  const s = String(ligue || "").toLowerCase();
  if (s.includes("5x5") || s.includes("rush")) return "FC25_5x5_RUSH";
  if (s.includes("4x4")) return "FC24_4x4";
  if (s.includes("ligue") && s.includes("europ")) return "FC25_LIGUE_EUROPEENNE";
  if (s.includes("champions")) return "FC25_CHAMPIONS";
  if (s.includes("espagne")) return "FC25_ESPAGNE";
  if (s.includes("allemagne")) return "FC25_ALLEMAGNE";
  if (s.includes("angleterre")) return "FC25_ANGLETERRE";
  return "AUTRE";
}

function normalizeOption(optionRaw) {
  const s = String(optionRaw || "").toLowerCase();
  let lineValue = null;
  const lineMatch = s.match(/\(([-+]?\d+(\.\d+)?)\)/);
  if (lineMatch) lineValue = Number(lineMatch[1]);

  let optionType = "unknown";
  if (s.includes("handicap")) optionType = "handicap";
  else if (s.includes("1x2") || s.includes(" v1") || s.includes(" v2") || s.includes(" nul")) optionType = "1x2";
  else if (s.includes("double") || s.includes("1x") || s.includes("x2") || s.includes("12")) optionType = "double_chance";
  else if (s.includes("total")) {
    const isUnder = s.includes("moins") || s.includes("under");
    const isOver = s.includes("plus") || s.includes("over");
    const isTeam1 = s.includes("total 1") || s.includes("equipe 1") || s.includes("équipe 1");
    const isTeam2 = s.includes("total 2") || s.includes("equipe 2") || s.includes("équipe 2");
    if (isUnder && (isTeam1 || isTeam2)) optionType = "team_total_under";
    else if (isOver && (isTeam1 || isTeam2)) optionType = "team_total_over";
    else if (isUnder) optionType = "total_under";
    else if (isOver) optionType = "total_over";
  }

  let pickSide = "MATCH";
  if (optionType === "double_chance") pickSide = "DC";
  if (optionType === "handicap" || optionType.startsWith("team_total")) {
    if (s.includes(" 1 ") || s.includes("total 1") || s.includes("equipe 1") || s.includes("équipe 1")) pickSide = "HOME";
    else if (s.includes(" 2 ") || s.includes("total 2") || s.includes("equipe 2") || s.includes("équipe 2")) pickSide = "AWAY";
    else pickSide = "HOME";
  } else if (optionType === "1x2") {
    if (s.includes("v1")) pickSide = "HOME";
    else if (s.includes("v2")) pickSide = "AWAY";
    else pickSide = "MATCH";
  }
  if (optionType === "handicap" && s.includes("handicap 2")) pickSide = "AWAY";

  return { optionType, pickSide, lineValue, option_raw: optionRaw || "" };
}

function issueToLabel(issue) {
  const s = String(issue || "").toLowerCase();
  if (["win", "gagne", "gagné", "paye", "payé"].includes(s)) return 1;
  if (["loss", "perdu"].includes(s)) return 0;
  if (["void", "rembourse", "remboursé", "push"].includes(s)) return null;
  return null;
}

function toFeatures(match) {
  const ligue = normalizeLigue(match.ligue);
  const odds = toNumber(match.odds, null);
  const stake = toNumber(match.stake_fcfa, null);
  const score = parseScore(match.score);
  const opt = normalizeOption(match.option);
  const lineValue = toNumber(match.line_value, opt.lineValue);
  const label = issueToLabel(match.issue);

  return {
    id: match.id ?? null,
    date: match.date ?? null,
    ligue,
    home: match.home ?? null,
    away: match.away ?? null,
    home_goals: score.home,
    away_goals: score.away,
    total_goals: score.total,
    optionType: opt.optionType,
    pickSide: opt.pickSide,
    lineValue,
    odds,
    stake,
    label,
    void: label === null ? 1 : 0,
    option_raw: opt.option_raw,
  };
}

function stableHash(row) {
  const key = [
    row.date || "",
    row.ligue || "",
    row.home || "",
    row.away || "",
    row.optionType || "",
    row.pickSide || "",
    row.lineValue ?? "",
    row.odds ?? "",
    row.stake ?? "",
  ].join("|");
  return crypto.createHash("sha1").update(key).digest("hex");
}

function deduplicate(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const hash = stableHash(row);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push({ ...row, _hash: hash });
  }
  return out;
}

function computeWinLoss(rows) {
  const playable = rows.filter((r) => r.label === 0 || r.label === 1);
  const wins = playable.filter((r) => r.label === 1).length;
  const losses = playable.filter((r) => r.label === 0).length;
  return { playable, wins, losses, total: wins + losses };
}

function wilson95(wins, n) {
  if (!n) return { low: 0, high: 0 };
  const z = 1.96;
  const phat = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (phat + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n)) / denom;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

function computeROI(rows) {
  let stakeSum = 0;
  let profit = 0;
  for (const r of rows) {
    if (typeof r.stake !== "number" || typeof r.odds !== "number") continue;
    stakeSum += r.stake;
    if (r.label === 1) profit += r.stake * (r.odds - 1);
    else if (r.label === 0) profit -= r.stake;
  }
  return { stakeSum, profit, roi: stakeSum ? profit / stakeSum : 0 };
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key] ?? "UNKNOWN";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

function summarizeGroup(rows) {
  const { wins, losses, total } = computeWinLoss(rows);
  const winrate = total ? wins / total : 0;
  const ci = wilson95(wins, total);
  const roi = computeROI(rows);
  return {
    n: rows.length,
    played: total,
    wins,
    losses,
    winrate,
    ci95_low: ci.low,
    ci95_high: ci.high,
    ...roi,
  };
}

function oddsBucket(odds) {
  if (typeof odds !== "number") return "odds_unknown";
  if (odds < 2.0) return "odds_1.xx";
  if (odds < 2.2) return "odds_2.00-2.19";
  if (odds <= 2.99) return "odds_2.20-2.99";
  return "odds_3.00+";
}

function extractRules(rows, minPlayed = 5) {
  const playable = rows.filter((r) => r.label === 0 || r.label === 1);
  const rules = [];

  const pushRule = (name, filterFn) => {
    const subset = playable.filter(filterFn);
    const sum = summarizeGroup(subset);
    if (sum.played >= minPlayed) rules.push({ rule: name, ...sum });
  };

  pushRule("ligue=FC25_5x5_RUSH", (r) => r.ligue === "FC25_5x5_RUSH");
  pushRule("ligue=FC24_4x4", (r) => r.ligue === "FC24_4x4");
  pushRule("ligue=FC25_LIGUE_EUROPEENNE", (r) => r.ligue === "FC25_LIGUE_EUROPEENNE");
  pushRule("option=handicap", (r) => r.optionType === "handicap");
  pushRule("option=team_total_over", (r) => r.optionType === "team_total_over");
  pushRule("option=total_under", (r) => r.optionType === "total_under");
  pushRule("option=total_over_high(>=5.5)", (r) => r.optionType === "total_over" && typeof r.lineValue === "number" && r.lineValue >= 5.5);
  pushRule("odds=2.20-2.99", (r) => oddsBucket(r.odds) === "odds_2.20-2.99");
  pushRule("odds=2.00-2.19", (r) => oddsBucket(r.odds) === "odds_2.00-2.19");
  pushRule("odds>=3.00", (r) => oddsBucket(r.odds) === "odds_3.00+");
  pushRule("FC25_5x5 + handicap", (r) => r.ligue === "FC25_5x5_RUSH" && r.optionType === "handicap");
  pushRule("FC25_5x5 + team_total_over", (r) => r.ligue === "FC25_5x5_RUSH" && r.optionType === "team_total_over");
  pushRule("FC25_5x5 + odds 2.20-2.99", (r) => r.ligue === "FC25_5x5_RUSH" && oddsBucket(r.odds) === "odds_2.20-2.99");

  rules.sort((a, b) => b.winrate - a.winrate || b.played - a.played);
  return rules;
}

function buildDecisionEngine(rows, totalValidated, opts = {}) {
  const minMatches = opts.minMatches ?? 50;
  const dedup = deduplicate(rows);
  const report = {
    meta: {
      total_records: rows.length,
      total_records_dedup: dedup.length,
      totalValidated,
      ...summarizeGroup(dedup),
    },
    byLeague: Object.fromEntries([...groupBy(dedup, "ligue")].map(([k, v]) => [k, summarizeGroup(v)])),
    byOption: Object.fromEntries([...groupBy(dedup, "optionType")].map(([k, v]) => [k, summarizeGroup(v)])),
    rules: extractRules(dedup, opts.minRulePlayed ?? 5),
  };

  function scoreCandidate(candidate) {
    const f = toFeatures({ ...candidate, score: "0-0", issue: "pending" });
    let score = 50;
    const reasons = [];

    if (f.ligue === "FC25_5x5_RUSH") {
      score += 25;
      reasons.push("+ Ligue forte (5x5 Rush)");
    }
    if (f.optionType === "handicap") {
      score += 18;
      reasons.push("+ Option forte (handicap)");
    }
    if (f.optionType === "team_total_over") {
      score += 14;
      reasons.push("+ Pattern team_total_over");
    }
    if (typeof f.odds === "number" && f.odds >= 2.2 && f.odds <= 2.99) {
      score += 18;
      reasons.push("+ Zone cote 2.20-2.99");
    }

    if (f.optionType === "total_over" && typeof f.lineValue === "number" && f.lineValue >= 5.5) {
      score -= 28;
      reasons.push("- Over >= 5.5 instable");
    }
    if (f.optionType === "double_chance") {
      score -= 15;
      reasons.push("- Double chance instable");
    }
    if (f.optionType === "handicap" && typeof f.lineValue === "number" && f.lineValue < -2.5) {
      score -= 20;
      reasons.push("- Handicap trop agressif");
    }
    if (f.ligue === "FC25_CHAMPIONS") {
      score -= 10;
      reasons.push("- Champions League instable");
    }

    score = Math.max(0, Math.min(100, score));
    return { score, features: f, reasons };
  }

  function decide(candidate) {
    if (totalValidated < minMatches) {
      return {
        status: "FILTER_LOCKED",
        playable: false,
        message: `Filtre bloque: ${totalValidated}/${minMatches} matchs valides`,
      };
    }
    const scored = scoreCandidate(candidate);
    const tier = scored.score >= 85 ? "SAFE" : scored.score >= 75 ? "MODERATE" : "NO_PLAY";
    return {
      status: "OK",
      playable: tier !== "NO_PLAY",
      tier,
      ...scored,
    };
  }

  return { report, scoreCandidate, decide };
}

function toTrainReadyCSV(featureRows) {
  const header = [
    "id",
    "date",
    "ligue",
    "home",
    "away",
    "home_goals",
    "away_goals",
    "total_goals",
    "option_type",
    "line_value",
    "pick_side",
    "odds",
    "stake_fcfa",
    "label",
    "void",
  ].join(",");

  const lines = featureRows.map((r) =>
    [
      r.id ?? "",
      r.date ?? "",
      r.ligue ?? "",
      r.home ?? "",
      r.away ?? "",
      r.home_goals ?? "",
      r.away_goals ?? "",
      r.total_goals ?? "",
      r.optionType ?? "",
      r.lineValue ?? "",
      r.pickSide ?? "",
      r.odds ?? "",
      r.stake ?? "",
      r.label ?? "",
      r.void ?? "",
    ].join(",")
  );

  return [header, ...lines].join("\n");
}

module.exports = {
  toFeatures,
  deduplicate,
  summarizeGroup,
  extractRules,
  buildDecisionEngine,
  toTrainReadyCSV,
};
