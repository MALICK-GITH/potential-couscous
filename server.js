const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const { API_URL, getPenaltyMatches, getStructure, getMatchPredictionDetails, getCouponSelection, validateCouponTicket } = require("./services/liveFeed");

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
  const contentLines = ["BT", "/F1 11 Tf"];
  let y = top;
  for (const raw of safeLines.slice(0, 180)) {
    const line = pdfEscape(raw);
    contentLines.push(`${left} ${y} Td (${line}) Tj`);
    contentLines.push(`${-left} 0 Td`);
    y -= lineHeight;
    if (y < 60) break;
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

function buildCouponPdfLines(payload = {}) {
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

app.post("/api/coupon/pdf", (req, res) => {
  try {
    const coupon = Array.isArray(req.body?.coupon) ? req.body.coupon : [];
    if (!coupon.length) {
      return res.status(400).json({
        success: false,
        message: "Coupon vide. Impossible de generer le PDF.",
      });
    }

    const pdfLines = buildCouponPdfLines(req.body || {});
    const pdfBuffer = buildSimplePdf(pdfLines);
    const filename = `coupon-fc25-${Date.now()}.pdf`;
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
});

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

    const text = buildTelegramCouponText(req.body || {});
    let chatId = String(process.env.TELEGRAM_CHANNEL_ID || "").trim();

    if (!chatId) {
      const updatesRes = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=30&timeout=1`);
      const updatesData = await updatesRes.json();
      if (!updatesRes.ok || !updatesData?.ok) {
        return res.status(502).json({
          success: false,
          message: "Impossible de recuperer le chat Telegram depuis le bot.",
          error: updatesData?.description || "getUpdates indisponible.",
        });
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
        return res.status(400).json({
          success: false,
          message: "Aucun chat detecte. Ecris d'abord un message a ton bot sur Telegram, puis reessaie.",
        });
      }
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

    res.json({
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

app.post("/api/coupon/send-telegram", sendTelegramCouponHandler);
app.post("/api/telegram/send-coupon", sendTelegramCouponHandler);
app.post("/api/send-telegram", sendTelegramCouponHandler);

app.post("/api/chat", async (req, res) => {
  try {
    if (!canUseChat(req)) {
      return res.status(429).json({
        success: false,
        message: "Trop de requetes chat. Reessaie dans 1 minute.",
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        success: false,
        message: "OPENAI_API_KEY manquant sur le serveur.",
      });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
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

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
          { role: "user", content: [{ type: "input_text", text: userPrompt }] },
        ],
        temperature: 0.5,
        max_output_tokens: 500,
      }),
    });

    const raw = await response.json();
    if (!response.ok) {
      const errMsg = raw?.error?.message || "Erreur OpenAI";
      return res.json({
        success: true,
        model: "local-fallback",
        answer: `${localChatFallback(message, { page, league, matchId })}\n\n[Info technique: ${errMsg}]`,
      });
    }

    const outputText =
      (Array.isArray(raw?.output)
        ? raw.output
            .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
            .map((c) => c?.text || "")
            .join("\n")
            .trim()
        : "") || "Je n'ai pas de reponse pour le moment.";

    res.json({
      success: true,
      model,
      answer: outputText,
    });
  } catch (error) {
    res.json({
      success: true,
      model: "local-fallback",
      answer: `${localChatFallback(req.body?.message, req.body?.context)}\n\n[Info technique: ${error.message}]`,
    });
  }
});

app.get("/api/chat", (_req, res) => {
  res.json({
    success: true,
    message: "Route chat active. Utilise POST /api/chat avec { message, context }.",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
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
