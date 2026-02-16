const REFRESH_INTERVAL = 60000;
const tr = typeof window !== 'undefined' && window.__t ? window.__t : (k) => k;

function getMatchId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('id');
}

const $ = (id) => document.getElementById(id);
const loading = $('loading');
const error = $('error');
const content = $('matchContent');

function showLoading(show) {
  loading.style.display = show ? 'block' : 'none';
  error.style.display = 'none';
  content.style.display = show ? 'none' : 'block';
}

function showError(show) {
  error.style.display = show ? 'block' : 'none';
  loading.style.display = 'none';
  content.style.display = show ? 'none' : 'block';
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

async function loadMatch() {
  const id = getMatchId();
  if (!id) {
    showError(true);
    return null;
  }

  showLoading(true);
  try {
    const res = await fetch(`/api/match/${id}`);
    const json = await res.json();

    if (!json.success || !json.data) {
      showError(true);
      return null;
    }

    showLoading(false);
    renderMatch(json.data);
    return json.data;
  } catch (err) {
    console.error(err);
    showError(true);
    return null;
  }
}

function getScoreFromStatus(status) {
  if (!status?.FS) return { s1: 0, s2: 0 };
  return { s1: parseInt(status.FS.S1, 10) || 0, s2: parseInt(status.FS.S2, 10) || 0 };
}

function simulateTrend(odds, key) {
  const v = odds[key];
  if (v == null) return 'stable';
  const r = (v * 1000 % 3);
  return r === 0 ? 'up' : r === 1 ? 'down' : 'stable';
}

function renderMatch(m) {
  const pred = m.prediction;
  const odds = pred?.odds || {};
  const value = pred?.value || {};
  const probs = pred?.probs || {};
  const ultimate = m.ultimatePredictions || { options: [], recommended: null };

  $('team1').textContent = m.team1 || '-';
  $('team2').textContent = m.team2 || '-';
  $('league').textContent = m.league || '-';
  $('sport').textContent = m.sport || 'FIFA';
  $('sport').className = `sport-badge ${(m.sport || 'FIFA').toLowerCase()}`;

  const { s1, s2 } = getScoreFromStatus(m.status);
  $('score1').textContent = s1;
  $('score2').textContent = s2;
  const scoreWrap = document.querySelector('.score-display');
  if (scoreWrap) {
    scoreWrap.classList.toggle('has-score', s1 > 0 || s2 > 0);
  }

  const now = Math.floor(Date.now() / 1000);
  const started = m.startTime && now >= m.startTime;
  const finished = m.endTime && now >= m.endTime;

  let statusClass = 'status-upcoming';
  if (finished) statusClass = 'status-finished';
  else if (started) statusClass = 'status-live';

  $('statusBar').innerHTML = `
    <div class="status-bar ${statusClass}">
      <span class="status-dot"></span>
      <span>${tr('start')}: ${formatTime(m.startTime)}</span>
      <span class="separator">→</span>
      <span>${tr('end')}: ${formatTime(m.endTime)}</span>
      <span class="status-label">${finished ? tr('status_finished') : started ? tr('status_live') : tr('status_upcoming')}</span>
    </div>
  `;

  renderProbChart(probs, m);
  renderMatchStateVisual(m, started, finished);
  renderOddsGrid(odds, value, m);
  renderTrendsMini(odds, value, m);
  renderAlternativePredictions(m.alternativePredictions || {});
  renderUltimateOptions(ultimate, m);
}

function renderProbChart(probs, m) {
  const labels = [
    { key: 'win1', label: m.team1 || tr('market_1') },
    { key: 'draw', label: tr('draw') },
    { key: 'win2', label: m.team2 || tr('market_2') },
  ];

  const maxProb = Math.max(...labels.map((l) => (probs[l.key] || 0) * 100), 1);

  $('probChart').innerHTML = labels
    .map(
      (l) => `
    <div class="prob-bar" style="height: ${((probs[l.key] || 0) * 100 / maxProb) * 80 + 10}%">
      <span class="label">${l.label}</span>
    </div>
  `
    )
    .join('');
}

function renderMatchStateVisual(m, started, finished) {
  const states = [
    { id: 'upcoming', label: 'À venir', active: !started && !finished },
    { id: 'live', label: 'En cours', active: started && !finished },
    { id: 'finished', label: 'Terminé', active: finished },
  ];

  $('matchStateVisual').innerHTML = states
    .map(
      (s) => `
    <div class="state-indicator ${s.active ? 'active' : 'inactive'}">${s.label}</div>
  `
    )
    .join('');
}

function getTrendIcon(trend, valueIndex) {
  if (valueIndex != null && valueIndex > 0.05) return { icon: '📈', label: 'Value', class: 'trend-value' };
  if (trend === 'up') return { icon: '📈', label: 'Hausse', class: 'trend-up' };
  if (trend === 'down') return { icon: '📉', label: 'Baisse', class: 'trend-down' };
  return { icon: '➡️', label: 'Stable', class: 'trend-stable' };
}

function getOddClass(odd, isFavorite) {
  if (odd == null) return '';
  const c = parseFloat(odd);
  if (isFavorite) return 'odd-favorite';
  if (c >= 3) return 'odd-long';
  if (c <= 1.5) return 'odd-short';
  return '';
}

function renderOddsGrid(odds, value, m) {
  const pred = m.prediction;
  const favKey = pred?.prediction?.outcome === 'Équipe 1' ? 'win1' : pred?.prediction?.outcome === 'Nul' ? 'draw' : pred?.prediction?.outcome === 'Équipe 2' ? 'win2' : null;

  const items = [
    { key: 'win1', label: m.team1 || 'Équipe 1' },
    { key: 'draw', label: 'Nul' },
    { key: 'win2', label: m.team2 || 'Équipe 2' },
  ];

  $('oddsGrid').innerHTML = items
    .map((i) => {
      const odd = odds[i.key];
      const vd = value[i.key];
      const prob = (m.prediction?.probs?.[i.key] || 0) * 100;
      const trend = simulateTrend(odds, i.key);
      const t = getTrendIcon(trend, vd?.valueIndex);
      const oddClass = getOddClass(odd, i.key === favKey);
      return `
    <div class="odd-card ${oddClass}" data-key="${i.key}">
      <div class="odd-card-header">
        <span class="odd-outcome">${i.label}</span>
        <span class="odd-trend ${t.class}" title="${t.label}">${t.icon}</span>
      </div>
      <div class="odd-value">${odd != null ? odd.toFixed(2) : '-'}</div>
      <div class="odd-prob-bar"><span class="odd-prob-fill" style="width:${Math.min(100, prob)}%"></span></div>
      <div class="odd-meta">${prob.toFixed(0)}% · ${vd?.valueIndex != null ? (vd.valueIndex > 0 ? '+' : '') + (vd.valueIndex * 100).toFixed(0) + '% value' : '-'}</div>
    </div>
  `;
    })
    .join('');
}

function renderTrendsMini(odds, value, m) {
  const items = [
    { key: 'win1', label: m.team1 || '1' },
    { key: 'draw', label: 'Nul' },
    { key: 'win2', label: m.team2 || '2' },
  ];
  const html = items
    .map((i) => {
      const odd = odds[i.key];
      const vd = value[i.key];
      const trend = simulateTrend(odds, i.key);
      const t = trend === 'up' ? '📈' : trend === 'down' ? '📉' : '➡️';
      const valStr = vd?.valueIndex != null && vd.valueIndex > 0 ? ` <span class="value-badge">+${(vd.valueIndex * 100).toFixed(0)}%</span>` : '';
      return `<span class="trend-item"><strong>${i.label}</strong> ${odd != null ? odd.toFixed(2) : '-'} ${t}${valStr}</span>`;
    })
    .join(' &nbsp; ');
  $('trendsMini').innerHTML = html ? `<div class="trends-strip">${html}</div>` : '';
}

function renderAlternativePredictions(alt) {
  const decision = alt.decision || tr('alt_no_decision');
  const options = alt.options || [];
  const paris = alt.parisAlternatifs || [];

  $('alternativeDecision').innerHTML = `<div class="alt-decision-text">${decision}</div>`;

  if (options.length === 0) {
    $('alternativeOptions').innerHTML = '<p class="alt-empty">' + tr('alt_no_option') + '</p>';
  } else {
    $('alternativeOptions').innerHTML = options
      .map((opt, i) => `
        <div class="alt-option ${i === 0 ? 'alt-recommended' : ''}">
          <span class="alt-nom">${opt.nom || opt.pari?.nom || '-'}</span>
          <span class="alt-cote">${typeof (opt.cote ?? opt.pari?.cote) === 'number' ? (opt.cote ?? opt.pari?.cote).toFixed(2) : (opt.cote ?? opt.pari?.cote ?? '-')}</span>
          <span class="alt-cat">${opt.categorie || ''}</span>
          ${opt.confiance ? `<span class="alt-conf">${Math.round(opt.confiance)}%</span>` : ''}
        </div>
      `)
      .join('');
  }

  if (paris.length > 0) {
    $('alternativeAllBets').innerHTML = `
      <div class="alt-all-title">${tr('alt_available')}</div>
      <div class="alt-all-list">${paris.map((p) => `<span class="alt-bet-chip">${p.nom} <strong>${p.cote}</strong></span>`).join('')}</div>
    `;
  } else {
    $('alternativeAllBets').innerHTML = '';
  }
}

function renderUltimateOptions(ultimate, m) {
  const options = ultimate.options || [];

  if (options.length === 0) {
    $('ultimateOptions').innerHTML = `
      <p class="ultimate-desc">${tr('ultimate_empty')}</p>
    `;
    $('selectedBet').style.display = 'none';
    return;
  }

  const recommended = ultimate.recommended;

  $('ultimateOptions').innerHTML = options
    .map(
      (opt) => `
    <div class="ultimate-option" data-key="${opt.key}" data-odds="${opt.odds}" data-label="${(opt.team || opt.outcome).replace(/"/g, '&quot;')}">
      <span>
        ${opt.team || opt.outcome}
        ${opt === recommended ? '<span class="recommended">' + tr('recommended') + '</span>' : ''}
      </span>
      <span>
        <span class="odds">${opt.odds?.toFixed(2)}</span>
        <span class="prob">(${opt.prob ? (opt.prob * 100).toFixed(0) : 0}%)</span>
      </span>
    </div>
  `
    )
    .join('');

  $('ultimateOptions').querySelectorAll('.ultimate-option').forEach((el) => {
    el.addEventListener('click', () => {
      $('ultimateOptions').querySelectorAll('.ultimate-option').forEach((e) => e.classList.remove('selected'));
      el.classList.add('selected');
      $('selectedLabel').textContent = el.dataset.label;
      $('selectedOdds').textContent = el.dataset.odds;
      $('selectedBet').style.display = 'block';
    });
  });

  if (recommended) {
    const recEl = $('ultimateOptions').querySelector(`[data-key="${recommended.key}"]`);
    if (recEl) recEl.classList.add('selected');
    $('selectedLabel').textContent = recommended.team || recommended.outcome;
    $('selectedOdds').textContent = recommended.odds?.toFixed(2) || '-';
    $('selectedBet').style.display = 'block';
  } else {
    $('selectedBet').style.display = 'none';
  }
}

function applyPageTranslations() {
  const map = {
    i18nVisualisations: 'visualisations',
    i18nProb1x2: 'prob_1x2',
    i18nMatchState: 'match_state',
    i18nOddsTrends: 'odds_trends',
    i18nAltBets: 'alt_bets',
    i18nAltDesc: 'alt_desc',
    i18nUltimateBet: 'ultimate_bet',
    i18nUltimateDesc: 'ultimate_desc',
    i18nSelectedBetLabel: 'selected_bet_label',
    i18nOddsLabel: 'odds_label',
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = tr(key);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyPageTranslations();
  loadMatch();
  setInterval(loadMatch, REFRESH_INTERVAL);
});
