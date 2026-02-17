function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function detectBetType(name) {
  const low = normalizeText(name);
  if (low.includes("total") && (low.includes("plus") || low.includes("moins"))) return "TOTAL_BUTS";
  if (low.includes("handicap")) return "HANDICAP";
  if (low.includes("pair") || low.includes("impair")) return "PAIR_IMPAIR";
  if (low.includes("corner")) return "CORNERS";
  if (low.includes("mi-temps") || low.includes("mi temps")) return "MI_TEMPS";
  if (low.includes("victoire") || low === "1" || low === "x" || low === "2") return "1X2";
  return "AUTRE";
}

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isOffensiveTeam(team) {
  const low = normalizeText(team);
  return ["arsenal", "manchester city", "psg", "real madrid", "barcelona", "liverpool"].some((x) =>
    low.includes(x)
  );
}

function scoreFromContext(ctx) {
  return parseNumber(ctx?.score1, 0) + parseNumber(ctx?.score2, 0);
}

function analyserPariUnifie(pari, team1, team2, _league, score1, score2, minute) {
  let confiance = 50;
  const nom = normalizeText(pari.nom);
  const cote = parseNumber(pari.cote, 2);

  if (isOffensiveTeam(team1)) confiance += 8;
  if (isOffensiveTeam(team2)) confiance += 8;

  if (nom.includes("plus") && nom.includes("total")) {
    if (score1 + score2 >= 2 && minute < 60) confiance += 15;
  } else if (nom.includes("moins") && nom.includes("total")) {
    if (score1 + score2 <= 1 && minute > 60) confiance += 15;
  }

  if (cote >= 1.8 && cote <= 2.5) confiance += 10;
  return clamp(confiance, 5, 95);
}

function analyserPariIA(pari, team1, team2, _league, score1, score2, minute) {
  let confiance = 55;
  const nom = normalizeText(pari.nom);
  const total = score1 + score2;

  if (nom.includes("total")) {
    if (nom.includes("plus")) {
      if (total >= 1 && minute < 45) confiance += 20;
      else if (total === 0 && minute > 70) confiance -= 20;
    } else if (nom.includes("moins")) {
      if (total <= 1 && minute > 60) confiance += 18;
    }
  }

  if ((normalizeText(team1).includes("arsenal") || normalizeText(team2).includes("arsenal")) && nom.includes("plus")) {
    confiance += 12;
  }
  return clamp(confiance, 5, 95);
}

function analyserPariProbabilites(pari, score1, score2, _minute) {
  let confiance = 50;
  const nom = normalizeText(pari.nom);
  const cote = parseNumber(pari.cote, 2);
  const probImplicite = (1 / Math.max(cote, 0.01)) * 100;
  let probEstimee = 50;

  if (nom.includes("total")) {
    if (nom.includes("plus")) {
      if (score1 + score2 >= 2) probEstimee = 75;
      else if (score1 + score2 === 1) probEstimee = 60;
      else probEstimee = 45;
    } else {
      probEstimee = 55;
    }
  }

  if (probEstimee > probImplicite) {
    confiance += (probEstimee - probImplicite) * 0.5;
  }
  return clamp(confiance, 5, 95);
}

function calculerValue(pari) {
  const nom = normalizeText(pari.nom);
  const cote = parseNumber(pari.cote, 2);
  let probEstimee = 50;

  if (nom.includes("total")) probEstimee = nom.includes("moins") ? 65 : 45;
  else if (nom.includes("handicap")) probEstimee = 55;

  const probImplicite = (1 / Math.max(cote, 0.01)) * 100;
  return Math.max(((probEstimee - probImplicite) / probImplicite) * 100, -50);
}

function analyserPariStat(pari, team1, team2, _league, score1, score2, minute) {
  let confiance = 52;
  const nom = normalizeText(pari.nom);
  const total = score1 + score2;

  if (nom.includes("total")) {
    if (minute <= 30) {
      confiance += nom.includes("plus") ? 8 : 3;
    } else if (minute > 70 && nom.includes("moins") && total <= 2) {
      confiance += 15;
    }
  }

  const hash = Array.from(`${team1}${team2}`).reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 100;
  if (hash > 60) confiance += 8;
  return clamp(confiance, 5, 95);
}

function runBots({ team1, team2, league, paris, score1, score2, minute }) {
  const valid = paris.filter((p) => parseNumber(p.cote, 0) >= 1.399 && parseNumber(p.cote, 0) <= 3.0);

  const makeResult = (botName, rows, specialite) => ({
    bot_name: botName,
    paris_recommandes: rows.sort((a, b) => b.confiance - a.confiance).slice(0, 3),
    confiance_globale: rows.length ? Math.max(...rows.map((x) => x.confiance)) : 0,
    specialite,
  });

  const botUnifieRows = valid
    .map((p) => ({ ...p, confiance: analyserPariUnifie(p, team1, team2, league, score1, score2, minute) }))
    .filter((p) => p.confiance >= 60)
    .map((p) => ({ nom: p.nom, cote: p.cote, confiance: p.confiance, type: detectBetType(p.nom), source: "BOT_UNIFIE" }));

  const botIaRows = valid
    .map((p) => ({ ...p, confiance: analyserPariIA(p, team1, team2, league, score1, score2, minute) }))
    .filter((p) => p.confiance >= 65)
    .map((p) => ({ nom: p.nom, cote: p.cote, confiance: p.confiance, type: detectBetType(p.nom), source: "BOT_IA" }));

  const botProbaRows = valid
    .map((p) => ({ ...p, confiance: analyserPariProbabilites(p, score1, score2, minute) }))
    .filter((p) => p.confiance >= 55)
    .map((p) => ({ nom: p.nom, cote: p.cote, confiance: p.confiance, type: detectBetType(p.nom), source: "BOT_PROBABILITES" }));

  const botValueRows = valid
    .map((p) => ({ ...p, value: calculerValue(p) }))
    .filter((p) => p.value >= 10)
    .map((p) => ({
      nom: p.nom,
      cote: p.cote,
      confiance: clamp(50 + p.value, 5, 95),
      value: Number(p.value.toFixed(2)),
      type: detectBetType(p.nom),
      source: "BOT_VALUE",
    }))
    .sort((a, b) => b.value - a.value);

  const botStatsRows = valid
    .map((p) => ({ ...p, confiance: analyserPariStat(p, team1, team2, league, score1, score2, minute) }))
    .filter((p) => p.confiance >= 58)
    .map((p) => ({ nom: p.nom, cote: p.cote, confiance: p.confiance, type: detectBetType(p.nom), source: "BOT_STATS" }));

  return {
    systeme_unifie: makeResult("SYSTEME UNIFIE ALTERNATIFS", botUnifieRows, "ANALYSE UNIFIEE"),
    systeme_ia: makeResult("IA SPECIALISEE ALTERNATIFS", botIaRows, "IA CONTEXTUELLE"),
    systeme_probabilites: makeResult("PROBABILITES ALTERNATIVES", botProbaRows, "CALCULS PROBABILISTES"),
    systeme_value: {
      ...makeResult("VALUE BETTING ALTERNATIFS", botValueRows, "DETECTION VALUE"),
      opportunities: botValueRows,
    },
    systeme_statistique: makeResult("ANALYSE STATISTIQUE ALTERNATIFS", botStatsRows, "STATS AVANCEES"),
  };
}

function detectTypeFromName(nomPari) {
  const nom = normalizeText(nomPari);
  if (nom.includes("total") && (nom.includes("plus") || nom.includes("moins"))) return "TOTAL_BUTS";
  if (nom.includes("handicap")) return "HANDICAP";
  if (nom.includes("pair") || nom.includes("impair")) return "PAIR_IMPAIR";
  if (nom.includes("corner")) return "CORNERS";
  if (nom.includes("mi-temps")) return "MI_TEMPS";
  return "AUTRE";
}

function maitrePronostics(decisionsBots, team1, team2, league) {
  const decisionsValides = [];

  for (const [botName, decision] of Object.entries(decisionsBots)) {
    if (!decision || !Array.isArray(decision.paris_recommandes)) continue;
    const parisValides = decision.paris_recommandes.filter((pari) => {
      const cote = parseNumber(pari.cote, 0);
      return cote >= 1.399 && cote <= 3.0;
    });
    if (parisValides.length) {
      decisionsValides.push({
        bot: botName,
        paris: parisValides,
        confiance_bot: parseNumber(decision.confiance_globale, 50),
      });
    }
  }

  if (!decisionsValides.length) {
    return {
      decision_finale: {
        action: "AUCUN_PARI",
        raison: "Aucun pari avec cotes valides (1.399-3.0)",
        confiance: 0,
        recommandation: "ATTENDRE DE MEILLEURES OPPORTUNITES",
      },
      analyse_bots: {
        nb_bots_consultes: 0,
        consensus: "AUCUN",
        paris_analyses: 0,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "MAITRE-PRONOSTICS-2024-JS",
      },
    };
  }

  const parisSpecifiques = new Map();
  for (const d of decisionsValides) {
    for (const pari of d.paris) {
      const key = pari.nom;
      if (!parisSpecifiques.has(key)) parisSpecifiques.set(key, []);
      parisSpecifiques.get(key).push({ bot: d.bot, pari, confiance: parseNumber(pari.confiance, 50) });
    }
  }
  const populaires = [...parisSpecifiques.entries()].sort((a, b) => b[1].length - a[1].length);
  if (!populaires.length) {
    return {
      decision_finale: { action: "AUCUN_PARI", confiance: 0, recommandation: "AUCUNE CONVERGENCE" },
      analyse_bots: { nb_bots_consultes: decisionsValides.length, consensus: "AUCUN" },
      meta: { timestamp: new Date().toISOString(), version: "MAITRE-PRONOSTICS-2024-JS" },
    };
  }

  const [nomPari, votes] = populaires[0];
  const nbBotsTotal = decisionsValides.length;
  const confianceConsensus = clamp((votes.length / nbBotsTotal) * 100, 0, 90);
  const confianceMoyenneBots = decisionsValides.reduce((a, x) => a + x.confiance_bot, 0) / nbBotsTotal;
  const confianceGlobale = confianceConsensus * 0.6 + confianceMoyenneBots * 0.4;
  const confiancePari = votes.reduce((a, x) => a + x.confiance, 0) / votes.length;
  const meilleurVote = votes.reduce((best, v) => (v.confiance > best.confiance ? v : best), votes[0]);

  let action = "EVITER";
  let niveau = "TRES FAIBLE";
  if (confianceGlobale >= 80) {
    action = "MISE FORTE RECOMMANDEE";
    niveau = "TRES ELEVEE";
  } else if (confianceGlobale >= 70) {
    action = "MISE RECOMMANDEE";
    niveau = "ELEVEE";
  } else if (confianceGlobale >= 60) {
    action = "MISE MODEREE";
    niveau = "MODEREE";
  } else if (confianceGlobale >= 50) {
    action = "MISE PRUDENTE";
    niveau = "FAIBLE";
  }

  return {
    decision_finale: {
      pari_choisi: nomPari,
      cote: meilleurVote.pari.cote,
      type_pari: detectTypeFromName(nomPari),
      action,
      niveau_confiance: niveau,
      confiance_numerique: Number(confianceGlobale.toFixed(1)),
      recommandation: `MAITRE RECOMMANDE: ${action}`,
      equipes: `${team1} vs ${team2}`,
    },
    analyse_bots: {
      nb_bots_consultes: nbBotsTotal,
      nb_bots_accord: votes.length,
      consensus: `${votes.length}/${nbBotsTotal} bots`,
      bots_supporters: votes.map((v) => v.bot),
      types_paris_analyses: new Set(decisionsValides.flatMap((d) => d.paris.map((p) => detectTypeFromName(p.nom)))).size,
      confiance_pari: Number(confiancePari.toFixed(1)),
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: "MAITRE-PRONOSTICS-2024-JS",
      match: `${team1} vs ${team2}`,
      league,
    },
  };
}

function analyseAvancee(team1, team2, league, paris, score1, score2, minute) {
  const analyses = paris.map((pari) => {
    const cote = parseNumber(pari.cote, 2);
    const nom = String(pari.nom || "Pari inconnu");
    const total = score1 + score2;

    let contexte = 50;
    if (normalizeText(nom).includes("plus") && normalizeText(nom).includes("2.5")) {
      if (total >= 3) contexte = 95;
      else if (total === 2 && minute < 70) contexte = 80;
      else if (total === 0 && minute > 60) contexte = 25;
    }
    let tendances = 50;
    if (minute > 75 && normalizeText(nom).includes("plus")) tendances += 20;
    if (minute > 75 && normalizeText(nom).includes("moins")) tendances += 15;
    let equipe = 50;
    if (isOffensiveTeam(team1) || isOffensiveTeam(team2)) equipe += 12;
    let ligue = 50;
    if (normalizeText(league).includes("bundesliga") && normalizeText(nom).includes("plus")) ligue += 15;
    let momentum = 50;
    if (total >= 2 && minute < 60 && normalizeText(nom).includes("plus")) momentum += 20;
    if (total === 0 && minute > 45 && normalizeText(nom).includes("moins")) momentum += 15;

    const scoreComposite = (contexte + tendances + equipe + ligue + momentum) / 5;
    const probabiliteEstimee = scoreComposite / 100;
    const probabiliteCote = 1 / Math.max(cote, 0.01);
    const value = ((probabiliteEstimee - probabiliteCote) / probabiliteCote) * 100;
    const potentielGain = value > 0 ? value * (cote - 1) : 0;

    let recommandation = "EVITER";
    if (scoreComposite >= 80 && value > 15) recommandation = "MISE FORTE";
    else if (scoreComposite >= 70 && value > 10) recommandation = "MISE RECOMMANDEE";
    else if (scoreComposite >= 60 && value > 5) recommandation = "MISE MODEREE";
    else if (scoreComposite >= 50) recommandation = "MISE PRUDENTE";

    return {
      pari: nom,
      cote,
      score_composite: Number(scoreComposite.toFixed(1)),
      probabilite_estimee: Number((probabiliteEstimee * 100).toFixed(1)),
      value: Number(value.toFixed(2)),
      potentiel_gain: Number(potentielGain.toFixed(2)),
      recommandation,
      risque: scoreComposite >= 75 && cote < 2.5 ? "FAIBLE" : scoreComposite >= 60 ? "MODERE" : "ELEVE",
    };
  });

  analyses.sort((a, b) => b.potentiel_gain - a.potentiel_gain);
  return {
    analyses_detaillees: analyses,
    top_3_recommandations: analyses.slice(0, 3),
    statistiques: {
      total_paris_analyses: analyses.length,
      score_moyen: analyses.length
        ? Number((analyses.reduce((a, x) => a + x.score_composite, 0) / analyses.length).toFixed(1))
        : 0,
      opportunities_positives: analyses.filter((a) => a.value > 0).length,
      potentiel_gain_total: Number(analyses.reduce((a, x) => a + x.potentiel_gain, 0).toFixed(2)),
    },
  };
}

function genererPredictionUnifiee({ team1, team2, league, context, bets }) {
  const score1 = parseNumber(context?.score1, 0);
  const score2 = parseNumber(context?.score2, 0);
  const minute = parseNumber(context?.minute, 0);

  const bots = runBots({ team1, team2, league, paris: bets, score1, score2, minute });
  const maitre = maitrePronostics(bots, team1, team2, league);
  const avancee = analyseAvancee(team1, team2, league, bets, score1, score2, minute);

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      version: "UNIFIED-PREDICTIONS-NODE-1.0",
      teams: `${team1} vs ${team2}`,
      league,
      context: { score1, score2, minute },
      betsAnalysed: bets.length,
      validOddsRange: "1.399 - 3.0",
    },
    bots,
    maitre,
    analyse_avancee: avancee,
  };
}

module.exports = {
  genererPredictionUnifiee,
  detectBetType,
};
