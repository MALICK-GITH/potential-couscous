const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const sharp = require("sharp");
const { API_URL, getPenaltyMatches, getStructure, getMatchPredictionDetails, getCouponSelection, validateCouponTicket } = require("./services/liveFeed");
const { toFeatures, deduplicate, extractRules, buildDecisionEngine, toTrainReadyCSV } = require("./services/patternEngineV2");

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3029;
const MAX_PORT_TRIES = 20;
const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT_MAX = 10;
const chatRateState = new Map();

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

function initialsFromName(name = "") {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "FC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0] || ""}${words[1][0] || ""}`.toUpperCase();
}

function colorFromName(name = "", salt = 0) {
  let h = 0;
  const s = `${name}|${salt}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 78% 46%)`;
}

function normalizeTeamKey(name = "") {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TEAM_COLOR_MAP = new Map([
  ["manchester city", ["#6CABDD", "#1C2C5B"]],
  ["borussia dortmund", ["#FDE100", "#111111"]],
  ["paris saint germain", ["#004170", "#DA1F3D"]],
  ["liverpool", ["#C8102E", "#00B2A9"]],
  ["arsenal", ["#EF0107", "#063672"]],
  ["tottenham hotspur", ["#132257", "#FFFFFF"]],
  ["chelsea", ["#034694", "#FFFFFF"]],
  ["newcastle united", ["#241F20", "#FFFFFF"]],
  ["manchester united", ["#DA291C", "#FBE122"]],
  ["aston villa", ["#670E36", "#95BFE5"]],
  ["brighton et hove albion", ["#0057B8", "#FFFFFF"]],
  ["fulham", ["#111111", "#CC0000"]],
  ["brentford", ["#D71920", "#111111"]],
  ["west ham united", ["#7A263A", "#1BB1E7"]],
  ["athletic bilbao", ["#D0102A", "#FFFFFF"]],
  ["atletico madrid", ["#C8102E", "#1B3E8A"]],
  ["club atletico de madrid", ["#C8102E", "#1B3E8A"]],
  ["real valladolid", ["#6A2C91", "#FFFFFF"]],
  ["espanyol", ["#0072CE", "#FFFFFF"]],
  ["fiorentine", ["#5E3A8C", "#FFFFFF"]],
  ["fiorentina", ["#5E3A8C", "#FFFFFF"]],
  ["milano", ["#D71920", "#111111"]],
  ["napoli", ["#008FD5", "#FFFFFF"]],
  ["udinese calcio", ["#111111", "#FFFFFF"]],
  ["bergamo calcio", ["#0057B8", "#111111"]],
  ["bologna 1909", ["#A50021", "#12326B"]],
  ["leipzig", ["#E30613", "#002B5C"]],
  ["eintracht", ["#D00027", "#111111"]],
  ["freiburg", ["#111111", "#E30613"]],
  ["werder bremen", ["#008A4B", "#FFFFFF"]],
  ["vfl bochum", ["#0054A6", "#FFFFFF"]],
  ["borussia monchengladbach", ["#111111", "#FFFFFF"]],
  ["ajax", ["#D2122E", "#FFFFFF"]],
  ["anderlecht", ["#4A1F7A", "#FFFFFF"]],
  ["galatasaray", ["#A91917", "#FFB300"]],
  ["olympiacos", ["#D4002A", "#FFFFFF"]],
  ["olympique lyonnais", ["#0E3386", "#DA291C"]],
  ["rangers", ["#005EB8", "#FFFFFF"]],
  ["sporting clube de portugal", ["#00883F", "#FFFFFF"]],
  ["villarreal", ["#FFE100", "#0052A5"]],
]);

function teamColors(name = "") {
  const key = normalizeTeamKey(name);
  for (const [teamKey, colors] of TEAM_COLOR_MAP.entries()) {
    if (key === teamKey || key.includes(teamKey) || teamKey.includes(key)) return colors;
  }
  return [colorFromName(name, 1), colorFromName(name, 2)];
}

function trimText(value, max = 1200) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function getClientKey(req) {
  return String(
    req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      req.ip ||
      "unknown"
  );
}

function canUseChat(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const state = chatRateState.get(key) || { count: 0, resetAt: now + CHAT_RATE_LIMIT_WINDOW_MS };
  if (now > state.resetAt) {
    state.count = 0;
    state.resetAt = now + CHAT_RATE_LIMIT_WINDOW_MS;
  }
  state.count += 1;
  chatRateState.set(key, state);
  return state.count <= CHAT_RATE_LIMIT_MAX;
}

function localChatFallback(message, context = {}) {
  const text = normalizeTeamKey(message || "");
  const page = String(context.page || "site");
  const league = String(context.league || "toutes les ligues");
  const matchId = String(context.matchId || "");

  if (text.includes("coupon")) {
    return (
      `Mode local actif (API IA indisponible). Sur ${page}, prends un profil Equilibre, ` +
      `3 selections max, cotes entre 1.35 et 2.20, et supprime les matchs deja en cours.`
    );
  }

  if (text.includes("risque") || text.includes("safe") || text.includes("agressif")) {
    return "Safe: faible cote/haute fiabilite. Equilibre: meilleur compromis. Agressif: grosse cote mais variance plus forte.";
  }

  if (text.includes("match")) {
    return (
      `Mode local actif. Analyse d'abord l'onglet A venir, puis la ligue ${league}. ` +
      `${matchId ? `Pour le match ${matchId}, ` : ""}valide toujours le ticket avant de jouer.`
    );
  }

  return (
    "Mode local actif (quota IA atteint). Je peux quand meme aider: tri matchs, niveau de risque, construction coupon et validation."
  );
}

function formatOddForTelegram(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(3) : "-";
}

function buildTelegramCouponText(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskProfile = String(payload.riskProfile || "balanced");
  const lines = [
    "COUPON OPTIMISE FC 25",
    "Source: FC 25 Virtual Predictions",
    `Profil: ${riskProfile}`,
    `Selections: ${Number(summary.totalSelections) || coupon.length}`,
    `Cote combinee: ${formatOddForTelegram(summary.combinedOdd)}`,
    `Confiance moyenne: ${Number(summary.averageConfidence) || 0}%`,
    "",
  ];

  coupon.forEach((pick, index) => {
    lines.push(`${index + 1}. ${pick.teamHome || "Equipe 1"} vs ${pick.teamAway || "Equipe 2"}`);
    lines.push(`Ligue: ${pick.league || "Non specifiee"}`);
    lines.push(`Pari: ${pick.pari || "-"}`);
    lines.push(`Cote: ${formatOddForTelegram(pick.cote)} | Confiance: ${Number(pick.confiance) || 0}%`);
    lines.push("");
  });
  lines.push("Aucune combinaison n'est garantie gagnante.");
  lines.push("Signe: SOLITAIRE HACK");
  return lines.join("\n").slice(0, 3900);
}

function escapeXml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCouponImageSvg(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskProfile = String(payload.riskProfile || "balanced");
  const picks = coupon.slice(0, 6);
  const count = Math.max(1, picks.length || 1);
  const cardH = 250;
  const gap = 18;
  const headH = 138;
  const footH = 60;
  const width = 1200;
  const height = headH + footH + count * cardH + (count - 1) * gap;
  const generatedAt = new Date().toLocaleString("fr-FR");

  const cards = picks.map((pick, i) => {
    const y = headH + i * (cardH + gap);
    const league = escapeXml(pick.league || "Ligue virtuelle");
    const home = escapeXml(pick.teamHome || "Equipe 1");
    const away = escapeXml(pick.teamAway || "Equipe 2");
    const pari = escapeXml(pick.pari || "-");
    const odd = formatOddForTelegram(pick.cote);
    const conf = Number(pick.confiance) || 0;
    const status = conf >= 75 ? "SAFE" : conf >= 60 ? "MODERE" : "RISQUE";
    return `
      <g transform="translate(36, ${y})">
        <rect x="0" y="0" width="${width - 72}" height="${cardH}" rx="18" fill="rgba(13,22,43,0.92)" stroke="rgba(67,102,153,0.40)"/>
        <rect x="0" y="0" width="${width - 72}" height="44" rx="18" fill="rgba(36,215,255,0.10)" />
        <text x="18" y="28" fill="#b9d4ff" font-size="16" font-weight="600">${i + 1}. ${league}</text>
        <g transform="translate(${width - 340}, 10)">
          <rect x="0" y="0" width="132" height="24" rx="999" fill="rgba(36,215,255,0.15)" stroke="rgba(36,215,255,0.45)"/>
          <text x="66" y="17" text-anchor="middle" fill="#b9f4ff" font-size="12" font-weight="700">Confiance ${conf}%</text>
          <rect x="144" y="0" width="132" height="24" rx="999" fill="rgba(255,95,121,0.16)" stroke="rgba(255,95,121,0.45)"/>
          <text x="210" y="17" text-anchor="middle" fill="#ffc5cf" font-size="12" font-weight="700">${status}</text>
        </g>

        <g transform="translate(0, 46)">
          <circle cx="90" cy="58" r="28" fill="rgba(9,15,28,0.95)" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
          <text x="90" y="64" text-anchor="middle" fill="#d7ecff" font-size="14" font-weight="700">1</text>
          <text x="90" y="100" text-anchor="middle" fill="#e5f0ff" font-size="16" font-weight="600">${home}</text>

          <text x="${(width - 72) / 2}" y="66" text-anchor="middle" fill="#ffffff" font-size="42" font-weight="800">VS</text>

          <circle cx="${width - 162}" cy="58" r="28" fill="rgba(9,15,28,0.95)" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
          <text x="${width - 162}" y="64" text-anchor="middle" fill="#d7ecff" font-size="14" font-weight="700">2</text>
          <text x="${width - 162}" y="100" text-anchor="middle" fill="#e5f0ff" font-size="16" font-weight="600">${away}</text>
        </g>

        <g transform="translate(18, 168)">
          <rect x="0" y="0" width="352" height="58" rx="12" fill="rgba(14,25,48,0.95)" stroke="rgba(66,245,108,0.26)"/>
          <text x="176" y="22" text-anchor="middle" fill="#9db5d6" font-size="14">Pari</text>
          <text x="176" y="42" text-anchor="middle" fill="#f5fbff" font-size="15" font-weight="700">${pari}</text>

          <rect x="380" y="0" width="352" height="58" rx="12" fill="rgba(14,25,48,0.95)" stroke="rgba(66,245,108,0.26)"/>
          <text x="556" y="22" text-anchor="middle" fill="#9db5d6" font-size="14">Cote</text>
          <text x="556" y="42" text-anchor="middle" fill="#42f56c" font-size="18" font-weight="800">${odd}</text>

          <rect x="760" y="0" width="352" height="58" rx="12" fill="rgba(14,25,48,0.95)" stroke="rgba(66,245,108,0.26)"/>
          <text x="936" y="22" text-anchor="middle" fill="#9db5d6" font-size="14">Lecture IA</text>
          <text x="936" y="42" text-anchor="middle" fill="#ffd98a" font-size="15" font-weight="700">${conf}% | ${status}</text>
        </g>
      </g>
    `;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#061830"/>
      <stop offset="60%" stop-color="#0e2d57"/>
      <stop offset="100%" stop-color="#123663"/>
    </linearGradient>
    <linearGradient id="head" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#16e3ff"/>
      <stop offset="100%" stop-color="#7dffcf"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="28" y="20" width="${width - 56}" height="${headH - 30}" rx="18" fill="rgba(2,10,24,0.55)" stroke="rgba(125,255,207,0.35)" />
  <text x="48" y="64" fill="url(#head)" font-size="32" font-weight="800" font-family="Arial, Helvetica, sans-serif">FC 25 COUPON IMAGE</text>
  <text x="48" y="92" fill="#d9ecff" font-size="18" font-family="Arial, Helvetica, sans-serif">Profil ${escapeXml(
    riskProfile
  )} | Selections ${Number(summary.totalSelections) || coupon.length} | Cote ${formatOddForTelegram(summary.combinedOdd)}</text>
  <text x="48" y="114" fill="#b3cee6" font-size="14" font-family="Arial, Helvetica, sans-serif">Genere le ${escapeXml(
    generatedAt
  )}</text>
  ${cards.join("\n")}
  <text x="48" y="${height - 28}" fill="#cfe6ff" font-size="15" font-family="Arial, Helvetica, sans-serif">Signe: SOLITAIRE HACK | Aucune combinaison n'est garantie gagnante.</text>
</svg>`;
}

function buildCouponStorySvg(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskProfile = String(payload.riskProfile || "balanced");
  const picks = coupon.slice(0, 5);
  const width = 1080;
  const height = 1920;
  const generatedAt = new Date().toLocaleString("fr-FR");
  const cardW = width - 88;
  const cardH = 256;
  const startY = 280;
  const gap = 24;

  const cards = picks.map((pick, i) => {
    const y = startY + i * (cardH + gap);
    const home = escapeXml(pick.teamHome || "Equipe 1");
    const away = escapeXml(pick.teamAway || "Equipe 2");
    const league = escapeXml(pick.league || "Ligue virtuelle");
    const pari = escapeXml(pick.pari || "-");
    const odd = formatOddForTelegram(pick.cote);
    const conf = Number(pick.confiance) || 0;
    const risk = conf >= 75 ? "SAFE" : conf >= 60 ? "MODERE" : "RISQUE";
    return `
      <g transform="translate(44, ${y})">
        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="28" fill="rgba(8,18,34,0.90)" stroke="rgba(138,216,255,0.36)" />
        <text x="28" y="42" fill="#b8dbff" font-size="26" font-weight="700">${i + 1}. ${league}</text>
        <text x="${cardW / 2}" y="112" text-anchor="middle" fill="#f5fbff" font-size="42" font-weight="800">${home} VS ${away}</text>
        <rect x="24" y="146" width="${cardW - 48}" height="78" rx="18" fill="rgba(14,25,48,0.95)" stroke="rgba(66,245,108,0.26)" />
        <text x="40" y="176" fill="#d2e9ff" font-size="24">Pari: ${pari}</text>
        <text x="40" y="206" fill="#7dffcf" font-size="26" font-weight="800">Cote ${odd}</text>
        <text x="${cardW - 40}" y="206" text-anchor="end" fill="#ffd98a" font-size="24" font-weight="700">${conf}% | ${risk}</text>
      </g>
    `;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgStory" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#071a32"/>
      <stop offset="50%" stop-color="#0d2d58"/>
      <stop offset="100%" stop-color="#18305b"/>
    </linearGradient>
    <linearGradient id="headStory" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#16e3ff"/>
      <stop offset="100%" stop-color="#7dffcf"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgStory)"/>
  <rect x="36" y="58" width="${width - 72}" height="186" rx="30" fill="rgba(2,10,24,0.55)" stroke="rgba(125,255,207,0.35)" />
  <text x="62" y="124" fill="url(#headStory)" font-size="54" font-weight="800" font-family="Arial, Helvetica, sans-serif">FC 25 SNAP STORY</text>
  <text x="62" y="168" fill="#d9ecff" font-size="30" font-family="Arial, Helvetica, sans-serif">Profil ${escapeXml(
    riskProfile
  )} | Selections ${Number(summary.totalSelections) || coupon.length}</text>
  <text x="62" y="204" fill="#b3cee6" font-size="22" font-family="Arial, Helvetica, sans-serif">Cote ${formatOddForTelegram(
    summary.combinedOdd
  )} | ${escapeXml(generatedAt)}</text>
  ${cards.join("\n")}
  <text x="62" y="${height - 74}" fill="#cfe6ff" font-size="24" font-family="Arial, Helvetica, sans-serif">Signe: SOLITAIRE HACK</text>
  <text x="62" y="${height - 40}" fill="#cfe6ff" font-size="18" font-family="Arial, Helvetica, sans-serif">Aucune combinaison n'est garantie gagnante.</text>
</svg>`;
}

function normalizeImageFormat(value, fallback = "png") {
  const v = String(value || "").toLowerCase();
  if (v === "jpg" || v === "jpeg") return "jpg";
  if (v === "png") return "png";
  if (v === "svg") return "svg";
  return fallback;
}

async function rasterizeSvg(svg, format = "png") {
  const buffer = Buffer.from(String(svg || ""), "utf8");
  if (format === "jpg") {
    return sharp(buffer).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  }
  return sharp(buffer).png({ compressionLevel: 9 }).toBuffer();
}

function pdfEscape(text = "") {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function buildSimplePdf(lines = []) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const lineHeight = 16;
  const left = 48;
  const top = 800;
  const maxLines = Math.max(1, Math.floor((top - 60) / lineHeight));
  const contentLines = ["BT", "/F1 11 Tf", `${left} ${top} Td`, `${lineHeight} TL`];
  let count = 0;
  for (const raw of safeLines.slice(0, 180)) {
    if (count >= maxLines) break;
    const line = pdfEscape(raw);
    contentLines.push(`(${line}) Tj`);
    count += 1;
    if (count < maxLines) contentLines.push("T*");
  }
  contentLines.push("ET");
  const streamContent = contentLines.join("\n");

  const objects = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objects.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objects.push("3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj");
  objects.push("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");
  objects.push(`5 0 obj << /Length ${Buffer.byteLength(streamContent, "utf8")} >> stream\n${streamContent}\nendstream endobj`);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${obj}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    const off = String(offsets[i]).padStart(10, "0");
    pdf += `${off} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function buildCouponPdfSummaryLines(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskProfile = String(payload.riskProfile || "balanced");
  const generatedAt = new Date().toLocaleString("fr-FR");
  const lines = [
    "FC 25 VIRTUAL PREDICTIONS - COUPON PDF",
    "Signe: SOLITAIRE HACK",
    `Date: ${generatedAt}`,
    `Profil: ${riskProfile}`,
    `Selections: ${Number(summary.totalSelections) || coupon.length}`,
    `Cote combinee: ${formatOddForTelegram(summary.combinedOdd)}`,
    `Confiance moyenne: ${Number(summary.averageConfidence) || 0}%`,
    "",
  ];
  coupon.forEach((pick, i) => {
    lines.push(`${i + 1}. ${pick.teamHome || "Equipe 1"} vs ${pick.teamAway || "Equipe 2"}`);
    lines.push(`   Ligue: ${pick.league || "Non specifiee"}`);
    lines.push(`   Pari: ${pick.pari || "-"}`);
    lines.push(`   Cote: ${formatOddForTelegram(pick.cote)} | Confiance: ${Number(pick.confiance) || 0}%`);
    lines.push("");
  });
  lines.push("Aucune combinaison n'est garantie gagnante.");
  return lines;
}

function buildCouponPdfQuickLines(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const generatedAt = new Date().toLocaleString("fr-FR");
  const lines = [
    "FC 25 VIRTUAL PREDICTIONS - PDF ULTRA-COURT",
    `Date: ${generatedAt}`,
    `Selections: ${Number(summary.totalSelections) || coupon.length}`,
    `Cote combinee: ${formatOddForTelegram(summary.combinedOdd)}`,
    "",
  ];
  coupon.slice(0, 14).forEach((pick, i) => {
    lines.push(
      `${i + 1}) ${pick?.teamHome || "Equipe 1"} vs ${pick?.teamAway || "Equipe 2"} | ${pick?.pari || "-"} | ${formatOddForTelegram(
        pick?.cote
      )}`
    );
  });
  lines.push("");
  lines.push("Signe: SOLITAIRE HACK");
  lines.push("Aucune combinaison n'est garantie gagnante.");
  return lines;
}

function buildCouponPdfDetailedLines(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const insights = payload.insights || {};
  const backupPlan = Array.isArray(payload.backupPlan) ? payload.backupPlan : [];
  const riskProfile = String(payload.riskProfile || "balanced");
  const generatedAt = new Date().toLocaleString("fr-FR");
  const total = Number(summary.totalSelections) || coupon.length || 0;
  const combinedOdd = Number(summary.combinedOdd) || 0;
  const avgConfidence = Number(summary.averageConfidence) || 0;
  const leagues = new Set(coupon.map((p) => String(p?.league || "").trim()).filter(Boolean));
  const safeCount = coupon.filter((p) => Number(p?.confiance) >= 75).length;
  const mediumCount = coupon.filter((p) => Number(p?.confiance) >= 60 && Number(p?.confiance) < 75).length;
  const highRiskCount = Math.max(0, coupon.length - safeCount - mediumCount);

  const lines = [
    "FC 25 VIRTUAL PREDICTIONS - COUPON DETAILLE ANALYTIQUE",
    "Signe: SOLITAIRE HACK",
    `Date: ${generatedAt}`,
    `Profil: ${riskProfile}`,
    "",
    "RESUME GLOBAL",
    `Selections totales: ${total}`,
    `Cote combinee: ${formatOddForTelegram(combinedOdd)}`,
    `Confiance moyenne: ${avgConfidence.toFixed(1)}%`,
    `Diversite ligues: ${leagues.size}`,
    `Qualite ticket: ${Number(insights.qualityScore) || 0}/100`,
    `Risque correlation: ${Number(insights.correlationRisk) || 0}%`,
    "",
    "DISTRIBUTION RISQUE",
    `Safe (>=75%): ${safeCount}`,
    `Moyen (60% - 74.9%): ${mediumCount}`,
    `Eleve (<60%): ${highRiskCount}`,
    "",
    "ANALYSE PAR SELECTION",
  ];

  coupon.forEach((pick, i) => {
    const odd = Number(pick?.cote) || 0;
    const conf = Number(pick?.confiance) || 0;
    const valueIndex = odd > 0 ? Number((conf / odd).toFixed(2)) : 0;
    const confidenceBand = conf >= 75 ? "SAFE" : conf >= 60 ? "MOYEN" : "ELEVE";
    const source = String(pick?.source || "MIXTE");
    lines.push(`${i + 1}. ${pick?.teamHome || "Equipe 1"} vs ${pick?.teamAway || "Equipe 2"}`);
    lines.push(`   Ligue: ${pick?.league || "Non specifiee"}`);
    lines.push(`   Pari: ${pick?.pari || "-"}`);
    lines.push(`   Cote: ${formatOddForTelegram(odd)} | Confiance: ${conf.toFixed(1)}% | Bande: ${confidenceBand}`);
    lines.push(`   Value Index (Confiance/Cote): ${valueIndex} | Source: ${source}`);
    lines.push("");
  });

  lines.push("NOTE: Le Value Index est un indicateur interne d'equilibre rendement/fiabilite.");
  if (backupPlan.length) {
    lines.push("");
    lines.push("PLAN B (REMPLACEMENTS PROPOSES)");
    backupPlan.slice(0, 20).forEach((b, i) => {
      lines.push(
        `${i + 1}. Match ${b.matchId || "-"} -> ${b.pari || "-"} | Cote ${formatOddForTelegram(b.cote)} | Conf ${
          Number(b.confiance) || 0
        }%`
      );
    });
  }
  lines.push("Aucune combinaison n'est garantie gagnante.");
  return lines;
}

function getStartedSelections(coupon = []) {
  const nowSec = Math.floor(Date.now() / 1000);
  return coupon.filter((pick) => {
    const start = Number(pick?.startTimeUnix || 0);
    return Number.isFinite(start) && start > 0 && start <= nowSec;
  });
}

app.get("/api/team-badge", (req, res) => {
  const name = String(req.query.name || "Equipe").trim();
  const initials = initialsFromName(name).slice(0, 2);
  const [c1, c2] = teamColors(name);
  const safeTitle = name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${safeTitle}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="61" fill="#fff" stroke="#e5e9f1" stroke-width="6"/>
  <circle cx="64" cy="64" r="51" fill="url(#g)"/>
  <text x="64" y="74" text-anchor="middle" font-size="40" font-family="Arial, Helvetica, sans-serif" font-weight="700" fill="#fff">${initials}</text>
</svg>`;

  res.set("Content-Type", "image/svg+xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(svg);
});

app.get("/api/logo/:fileName", async (req, res) => {
  const raw = String(req.params.fileName || "").trim();
  let safe = raw;
  try {
    safe = decodeURIComponent(raw);
  } catch (_error) {
    return res.status(400).send("Nom de logo invalide.");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(safe)) {
    return res.status(400).send("Nom de logo invalide.");
  }

  const fileCandidates = safe.includes(".") ? [safe] : [safe, `${safe}.png`];
  const baseUrls = [
    "https://1xbet.com/LineFeedImages/",
    "https://1xbet.com/linefeed/images/",
    "https://1xbet.com/genfiles/team/",
    "https://1xbet.com/genfiles/teams/",
  ];

  for (const file of fileCandidates) {
    for (const base of baseUrls) {
      const url = `${base}${file}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, {
          headers: {
            "user-agent": "Mozilla/5.0",
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            referer: "https://1xbet.com/",
          },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) continue;
        const type = response.headers.get("content-type") || "image/png";
        const buffer = Buffer.from(await response.arrayBuffer());
        res.set("Content-Type", type);
        res.set("Cache-Control", "public, max-age=3600");
        return res.send(buffer);
      } catch (_error) {
        continue;
      }
    }
  }

  res.status(404).send("Logo introuvable.");
});

app.get("/api/structure", async (_req, res) => {
  try {
    const structure = await getStructure();
    res.json({ success: true, source: API_URL, ...structure });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Impossible d'analyser la structure JSON.",
      error: error.message,
    });
  }
});

app.get("/api/matches", async (_req, res) => {
  try {
    const data = await getPenaltyMatches();
    res.json({ success: true, source: API_URL, ...data });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Impossible de recuperer les matchs penalty FIFA virtuel.",
      error: error.message,
    });
  }
});

app.get("/api/matches/:id/details", async (req, res) => {
  try {
    const details = await getMatchPredictionDetails(req.params.id);
    res.json({ success: true, source: API_URL, ...details });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Impossible de calculer les predictions unifiees pour ce match.",
      error: error.message,
    });
  }
});

app.get("/api/coupon", async (req, res) => {
  try {
    const size = Number(req.query.size) || 3;
    const league = req.query.league ? String(req.query.league) : "all";
    const risk = req.query.risk ? String(req.query.risk) : "balanced";
    const coupon = await getCouponSelection(size, league, risk);
    res.json({ success: true, source: API_URL, ...coupon });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Impossible de generer le coupon optimise.",
      error: error.message,
    });
  }
});

app.post("/api/coupon/validate", async (req, res) => {
  try {
    const driftThresholdPercent = Number(req.body?.driftThresholdPercent) || 6;
    const report = await validateCouponTicket(req.body || {}, { driftThresholdPercent });
    res.json({ success: true, source: API_URL, ...report });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Impossible de valider le ticket coupon.",
      error: error.message,
    });
  }
});

app.post("/api/patterns/report", (req, res) => {
  try {
    const matches = Array.isArray(req.body?.matches) ? req.body.matches : [];
    const minRulePlayed = Number(req.body?.minRulePlayed) > 0 ? Number(req.body.minRulePlayed) : 5;
    const featureRows = matches.map(toFeatures);
    const dedupRows = deduplicate(featureRows);
    const totalValidated = Number(req.body?.totalValidated) > 0 ? Number(req.body.totalValidated) : dedupRows.length;
    const engine = buildDecisionEngine(dedupRows, totalValidated, { minRulePlayed });
    return res.json({
      success: true,
      totalInput: matches.length,
      totalFeatures: featureRows.length,
      totalDeduplicated: dedupRows.length,
      report: engine.report,
      rules: extractRules(dedupRows, minRulePlayed),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de construire le rapport patterns.",
      error: error.message,
    });
  }
});

app.post("/api/patterns/decide", (req, res) => {
  try {
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const candidate = req.body?.candidate || {};
    const options = req.body?.options || {};
    const featureRows = deduplicate(history.map(toFeatures));
    const totalValidated = Number(req.body?.totalValidated) > 0 ? Number(req.body.totalValidated) : featureRows.length;
    const engine = buildDecisionEngine(featureRows, totalValidated, options);
    const decision = engine.decide(candidate);
    const scored = engine.scoreCandidate(candidate);

    return res.json({
      success: true,
      totalValidated,
      historySize: featureRows.length,
      decision,
      previewScore: scored,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible d'evaluer ce candidat.",
      error: error.message,
    });
  }
});

app.post("/api/patterns/csv", (req, res) => {
  try {
    const matches = Array.isArray(req.body?.matches) ? req.body.matches : [];
    const featureRows = matches.map(toFeatures);
    const csv = toTrainReadyCSV(featureRows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="train_ready_export_${Date.now()}.csv"`);
    return res.send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de generer le CSV train-ready.",
      error: error.message,
    });
  }
});

function generateCouponPdfHandler(req, res) {
  try {
    const coupon = Array.isArray(req.body?.coupon) ? req.body.coupon : [];
    if (!coupon.length) {
      return res.status(400).json({
        success: false,
        message: "Coupon vide. Impossible de generer le PDF.",
      });
    }
    const started = getStartedSelections(coupon);
    if (started.length) {
      return res.status(400).json({
        success: false,
        message: "PDF bloque: le coupon contient des matchs deja demarres.",
      });
    }

    const mode = String(req.body?.mode || "summary").toLowerCase();
    const isDetailed = mode === "detailed" || mode === "detail" || mode === "analysis";
    const isQuick = mode === "quick" || mode === "short" || mode === "ultra";
    const pdfLines = isDetailed
      ? buildCouponPdfDetailedLines(req.body || {})
      : isQuick
      ? buildCouponPdfQuickLines(req.body || {})
      : buildCouponPdfSummaryLines(req.body || {});
    const pdfBuffer = buildSimplePdf(pdfLines);
    const filename = `coupon-fc25-${isDetailed ? "detail" : isQuick ? "rapide" : "resume"}-${Date.now()}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdfBuffer.length));
    return res.send(pdfBuffer);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de generer le PDF coupon.",
      error: error.message,
    });
  }
}

async function generateCouponImageHandler(req, res) {
  try {
    const coupon = Array.isArray(req.body?.coupon) ? req.body.coupon : [];
    if (!coupon.length) {
      return res.status(400).json({
        success: false,
        message: "Coupon vide. Impossible de generer l'image.",
      });
    }
    const started = getStartedSelections(coupon);
    if (started.length) {
      return res.status(400).json({
        success: false,
        message: "Image bloquee: le coupon contient des matchs deja demarres.",
      });
    }
    const mode = String(req.body?.mode || "default").toLowerCase();
    const isStory = mode === "story" || mode === "snap";
    const requested = req.body?.format || req.query?.format || (isStory ? "jpg" : "png");
    const format = normalizeImageFormat(requested, isStory ? "jpg" : "png");
    const svg = isStory ? buildCouponStorySvg(req.body || {}) : buildCouponImageSvg(req.body || {});
    if (format === "svg") {
      const filename = `coupon-fc25-${isStory ? "story" : "image"}-${Date.now()}.svg`;
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(svg);
    }
    const output = await rasterizeSvg(svg, format);
    const ext = format === "jpg" ? "jpg" : "png";
    const filename = `coupon-fc25-${isStory ? "story" : "image"}-${Date.now()}.${ext}`;
    res.setHeader("Content-Type", format === "jpg" ? "image/jpeg" : "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.send(output);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de generer l'image coupon (PNG/JPG).",
      error: error.message,
    });
  }
}

function buildCouponPdfBuffer(payload = {}, mode = "quick") {
  const m = String(mode || "quick").toLowerCase();
  const lines =
    m === "detailed" || m === "detail" || m === "analysis"
      ? buildCouponPdfDetailedLines(payload)
      : m === "quick" || m === "short" || m === "ultra"
      ? buildCouponPdfQuickLines(payload)
      : buildCouponPdfSummaryLines(payload);
  return buildSimplePdf(lines);
}

async function resolveTelegramChatId(botToken) {
  let chatId = String(process.env.TELEGRAM_CHANNEL_ID || "").trim();
  if (chatId) return chatId;
  const updatesRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=30&timeout=1`);
  const updatesData = await updatesRes.json();
  if (!updatesRes.ok || !updatesData?.ok) {
    throw new Error(updatesData?.description || "getUpdates indisponible.");
  }
  const updates = Array.isArray(updatesData.result) ? updatesData.result : [];
  for (let i = updates.length - 1; i >= 0; i -= 1) {
    const chat = updates[i]?.message?.chat || updates[i]?.channel_post?.chat;
    if (chat?.id && (chat?.type === "private" || chat?.type === "group" || chat?.type === "supergroup")) {
      chatId = String(chat.id);
      break;
    }
  }
  if (!chatId) {
    throw new Error("Aucun chat detecte. Ecris d'abord un message au bot puis reessaie.");
  }
  return chatId;
}

async function sendTelegramDocument(botToken, chatId, fileBlob, fileName, caption = "") {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("document", fileBlob, fileName);
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.description || "API Telegram indisponible.");
  }
  return data?.result?.message_id || null;
}

async function sendTelegramPhoto(botToken, chatId, photoBlob, fileName, caption = "") {
  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);
  form.append("photo", photoBlob, fileName);
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.description || "API Telegram indisponible.");
  }
  return data?.result?.message_id || null;
}

app.post("/api/coupon/pdf", generateCouponPdfHandler);
app.post("/api/pdf/coupon", generateCouponPdfHandler);
app.post("/api/download/coupon", generateCouponPdfHandler);
app.post("/api/coupon/pdf/summary", (req, res) =>
  generateCouponPdfHandler({ ...req, body: { ...(req.body || {}), mode: "summary" } }, res)
);
app.post("/api/coupon/pdf/detailed", (req, res) =>
  generateCouponPdfHandler({ ...req, body: { ...(req.body || {}), mode: "detailed" } }, res)
);
app.post("/api/coupon/pdf/quick", (req, res) =>
  generateCouponPdfHandler({ ...req, body: { ...(req.body || {}), mode: "quick" } }, res)
);
app.post("/api/coupon/image", generateCouponImageHandler);
app.post("/api/coupon/image/svg", (req, res) =>
  generateCouponImageHandler({ ...req, body: { ...(req.body || {}), format: "svg" } }, res)
);
app.post("/api/coupon/image/story", (req, res) =>
  generateCouponImageHandler(
    { ...req, body: { ...(req.body || {}), mode: "story", format: req.body?.format || "jpg" } },
    res
  )
);

async function sendTelegramCouponHandler(req, res) {
  try {
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!botToken) {
      return res.status(500).json({
        success: false,
        message: "Configuration Telegram manquante (TELEGRAM_BOT_TOKEN).",
      });
    }

    const coupon = Array.isArray(req.body?.coupon) ? req.body.coupon : [];
    if (coupon.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Coupon vide. Genere d'abord un coupon.",
      });
    }
    const started = getStartedSelections(coupon);
    if (started.length) {
      return res.status(400).json({
        success: false,
        message: "Envoi Telegram bloque: le coupon contient des matchs deja demarres.",
      });
    }

    const text = buildTelegramCouponText(req.body || {});
    let chatId;
    try {
      chatId = await resolveTelegramChatId(botToken);
    } catch (e) {
      return res.status(400).json({ success: false, message: String(e.message || e) });
    }

    const sendImage = Boolean(req.body?.sendImage);
    if (sendImage) {
      const fmt = normalizeImageFormat(req.body?.imageFormat || req.body?.format || "png", "png");
      const svg = buildCouponImageSvg(req.body || {});
      const img = await rasterizeSvg(svg, fmt === "svg" ? "png" : fmt);
      const mime = fmt === "jpg" ? "image/jpeg" : "image/png";
      const ext = fmt === "jpg" ? "jpg" : "png";
      const photoId = await sendTelegramPhoto(
        botToken,
        chatId,
        new Blob([img], { type: mime }),
        `coupon-fc25-${Date.now()}.${ext}`,
        "Coupon image - FC 25 Virtual Predictions | Signe: SOLITAIRE HACK"
      );
      return res.json({
        success: true,
        message: "Coupon image envoye sur Telegram.",
        telegramMessageId: photoId,
      });
    }

    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const telegramData = await telegramRes.json();
    if (!telegramRes.ok || !telegramData?.ok) {
      return res.status(502).json({
        success: false,
        message: "Echec envoi Telegram.",
        error: telegramData?.description || "API Telegram indisponible.",
      });
    }

    return res.json({
      success: true,
      message: "Coupon envoye sur Telegram.",
      telegramMessageId: telegramData?.result?.message_id || null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Impossible d'envoyer le coupon sur Telegram.",
      error: error.message,
    });
  }
}

async function sendTelegramCouponPackHandler(req, res) {
  try {
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!botToken) {
      return res.status(500).json({
        success: false,
        message: "Configuration Telegram manquante (TELEGRAM_BOT_TOKEN).",
      });
    }

    const coupon = Array.isArray(req.body?.coupon) ? req.body.coupon : [];
    if (coupon.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Coupon vide. Genere d'abord un coupon.",
      });
    }
    const started = getStartedSelections(coupon);
    if (started.length) {
      return res.status(400).json({
        success: false,
        message: "Envoi pack bloque: le coupon contient des matchs deja demarres.",
      });
    }

    let chatId;
    try {
      chatId = await resolveTelegramChatId(botToken);
    } catch (e) {
      return res.status(400).json({ success: false, message: String(e.message || e) });
    }

    const text = buildTelegramCouponText(req.body || {});
    const textRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const textData = await textRes.json();
    if (!textRes.ok || !textData?.ok) {
      return res.status(502).json({
        success: false,
        message: "Echec envoi texte Telegram.",
        error: textData?.description || "API Telegram indisponible.",
      });
    }

    const imageFormat = normalizeImageFormat(req.body?.imageFormat || "png", "png");
    const svg = buildCouponImageSvg(req.body || {});
    const imageBuffer = await rasterizeSvg(svg, imageFormat === "svg" ? "png" : imageFormat);
    const imageMessageId = await sendTelegramPhoto(
      botToken,
      chatId,
      new Blob([imageBuffer], { type: imageFormat === "jpg" ? "image/jpeg" : "image/png" }),
      `coupon-fc25-${Date.now()}.${imageFormat === "jpg" ? "jpg" : "png"}`,
      "Coupon image - FC 25 Virtual Predictions | Signe: SOLITAIRE HACK"
    );

    const pdf = buildCouponPdfBuffer(req.body || {}, "quick");
    const pdfMessageId = await sendTelegramDocument(
      botToken,
      chatId,
      new Blob([pdf], { type: "application/pdf" }),
      `coupon-fc25-rapide-${Date.now()}.pdf`,
      "Coupon PDF rapide - FC 25 Virtual Predictions"
    );

    return res.json({
      success: true,
      message: "Pack Telegram envoye: texte + image + PDF.",
      telegramMessageIds: {
        text: textData?.result?.message_id || null,
        image: imageMessageId,
        pdf: pdfMessageId,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible d'envoyer le pack Telegram.",
      error: error.message,
    });
  }
}

app.post("/api/coupon/send-telegram", sendTelegramCouponHandler);
app.post("/api/telegram/send-coupon", sendTelegramCouponHandler);
app.post("/api/send-telegram", sendTelegramCouponHandler);
app.post("/api/coupon/send-telegram-pack", sendTelegramCouponPackHandler);

function trimTrailingSlash(url = "") {
  return String(url || "").replace(/\/+$/, "");
}

function extractAnthropicText(raw) {
  if (!Array.isArray(raw?.content)) return "";
  return raw.content
    .map((c) => (c?.type === "text" ? c.text || "" : ""))
    .join("\n")
    .trim();
}

async function requestAnthropicChat({ baseUrl, apiKey, model, systemPrompt, userPrompt }) {
  const base = trimTrailingSlash(baseUrl);
  const endpointCandidates = base.endsWith("/messages")
    ? [base]
    : [`${base}/v1/messages`, `${base}/messages`];
  const errors = [];

  for (const endpoint of endpointCandidates) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          Authorization: `Bearer ${apiKey}`,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          temperature: 0.5,
          max_tokens: 500,
        }),
      });

      const raw = await response.json();
      if (!response.ok) {
        errors.push(raw?.error?.message || raw?.message || `HTTP ${response.status}`);
        continue;
      }

      const answer = extractAnthropicText(raw);
      if (!answer) {
        errors.push("Reponse Anthropic vide.");
        continue;
      }
      return { answer, model };
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors.filter(Boolean).join(" | ") || "Erreur Anthropic");
}

app.post("/api/chat", async (req, res) => {
  try {
    if (!canUseChat(req)) {
      return res.status(429).json({
        success: false,
        message: "Trop de requetes chat. Reessaie dans 1 minute.",
      });
    }
    const message = trimText(req.body?.message, 2000);
    const page = trimText(req.body?.context?.page || "site", 80);
    const matchId = trimText(req.body?.context?.matchId || "", 60);
    const league = trimText(req.body?.context?.league || "", 120);

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message vide.",
      });
    }

    const systemPrompt =
      "Tu es SOLITAIRE AI, assistant du site FC 25 Virtual Predictions. " +
      "Reponds en francais simple, direct, utile. " +
      "Tu analyses matchs, cotes, coupon, risque, et validation ticket. " +
      "Tu ne promets jamais un gain garanti. Tu donnes des options prudentes.";

    const userPrompt = [
      `Contexte page: ${page}`,
      matchId ? `Match ID: ${matchId}` : "",
      league ? `Ligue: ${league}` : "",
      `Question utilisateur: ${message}`,
    ]
      .filter(Boolean)
      .join("\n");

    const anthropicBaseUrl = trimText(process.env.ANTHROPIC_BASE_URL || "", 500);
    const anthropicKey = trimText(
      process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY || "",
      500
    );
    const anthropicModel =
      trimText(process.env.ANTHROPIC_MODEL || "", 120) ||
      trimText(process.env.ANTHROPIC_DEFAULT_OPUS_MODEL || "", 120) ||
      trimText(process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "", 120) ||
      "claude-opus-4-6";
    const errors = [];

    if (anthropicBaseUrl && anthropicKey) {
      try {
        const result = await requestAnthropicChat({
          baseUrl: anthropicBaseUrl,
          apiKey: anthropicKey,
          model: anthropicModel,
          systemPrompt,
          userPrompt,
        });
        return res.json({
          success: true,
          provider: "anthropic",
          model: result.model,
          answer: result.answer,
        });
      } catch (error) {
        errors.push(`Anthropic: ${error.message}`);
      }
    } else {
      errors.push("Anthropic: configuration absente.");
    }

    return res.json({
      success: true,
      provider: "local-fallback",
      model: "local-fallback",
      answer: `${localChatFallback(message, { page, league, matchId })}\n\n[Info technique: ${errors.join(" | ")}]`,
    });
  } catch (error) {
    res.json({
      success: true,
      provider: "local-fallback",
      model: "local-fallback",
      answer: `${localChatFallback(req.body?.message, req.body?.context)}\n\n[Info technique: ${error.message}]`,
    });
  }
});

app.get("/api/chat", (_req, res) => {
  const anthropicModel =
    process.env.ANTHROPIC_MODEL ||
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    null;
  res.json({
    success: true,
    message: "Route chat active. Utilise POST /api/chat avec { message, context }.",
    providerPriority: ["anthropic", "local-fallback"],
    anthropic: {
      enabled: Boolean(
        process.env.ANTHROPIC_BASE_URL &&
          (process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_API_KEY)
      ),
      model: anthropicModel,
      baseUrl: process.env.ANTHROPIC_BASE_URL || null,
    },
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    success: false,
    message: "Route API introuvable.",
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

function startServer(startPort, triesLeft = MAX_PORT_TRIES) {
  const server = app.listen(startPort, () => {
    console.log(`Serveur actif: http://localhost:${startPort}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && triesLeft > 0) {
      const nextPort = startPort + 1;
      console.warn(`Port ${startPort} occupe, tentative sur ${nextPort}...`);
      startServer(nextPort, triesLeft - 1);
      return;
    }

    console.error("Impossible de demarrer le serveur:", error.message);
    process.exit(1);
  });
}

startServer(DEFAULT_PORT);
