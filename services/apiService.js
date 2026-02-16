const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
const config = require('../config');

const buildUrl = (sportId, count = 100) => {
  const params = new URLSearchParams({
    sports: sportId,
    count,
    lng: 'fr',
    mode: 4,
    country: 96,
    getEmpty: true,
    virtualSports: true,
    noFilterBlockEvent: true,
  });
  return `${config.api.baseUrl}?${params}`;
};

const fetchVirtualMatches = async (sportId) => {
  try {
    const url = buildUrl(sportId);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(config.api.timeout),
    });
    const data = await res.json();
    const list = data?.Success ? data.Value : null;
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error(`Erreur fetch sport ${sportId}:`, err.message);
    return [];
  }
};

const isPenaltyMatch = (event, keywords) => {
  const league = (event.L || '') + (event.LE || '') + (event.LR || '');
  const text = league.toLowerCase();
  return keywords.some((k) => text.includes(k.toLowerCase()));
};

module.exports = {
  fetchVirtualMatches,
  isPenaltyMatch,
};
