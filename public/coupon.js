function formatOdd(value) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

async function readJsonSafe(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const htmlHint = text.trim().startsWith("<")
      ? "Le serveur a renvoye une page HTML au lieu d'un JSON."
      : "Reponse non-JSON.";
    throw new Error(`${htmlHint} (HTTP ${response.status})`);
  }
}

function pickOptionFromDetails(details) {
  const master = details?.prediction?.maitre?.decision_finale || {};
  const top = details?.prediction?.analyse_avancee?.top_3_recommandations || [];
  const markets = Array.isArray(details?.bettingMarkets) ? details.bettingMarkets : [];
  const byName = new Map(markets.map((m) => [m.nom, m]));
  const m = byName.get(master.pari_choisi);
  if (m && Number(master.confiance_numerique) >= 50 && m.cote >= 1.25 && m.cote <= 2.2) {
    return { pari: m.nom, cote: m.cote, confiance: Number(master.confiance_numerique), source: "MAITRE" };
  }
  const bestTop = top
    .filter((x) => Number.isFinite(Number(x?.cote)) && Number(x.cote) >= 1.25 && Number(x.cote) <= 2.2)
    .sort((a, b) => Number(b.score_composite || 0) - Number(a.score_composite || 0))[0];
  if (bestTop) {
    return { pari: bestTop.pari, cote: Number(bestTop.cote), confiance: Number(bestTop.score_composite || 50), source: "TOP3" };
  }
  const fallback = markets
    .filter((x) => Number.isFinite(Number(x?.cote)) && Number(x.cote) >= 1.25 && Number(x.cote) <= 2.1)
    .sort((a, b) => Number(a.cote) - Number(b.cote))[0];
  if (!fallback) return null;
  return { pari: fallback.nom, cote: Number(fallback.cote), confiance: 45, source: "FALLBACK" };
}

async function generateCouponFallback(size, league) {
  const listRes = await fetch("/api/matches", { cache: "no-store" });
  const listData = await readJsonSafe(listRes);
  if (!listRes.ok || !listData.success) {
    throw new Error(listData.error || listData.message || "Erreur liste matchs");
  }

  const normLeague = String(league || "all").trim().toLowerCase();
  const base = Array.isArray(listData.matches) ? listData.matches : [];
  const filtered =
    normLeague === "all" ? base : base.filter((m) => String(m.league || "").trim().toLowerCase() === normLeague);

  const sample = filtered.slice(0, 20);
  const candidates = [];
  for (const m of sample) {
    try {
      const dRes = await fetch(`/api/matches/${encodeURIComponent(m.id)}/details`, { cache: "no-store" });
      const dData = await readJsonSafe(dRes);
      if (!dRes.ok || !dData.success) continue;
      const opt = pickOptionFromDetails(dData);
      if (!opt) continue;
      const safetyScore = Number((opt.confiance - Math.abs(opt.cote - 1.65) * 11).toFixed(2));
      candidates.push({
        matchId: m.id,
        teamHome: m.teamHome,
        teamAway: m.teamAway,
        league: m.league,
        pari: opt.pari,
        cote: Number(opt.cote),
        confiance: Number(opt.confiance.toFixed(1)),
        safetyScore,
      });
    } catch {}
  }

  candidates.sort((a, b) => b.safetyScore - a.safetyScore);
  const picks = candidates.slice(0, size);
  const combinedOdd = picks.length ? Number(picks.reduce((acc, x) => acc * x.cote, 1).toFixed(3)) : null;
  const averageConfidence = picks.length
    ? Number((picks.reduce((acc, x) => acc + x.confiance, 0) / picks.length).toFixed(1))
    : 0;

  return {
    success: true,
    coupon: picks,
    summary: { totalSelections: picks.length, combinedOdd, averageConfidence },
    warning:
      "Mode fallback actif: coupon calcule localement car /api/coupon indisponible.",
  };
}

function setResultHtml(html) {
  document.getElementById("result").innerHTML = html;
}

async function loadLeagues() {
  try {
    const res = await fetch("/api/matches", { cache: "no-store" });
    const data = await readJsonSafe(res);
    if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur /api/matches");
    const select = document.getElementById("leagueSelect");
    const leagues = [...new Set((data.matches || []).map((m) => String(m.league || "").trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, "fr")
    );
    leagues.forEach((league) => {
      const option = document.createElement("option");
      option.value = league;
      option.textContent = league;
      select.appendChild(option);
    });
  } catch (error) {
    setResultHtml(`<p>Erreur chargement ligues: ${error.message}</p>`);
  }
}

function renderCoupon(data) {
  const picks = Array.isArray(data?.coupon) ? data.coupon : [];
  if (!picks.length) {
    setResultHtml(`
      <h3>Coupon Optimise</h3>
      <p>Aucune selection disponible.</p>
      <p class="warning">${data?.warning || ""}</p>
    `);
    return;
  }

  const items = picks
    .map(
      (p, i) => `
      <li>
        <strong>${i + 1}. ${p.teamHome} vs ${p.teamAway}</strong>
        <span>Ligue: ${p.league || "Non specifiee"}</span>
        <span>${p.pari}</span>
        <span>Cote ${formatOdd(p.cote)} | Confiance ${p.confiance}%</span>
        <a href="/match.html?id=${encodeURIComponent(p.matchId)}">Voir detail match</a>
      </li>
    `
    )
    .join("");

  setResultHtml(`
    <h3>Coupon Optimise</h3>
    <div class="meta">
      <span>Selections: ${data.summary?.totalSelections ?? 0}</span>
      <span>Cote combinee: ${formatOdd(data.summary?.combinedOdd)}</span>
      <span>Confiance moyenne: ${data.summary?.averageConfidence ?? 0}%</span>
    </div>
    <ol>${items}</ol>
    <p class="warning">${data.warning || ""}</p>
  `);
}

async function generateCoupon() {
  const sizeInput = document.getElementById("sizeInput");
  const leagueSelect = document.getElementById("leagueSelect");
  const size = Math.max(1, Math.min(Number(sizeInput.value) || 3, 12));
  sizeInput.value = String(size);
  setResultHtml("<p>Generation du coupon en cours...</p>");

  try {
    const league = leagueSelect.value || "all";
    let data;
    try {
      const res = await fetch(`/api/coupon?size=${size}&league=${encodeURIComponent(league)}`, { cache: "no-store" });
      data = await readJsonSafe(res);
      if (!res.ok || !data.success) throw new Error(data.error || data.message || "Erreur /api/coupon");
    } catch (primaryErr) {
      data = await generateCouponFallback(size, league);
      if (!data?.success) throw primaryErr;
    }
    renderCoupon(data);
  } catch (error) {
    setResultHtml(`<p>Erreur: ${error.message}</p>`);
  }
}

document.getElementById("generateBtn").addEventListener("click", generateCoupon);
loadLeagues();
