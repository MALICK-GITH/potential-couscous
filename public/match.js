const charts = [];

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

function setupTabs() {
  const tabs = document.querySelectorAll(".analytics-tab");
  const panels = document.querySelectorAll(".tab-content");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.target;
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = document.getElementById(target);
      if (panel) panel.classList.add("active");
    });
  });
}

function destroyCharts() {
  while (charts.length) {
    const c = charts.pop();
    try {
      c.destroy();
    } catch {}
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
  const rows = Object.values(bots || {})
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

function makeForceChart(match) {
  const p = impliedProbabilities(match.odds1x2);
  const ctx = document.getElementById("chartForce");
  if (!ctx || !window.Chart) return;
  charts.push(
    new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: [match.teamHome, match.teamAway, "Nul"],
        datasets: [{ data: [p.home, p.away, p.draw], backgroundColor: ["#55b0e8", "#ea7166", "#9a6fd6"] }],
      },
      options: {
        plugins: { legend: { labels: { color: chartTextColor() } } },
      },
    })
  );
}

function makeOddsSnapshotChart(match) {
  const ctx = document.getElementById("chartOddsSnapshot");
  if (!ctx || !window.Chart) return;
  charts.push(
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: [`Victoire ${match.teamHome}`, "Match nul", `Victoire ${match.teamAway}`],
        datasets: [{ label: "Cote reelle", data: [toNumber(match.odds1x2?.home), toNumber(match.odds1x2?.draw), toNumber(match.odds1x2?.away)], backgroundColor: ["#55b0e8", "#64d18c", "#ea7166"] }],
      },
      options: {
        scales: {
          y: { ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } },
          x: { ticks: { color: chartTextColor() }, grid: { color: "rgba(255,255,255,0.05)" } },
        },
        plugins: { legend: { labels: { color: chartTextColor() } } },
      },
    })
  );
}

function makeBotsChart(prediction) {
  const ctx = document.getElementById("chartBots");
  if (!ctx || !window.Chart) return;
  const bots = Object.values(prediction?.bots || {});
  const labels = bots.map((b) => (b.bot_name || "").replace(" ALTERNATIFS", ""));
  const data = bots.map((b) => toNumber(b.confiance_globale, 0));
  labels.push("MAITRE");
  data.push(toNumber(prediction?.maitre?.decision_finale?.confiance_numerique, 0));

  charts.push(
    new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Confiance (%)", data, backgroundColor: ["#55b0e8", "#ea7166", "#64d18c", "#c5a65e", "#9a6fd6", "#ffd79c"] }] },
      options: {
        scales: {
          y: { min: 0, max: 100, ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } },
          x: { ticks: { color: chartTextColor() } },
        },
        plugins: { legend: { labels: { color: chartTextColor() } } },
      },
    })
  );
}

function makeTop3Chart(prediction) {
  const ctx = document.getElementById("chartTop3");
  if (!ctx || !window.Chart) return;
  const top3 = prediction?.analyse_avancee?.top_3_recommandations || [];
  charts.push(
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: top3.map((x, i) => `#${i + 1} ${String(x.pari || "").slice(0, 20)}`),
        datasets: [
          { label: "Score composite", data: top3.map((x) => toNumber(x.score_composite, 0)), backgroundColor: "#55b0e8" },
          { label: "Value", data: top3.map((x) => toNumber(x.value, 0)), backgroundColor: "#ea7166" },
        ],
      },
      options: {
        scales: {
          y: { ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } },
          x: { ticks: { color: chartTextColor(), maxRotation: 35, minRotation: 20 } },
        },
        plugins: { legend: { labels: { color: chartTextColor() } } },
      },
    })
  );
}

function marketStats(markets) {
  const map = new Map();
  for (const m of markets || []) {
    const type = m.type || "AUTRE";
    if (!map.has(type)) map.set(type, { count: 0, oddsSum: 0 });
    const r = map.get(type);
    r.count += 1;
    r.oddsSum += toNumber(m.cote, 0);
  }
  return [...map.entries()].map(([type, v]) => ({
    type,
    count: v.count,
    avgOdd: Number((v.oddsSum / Math.max(v.count, 1)).toFixed(3)),
  }));
}

function makeMarketTypeChart(markets) {
  const ctx = document.getElementById("chartMarketTypes");
  if (!ctx || !window.Chart) return;
  const stats = marketStats(markets);
  charts.push(
    new Chart(ctx, {
      type: "pie",
      data: {
        labels: stats.map((s) => s.type),
        datasets: [{ data: stats.map((s) => s.count), backgroundColor: ["#55b0e8", "#ea7166", "#64d18c", "#9a6fd6", "#c5a65e", "#7ec6a2"] }],
      },
      options: {
        plugins: { legend: { labels: { color: chartTextColor() } } },
      },
    })
  );
}

function makeMarketOddsChart(markets) {
  const ctx = document.getElementById("chartMarketOdds");
  if (!ctx || !window.Chart) return;
  const stats = marketStats(markets);
  charts.push(
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: stats.map((s) => s.type),
        datasets: [{ label: "Cote moyenne", data: stats.map((s) => s.avgOdd), backgroundColor: "#9dd6ff" }],
      },
      options: {
        scales: {
          y: { ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } },
          x: { ticks: { color: chartTextColor() } },
        },
        plugins: { legend: { labels: { color: chartTextColor() } } },
      },
    })
  );
}

function makeConsensusChart(prediction, markets) {
  const ctx = document.getElementById("chartConsensus");
  if (!ctx || !window.Chart) return;
  const votes = new Map();
  for (const bot of Object.values(prediction?.bots || {})) {
    for (const p of bot?.paris_recommandes || []) {
      votes.set(p.nom, (votes.get(p.nom) || 0) + 1);
    }
  }
  const masterPick = prediction?.maitre?.decision_finale?.pari_choisi;
  if (masterPick) votes.set(masterPick, (votes.get(masterPick) || 0) + 2);
  const top = [...votes.entries()]
    .map(([name, vote]) => {
      const market = (markets || []).find((m) => m.nom === name);
      return { name, vote, odd: toNumber(market?.cote, 0) };
    })
    .sort((a, b) => b.vote - a.vote)
    .slice(0, 8);

  charts.push(
    new Chart(ctx, {
      type: "bar",
      data: {
        labels: top.map((x) => x.name.slice(0, 24)),
        datasets: [
          { label: "Votes consensus", data: top.map((x) => x.vote), backgroundColor: "#64d18c" },
          { label: "Cote", data: top.map((x) => x.odd), backgroundColor: "#ea7166" },
        ],
      },
      options: {
        scales: {
          y: { ticks: { color: chartTextColor() }, grid: { color: chartGridColor() } },
          x: { ticks: { color: chartTextColor(), maxRotation: 35, minRotation: 20 } },
        },
        plugins: { legend: { labels: { color: chartTextColor() } } },
      },
    })
  );
}

function renderAnalytics(data) {
  destroyCharts();
  const match = data.match || {};
  const prediction = data.prediction || {};
  const markets = data.bettingMarkets || [];

  makeForceChart(match);
  makeOddsSnapshotChart(match);
  makeBotsChart(prediction);
  makeTop3Chart(prediction);
  makeMarketTypeChart(markets);
  makeMarketOddsChart(markets);
  makeConsensusChart(prediction, markets);
}

async function load() {
  setupTabs();
  const id = qs("id");
  if (!id) {
    document.getElementById("title").textContent = "Match non specifie";
    document.getElementById("sub").textContent = "Ajoute ?id=...";
    return;
  }

  try {
    const res = await fetch(`/api/matches/${encodeURIComponent(id)}/details`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur API");

    const match = data.match || {};
    document.getElementById("title").textContent = `${match.teamHome} vs ${match.teamAway}`;
    document.getElementById("sub").textContent = `${match.league} | marche(s): ${data.bettingMarkets?.length || 0}`;

    renderMaster(data.prediction?.maitre?.decision_finale || {}, data.prediction?.maitre?.analyse_bots || {});
    renderAnalytics(data);
    renderBots(data.prediction?.bots || {});
    renderTop3(data.prediction?.analyse_avancee?.top_3_recommandations || []);
    renderMarkets(data.bettingMarkets || []);
  } catch (error) {
    document.getElementById("title").textContent = "Erreur de chargement";
    document.getElementById("sub").textContent = error.message;
  }
}

load();
