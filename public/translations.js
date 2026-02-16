/**
 * Traductions des marchés et de l'interface (FR / EN)
 * Utilisation : t('key') ou t('key', 'en')
 */
const translations = {
  fr: {
    // Marchés 1X2
    market_1: '1',
    market_x: 'X',
    market_2: '2',
    market_1x2: 'Résultat 1X2',
    team1: 'Équipe 1',
    team2: 'Équipe 2',
    draw: 'Nul',
    outcome_1: 'Équipe 1',
    outcome_2: 'Équipe 2',
    outcome_x: 'Nul',
    // Cotes & prédictions
    odds: 'Cote',
    odds_short: 'Cote',
    prediction: 'Prédiction',
    confidence: 'Confiance',
    value: 'Value',
    value_bet: 'Value',
    // Tendances
    trend_up: 'Hausse',
    trend_down: 'Baisse',
    trend_stable: 'Stable',
    // Statut match
    status_finished: 'Terminé',
    status_live: 'En cours',
    status_upcoming: 'À venir',
    start: 'Début',
    end: 'Fin',
    // Interface
    details: 'Détails',
    back: 'Retour',
    home: 'Accueil',
    loading: 'Chargement des matches...',
    loading_short: 'Chargement...',
    retry: 'Réessayer',
    error_load: 'Erreur de chargement. Vérifiez la connexion et réessayez.',
    error_match: 'Match introuvable ou erreur de chargement.',
    no_match: 'Aucun match',
    no_match_found: 'trouvé.',
    try_later: 'Réessayez plus tard ou vérifiez les paramètres.',
    pes_unavailable: 'PES est temporairement hors service. Les matchs virtuels PES s\'afficheront ici lorsqu\'ils seront disponibles.',
    tab_all: 'Tous',
    tab_fifa: 'FIFA Penalty',
    tab_pes: 'PES Penalty',
    prob_1x2: 'Probabilités 1X2',
    match_state: 'État du match',
    odds_trends: 'Cotes & tendances',
    alt_bets: 'Prédictions Paris Alternatifs uniquement',
    alt_desc: 'Système dédié : totaux, handicaps, pair/impair, etc. Aucun 1X2.',
    ultimate_bet: 'Paris ultime (cote ≥ 2.0)',
    ultimate_desc: 'Choisissez votre pari et misez. Seules les options avec cote ≥ 2.0 sont affichées.',
    recommended: 'Recommandé',
    your_bet: 'Votre pari',
    league_other: 'Autres',
    footer_disclaimer: 'Données issues de l\'API 1xbet • Prédictions indicatives uniquement',
    list_matches: 'Liste des matches',
    match_detail: 'Détails du match',
    fallback_no_penalty: 'Peu ou pas de matches "Penalty" trouvés. Affichage de tous les matchs virtuels FIFA et PES.',
    fallback_fifa: 'Peu ou pas de matches "Penalty" trouvés. Affichage de tous les matchs virtuels FIFA.',
    api_no_data: 'L\'API 1xbet ne renvoie pas de données (hébergeur ou connexion).',
    no_match_fifa: 'Aucun match FIFA Penalty trouvé.',
    // Options de pari (page détail)
    alt_no_decision: 'Aucune prédiction alternative.',
    alt_no_option: 'Aucune option alternative prédite.',
    alt_available: 'Paris alternatifs disponibles',
    visualisations: 'Visualisations',
    selected_bet_label: 'Votre pari :',
    odds_label: 'Cote :',
  },
  en: {
    market_1: '1',
    market_x: 'X',
    market_2: '2',
    market_1x2: '1X2 Result',
    team1: 'Team 1',
    team2: 'Team 2',
    draw: 'Draw',
    outcome_1: 'Team 1',
    outcome_2: 'Team 2',
    outcome_x: 'Draw',
    odds: 'Odds',
    odds_short: 'Odds',
    prediction: 'Prediction',
    confidence: 'Confidence',
    value: 'Value',
    value_bet: 'Value',
    trend_up: 'Up',
    trend_down: 'Down',
    trend_stable: 'Stable',
    status_finished: 'Finished',
    status_live: 'Live',
    status_upcoming: 'Upcoming',
    start: 'Start',
    end: 'End',
    details: 'Details',
    back: 'Back',
    home: 'Home',
    loading: 'Loading matches...',
    loading_short: 'Loading...',
    retry: 'Retry',
    error_load: 'Load error. Check your connection and try again.',
    error_match: 'Match not found or load error.',
    no_match: 'No match',
    no_match_found: 'found.',
    try_later: 'Try again later or check settings.',
    pes_unavailable: 'PES is temporarily unavailable. Virtual PES matches will appear here when available.',
    tab_all: 'All',
    tab_fifa: 'FIFA Penalty',
    tab_pes: 'PES Penalty',
    prob_1x2: '1X2 Probabilities',
    match_state: 'Match state',
    odds_trends: 'Odds & trends',
    alt_bets: 'Alternative bets predictions only',
    alt_desc: 'Dedicated system: totals, handicaps, odd/even, etc. No 1X2.',
    ultimate_bet: 'Ultimate bet (odds ≥ 2.0)',
    ultimate_desc: 'Choose your bet. Only options with odds ≥ 2.0 are shown.',
    ultimate_empty: 'No option with odds ≥ 2.0 at the moment.',
    recommended: 'Recommended',
    your_bet: 'Your bet',
    league_other: 'Others',
    footer_disclaimer: 'Data from 1xbet API • Indicative predictions only',
    list_matches: 'Match list',
    match_detail: 'Match details',
    fallback_no_penalty: 'Few or no "Penalty" matches found. Showing all FIFA and PES virtual matches.',
    fallback_fifa: 'Few or no "Penalty" matches found. Showing all FIFA virtual matches.',
    api_no_data: '1xbet API is not returning data (host or connection).',
    no_match_fifa: 'No FIFA Penalty match found.',
    alt_no_decision: 'No alternative prediction.',
    alt_no_option: 'No alternative option predicted.',
    alt_available: 'Alternative bets available',
    visualisations: 'Visualizations',
    selected_bet_label: 'Your bet:',
    odds_label: 'Odds:',
  },
};

let currentLang = (typeof navigator !== 'undefined' && navigator.language && navigator.language.startsWith('en')) ? 'en' : 'fr';

function t(key, lang) {
  const L = lang || currentLang;
  const dict = translations[L] || translations.fr;
  return dict[key] != null ? dict[key] : (translations.fr[key] || key);
}

function setLang(lang) {
  if (translations[lang]) currentLang = lang;
  return currentLang;
}

function getLang() {
  return currentLang;
}

// Export pour usage global dans les pages
if (typeof window !== 'undefined') {
  window.__t = t;
  window.__setLang = setLang;
  window.__getLang = getLang;
}
