const AUTO_REFRESH_SECONDS = 60;
const DRIFT_THRESHOLD_PERCENT = 8;

let radarChart = null;
let flowChart = null;
let currentMatchId = null;
let refreshIntervalId = null;
let countdownIntervalId = null;
let countdown = AUTO_REFRESH_SECONDS;
let previousOdds = null;
let loading = false;
const IS_MOBILE = window.matchMedia("(max-width: 760px)").matches;
let lastDetailsData = null;

function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function formatOdd(value) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function chartTextColor() {
  return "#d8e7f8";
}

function chartGridColor() {
  return "rgba(255,255,255,0.12)";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateRefreshBadge() {
  const el = document.getElementById("refreshBadge");
  if (el) el.textContent = `Auto-refresh dans ${countdown}s`;
}

function setMatchTelegramButtonEnabled(enabled) {
  const btn = document.getElementById("sendMatchTelegramBtn");
  const btnImageTelegram = document.getElementById("sendMatchTelegramImageBtn");
  const pdfBtn = document.getElementById("downloadMatchPdfBtn");
  const imageBtn = document.getElementById("downloadMatchImageBtn");
  if (btn) btn.disabled = !enabled;
  if (btnImageTelegram) btnImageTelegram.disabled = !enabled;
  if (pdfBtn) pdfBtn.disabled = !enabled;
  if (imageBtn) imageBtn.disabled = !enabled;
}

function startAutoRefresh() {
  if (!refreshIntervalId) {
    refreshIntervalId = setInterval(() => {
      countdown = AUTO_REFRESH_SECONDS;
      updateRefreshBadge();
      loadData("auto");
    }, AUTO_REFRESH_SECONDS * 1000);
  }
  if (!countdownIntervalId) {
    countdownIntervalId = setInterval(() => {
      countdown = Math.max(0, countdown - 1);
      updateRefreshBadge();
    }, 1000);
  }
}

function impliedProbabilities(odds1x2) {
  const home = toNumber(odds1x2?.home, 0);
  const draw = toNumber(odds1x2?.draw, 0);
  const away = toNumber(odds1x2?.away, 0);
  if (!(home > 0 && draw > 0 && away > 0)) return { home: 33.3, draw: 33.3, away: 33.4 };
  const ph = 1 / home;
  const pd = 1 / draw;
  const pa = 1 / away;
  const sum = ph + pd + pa;
  return {
    home: Number(((ph / sum) * 100).toFixed(2)),
    draw: Number(((pd / sum) * 100).toFixed(2)),
    away: Number(((pa / sum) * 100).toFixed(2)),
  };
}

function extractOdds(match) {
  return {
    home: toNumber(match?.odds1x2?.home, 0),
    draw: toNumber(match?.odds1x2?.draw, 0),
    away: toNumber(match?.odds1x2?.away, 0),
  };
}

function computeDrift(previous, next) {
  if (!previous) return [];
  const labels = {
    home: "Victoire domicile (1)",
    draw: "Match nul (X)",
    away: "Victoire exterieur (2)",
  };
  const drifts = [];
  for (const key of ["home", "draw", "away"]) {
    const oldVal = toNumber(previous[key], 0);
    const newVal = toNumber(next[key], 0);
    if (oldVal <= 0 || newVal <= 0) continue;
    const pct = Math.abs(((newVal - oldVal) / oldVal) * 100);
    if (pct >= DRIFT_THRESHOLD_PERCENT) {
      drifts.push({
        label: labels[key],
        oldVal,
        newVal,
        pct: Number(pct.toFixed(1)),
      });
    }
  }
  return drifts;
}

function renderDriftAlert(drifts) {
  const box = document.getElementById("driftAlert");
  if (!box) return;
  if (!drifts.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  const rows = drifts
    .map((d) => `<li>${d.label}: ${formatOdd(d.oldVal)} -> ${formatOdd(d.newVal)} (${d.pct}%)</li>`)
    .join("");
  box.classList.remove("hidden");
  box.innerHTML = `
    <h2 class="drift-title">Alerte Drift Cotes</h2>
    <ul class="drift-list">${rows}</ul>
  `;
}

function renderMaster(master, analyse) {
  const el = document.getElementById("master");
  el.innerHTML = `
    <h2>Decision Finale (Maitre)</h2>
    <div class="grid2">
      <div class="box"><strong>Pari choisi</strong><div>${master.pari_choisi || "Aucun"}</div></div>
      <div class="box"><strong>Action</strong><div>${master.action || "AUCUNE"}</div></div>
      <div class="box"><strong>Confiance</strong><div>${master.confiance_numerique ?? 0}%</div></div>
      <div class="box"><strong>Consensus bots</strong><div>${analyse.consensus || "N/A"}</div></div>
    </div>
  `;
}

function renderBots(bots) {
  const el = document.getElementById("bots");
  const rows = Object.values(bots || [])
    .map((b) => {
      const picks = Array.isArray(b.paris_recommandes)
        ? b.paris_recommandes
            .map((p) => `<li>${p.nom} | cote ${formatOdd(Number(p.cote))} | confiance ${p.confiance ?? 0}%</li>`)
            .join("")
        : "";
      return `
      <div class="box">
        <strong>${b.bot_name}</strong>
        <div>Confiance globale: ${b.confiance_globale || 0}%</div>
        <div>Top paris: ${Array.isArray(b.paris_recommandes) ? b.paris_recommandes.length : 0}</div>
        <ul>${picks || "<li>Aucun pari retenu</li>"}</ul>
      </div>
    `;
    })
    .join("");
  el.innerHTML = `<h2>Confiance des Bots</h2><div class="grid2">${rows || "<div class='box'>Aucun bot</div>"}</div>`;
}

function renderTop3(list) {
  const el = document.getElementById("top3");
  const li = (list || [])
    .map((x) => `<li>${x.pari} | cote ${formatOdd(x.cote)} | score ${x.score_composite}% | value ${x.value}% | risque ${x.risque}</li>`)
    .join("");
  el.innerHTML = `<h2>Top 3 Recommandations</h2><ul>${li || "<li>Aucune recommandation</li>"}</ul>`;
}

function renderMarkets(markets) {
  const el = document.getElementById("markets");
  const li = (markets || [])
    .slice(0, 50)
    .map((m) => `<li>${m.nom} | cote ${formatOdd(m.cote)} | type ${m.type}</li>`)
    .join("");
  el.innerHTML = `<h2>Marches Analyses</h2><ul>${li || "<li>Aucun marche</li>"}</ul>`;
}

function pickSingleSelectionFromDetails(data) {
  const match = data?.match || {};
  const prediction = data?.prediction || {};
  const bettingMarkets = Array.isArray(data?.bettingMarkets) ? data.bettingMarkets : [];
  const master = prediction?.maitre?.decision_finale || {};
  const marketByName = new Map(bettingMarkets.map((m) => [String(m.nom), m]));

  let pari = String(master.pari_choisi || "").trim();
  let cote = pari ? Number(marketByName.get(pari)?.cote) : NaN;
  let confiance = Number(master.confiance_numerique || 0);

  if (!pari || !Number.isFinite(cote)) {
    const top = prediction?.analyse_avancee?.top_3_recommandations || [];
    const best = top.find((x) => Number.isFinite(Number(x?.cote)));
    if (best) {
      pari = String(best.pari || "");
      cote = Number(best.cote);
      confiance = Number(best.score_composite || confiance || 55);
    }
  }

  if (!pari || !Number.isFinite(cote)) {
    const fallback = bettingMarkets.find((m) => Number.isFinite(Number(m?.cote)));
    if (fallback) {
      pari = String(fallback.nom || "");
      cote = Number(fallback.cote);
      confiance = Math.max(confiance, 50);
    }
  }

  if (!pari || !Number.isFinite(cote)) return null;

  return {
    matchId: match.id,
    teamHome: match.teamHome,
    teamAway: match.teamAway,
    league: match.league,
    pari,
    cote,
    confiance: Number.isFinite(confiance) ? Number(confiance.toFixed(1)) : 55,
  };
}

function couponSummary(coupon) {
  const totalSelections = coupon.length;
  const combinedOdd = totalSelections ? Number(coupon.reduce((acc, x) => acc * Number(x.cote || 1), 1).toFixed(3)) : null;
  const averageConfidence = totalSelections
    ? Number((coupon.reduce((acc, x) => acc + Number(x.confiance || 0), 0) / totalSelections).toFixed(1))
    : 0;
  return { totalSelections, combinedOdd, averageConfidence };
}

async function sendCurrentMatchToTelegram() {
  const btn = document.getElementById("sendMatchTelegramBtn");
  if (!lastDetailsData) return;

  const selection = pickSingleSelectionFromDetails(lastDetailsData);
  if (!selection) {
    document.getElementById("sub").textContent = "Selection Telegram impossible pour ce match.";
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Envoi...";
  }

  try {
    const payload = {
      coupon: [selection],
      summary: couponSummary([selection]),
      riskProfile: "single-match",
    };
    const res = await fetch("/api/coupon/send-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || data?.message || "Erreur Telegram");
    }
    document.getElementById("sub").textContent = "Ticket 1 match envoye sur Telegram.";
  } catch (error) {
    document.getElementById("sub").textContent = `Erreur Telegram: ${error.message}`;
  } finally {
    if (btn) {
      btn.textContent = "Envoyer Telegram";
      setMatchTelegramButtonEnabled(Boolean(lastDetailsData));
    }
  }
}

async function sendCurrentMatchImageToTelegram() {
  const btn = document.getElementById("sendMatchTelegramImageBtn");
  if (!lastDetailsData) return;
  const selection = pickSingleSelectionFromDetails(lastDetailsData);
  if (!selection) {
    document.getElementById("sub").textContent = "Selection Telegram image impossible pour ce match.";
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Envoi image...";
  }

  try {
    const payload = {
      coupon: [selection],
      summary: couponSummary([selection]),
      riskProfile: "single-match",
      sendImage: true,
      imageFormat: "png",
    };
    const res = await fetch("/api/coupon/send-telegram", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) throw new Error(data?.error || data?.message || "Erreur Telegram image");
    document.getElementById("sub").textContent = "Image du ticket match envoyee sur Telegram.";
  } catch (error) {
    document.getElementById("sub").textContent = `Erreur Telegram image: ${error.message}`;
  } finally {
    if (btn) {
      btn.textContent = "Telegram Image";
      setMatchTelegramButtonEnabled(Boolean(lastDetailsData));
    }
  }
}

async function downloadCurrentMatchPdf() {
  if (!lastDetailsData) return;
  const selection = pickSingleSelectionFromDetails(lastDetailsData);
  if (!selection) {
    document.getElementById("sub").textContent = "Selection PDF impossible pour ce match.";
    return;
  }

  try {
    const payload = {
      coupon: [selection],
      summary: couponSummary([selection]),
      riskProfile: "single-match",
    };
    const endpoints = ["/api/coupon/pdf", "/api/pdf/coupon", "/api/download/coupon"];
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `match-ticket-${selection.matchId}-${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    document.getElementById("sub").textContent = "PDF match telecharge.";
  } catch (error) {
    document.getElementById("sub").textContent = `Erreur PDF: ${error.message}`;
  }
}

async function downloadCurrentMatchImage() {
  if (!lastDetailsData) return;
  const selection = pickSingleSelectionFromDetails(lastDetailsData);
  if (!selection) {
    document.getElementById("sub").textContent = "Selection image impossible pour ce match.";
    return;
  }

  try {
    const payload = {
      coupon: [selection],
      summary: couponSummary([selection]),
      riskProfile: "single-match",
      format: "png",
    };
    const endpoints = ["/api/coupon/image"];
    let blob = null;
    let lastErr = "Erreur image";
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `match-ticket-${selection.matchId}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    document.getElementById("sub").textContent = "Image match telechargee.";
  } catch (error) {
    document.getElementById("sub").textContent = `Erreur image: ${error.message}`;
  }
}

function computeMatchModel(data) {
  const match = data.match || {};
  const prediction = data.prediction || {};
  const bots = Object.values(prediction.bots || {});
  const probs = impliedProbabilities(match.odds1x2);

  const avgBotConfidence =
    bots.length > 0
      ? Number((bots.reduce((acc, b) => acc + toNumber(b.confiance_globale, 0), 0) / bots.length).toFixed(2))
      : 0;
  const masterConfidence = toNumber(prediction?.maitre?.decision_finale?.confiance_numerique, 0);

  const marketCount = Array.isArray(data.bettingMarkets) ? data.bettingMarkets.length : 0;
  const odds = extractOdds(match);
  const oddsMean = ((odds.home || 0) + (odds.draw || 0) + (odds.away || 0)) / 3 || 1;
  const volatility = previousOdds
    ? Number(
        (
          (Math.abs(odds.home - previousOdds.home) +
            Math.abs(odds.draw - previousOdds.draw) +
            Math.abs(odds.away - previousOdds.away)) /
          3
        ).toFixed(3)
      )
    : 0;

  const homePower = clamp(probs.home * 0.52 + masterConfidence * 0.22 + avgBotConfidence * 0.16, 8, 96);
  const awayPower = clamp(probs.away * 0.52 + (100 - masterConfidence) * 0.22 + avgBotConfidence * 0.16, 8, 96);
  const drawGrip = clamp(probs.draw * 1.35 + (odds.draw < 4 ? 8 : 0), 4, 65);
  const valuePulse = clamp((marketCount / 160) * 100 + (100 / oddsMean) * 8, 5, 100);
  const driftPulse = clamp(volatility * 100, 0, 100);

  const axis = ["Attaque", "Controle", "Forme", "Precision", "Discipline", "Momentum"];
  const homeProfile = [
    clamp(homePower * 0.94, 8, 99),
    clamp(homePower * 0.87 + drawGrip * 0.1, 8, 99),
    clamp(avgBotConfidence * 0.95, 8, 99),
    clamp((100 / Math.max(1.05, odds.home)) * 1.2, 8, 99),
    clamp(72 - driftPulse * 0.28 + probs.home * 0.24, 8, 99),
    clamp(homePower - driftPulse * 0.42 + (masterConfidence - 50) * 0.35, 8, 99),
  ];
  const awayProfile = [
    clamp(awayPower * 0.94, 8, 99),
    clamp(awayPower * 0.87 + drawGrip * 0.1, 8, 99),
    clamp((100 - avgBotConfidence) * 0.4 + 44, 8, 99),
    clamp((100 / Math.max(1.05, odds.away)) * 1.2, 8, 99),
    clamp(72 - driftPulse * 0.28 + probs.away * 0.24, 8, 99),
    clamp(awayPower - driftPulse * 0.42 + (50 - masterConfidence) * 0.35, 8, 99),
  ];

  const timeline = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const confFactor = (avgBotConfidence + masterConfidence) / 200;
  const waveAmp = clamp(6 + driftPulse * 0.08 + confFactor * 5, 4, 18);
  const homeFlow = timeline.map((m) =>
    clamp(
      probs.home + Math.sin((m / 90) * Math.PI * 2) * waveAmp + (m > 45 ? 2.2 : 0) + (masterConfidence - 50) * 0.05,
      3,
      93
    )
  );
  const awayFlow = timeline.map((m) =>
    clamp(
      probs.away + Math.cos((m / 90) * Math.PI * 1.7) * waveAmp + (m > 60 ? 1.8 : 0) + (50 - masterConfidence) * 0.05,
      3,
      93
    )
  );
  const drawFlow = timeline.map((_, i) => clamp(100 - homeFlow[i] - awayFlow[i], 2, 45));

  return {
    axis,
    homeProfile,
    awayProfile,
    timeline,
    homeFlow,
    awayFlow,
    drawFlow,
    kpis: {
      homeWin: probs.home,
      awayWin: probs.away,
      valuePulse,
      driftPulse,
    },
  };
}

function renderKpis(model) {
  const el = document.getElementById("kpiGrid");
  if (!el) return;
  el.innerHTML = `
    <div class="kpi"><small>Win Home</small><strong>${model.kpis.homeWin.toFixed(1)}%</strong></div>
    <div class="kpi"><small>Win Away</small><strong>${model.kpis.awayWin.toFixed(1)}%</strong></div>
    <div class="kpi"><small>Value Pulse</small><strong>${model.kpis.valuePulse.toFixed(1)}</strong></div>
    <div class="kpi"><small>Drift Pulse</small><strong>${model.kpis.driftPulse.toFixed(1)}</strong></div>
  `;
}

function makeGlowGradient(ctx, colorStart, colorEnd) {
  const g = ctx.createLinearGradient(0, 0, 0, 340);
  g.addColorStop(0, colorStart);
  g.addColorStop(1, colorEnd);
  return g;
}

function renderNeuralCharts(data) {
  const radarCanvas = document.getElementById("chartRadar");
  const flowCanvas = document.getElementById("chartFlow");
  if (!radarCanvas || !flowCanvas || !window.Chart) return;

  const model = computeMatchModel(data);
  renderKpis(model);

  if (radarChart) {
    try { radarChart.destroy(); } catch {}
  }
  if (flowChart) {
    try { flowChart.destroy(); } catch {}
  }

  radarChart = new Chart(radarCanvas, {
    type: "radar",
    data: {
      labels: model.axis,
      datasets: [
        {
          label: data.match?.teamHome || "Equipe 1",
          data: model.homeProfile,
          borderColor: "#5fd2ff",
          backgroundColor: "rgba(95, 210, 255, 0.24)",
          borderWidth: 2,
        },
        {
          label: data.match?.teamAway || "Equipe 2",
          data: model.awayProfile,
          borderColor: "#ff7b7b",
          backgroundColor: "rgba(255, 123, 123, 0.2)",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: 100,
          angleLines: { color: "rgba(255,255,255,0.13)" },
          grid: { color: "rgba(255,255,255,0.12)" },
          pointLabels: { color: chartTextColor() },
          ticks: { display: false },
        },
      },
      plugins: {
        legend: { labels: { color: chartTextColor() } },
      },
    },
  });

  const flowCtx = flowCanvas.getContext("2d");
  if (!flowCtx) return;
  const gradHome = makeGlowGradient(flowCtx, "rgba(83, 206, 255, 0.5)", "rgba(83, 206, 255, 0.02)");
  const gradAway = makeGlowGradient(flowCtx, "rgba(255, 109, 109, 0.42)", "rgba(255, 109, 109, 0.01)");

  flowChart = new Chart(flowCanvas, {
    type: "line",
    data: {
      labels: model.timeline,
      datasets: [
        {
          label: `${data.match?.teamHome || "Home"} flux`,
          data: model.homeFlow,
          borderColor: "#53ceff",
          backgroundColor: gradHome,
          fill: true,
          pointRadius: IS_MOBILE ? 0 : 2,
          tension: 0.34,
          borderWidth: 2.4,
        },
        {
          label: `${data.match?.teamAway || "Away"} flux`,
          data: model.awayFlow,
          borderColor: "#ff6d6d",
          backgroundColor: gradAway,
          fill: true,
          pointRadius: IS_MOBILE ? 0 : 2,
          tension: 0.34,
          borderWidth: 2.4,
        },
        {
          label: "Zone Nul",
          data: model.drawFlow,
          borderColor: "#ffd479",
          borderDash: [7, 4],
          fill: false,
          pointRadius: 0,
          tension: 0.28,
          borderWidth: 1.7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: IS_MOBILE ? false : { duration: 420 },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { color: chartTextColor(), callback: (v) => `${v}%` },
          grid: { color: chartGridColor() },
        },
        x: {
          ticks: { color: chartTextColor(), callback: (v) => `${model.timeline[v]}'` },
          grid: { color: "rgba(255,255,255,0.06)" },
        },
      },
      plugins: {
        legend: { labels: { color: chartTextColor() } },
        tooltip: {
          enabled: !IS_MOBILE,
          callbacks: {
            title: (items) => `${items?.[0]?.label || 0} min`,
            label: (ctx) => `${ctx.dataset.label}: ${toNumber(ctx.parsed?.y, 0).toFixed(1)}%`,
          },
        },
      },
    },
  });
}

async function loadData(trigger = "manual") {
  if (loading || !currentMatchId) return;
  loading = true;
  try {
    const res = await fetch(`/api/matches/${encodeURIComponent(currentMatchId)}/details`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur API");

    const match = data.match || {};
    lastDetailsData = data;
    setMatchTelegramButtonEnabled(true);
    document.getElementById("title").textContent = `${match.teamHome} vs ${match.teamAway}`;
    document.getElementById("sub").textContent = `${match.league} | marche(s): ${data.bettingMarkets?.length || 0}${trigger === "auto" ? " | mise a jour auto" : ""}`;

    renderMaster(data.prediction?.maitre?.decision_finale || {}, data.prediction?.maitre?.analyse_bots || {});
    renderNeuralCharts(data);
    renderBots(data.prediction?.bots || {});
    renderTop3(data.prediction?.analyse_avancee?.top_3_recommandations || []);
    renderMarkets(data.bettingMarkets || []);

    const currentOdds = extractOdds(match);
    const drifts = computeDrift(previousOdds, currentOdds);
    renderDriftAlert(drifts);
    previousOdds = currentOdds;
  } catch (error) {
    lastDetailsData = null;
    setMatchTelegramButtonEnabled(false);
    document.getElementById("title").textContent = "Erreur de chargement";
    document.getElementById("sub").textContent = error.message;
    console.error("Erreur match.js:", error);
  } finally {
    loading = false;
  }
}

function init() {
  currentMatchId = qs("id");
  if (!currentMatchId) {
    setMatchTelegramButtonEnabled(false);
    document.getElementById("title").textContent = "Match non specifie";
    document.getElementById("sub").textContent = "Ajoute ?id=...";
    return;
  }
  countdown = AUTO_REFRESH_SECONDS;
  updateRefreshBadge();
  setMatchTelegramButtonEnabled(false);
  const sendBtn = document.getElementById("sendMatchTelegramBtn");
  if (sendBtn) sendBtn.addEventListener("click", sendCurrentMatchToTelegram);
  const sendImageBtn = document.getElementById("sendMatchTelegramImageBtn");
  if (sendImageBtn) sendImageBtn.addEventListener("click", sendCurrentMatchImageToTelegram);
  const pdfBtn = document.getElementById("downloadMatchPdfBtn");
  if (pdfBtn) pdfBtn.addEventListener("click", downloadCurrentMatchPdf);
  const imageBtn = document.getElementById("downloadMatchImageBtn");
  if (imageBtn) imageBtn.addEventListener("click", downloadCurrentMatchImage);
  loadData("manual");
  startAutoRefresh();
}

init();
