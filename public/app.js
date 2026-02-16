const t = typeof window !== 'undefined' && window.__t ? window.__t : (k) => k;

const API = {
  fifa: '/api/fifa-penalty',
  all: '/api/all-virtual',
  match: (id) => `/api/match/${id}`,
};

function translateOutcome(outcome) {
  if (outcome === 'Équipe 1') return t('outcome_1');
  if (outcome === 'Équipe 2') return t('outcome_2');
  if (outcome === 'Nul') return t('draw');
  return outcome;
}

let allData = [];
let penaltyData = [];

const $ = (id) => document.getElementById(id);
const loading = $('loading');
const error = $('error');
const matches = $('matches');
const fallbackInfo = $('fallbackInfo');

function showLoading(show) {
  loading.style.display = show ? 'block' : 'none';
  error.style.display = 'none';
}

function showError(show) {
  error.style.display = show ? 'block' : 'none';
  loading.style.display = 'none';
}

async function loadData() {
  showLoading(true);
  try {
    const [fifaRes, allRes] = await Promise.all([
      fetch(API.fifa),
      fetch(API.all),
    ]);
    const fifaJson = await fifaRes.json();
    const allJson = await allRes.json();

    if (fifaJson.success) penaltyData = fifaJson.data || [];
    if (allJson.success) allData = allJson.data || [];

    render();
  } catch (err) {
    console.error(err);
    showError(true);
  } finally {
    showLoading(false);
  }
}

function getData() {
  return penaltyData.length > 0 ? penaltyData : allData;
}

function groupByLeague(data) {
  const groups = {};
  for (const m of data) {
    const league = m.league || t('league_other');
    if (!groups[league]) groups[league] = [];
    groups[league].push(m);
  }
  return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatStatus(sc) {
  if (!sc) return '';
  if (sc.CPS) return sc.CPS;
  if (sc.SLS) return sc.SLS;
  if (sc.FS?.S1 != null && sc.FS?.S2 != null) {
    return `⚽ ${sc.FS.S1} - ${sc.FS.S2}`;
  }
  return '';
}

function renderStatusBar(m) {
  const start = formatTime(m.startTime);
  const end = formatTime(m.endTime);
  const now = Math.floor(Date.now() / 1000);
  const started = m.startTime && now >= m.startTime;
  const finished = m.endTime && now >= m.endTime;

  let statusClass = 'status-upcoming';
  if (finished) statusClass = 'status-finished';
  else if (started) statusClass = 'status-live';

  return `
    <div class="status-bar ${statusClass}">
      <span class="status-dot"></span>
      <span>${t('start')}: ${start}</span>
      <span class="separator">→</span>
      <span>${t('end')}: ${end}</span>
      <span class="status-label">${finished ? t('status_finished') : started ? t('status_live') : t('status_upcoming')}</span>
    </div>
  `;
}

function renderMatch(m) {
  const pred = m.prediction;
  const favorite = pred?.prediction;
  const odds = pred?.odds || {};

  const isWin1 = favorite?.outcome === 'Équipe 1';
  const isDraw = favorite?.outcome === 'Nul';
  const isWin2 = favorite?.outcome === 'Équipe 2';
  const predLabel = favorite ? (favorite.team || translateOutcome(favorite.outcome)) : '';

  return `
    <article class="match-card">
      <div class="match-header">
        <span class="status-text">${formatStatus(m.status)}</span>
      </div>
      ${renderStatusBar(m)}
      <div class="teams">
        <div class="team">${m.team1 || '?'}</div>
        <span class="vs">
          ${m.status?.FS?.S1 != null && m.status?.FS?.S2 != null
            ? `<span class="mini-score">${m.status.FS.S1}<span class="score-colon">:</span>${m.status.FS.S2}</span>`
            : 'VS'}
        </span>
        <div class="team">${m.team2 || '?'}</div>
      </div>
      <div class="odds-row">
        <div class="odd ${isWin1 ? 'predicted' : ''}">
          <div class="label">${t('market_1')}</div>
          <div>${odds.win1 != null ? odds.win1.toFixed(2) : '-'}</div>
        </div>
        <div class="odd ${isDraw ? 'predicted' : ''}">
          <div class="label">${t('market_x')}</div>
          <div>${odds.draw != null ? odds.draw.toFixed(2) : '-'}</div>
        </div>
        <div class="odd ${isWin2 ? 'predicted' : ''}">
          <div class="label">${t('market_2')}</div>
          <div>${odds.win2 != null ? odds.win2.toFixed(2) : '-'}</div>
        </div>
      </div>
      ${
        favorite
          ? `
      <div class="prediction-box">
        <span><strong>${t('prediction')} :</strong> ${predLabel}</span>
        <span class="confidence">${t('confidence')}: ${favorite.confidence || 0}%</span>
        <span class="confidence">${t('odds')}: ${favorite.odds?.toFixed(2) || '-'}</span>
      </div>
      `
          : ''
      }
      <a href="/match?id=${m.id}" class="btn-details">${t('details')}</a>
    </article>
  `;
}

function render() {
  const data = getData();
  const byLeague = groupByLeague(data);

  if (!data || data.length === 0) {
    matches.innerHTML = `
      <div class="empty-state">
        <p>${t('no_match_fifa')}</p>
        <p>${t('try_later')}</p>
      </div>
    `;
  } else {
    matches.innerHTML = byLeague
      .map(
        ([league, items]) => `
        <div class="league-group">
          <h3 class="league-title">${league}</h3>
          <div class="league-matches">${items.map(renderMatch).join('')}</div>
        </div>
      `
      )
      .join('');
  }

  fallbackInfo.style.display = penaltyData.length === 0 && allData.length > 0 ? 'block' : 'none';
  if (fallbackInfo.style.display === 'block') fallbackInfo.textContent = t('fallback_fifa');
}

function applyTranslations() {
  const loadingText = document.getElementById('loadingText');
  if (loadingText) loadingText.textContent = t('loading');
  const errorText = document.getElementById('errorText');
  if (errorText) errorText.textContent = t('error_load');
  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) retryBtn.textContent = t('retry');
  const footerDisclaimer = document.getElementById('footerDisclaimer');
  if (footerDisclaimer) footerDisclaimer.textContent = t('footer_disclaimer');
}

applyTranslations();
loadData();
setInterval(loadData, 60000);
