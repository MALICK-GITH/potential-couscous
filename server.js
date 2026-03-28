const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const sharp = require("sharp");
const { API_URL, getPenaltyMatches, getStructure, getMatchPredictionDetails, getCouponSelection, validateCouponTicket } = require("./services/liveFeed");
const { toFeatures, deduplicate, extractRules, buildDecisionEngine, toTrainReadyCSV } = require("./services/patternEngineV2");
const {
  saveCouponGeneration,
  saveCouponValidation,
  saveTelegramLog,
  saveAuditReport,
  getCouponHistory,
  getTelegramHistory,
  getAuditHistory,
  getDbStatus,
} = require("./services/db");

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3029;
const MAX_PORT_TRIES = 20;
const CHAT_RATE_LIMIT_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT_MAX = 10;
const chatRateState = new Map();
const HEAVY_POST_WINDOW_MS = 60_000;
const HEAVY_POST_MAX = 40;
const heavyPostState = new Map();
const SERVER_STARTED_AT = Date.now();
const CHAT_IO_TIMEOUT_MS = 3500;
const CHAT_PROVIDER_TIMEOUT_MS = 7000;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.floor((Date.now() - SERVER_STARTED_AT) / 1000),
    startedAt: new Date(SERVER_STARTED_AT).toISOString(),
  });
});

app.use((req, res, next) => {
  if (req.method !== "POST" || !isHeavyPostPath(req.path)) return next();
  if (!canUseHeavyPost(req)) {
    return res.status(429).json({
      success: false,
      error: "Trop de requetes sur cette action. Reessaie dans environ une minute.",
    });
  }
  next();
});

function withTimeout(promise, timeoutMs, fallbackValue = null) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallbackValue);
      }
    }, timeoutMs);

    Promise.resolve(promise)
      .then((v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

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

function isHeavyPostPath(path = "") {
  const p = String(path || "");
  return (
    p.includes("send-telegram") ||
    p.includes("/coupon/pdf") ||
    p.includes("/coupon/image") ||
    p.includes("/pdf/coupon") ||
    p.includes("/download/coupon") ||
    p.includes("/coupon/print")
  );
}

function canUseHeavyPost(req) {
  const key = getClientKey(req);
  const now = Date.now();
  const state = heavyPostState.get(key) || { count: 0, resetAt: now + HEAVY_POST_WINDOW_MS };
  if (now > state.resetAt) {
    state.count = 0;
    state.resetAt = now + HEAVY_POST_WINDOW_MS;
  }
  state.count += 1;
  heavyPostState.set(key, state);
  return state.count <= HEAVY_POST_MAX;
}

function localChatFallback(message, context = {}) {
  const text = normalizeTeamKey(message || "");
  const page = String(context.page || "site");
  const league = String(context.league || "toutes les ligues");
  const matchId = String(context.matchId || "");
  const pageSnapshot = context?.pageSnapshot || null;

  if ((text.includes("tu vois la page") || text.includes("tu vois le site") || text.includes("est ce que tu vois")) && pageSnapshot) {
    const pageType = String(pageSnapshot?.pageType || context?.page || "site");
    const cards = Number(pageSnapshot?.cardsVisible || 0);
    const selections = Number(pageSnapshot?.selectionsVisible || 0);
    return `Oui, je vois la page via le snapshot temps reel (${pageType}). Elements detectes: matchs=${cards}, selections=${selections}.`;
  }

  if (
    text.includes("site") ||
    text.includes("que sais") ||
    text.includes("comment utiliser") ||
    text.includes("mode emploi")
  ) {
    return (
      "Je connais le site: page matchs live (/), detail match (/match.html?id=...), coupon builder (/coupon.html), " +
      "guide complet (/mode-emploi.html), page createur (/about.html), page developpeur (/developpeur.html). " +
      "Pour bien utiliser le coupon: choisis taille + ligue + profil risque, genere, valide ticket, puis exporte en PDF/PNG/JPG ou envoie Telegram."
    );
  }

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

  if (
    text.includes("bonjour") ||
    text.includes("salut") ||
    text.includes("ca va")
  ) {
    return "Salut. Je suis actif et je peux repondre a tes questions sur le site et aussi aux questions generales.";
  }

  return "Mode local actif. Je peux repondre aux questions du site et aux questions generales, puis proposer une action concrete si besoin.";
}

function isSiteQuestion(message = "") {
  const text = normalizeTeamKey(message);
  const keys = [
    "site",
    "fifa",
    "fc24",
    "fc25",
    "match",
    "cote",
    "coupon",
    "ticket",
    "telegram",
    "pari",
    "ligue",
    "bankroll",
    "prediction",
    "coach",
    "refresh",
  ];
  return keys.some((k) => text.includes(k));
}

function isRefusalAnswer(answer = "") {
  const t = normalizeTeamKey(answer);
  return (
    t.includes("je ne peux pas repondre") ||
    t.includes("je ne peux pas") ||
    t.includes("je peux pas") ||
    t.includes("je ne suis pas en mesure") ||
    t.includes("je ne peux pas aider")
  );
}

function localGeneralAnswer(message = "") {
  const q = String(message || "").trim();
  const t = normalizeTeamKey(q);
  if (!q) return "Pose ta question et je reponds directement.";
  if (t.includes("pourquoi") && t.includes("ciel") && t.includes("bleu")) {
    return "Le ciel parait bleu car l'atmosphere diffuse plus fortement la lumiere bleue du soleil (diffusion de Rayleigh).";
  }
  if (t.includes("bonjour") || t.includes("salut")) {
    return "Salut. Je suis disponible pour toutes tes questions, site ou general.";
  }
  if (t.includes("comment")) {
    return "Donne-moi le contexte exact et l'objectif, je te reponds avec des etapes simples et directes.";
  }
  if (t.includes("c est quoi") || t.includes("quest ce")) {
    return "Je peux te donner une definition claire. Precise juste le terme a definir si besoin.";
  }
  return `Reponse generale: ${q}. Si tu veux, je peux te donner une version courte, detaillee, ou un exemple concret.`;
}

function buildSiteKnowledgeBlock() {
  return [
    "BASE CONNAISSANCE SITE SOLITFIFPRO225 (TOUS FORMATS) — Signe SOLITAIRE HACK:",
    "- Pages: / (matchs live), /match.html?id=... (detail match), /coupon.html (coupon builder), /mode-emploi.html (guide), /about.html (createur), /developpeur.html (contacts).",
    "- Donnees matchs: API 1xBet LiveFeed (FIFA virtuel global), tri ligue, statut match, cotes 1X2 et marches additionnels.",
    "- Couverture: FC 24, FC 25, et toutes les ligues/formats FIFA virtuels presentes sur le site.",
    "- Detail match: decision maitre, bots, top 3 recommandations, Neural Match Engine, alertes drift cotes.",
    "- Coupon: generation optimisee par risque (safe/balanced/aggressive), validation ticket, remplacement selections faibles.",
    "- Exports image: PNG (nettete) et JPG (leger) pour standard, premium et story; duo PNG+JPG en un flux; Telegram image suit le format choisi sur la page coupon.",
    "- Exports: PDF coupon (resume/rapide/detaille), impression A4, rapport pro, journal performance.",
    "- Telegram: envoi texte, image (PNG ou JPG selon UI), pack (texte+image+PDF), ladder.",
    "- Regle metier critique: aucun coupon garanti gagnant; filtrer de preference les matchs non demarres.",
    "- CONTROLE IA (priorite): le site t'envoie snapshot + liste d'actions disponibles. Tu orientes l'utilisateur et tu sais que le backend declenche des actions securisees (navigation, refresh, site_control) quand l'utilisateur formule une intention claire.",
    "- Commandes reconnues (non exhaustif): accueil, page coupon, guide, actualise, image png/jpg, duo png jpg, copier coupon, reinitialiser coupon, generer/valider/telegram/pdf/story/premium, modes match (live, turbo, termines).",
  ].join("\n");
}

function deriveControlActions(message, context = {}) {
  const text = normalizeTeamKey(message || "");
  const actions = [];
  const page = String(context?.page || "");
  const capabilities = Array.isArray(context?.capabilities?.actions) ? context.capabilities.actions : [];
  const can = (name) => capabilities.includes(name);

  if (text.includes("ouvre coupon") || text.includes("page coupon")) {
    actions.push({ type: "open_page", target: "/coupon.html" });
  }
  if (text.includes("ouvre match") && context.matchId) {
    actions.push({ type: "open_page", target: `/match.html?id=${encodeURIComponent(context.matchId)}` });
  }
  if (text.includes("retour match") || text.includes("accueil")) {
    actions.push({ type: "open_page", target: "/" });
  }
  if (text.includes("mode emploi") || text.includes("guide")) {
    actions.push({ type: "open_page", target: "/mode-emploi.html" });
  }
  if (text.includes("page createur") || text.includes("a propos") || text.includes("apropos")) {
    actions.push({ type: "open_page", target: "/about.html" });
  }
  if (text.includes("developpeur") || text.includes("contact dev")) {
    actions.push({ type: "open_page", target: "/developpeur.html" });
  }
  if (text.includes("refresh") || text.includes("actualise") || text.includes("rafraich")) {
    actions.push({ type: "refresh_page" });
  }
  if (text.includes("efface chat") || text.includes("vider chat") || text.includes("clear chat")) {
    actions.push({ type: "clear_chat" });
  }

  const wantsCoupon =
    text.includes("coupon") || text.includes("ticket") || text.includes("parlay");
  const wantsGenerate =
    text.includes("fait") ||
    text.includes("fais") ||
    text.includes("genere") ||
    text.includes("cree") ||
    text.includes("prepare");
  const wantsTelegram =
    text.includes("telegram") ||
    text.includes("tg") ||
    text.includes("balance sur tg") ||
    text.includes("envoie sur tg") ||
    text.includes("envoi sur tg") ||
    text.includes("send tg");
  const wantsPack =
    text.includes("pack") ||
    text.includes("image+pdf+telegram") ||
    text.includes("image pdf telegram");
  const wantsLadder =
    text.includes("ladder") ||
    text.includes("echelle") ||
    text.includes("60/30/10");

  // Controle home
  if (page === "/" || page === "/index.html") {
    if (text.includes("mode live") || text.includes("match en cours")) {
      actions.push({ type: "site_control", name: "set_mode_live" });
    }
    if (text.includes("mode a venir") || text.includes("upcoming")) {
      actions.push({ type: "site_control", name: "set_mode_upcoming" });
    }
    if (text.includes("mode turbo")) {
      actions.push({ type: "site_control", name: "set_mode_turbo" });
    }
    if (text.includes("mode termine")) {
      actions.push({ type: "site_control", name: "set_mode_finished" });
    }
    if (text.includes("actualise match") || text.includes("refresh match")) {
      actions.push({ type: "site_control", name: "refresh_matches" });
    }
  }

  // Controle coupon
  if (page.includes("coupon")) {
    if (wantsLadder) {
      actions.push({ type: "site_control", name: "generate_ladder" });
    }
    if (wantsCoupon && wantsGenerate) {
      actions.push({ type: "site_control", name: "generate_coupon" });
    }
    if (text.includes("genere coupon") || text.includes("creer coupon")) {
      actions.push({ type: "site_control", name: "generate_coupon" });
    }
    if (text.includes("valide ticket")) {
      actions.push({ type: "site_control", name: "validate_ticket" });
    }
    if (text.includes("remplace faible")) {
      actions.push({ type: "site_control", name: "replace_weak_pick" });
    }
    if (text.includes("simule bankroll")) {
      actions.push({ type: "site_control", name: "simulate_bankroll" });
    }
    if (text.includes("telegram mini") || text.includes("mini telegram") || text.includes("tg mini")) {
      actions.push({ type: "site_control", name: "send_telegram_mini" });
    }
    if (text.includes("envoie telegram image")) {
      actions.push({ type: "site_control", name: "send_telegram_image" });
    } else if (text.includes("envoie telegram") || wantsTelegram) {
      actions.push({ type: "site_control", name: "send_telegram_text" });
    }
    if (text.includes("envoie pack") || wantsPack || (wantsCoupon && wantsGenerate && wantsTelegram)) {
      actions.push({ type: "site_control", name: "send_telegram_pack" });
    }
    if (wantsLadder && wantsTelegram) {
      actions.push({ type: "site_control", name: "send_ladder_telegram" });
    }
    if (text.includes("pdf rapide")) actions.push({ type: "site_control", name: "download_pdf_quick" });
    if (text.includes("pdf detail")) actions.push({ type: "site_control", name: "download_pdf_detailed" });
    if (text.includes("pdf")) actions.push({ type: "site_control", name: "download_pdf_summary" });
    if (text.includes("print a4") || text.includes("impression a4") || text.includes("ticket imprimable")) {
      actions.push({ type: "site_control", name: "print_a4" });
    }
    if (text.includes("journal performance") || text.includes("analyser journal")) {
      actions.push({ type: "site_control", name: "analyze_journal" });
    }
    if (text.includes("replay journal") || text.includes("journal replay")) {
      actions.push({ type: "site_control", name: "replay_journal" });
    }
    if (text.includes("watchlist")) {
      actions.push({ type: "site_control", name: "build_watchlist" });
    }
    if (text.includes("profil bankroll conservateur")) {
      actions.push({ type: "site_control", name: "set_bankroll_profile", payload: { profile: "conservateur" } });
    } else if (text.includes("profil bankroll attaque")) {
      actions.push({ type: "site_control", name: "set_bankroll_profile", payload: { profile: "attaque" } });
    } else if (text.includes("profil bankroll standard")) {
      actions.push({ type: "site_control", name: "set_bankroll_profile", payload: { profile: "standard" } });
    }
    if (text.includes("simulation live on")) {
      actions.push({ type: "site_control", name: "set_live_simulation", payload: { enabled: true } });
    } else if (text.includes("simulation live off")) {
      actions.push({ type: "site_control", name: "set_live_simulation", payload: { enabled: false } });
    }
    if (text.includes("auto heal on")) {
      actions.push({ type: "site_control", name: "set_auto_heal", payload: { enabled: true } });
    } else if (text.includes("auto heal off")) {
      actions.push({ type: "site_control", name: "set_auto_heal", payload: { enabled: false } });
    }
    if (text.includes("anti chaos on")) {
      actions.push({ type: "site_control", name: "set_anti_chaos", payload: { enabled: true } });
    } else if (text.includes("anti chaos off")) {
      actions.push({ type: "site_control", name: "set_anti_chaos", payload: { enabled: false } });
    }
    if (text.includes("lock pre send on") || text.includes("verrouillage pre envoi on")) {
      actions.push({ type: "site_control", name: "set_pre_send_lock", payload: { enabled: true } });
    } else if (text.includes("lock pre send off") || text.includes("verrouillage pre envoi off")) {
      actions.push({ type: "site_control", name: "set_pre_send_lock", payload: { enabled: false } });
    }
    if (text.includes("low data on")) {
      actions.push({ type: "site_control", name: "set_low_data_mode", payload: { enabled: true } });
    } else if (text.includes("low data off")) {
      actions.push({ type: "site_control", name: "set_low_data_mode", payload: { enabled: false } });
    }
    const wantPng = text.includes("png");
    const wantJpg = text.includes("jpg") || text.includes("jpeg");
    if (text.includes("copie coupon") || text.includes("copier le coupon") || text.includes("copier coupon")) {
      actions.push({ type: "site_control", name: "copy_coupon_text" });
    }
    if (
      text.includes("reinitialise") ||
      text.includes("reinitialiser") ||
      text.includes("reset coupon") ||
      text.includes("vider le coupon")
    ) {
      actions.push({ type: "site_control", name: "reset_coupon_workspace" });
    }
    if (
      text.includes("duo") ||
      text.includes("png et jpg") ||
      text.includes("jpg et png") ||
      text.includes("deux formats")
    ) {
      actions.push({ type: "site_control", name: "download_image_duo", payload: { mode: "default" } });
    }
    if (text.includes("premium") && wantPng) {
      actions.push({ type: "site_control", name: "download_image", payload: { mode: "premium", format: "png" } });
    } else if (text.includes("premium") && wantJpg) {
      actions.push({ type: "site_control", name: "download_image", payload: { mode: "premium", format: "jpg" } });
    } else if ((text.includes("story") || text.includes("snap")) && wantPng) {
      actions.push({ type: "site_control", name: "download_image", payload: { mode: "story", format: "png" } });
    } else if ((text.includes("story") || text.includes("snap")) && wantJpg) {
      actions.push({ type: "site_control", name: "download_image", payload: { mode: "story", format: "jpg" } });
    } else if (
      (text.includes("image coupon") || text.includes("telecharge image") || (text.includes("export") && text.includes("image"))) &&
      wantPng
    ) {
      actions.push({ type: "site_control", name: "download_image", payload: { mode: "default", format: "png" } });
    } else if (
      (text.includes("image coupon") || text.includes("telecharge image") || (text.includes("export") && text.includes("image"))) &&
      wantJpg
    ) {
      actions.push({ type: "site_control", name: "download_image", payload: { mode: "default", format: "jpg" } });
    } else if (text.includes("image coupon")) {
      actions.push({ type: "site_control", name: "download_image" });
    } else if (text.includes("image premium")) {
      actions.push({ type: "site_control", name: "download_image_premium" });
    } else if (text.includes("story") || text.includes("snap")) {
      actions.push({ type: "site_control", name: "download_story" });
    }
  }

  // Controle match detail
  if (page.includes("match")) {
    if (text.includes("coach on")) actions.push({ type: "site_control", name: "toggle_coach_mode", payload: { enabled: true } });
    if (text.includes("coach off")) actions.push({ type: "site_control", name: "toggle_coach_mode", payload: { enabled: false } });
    if (text.includes("export 1 clic") || text.includes("export all")) actions.push({ type: "site_control", name: "export_match_all" });
    if (text.includes("match telegram image")) actions.push({ type: "site_control", name: "send_match_telegram_image" });
    if (text.includes("match telegram")) actions.push({ type: "site_control", name: "send_match_telegram_text" });
    if (text.includes("pdf match")) actions.push({ type: "site_control", name: "download_match_pdf" });
    if (text.includes("image match")) actions.push({ type: "site_control", name: "download_match_image" });
    if (text.includes("refresh detail")) actions.push({ type: "site_control", name: "refresh_match_data" });
  }

  // Simple parse "coupon 3 matchs safe"
  const sizeMatch = text.match(/(\d{1,2})\s*match/);
  const isCouponIntent = text.includes("coupon") || text.includes("ticket");
  if (isCouponIntent) {
    const size = sizeMatch ? Math.max(1, Math.min(12, Number(sizeMatch[1]))) : null;
    const risk = text.includes("safe")
      ? "safe"
      : text.includes("agress")
      ? "aggressive"
      : text.includes("equilibre")
      ? "balanced"
      : null;
    const league = context.league && context.league !== "all" ? context.league : null;
    if (size || risk || league) {
      actions.push({
        type: "set_coupon_form",
        size: size || undefined,
        risk: risk || undefined,
        league: league || undefined,
      });
      if (can("set_coupon_form")) {
        actions.push({
          type: "site_control",
          name: "set_coupon_form",
          payload: {
            size: size || undefined,
            risk: risk || undefined,
            league: league || undefined,
          },
        });
      }
    }
  }

  // Si demande coupon+TG hors page coupon, basculer automatiquement
  if (!page.includes("coupon") && wantsCoupon && wantsGenerate && wantsTelegram) {
    actions.unshift({ type: "open_page", target: "/coupon.html" });
  }

  const priority = (a) => {
    if (a?.type === "set_coupon_form") return 10;
    if (a?.type === "site_control" && a?.name === "set_coupon_form") return 11;
    if (a?.type === "site_control" && a?.name === "generate_ladder") return 18;
    if (a?.type === "site_control" && a?.name === "generate_coupon") return 20;
    if (a?.type === "site_control" && (a?.name === "send_ladder_telegram" || a?.name === "send_telegram_pack" || a?.name === "send_telegram_text" || a?.name === "send_telegram_mini" || a?.name === "send_telegram_image")) return 30;
    return 50;
  };
  return actions.sort((x, y) => priority(x) - priority(y));
}

const runtimeContextCache = {
  at: 0,
  summary: "",
};

async function buildDynamicRuntimeContext({ page, league, matchId }) {
  const lines = [];
  const now = Date.now();

  if (matchId) {
    try {
      const details = await withTimeout(getMatchPredictionDetails(matchId), CHAT_IO_TIMEOUT_MS, null);
      const m = details?.match || {};
      const master = details?.prediction?.maitre?.decision_finale || {};
      lines.push(
        `MATCH_COURANT: ${m.teamHome || "?"} vs ${m.teamAway || "?"} | Ligue: ${m.league || league || "?"} | Pari maitre: ${master.pari_choisi || "N/A"} | Confiance: ${master.confiance_numerique ?? 0}%`
      );
    } catch (_e) {
      lines.push(`MATCH_COURANT: indisponible pour id ${matchId}`);
    }
  }

  // Cache court pour eviter de recharger les matchs a chaque message
  const cacheFresh = now - runtimeContextCache.at < 30_000 && runtimeContextCache.summary;
  if (cacheFresh) {
    lines.push(runtimeContextCache.summary);
  } else {
    try {
      const listing = await withTimeout(getPenaltyMatches(), CHAT_IO_TIMEOUT_MS, null);
      const matches = Array.isArray(listing?.matches) ? listing.matches : [];
      const upcoming = matches.filter((x) => Number(x?.startTimeUnix || 0) > Math.floor(Date.now() / 1000));
      const byLeague = new Map();
      for (const m of upcoming) {
        const key = String(m?.league || "Autre");
        byLeague.set(key, (byLeague.get(key) || 0) + 1);
      }
      const topLeague = [...byLeague.entries()].sort((a, b) => b[1] - a[1])[0];
      const summary =
        `ETAT_SITE: matchs=${matches.length}, a_venir=${upcoming.length}` +
        (topLeague ? `, ligue_top="${topLeague[0]}" (${topLeague[1]})` : "");
      runtimeContextCache.at = now;
      runtimeContextCache.summary = summary;
      lines.push(summary);
    } catch (_e) {
      lines.push("ETAT_SITE: indisponible");
    }
  }

  lines.push(`PAGE_ACTIVE: ${page || "site"}${league ? ` | FILTRE_LIGUE: ${league}` : ""}`);
  return lines.join("\n");
}

function formatOddForTelegram(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(3) : "-";
}

function formatDateTime(value) {
  if (!value && value !== 0) return "-";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMatchStartTimeUnix(unixSeconds) {
  const n = Number(unixSeconds);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return formatDateTime(n * 1000);
}

function buildTelegramCouponText(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const insights = payload.insights || {};
  const riskProfile = String(payload.riskProfile || "balanced");
  const telegramConfidenceScore = Math.max(
    1,
    Math.min(
      100,
      Math.round(
        Number(payload?.telegramConfidenceScore) ||
          Number(summary?.averageConfidence || 0) * 0.45 +
            Number(insights?.reliabilityIndex || 60) * 0.4 +
            (100 - Number(insights?.correlationRisk || 50)) * 0.15
      )
    )
  );
  if (payload?.mini) {
    const top = coupon.slice(0, 3);
    const lines = [
      `FC25 MINI | ${riskProfile.toUpperCase()}`,
      `Sel: ${Number(summary.totalSelections) || coupon.length} | Cote: ${formatOddForTelegram(summary.combinedOdd)}`,
      `Conf: ${Number(summary.averageConfidence) || 0}%`,
      `Score Telegram: ${telegramConfidenceScore}/100`,
      ...top.map((p, i) => `${i + 1}) ${p?.teamHome || "E1"} vs ${p?.teamAway || "E2"} | ${formatOddForTelegram(p?.cote)}`),
      "Signe: SOLITAIRE HACK",
    ];
    return lines.slice(0, 7).join("\n");
  }
  const lines = [
    "COUPON OPTIMISE SOLITFIFPRO225",
    "Source: SOLITFIFPRO225",
    `Profil: ${riskProfile}`,
    `Selections: ${Number(summary.totalSelections) || coupon.length}`,
    `Cote combinee: ${formatOddForTelegram(summary.combinedOdd)}`,
    `Confiance moyenne: ${Number(summary.averageConfidence) || 0}%`,
    `Score confiance Telegram: ${telegramConfidenceScore}/100`,
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

function truncateCouponLabel(text = "", max = 44) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

function buildCouponImageSvg(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskRaw = truncateCouponLabel(String(payload.riskProfile || "balanced"), 20);
  const picks = coupon.slice(0, 6);
  const count = Math.max(1, picks.length || 1);
  const cardH = 228;
  const gap = 18;
  const headH = 178;
  const footH = 52;
  const width = 1200;
  const height = headH + footH + count * cardH + (count - 1) * gap;
  const generatedAt = formatDateTime(new Date());
  const innerW = width - 72;

  const cards = picks.map((pick, i) => {
    const y = headH + i * (cardH + gap);
    const league = escapeXml(truncateCouponLabel(pick.league || "Ligue virtuelle", 52));
    const home = escapeXml(truncateCouponLabel(pick.teamHome || "Equipe 1", 22));
    const away = escapeXml(truncateCouponLabel(pick.teamAway || "Equipe 2", 22));
    const pari = escapeXml(truncateCouponLabel(pick.pari || "-", 64));
    const odd = formatOddForTelegram(pick.cote);
    const matchStart = escapeXml(formatMatchStartTimeUnix(pick.startTimeUnix));
    const cx = innerW / 2;
    return `
      <g transform="translate(36, ${y})">
        <rect x="0" y="0" width="${innerW}" height="${cardH}" rx="16" fill="rgba(8,12,22,0.94)" stroke="url(#imgStroke)" stroke-width="1.5"/>
        <rect x="0" y="0" width="7" height="${cardH}" rx="4" fill="url(#imgAccent)"/>
        <rect x="0" y="0" width="${innerW}" height="46" rx="16" fill="rgba(18,28,48,0.88)"/>
        <line x1="14" y1="46" x2="${innerW - 14}" y2="46" stroke="rgba(0,240,255,0.2)"/>
        <text x="20" y="30" fill="#9ecfff" font-size="14" font-weight="800" font-family="Segoe UI, Arial, sans-serif" letter-spacing="0.06em">${i + 1}. ${league}</text>
        <text x="${innerW - 18}" y="30" text-anchor="end" fill="#7a8fb8" font-size="12" font-family="Segoe UI, Arial, sans-serif">${matchStart}</text>
        <text x="24" y="96" fill="#ffffff" font-size="26" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${home}</text>
        <g transform="translate(${cx - 34}, 58)">
          <polygon points="34,0 68,20 34,40 0,20" fill="rgba(0,240,255,0.12)" stroke="rgba(255,0,170,0.65)" stroke-width="2"/>
          <text x="34" y="26" text-anchor="middle" fill="#00f0ff" font-size="17" font-weight="900" font-family="Segoe UI, Arial, sans-serif">VS</text>
        </g>
        <text x="${innerW - 24}" y="96" text-anchor="end" fill="#ffffff" font-size="26" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${away}</text>
        <rect x="16" y="118" width="${innerW - 32}" height="92" rx="12" fill="rgba(4,8,18,0.92)" stroke="rgba(123,44,255,0.35)"/>
        <text x="32" y="148" fill="#8fa6c8" font-size="12" font-weight="700" font-family="Segoe UI, Arial, sans-serif" letter-spacing="0.12em">PARI ESPORTS</text>
        <text x="32" y="176" fill="#eef4ff" font-size="18" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${pari}</text>
        <text x="${innerW - 32}" y="148" text-anchor="end" fill="#8fa6c8" font-size="12" font-weight="700" font-family="Segoe UI, Arial, sans-serif">COTE</text>
        <text x="${innerW - 32}" y="182" text-anchor="end" fill="url(#imgOdd)" font-size="28" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${odd}</text>
      </g>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="imgBg" x1="0" y1="0" x2="1.1" y2="1">
      <stop offset="0%" stop-color="#050810"/>
      <stop offset="45%" stop-color="#0c1528"/>
      <stop offset="100%" stop-color="#120a20"/>
    </linearGradient>
    <radialGradient id="imgGlow" cx="18%" cy="12%" r="55%">
      <stop offset="0%" stop-color="rgba(0,240,255,0.22)"/>
      <stop offset="55%" stop-color="rgba(123,44,255,0.08)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <radialGradient id="imgFloor" cx="50%" cy="100%" r="70%">
      <stop offset="0%" stop-color="rgba(255,0,170,0.12)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="imgHead" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00f0ff"/>
      <stop offset="50%" stop-color="#ff00aa"/>
      <stop offset="100%" stop-color="#7b2cff"/>
    </linearGradient>
    <linearGradient id="imgAccent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00f0ff"/>
      <stop offset="100%" stop-color="#ff00aa"/>
    </linearGradient>
    <linearGradient id="imgStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(0,240,255,0.5)"/>
      <stop offset="100%" stop-color="rgba(123,44,255,0.35)"/>
    </linearGradient>
    <linearGradient id="imgOdd" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#5dffa2"/>
      <stop offset="100%" stop-color="#00f0ff"/>
    </linearGradient>
    <pattern id="imgMesh" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M0 48 L48 0 M-12 12 L12 -12 M36 60 L60 36" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#imgBg)"/>
  <rect width="${width}" height="${height}" fill="url(#imgGlow)"/>
  <rect width="${width}" height="${height}" fill="url(#imgFloor)"/>
  <rect width="${width}" height="${height}" fill="url(#imgMesh)" opacity="0.9"/>
  <rect x="24" y="18" width="${width - 48}" height="${headH - 36}" rx="20" fill="rgba(6,10,22,0.75)" stroke="url(#imgStroke)" stroke-width="1.2"/>
  <rect x="36" y="30" width="168" height="30" rx="8" fill="rgba(0,240,255,0.12)" stroke="rgba(0,240,255,0.45)"/>
  <text x="48" y="51" fill="#00f0ff" font-size="13" font-weight="800" font-family="Segoe UI, Arial, sans-serif" letter-spacing="0.28em">FC ESPORTS</text>
  <text x="48" y="96" fill="url(#imgHead)" font-size="34" font-weight="900" font-family="Segoe UI, Arial, sans-serif">SOLITFIFPRO225</text>
  <text x="48" y="124" fill="#c5d6f0" font-size="17" font-family="Segoe UI, Arial, sans-serif">Ticket pro — Profil ${escapeXml(riskRaw)} · Sel. ${Number(summary.totalSelections) || coupon.length} · Combinée ${formatOddForTelegram(summary.combinedOdd)}</text>
  <text x="48" y="148" fill="#7a8fb8" font-size="13" font-family="Segoe UI, Arial, sans-serif">Généré ${escapeXml(generatedAt)}</text>
  ${cards.join("\n")}
  <text x="48" y="${height - 26}" fill="#8fa1c4" font-size="14" font-family="Segoe UI, Arial, sans-serif">Signé SOLITAIRE HACK · Esports Virtual</text>
</svg>`;
}

function buildCouponStorySvg(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskRaw = truncateCouponLabel(String(payload.riskProfile || "balanced"), 18);
  const picks = coupon.slice(0, 5);
  const width = 1080;
  const height = 1920;
  const generatedAt = new Date().toLocaleString("fr-FR");
  const cardW = width - 96;
  const cardH = 268;
  const startY = 300;
  const gap = 22;

  const cards = picks.map((pick, i) => {
    const y = startY + i * (cardH + gap);
    const home = escapeXml(truncateCouponLabel(pick.teamHome || "Equipe 1", 18));
    const away = escapeXml(truncateCouponLabel(pick.teamAway || "Equipe 2", 18));
    const league = escapeXml(truncateCouponLabel(pick.league || "Ligue", 28));
    const pari = escapeXml(truncateCouponLabel(pick.pari || "-", 40));
    const odd = formatOddForTelegram(pick.cote);
    const conf = Number(pick.confiance) || 0;
    const risk = conf >= 75 ? "SAFE" : conf >= 60 ? "MODERE" : "RISQUE";
    const mid = cardW / 2;
    return `
      <g transform="translate(48, ${y})">
        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="26" fill="rgba(6,10,20,0.92)" stroke="url(#stStroke)" stroke-width="2"/>
        <rect x="0" y="0" width="8" height="${cardH}" rx="4" fill="url(#stAccent)"/>
        <text x="24" y="44" fill="#00f0ff" font-size="22" font-weight="800" font-family="Segoe UI, Arial, sans-serif" letter-spacing="0.04em">${i + 1}. ${league}</text>
        <text x="${mid}" y="118" text-anchor="middle" fill="#ffffff" font-size="36" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${home}</text>
        <g transform="translate(${mid - 40}, 128)">
          <polygon points="40,0 80,24 40,48 0,24" fill="rgba(255,0,170,0.15)" stroke="#00f0ff" stroke-width="2.5"/>
          <text x="40" y="32" text-anchor="middle" fill="#ff4ddb" font-size="20" font-weight="900" font-family="Segoe UI, Arial, sans-serif">VS</text>
        </g>
        <text x="${mid}" y="210" text-anchor="middle" fill="#ffffff" font-size="36" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${away}</text>
        <rect x="20" y="224" width="${cardW - 40}" height="36" rx="10" fill="rgba(0,240,255,0.08)" stroke="rgba(123,44,255,0.4)"/>
        <text x="32" y="247" fill="#c8d9f5" font-size="18" font-weight="600" font-family="Segoe UI, Arial, sans-serif">${pari}</text>
        <text x="${cardW - 32}" y="247" text-anchor="end" fill="url(#stOdd)" font-size="22" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${odd}</text>
        <text x="${cardW - 24}" y="44" text-anchor="end" fill="#ffc14d" font-size="20" font-weight="800" font-family="Segoe UI, Arial, sans-serif">${conf}% ${risk}</text>
      </g>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="stBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#030508"/>
      <stop offset="40%" stop-color="#0a1428"/>
      <stop offset="100%" stop-color="#180820"/>
    </linearGradient>
    <radialGradient id="stSpot" cx="50%" cy="0%" r="75%">
      <stop offset="0%" stop-color="rgba(0,240,255,0.35)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="stTitle" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00f0ff"/>
      <stop offset="50%" stop-color="#ff00aa"/>
      <stop offset="100%" stop-color="#c9ff3d"/>
    </linearGradient>
    <linearGradient id="stAccent" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ff00aa"/>
      <stop offset="100%" stop-color="#7b2cff"/>
    </linearGradient>
    <linearGradient id="stStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="rgba(0,240,255,0.55)"/>
      <stop offset="100%" stop-color="rgba(255,0,170,0.4)"/>
    </linearGradient>
    <linearGradient id="stOdd" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#7dffb0"/>
      <stop offset="100%" stop-color="#00f0ff"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#stBg)"/>
  <rect width="${width}" height="${height}" fill="url(#stSpot)"/>
  <rect x="40" y="72" width="${width - 80}" height="200" rx="28" fill="rgba(8,12,24,0.82)" stroke="url(#stStroke)" stroke-width="1.5"/>
  <text x="72" y="128" fill="url(#stTitle)" font-size="52" font-weight="900" font-family="Segoe UI, Arial, sans-serif">STORY ESPORTS</text>
  <text x="72" y="168" fill="#00f0ff" font-size="22" font-weight="800" font-family="Segoe UI, Arial, sans-serif" letter-spacing="0.35em">SOLITFIFPRO225</text>
  <text x="72" y="210" fill="#d5e4ff" font-size="26" font-family="Segoe UI, Arial, sans-serif">Profil ${escapeXml(riskRaw)} · ${Number(summary.totalSelections) || coupon.length} sélections</text>
  <text x="72" y="246" fill="#8fa6c8" font-size="22" font-family="Segoe UI, Arial, sans-serif">Cote ${formatOddForTelegram(summary.combinedOdd)} · ${escapeXml(generatedAt)}</text>
  ${cards.join("\n")}
  <text x="72" y="${height - 88}" fill="#a8b8d8" font-size="24" font-family="Segoe UI, Arial, sans-serif">Signé SOLITAIRE HACK</text>
  <text x="72" y="${height - 52}" fill="#6a7a9a" font-size="18" font-family="Segoe UI, Arial, sans-serif">Aucune combinaison n'est garantie gagnante.</text>
</svg>`;
}

function buildCouponPremiumSvg(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskRaw = truncateCouponLabel(String(payload.riskProfile || "balanced"), 22);
  const picks = coupon.slice(0, 8);
  const count = Math.max(1, picks.length || 1);
  const width = 1400;
  const headH = 200;
  const cardH = 152;
  const gap = 14;
  const footH = 54;
  const height = headH + footH + count * cardH + (count - 1) * gap;
  const generatedAt = formatDateTime(new Date());
  const rowW = width - 64;

  const rows = picks
    .map((pick, idx) => {
      const y = headH + idx * (cardH + gap);
      const home = escapeXml(truncateCouponLabel(pick.teamHome || "Equipe 1", 20));
      const away = escapeXml(truncateCouponLabel(pick.teamAway || "Equipe 2", 20));
      const league = escapeXml(truncateCouponLabel(pick.league || "Ligue virtuelle", 40));
      const bet = escapeXml(truncateCouponLabel(pick.pari || "-", 48));
      const odd = formatOddForTelegram(pick.cote);
      const conf = Number(pick?.confiance || 0).toFixed(1);
      const startAt = escapeXml(formatMatchStartTimeUnix(pick.startTimeUnix));
      const q = Number(pick?.qualityScore || pick?.dataQuality || pick?.confiance || 0).toFixed(0);
      const hx = rowW / 2;
      return `
      <g transform="translate(32, ${y})">
        <rect x="0" y="0" width="${rowW}" height="${cardH}" rx="14" fill="rgba(5,9,18,0.96)" stroke="url(#pmStroke)"/>
        <rect x="0" y="0" width="6" height="${cardH}" rx="3" fill="url(#pmBar)"/>
        <text x="16" y="28" fill="#8ab4ff" font-size="13" font-weight="800" font-family="Segoe UI, Arial, sans-serif" letter-spacing="0.08em">${idx + 1}. ${league}</text>
        <text x="${rowW - 16}" y="28" text-anchor="end" fill="#6a7a98" font-size="12" font-family="Segoe UI, Arial, sans-serif">${startAt}</text>
        <text x="18" y="76" fill="#ffffff" font-size="26" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${home}</text>
        <g transform="translate(${hx - 28}, 44)">
          <rect x="0" y="0" width="56" height="28" rx="8" fill="rgba(0,240,255,0.12)" stroke="rgba(255,0,170,0.6)" stroke-width="1.5"/>
          <text x="28" y="20" text-anchor="middle" fill="#00f0ff" font-size="15" font-weight="900" font-family="Segoe UI, Arial, sans-serif">VS</text>
        </g>
        <text x="${rowW - 18}" y="76" text-anchor="end" fill="#ffffff" font-size="26" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${away}</text>
        <rect x="14" y="92" width="${rowW - 28}" height="48" rx="10" fill="rgba(12,18,32,0.95)" stroke="rgba(123,44,255,0.3)"/>
        <text x="26" y="118" fill="#dce6ff" font-size="16" font-weight="700" font-family="Segoe UI, Arial, sans-serif">${bet}</text>
        <text x="${rowW - 120}" y="122" text-anchor="end" fill="url(#pmOdd)" font-size="26" font-weight="900" font-family="Segoe UI, Arial, sans-serif">${odd}</text>
        <text x="${rowW - 22}" y="112" text-anchor="end" fill="#8899bb" font-size="10" font-family="Segoe UI, Arial, sans-serif">CONF</text>
        <text x="${rowW - 22}" y="128" text-anchor="end" fill="#8899bb" font-size="10" font-family="Segoe UI, Arial, sans-serif">${conf}% · Q${q}</text>
      </g>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="pmBg" x1="0" y1="0" x2="1.1" y2="1">
      <stop offset="0%" stop-color="#020408"/>
      <stop offset="50%" stop-color="#0c1830"/>
      <stop offset="100%" stop-color="#14081a"/>
    </linearGradient>
    <radialGradient id="pmLite" cx="80%" cy="15%" r="50%">
      <stop offset="0%" stop-color="rgba(255,0,170,0.2)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </radialGradient>
    <linearGradient id="pmHead" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#00f0ff"/>
      <stop offset="33%" stop-color="#ff00aa"/>
      <stop offset="100%" stop-color="#7b2cff"/>
    </linearGradient>
    <linearGradient id="pmBar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#00f0ff"/>
      <stop offset="100%" stop-color="#7b2cff"/>
    </linearGradient>
    <linearGradient id="pmStroke" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(0,240,255,0.45)"/>
      <stop offset="100%" stop-color="rgba(123,44,255,0.35)"/>
    </linearGradient>
    <linearGradient id="pmOdd" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#9fff6e"/>
      <stop offset="100%" stop-color="#00f0ff"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#pmBg)"/>
  <rect width="${width}" height="${height}" fill="url(#pmLite)"/>
  <rect x="18" y="16" width="${width - 36}" height="${headH - 34}" rx="20" fill="rgba(6,10,22,0.78)" stroke="url(#pmStroke)" stroke-width="1.2"/>
  <text x="40" y="58" fill="url(#pmHead)" font-size="38" font-weight="900" font-family="Segoe UI, Arial, sans-serif">PREMIUM ESPORTS TICKET</text>
  <text x="40" y="92" fill="#d4e2ff" font-size="18" font-family="Segoe UI, Arial, sans-serif">SOLITFIFPRO225 · Profil ${escapeXml(riskRaw)} · ${Number(summary.totalSelections) || coupon.length} sel. · ${formatOddForTelegram(summary.combinedOdd)}</text>
  <text x="40" y="120" fill="#7d8db0" font-size="14" font-family="Segoe UI, Arial, sans-serif">Généré ${escapeXml(generatedAt)} — rendu HD mobile &amp; desktop</text>
  ${rows}
  <text x="40" y="${height - 22}" fill="#8a9ab8" font-size="14" font-family="Segoe UI, Arial, sans-serif">Signé SOLITAIRE HACK — jeu responsable — combinaison non garantie</text>
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
    return sharp(buffer).jpeg({ quality: 94, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  }
  return sharp(buffer).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
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
    "SOLITFIFPRO225 - COUPON PDF",
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
    "SOLITFIFPRO225 - PDF ULTRA-COURT",
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
    "SOLITFIFPRO225 - COUPON DETAILLE ANALYTIQUE",
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
  const norm = (v) =>
    String(v || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  const isPreMatchBySignals = (pick) => {
    const statusCode = Number(pick?.statusCode || 0);
    const info = norm(pick?.infoText || "");
    const status = norm(pick?.statusText || "");
    const phase = norm(pick?.phase || "");
    const preByCode = statusCode === 128;
    const preByInfo = info.includes("avant le debut");
    const preByStatus = status.includes("debut dans");
    const inPlay =
      phase.includes("mi-temps") ||
      phase.includes("1ere mi-temps") ||
      phase.includes("2eme mi-temps") ||
      info.includes("termine") ||
      phase.includes("termine");
    if (inPlay) return false;
    return preByCode || preByInfo || preByStatus;
  };

  return coupon.filter((pick) => {
    const start = Number(pick?.startTimeUnix || 0);
    if (isPreMatchBySignals(pick)) return false;
    if (!Number.isFinite(start) || start <= 0) return false;
    const hasStatusSignals =
      Number(pick?.statusCode || 0) > 0 ||
      String(pick?.infoText || "").trim().length > 0 ||
      String(pick?.statusText || "").trim().length > 0 ||
      String(pick?.phase || "").trim().length > 0;
    if (!hasStatusSignals) {
      const diffSec = nowSec - start;
      // Tolerance when upstream status signals are missing.
      if (diffSec >= 0 && diffSec <= 15 * 60) return false;
    }
    return start <= nowSec;
  });
}

function buildPrintableCouponHtml(payload = {}) {
  const coupon = Array.isArray(payload.coupon) ? payload.coupon : [];
  const summary = payload.summary || {};
  const riskProfile = String(payload.riskProfile || "balanced");
  const generatedAt = formatDateTime(new Date());
  const combinedOdd = formatOddForTelegram(summary.combinedOdd);
  const avgConf = Number(summary.averageConfidence) || 0;

  const shareText = [
    "FC25 Coupon",
    `Date ${generatedAt}`,
    `Profil ${riskProfile}`,
    `Cote ${combinedOdd}`,
    ...coupon.slice(0, 8).map((p, i) => `${i + 1}. ${p?.teamHome || "Equipe 1"} vs ${p?.teamAway || "Equipe 2"} | ${p?.pari || "-"} | ${formatOddForTelegram(p?.cote)}`),
  ].join(" | ");
  const qrUrl = `https://quickchart.io/qr?size=190&text=${encodeURIComponent(shareText)}`;

  const rows = coupon
    .map((p, i) => {
      const home = escapeXml(p?.teamHome || "Equipe 1");
      const away = escapeXml(p?.teamAway || "Equipe 2");
      const league = escapeXml(p?.league || "Non specifiee");
      const pari = escapeXml(p?.pari || "-");
      const odd = formatOddForTelegram(p?.cote);
      const conf = Number(p?.confiance) || 0;
      const startAt = escapeXml(formatMatchStartTimeUnix(p?.startTimeUnix));
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${home} vs ${away}</td>
          <td>${league}</td>
          <td>${startAt}</td>
          <td>${pari}</td>
          <td>${odd}</td>
          <td>${conf.toFixed(1)}%</td>
        </tr>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Coupon A4 FC25</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f1a2f; background: #fff; }
    .wrap { width: 100%; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
    .title { font-size: 24px; font-weight: 800; margin: 0 0 4px; }
    .sub { margin: 0; font-size: 13px; color: #324868; line-height: 1.4; }
    .qr { border: 1px solid #d5deea; border-radius: 8px; padding: 8px; }
    .meta { margin: 10px 0 14px; display: flex; gap: 12px; flex-wrap: wrap; font-size: 12px; color: #31486a; }
    .pill { border: 1px solid #d0daea; border-radius: 999px; padding: 4px 10px; background: #f6f9ff; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d7e0ec; padding: 7px; text-align: left; vertical-align: top; }
    th { background: #eef4ff; color: #1b355d; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    tbody tr:nth-child(even) { background: #fbfdff; }
    .foot { margin-top: 12px; font-size: 11px; color: #4c607d; display: flex; justify-content: space-between; }
    .print-btn { margin-top: 12px; padding: 8px 12px; border: 0; background: #123b7a; color: white; border-radius: 6px; font-weight: 700; }
    @media print { .print-btn { display: none; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <h1 class="title">SOLITFIFPRO225 Coupon Ticket A4</h1>
        <p class="sub">Genere le ${escapeXml(generatedAt)}</p>
        <p class="sub">Signe: SOLITAIRE HACK</p>
      </div>
      <div class="qr">
        <img src="${qrUrl}" width="160" height="160" alt="QR Coupon"/>
      </div>
    </div>
    <div class="meta">
      <span class="pill">Profil: ${escapeXml(riskProfile)}</span>
      <span class="pill">Selections: ${Number(summary.totalSelections) || coupon.length}</span>
      <span class="pill">Cote combinee: ${combinedOdd}</span>
      <span class="pill">Confiance moyenne: ${avgConf.toFixed(1)}%</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Match</th>
          <th>Ligue</th>
          <th>Heure match</th>
          <th>Pari</th>
          <th>Cote</th>
          <th>Confiance</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="foot">
      <span>Document interne ticket</span>
      <span>Aucune combinaison n'est garantie gagnante</span>
    </div>
    <button class="print-btn" onclick="window.print()">Imprimer</button>
  </div>
</body>
</html>`;
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
    try {
      saveCouponGeneration({
        size,
        league,
        risk,
        source: API_URL,
        summary: coupon?.summary || {},
        coupon: Array.isArray(coupon?.coupon) ? coupon.coupon : [],
      });
    } catch (_dbError) {}
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
    try {
      saveCouponValidation({
        driftThreshold: driftThresholdPercent,
        status: "ok",
        request: req.body || {},
        report,
      });
    } catch (_dbError) {}
    res.json({ success: true, source: API_URL, ...report });
  } catch (error) {
    try {
      saveCouponValidation({
        driftThreshold: Number(req.body?.driftThresholdPercent) || 6,
        status: "error",
        request: req.body || {},
        report: {},
        error: error.message,
      });
    } catch (_dbError) {}
    res.status(500).json({
      success: false,
      message: "Impossible de valider le ticket coupon.",
      error: error.message,
    });
  }
});

app.get("/api/db/status", (_req, res) => {
  try {
    return res.json({ success: true, db: getDbStatus() });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de lire le statut DB.",
      error: error.message,
    });
  }
});

app.get("/api/coupon/history", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const items = getCouponHistory(limit);
    return res.json({
      success: true,
      total: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de lire l'historique des coupons.",
      error: error.message,
    });
  }
});

app.get("/api/telegram/history", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const items = getTelegramHistory(limit);
    return res.json({
      success: true,
      total: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de lire l'historique Telegram.",
      error: error.message,
    });
  }
});

app.get("/api/audit/history", (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const items = getAuditHistory(limit);
    return res.json({
      success: true,
      total: items.length,
      items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de lire l'historique audit.",
      error: error.message,
    });
  }
});

app.post("/api/coupon/audit", (req, res) => {
  try {
    const now = new Date();
    const auditId =
      String(req.body?.auditId || "").trim() ||
      `AUD-${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}-${String(
        now.getUTCHours()
      ).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}-${Math.floor(
        Math.random() * 9000 + 1000
      )}`;
    const saved = saveAuditReport({
      auditId,
      action: req.body?.action || "coupon_export_pro",
      payload: req.body?.payload || {},
      result: req.body?.result || {},
    });
    return res.json({
      success: true,
      auditId: saved.auditId,
      id: saved.id,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Impossible de sauvegarder l'audit.",
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
    const isPremium = mode === "premium" || mode === "pro";
    const requested = req.body?.format || req.query?.format || (isStory ? "jpg" : "png");
    const format = normalizeImageFormat(requested, isStory ? "jpg" : "png");
    const svg = isStory
      ? buildCouponStorySvg(req.body || {})
      : isPremium
      ? buildCouponPremiumSvg(req.body || {})
      : buildCouponImageSvg(req.body || {});
    if (format === "svg") {
      const filename = `coupon-fc25-${isStory ? "story" : isPremium ? "premium" : "image"}-${Date.now()}.svg`;
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(svg);
    }
    const output = await rasterizeSvg(svg, format);
    const ext = format === "jpg" ? "jpg" : "png";
    const filename = `coupon-fc25-${isStory ? "story" : isPremium ? "premium" : "image"}-${Date.now()}.${ext}`;
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
app.post("/api/coupon/image/premium", (req, res) =>
  generateCouponImageHandler(
    { ...req, body: { ...(req.body || {}), mode: "premium", format: req.body?.format || "png" } },
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
        "Coupon image - SOLITFIFPRO225 | Signe: SOLITAIRE HACK"
      );
      try {
        saveTelegramLog({
          kind: "coupon_image",
          status: "sent",
          message: "Coupon image envoye sur Telegram",
          payload: req.body || {},
          response: { telegramMessageId: photoId, chatId },
        });
      } catch (_dbError) {}
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
      try {
        saveTelegramLog({
          kind: "coupon_text",
          status: "error",
          message: "Echec envoi Telegram",
          payload: req.body || {},
          response: telegramData || {},
          error: telegramData?.description || "API Telegram indisponible.",
        });
      } catch (_dbError) {}
      return res.status(502).json({
        success: false,
        message: "Echec envoi Telegram.",
        error: telegramData?.description || "API Telegram indisponible.",
      });
    }

    try {
      saveTelegramLog({
        kind: "coupon_text",
        status: "sent",
        message: "Coupon texte envoye sur Telegram",
        payload: req.body || {},
        response: { telegramMessageId: telegramData?.result?.message_id || null, chatId },
      });
    } catch (_dbError) {}
    return res.json({
      success: true,
      message: "Coupon envoye sur Telegram.",
      telegramMessageId: telegramData?.result?.message_id || null,
    });
  } catch (error) {
    try {
      saveTelegramLog({
        kind: "coupon_text",
        status: "error",
        message: "Impossible d'envoyer le coupon sur Telegram",
        payload: req.body || {},
        response: {},
        error: error.message,
      });
    } catch (_dbError) {}
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
      "Coupon image - SOLITFIFPRO225 | Signe: SOLITAIRE HACK"
    );

    const pdf = buildCouponPdfBuffer(req.body || {}, "quick");
    const pdfMessageId = await sendTelegramDocument(
      botToken,
      chatId,
      new Blob([pdf], { type: "application/pdf" }),
      `coupon-fc25-rapide-${Date.now()}.pdf`,
      "Coupon PDF rapide - SOLITFIFPRO225"
    );

    try {
      saveTelegramLog({
        kind: "coupon_pack",
        status: "sent",
        message: "Pack Telegram envoye (texte + image + PDF)",
        payload: req.body || {},
        response: {
          chatId,
          textMessageId: textData?.result?.message_id || null,
          imageMessageId,
          pdfMessageId,
        },
      });
    } catch (_dbError) {}
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
    try {
      saveTelegramLog({
        kind: "coupon_pack",
        status: "error",
        message: "Impossible d'envoyer le pack Telegram",
        payload: req.body || {},
        response: {},
        error: error.message,
      });
    } catch (_dbError) {}
    return res.status(500).json({
      success: false,
      message: "Impossible d'envoyer le pack Telegram.",
      error: error.message,
    });
  }
}

function buildTelegramLadderText(payload = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const totalStake = Number(payload?.totalStake || 0);
  const lines = [
    "COUPON LADDER IA (60/30/10)",
    `Total mise: ${Number.isFinite(totalStake) ? totalStake.toFixed(0) : "0"}`,
    "",
  ];
  items.forEach((it, idx) => {
    const picks = Array.isArray(it?.coupon) ? it.coupon : [];
    const summary = it?.summary || {};
    lines.push(
      `${idx + 1}. ${String(it?.label || it?.profile || "TICKET").toUpperCase()} | Mise ${Number(it?.stake || 0).toFixed(0)} | Cote ${formatOddForTelegram(
        summary?.combinedOdd
      )} | Selections ${Number(summary?.totalSelections || picks.length)}`
    );
    picks.slice(0, 4).forEach((p, i) => {
      lines.push(
        `   ${i + 1}) ${p?.teamHome || "Equipe 1"} vs ${p?.teamAway || "Equipe 2"} | ${p?.pari || "-"} | ${formatOddForTelegram(p?.cote)}`
      );
    });
    lines.push("");
  });
  lines.push("Aucune combinaison n'est garantie gagnante. Gestion de risque obligatoire.");
  lines.push("Signe: SOLITAIRE HACK");
  return lines.join("\n");
}

async function sendTelegramLadderHandler(req, res) {
  try {
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
    if (!botToken) {
      return res.status(500).json({
        success: false,
        message: "Configuration Telegram manquante (TELEGRAM_BOT_TOKEN).",
      });
    }
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({
        success: false,
        message: "Ladder vide. Genere d'abord les 3 tickets.",
      });
    }
    const allPicks = items.flatMap((it) => (Array.isArray(it?.coupon) ? it.coupon : []));
    const started = getStartedSelections(allPicks);
    if (started.length) {
      return res.status(400).json({
        success: false,
        message: "Envoi Ladder bloque: un ou plusieurs matchs ont deja demarre.",
      });
    }
    const chatId = await resolveTelegramChatId(botToken);
    const text = buildTelegramLadderText(req.body || {});
    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const data = await telegramRes.json();
    if (!telegramRes.ok || !data?.ok) {
      try {
        saveTelegramLog({
          kind: "ladder_text",
          status: "error",
          message: "Echec envoi Ladder Telegram",
          payload: req.body || {},
          response: data || {},
          error: data?.description || "API Telegram indisponible.",
        });
      } catch (_dbError) {}
      return res.status(502).json({
        success: false,
        message: "Echec envoi Ladder Telegram.",
        error: data?.description || "API Telegram indisponible.",
      });
    }
    try {
      saveTelegramLog({
        kind: "ladder_text",
        status: "sent",
        message: "Ladder envoye sur Telegram",
        payload: req.body || {},
        response: { telegramMessageId: data?.result?.message_id || null, chatId },
      });
    } catch (_dbError) {}
    return res.json({
      success: true,
      message: "Ladder envoye sur Telegram.",
      telegramMessageId: data?.result?.message_id || null,
    });
  } catch (error) {
    try {
      saveTelegramLog({
        kind: "ladder_text",
        status: "error",
        message: "Impossible d'envoyer le Ladder sur Telegram",
        payload: req.body || {},
        response: {},
        error: error.message,
      });
    } catch (_dbError) {}
    return res.status(500).json({
      success: false,
      message: "Impossible d'envoyer le Ladder sur Telegram.",
      error: error.message,
    });
  }
}

app.post("/api/coupon/send-telegram", sendTelegramCouponHandler);
app.post("/api/telegram/send-coupon", sendTelegramCouponHandler);
app.post("/api/send-telegram", sendTelegramCouponHandler);
app.post("/api/coupon/send-telegram-pack", sendTelegramCouponPackHandler);
app.post("/api/coupon/ladder/send-telegram", sendTelegramLadderHandler);

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

function extractSlokText(raw) {
  if (!raw || typeof raw !== "object") return "";
  return (
    raw?.response?.text ||
    raw?.response?.message ||
    raw?.text ||
    raw?.message ||
    ""
  )
    .toString()
    .trim();
}

function buildAnthropicEndpointCandidates(baseUrl) {
  const base = trimTrailingSlash(baseUrl);
  if (!base) return [];
  const list = [];
  const push = (u) => {
    if (u && !list.includes(u)) list.push(u);
  };

  if (base.endsWith("/messages")) {
    push(base);
    return list;
  }

  push(`${base}/v1/messages`);
  push(`${base}/messages`);

  if (base.includes("/cliproxy-api/api/provider/")) {
    push(base);
    push(`${base}/messages`);
    push(`${base}/v1/messages`);
  } else {
    push(`${base}/cliproxy-api/api/provider/agy`);
    push(`${base}/cliproxy-api/api/provider/agy/messages`);
    push(`${base}/cliproxy-api/api/provider/agy/v1/messages`);
  }

  return list;
}

async function parseResponseSafe(response) {
  const rawText = await response.text();
  let json = null;
  if (rawText && rawText.trim()) {
    try {
      json = JSON.parse(rawText);
    } catch (_e) {
      json = null;
    }
  }
  return { text: rawText || "", json };
}

async function requestAnthropicChat({ baseUrl, apiKey, model, systemPrompt, userPrompt }) {
  const endpointCandidates = buildAnthropicEndpointCandidates(baseUrl);
  const errors = [];

  for (const endpoint of endpointCandidates) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "x-auth-token": apiKey,
          "anthropic-api-key": apiKey,
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
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const parsed = await parseResponseSafe(response);
      const raw = parsed.json;
      if (!response.ok) {
        const msg =
          raw?.error?.message ||
          raw?.message ||
          (parsed.text.startsWith("<!DOCTYPE") || parsed.text.startsWith("<html")
            ? "Reponse HTML recue (endpoint non API). Use /v1/ or /cliproxy-api/ endpoints"
            : parsed.text.slice(0, 180)) ||
          `HTTP ${response.status}`;
        errors.push(`${endpoint} -> ${msg}`);
        continue;
      }

      if (!raw) {
        errors.push(`${endpoint} -> reponse non-JSON recue.`);
        continue;
      }

      const answer = extractAnthropicText(raw);
      if (!answer) {
        errors.push(`${endpoint} -> reponse Anthropic vide.`);
        continue;
      }
      return { answer, model };
    } catch (error) {
      errors.push(`${endpoint} -> ${error.message}`);
    }
  }

  throw new Error(errors.filter(Boolean).join(" | ") || "Erreur Anthropic");
}

async function requestOpenAICompatChat({ baseUrl, apiKey, model, systemPrompt, userPrompt }) {
  const root = trimTrailingSlash(trimText(baseUrl || "", 500));
  if (!root) throw new Error("base URL vide");
  const url = `${root}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 800,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const parsed = await parseResponseSafe(response);
  const raw = parsed.json;
  if (!response.ok) {
    const msg =
      raw?.error?.message ||
      (typeof raw?.error === "string" ? raw.error : null) ||
      parsed.text.slice(0, 180) ||
      `HTTP ${response.status}`;
    throw new Error(msg);
  }
  if (!raw) throw new Error("reponse non-JSON");
  const content = raw?.choices?.[0]?.message?.content;
  if (content == null || String(content).trim() === "") {
    throw new Error("reponse chat vide");
  }
  return { answer: String(content).trim(), model: raw?.model || model };
}

function buildSlokEndpointCandidates(baseUrl) {
  const base = trimTrailingSlash(baseUrl);
  const out = [];
  const push = (u) => {
    if (u && !out.includes(u)) out.push(u);
  };
  if (!base) return out;
  if (base.endsWith("/api/v2/chatgpt")) push(base);
  push(`${base}/api/v2/chatgpt`);
  if (base.includes("orbit-provider.com")) push("https://yellowfire.ru/api/v2/chatgpt");
  return out;
}

function slokRootFromChatEndpoint(endpoint) {
  const e = trimTrailingSlash(endpoint);
  if (e.endsWith("/api/v2/chatgpt")) return e.slice(0, -"/api/v2/chatgpt".length);
  return e;
}

async function requestSlokChat({ baseUrl, apiKey, model, systemPrompt, userPrompt }) {
  const endpointCandidates = buildSlokEndpointCandidates(baseUrl);
  const errors = [];
  for (const endpoint of endpointCandidates) {
    try {
      const mergedPrompt = [systemPrompt, userPrompt].filter(Boolean).join("\n\n");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt: mergedPrompt,
          chat_history: [],
          file_base64: "",
          internet_access: false,
          mime_type: "",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const parsed = await parseResponseSafe(response);
      if (!response.ok) {
        const msg =
          parsed.json?.error?.message ||
          parsed.json?.message ||
          parsed.text.slice(0, 180) ||
          `HTTP ${response.status}`;
        errors.push(`${endpoint} -> ${msg}`);
        continue;
      }
      const start = parsed.json;
      if (!start) {
        errors.push(`${endpoint} -> reponse non-JSON recue.`);
        continue;
      }
      if (start?.error) {
        errors.push(`${endpoint} -> ${start.error}`);
        continue;
      }
      const requestId = start?.request_id;
      if (!requestId) {
        const directAnswer = extractSlokText(start);
        if (directAnswer) return { answer: directAnswer, model };
        errors.push(`${endpoint} -> request_id absent.`);
        continue;
      }

      const waitSec = Math.max(0.1, Number(start?.wait || 1));
      await new Promise((r) => setTimeout(r, Math.round(waitSec * 1000)));
      const statusEndpoint = `${slokRootFromChatEndpoint(endpoint)}/api/v2/status/${encodeURIComponent(requestId)}`;

      let answer = "";
      let statusErr = "";
      for (let i = 0; i < 80; i += 1) {
        const statusCtl = new AbortController();
        const statusTimer = setTimeout(() => statusCtl.abort(), 5000);
        const statusRes = await fetch(statusEndpoint, {
          method: "GET",
          headers: {
            "api-key": apiKey,
            Authorization: `Bearer ${apiKey}`,
          },
          signal: statusCtl.signal,
        });
        clearTimeout(statusTimer);
        const statusParsed = await parseResponseSafe(statusRes);
        const statusJson = statusParsed.json;
        if (!statusRes.ok) {
          statusErr = statusParsed.text.slice(0, 160) || `HTTP ${statusRes.status}`;
          break;
        }
        if (!statusJson) {
          statusErr = "status non-JSON";
          break;
        }
        if (statusJson?.error) {
          statusErr = String(statusJson.error);
          break;
        }
        answer = extractSlokText(statusJson);
        if (statusJson?.status === "success" && answer) {
          return { answer, model };
        }
        if (statusJson?.status === "failed") {
          statusErr = "status failed";
          break;
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      if (answer) return { answer, model };
      errors.push(`${statusEndpoint} -> ${statusErr || "timeout sans reponse"}`);
    } catch (error) {
      errors.push(`${endpoint} -> ${error.message}`);
    }
  }
  throw new Error(errors.filter(Boolean).join(" | ") || "Erreur Slok API");
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
    const historyInput = Array.isArray(req.body?.history) ? req.body.history : [];
    const chatHistory = historyInput
      .slice(-12)
      .map((m) => ({
        role: String(m?.role || "").toLowerCase() === "user" ? "user" : "assistant",
        text: trimText(m?.text || "", 600),
      }))
      .filter((m) => m.text);
    const page = trimText(req.body?.context?.page || "site", 80);
    const matchId = trimText(req.body?.context?.matchId || "", 60);
    const league = trimText(req.body?.context?.league || "", 120);
    const pageSnapshot = req.body?.context?.pageSnapshot || null;
    const pageActions = Array.isArray(req.body?.context?.capabilities?.actions)
      ? req.body.context.capabilities.actions.slice(0, 40).map((x) => trimText(x, 80))
      : [];

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message vide.",
      });
    }

    const siteKnowledge = buildSiteKnowledgeBlock();

    const systemPrompt =
      "Tu es SOLITAIRE AI, bras operationnel du site FIFA Virtual Predictions (SOLITFIFPRO225, signe SOLITAIRE HACK). " +
      "Tu as la main sur les actions securisees exposees par le site (navigation, refresh, generation coupon, exports PNG/JPG, PDF, Telegram, reglages) via le mecanisme d'actions renvoye par le serveur. " +
      "Reponds en francais, ton premium et clair (1 a 5 phrases). " +
      "Priorite: guider vers une action concrete (bouton ou phrase declencheur) plutot que du blabla. " +
      "Reste centre sur le site: matchs, cotes, coupon, risque, validation, exports PNG et JPG, Telegram, impression. " +
      "Si la question derape, recadre vers une fonction du site. " +
      "Quand on te demande si tu vois la page, reponds OUI et cite le snapshot (titres, selections, boutons). " +
      "Tu ne promets jamais un gain garanti.\n\n" +
      siteKnowledge;

    const runtimeContext = await buildDynamicRuntimeContext({ page, league, matchId });

    const userPrompt = [
      "Mode: assistant operationnel site uniquement. Priorite execution et reponse precise.",
      chatHistory.length
        ? `Historique conversation recente:\n${chatHistory
            .map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"}: ${m.text}`)
            .join("\n")}`
        : "",
      `Contexte runtime:\n${runtimeContext}`,
      `Contexte page: ${page}`,
      matchId ? `Match ID: ${matchId}` : "",
      league ? `Ligue: ${league}` : "",
      pageSnapshot ? `Snapshot page: ${JSON.stringify(pageSnapshot).slice(0, 2500)}` : "",
      pageActions.length ? `Actions page disponibles: ${pageActions.join(", ")}` : "",
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
    const openaiCompatBaseUrl = trimText(
      process.env.OPENAI_COMPAT_BASE_URL || process.env.THE_OLD_API_BASE_URL || "",
      500
    );
    const openaiCompatKey = trimText(
      process.env.OPENAI_COMPAT_API_KEY || process.env.THE_OLD_API_KEY || "",
      500
    );
    const openaiCompatModel = trimText(
      process.env.OPENAI_COMPAT_MODEL || process.env.THE_OLD_MODEL || "gpt-4o",
      120
    );
    const openaiCompatFirst =
      String(process.env.OPENAI_COMPAT_FIRST || process.env.THE_OLD_FIRST || "0").trim() === "1";
    const errors = [];
    const attempted = [];
    const actions = deriveControlActions(message, {
      page,
      league,
      matchId,
      capabilities: { actions: pageActions },
      pageSnapshot,
    });

    const finishRemote = (provider, result) => {
      let answer = result.answer;
      if (isRefusalAnswer(answer) && !isSiteQuestion(message)) {
        answer = localGeneralAnswer(message);
      }
      return res.json({
        success: true,
        provider,
        model: result.model,
        tried: [...attempted, provider],
        answer,
        actions,
      });
    };

    if (openaiCompatFirst && openaiCompatBaseUrl && openaiCompatKey) {
      attempted.push("openai-compat");
      try {
        const result = await withTimeout(
          requestOpenAICompatChat({
            baseUrl: openaiCompatBaseUrl,
            apiKey: openaiCompatKey,
            model: openaiCompatModel,
            systemPrompt,
            userPrompt,
          }),
          CHAT_PROVIDER_TIMEOUT_MS,
          null
        );
        if (!result) throw new Error("Timeout provider OpenAI-compat.");
        return finishRemote("openai-compat", result);
      } catch (error) {
        errors.push(`OpenAI-compat: ${error.message}`);
      }
    }

    if (anthropicBaseUrl && anthropicKey) {
      attempted.push("anthropic");
      try {
        const result = await withTimeout(
          requestAnthropicChat({
            baseUrl: anthropicBaseUrl,
            apiKey: anthropicKey,
            model: anthropicModel,
            systemPrompt,
            userPrompt,
          }),
          CHAT_PROVIDER_TIMEOUT_MS,
          null
        );
        if (!result) throw new Error("Timeout provider Anthropic.");
        return finishRemote("anthropic", result);
      } catch (error) {
        errors.push(`Anthropic: ${error.message}`);
      }

      attempted.push("slok");
      try {
        const slokResult = await withTimeout(
          requestSlokChat({
            baseUrl: anthropicBaseUrl,
            apiKey: anthropicKey,
            model: anthropicModel,
            systemPrompt,
            userPrompt,
          }),
          CHAT_PROVIDER_TIMEOUT_MS,
          null
        );
        if (!slokResult) throw new Error("Timeout provider Slok.");
        return finishRemote("slok", slokResult);
      } catch (error) {
        errors.push(`Slok: ${error.message}`);
      }
    } else {
      errors.push("Anthropic: configuration absente.");
    }

    if (!openaiCompatFirst && openaiCompatBaseUrl && openaiCompatKey) {
      attempted.push("openai-compat");
      try {
        const result = await withTimeout(
          requestOpenAICompatChat({
            baseUrl: openaiCompatBaseUrl,
            apiKey: openaiCompatKey,
            model: openaiCompatModel,
            systemPrompt,
            userPrompt,
          }),
          CHAT_PROVIDER_TIMEOUT_MS,
          null
        );
        if (!result) throw new Error("Timeout provider OpenAI-compat.");
        return finishRemote("openai-compat", result);
      } catch (error) {
        errors.push(`OpenAI-compat: ${error.message}`);
      }
    }

    attempted.push("local-fallback");
    return res.json({
      success: true,
      provider: "local-fallback",
      model: "local-fallback",
      tried: attempted,
      answer: `${
        isSiteQuestion(message)
          ? localChatFallback(message, { page, league, matchId })
          : localGeneralAnswer(message)
      }\n\n[Info technique: ${errors.join(" | ")}]`,
      actions,
    });
  } catch (error) {
    res.json({
      success: true,
      provider: "local-fallback",
      model: "local-fallback",
      answer: `${
        isSiteQuestion(req.body?.message)
          ? localChatFallback(req.body?.message, req.body?.context)
          : localGeneralAnswer(req.body?.message)
      }\n\n[Info technique: ${error.message}]`,
      actions: deriveControlActions(req.body?.message, req.body?.context || {}),
    });
  }
});

app.post("/api/coupon/print-a4", (req, res) => {
  try {
    const coupon = Array.isArray(req.body?.coupon) ? req.body.coupon : [];
    if (!coupon.length) {
      return res.status(400).send("Coupon vide.");
    }
    const html = buildPrintableCouponHtml(req.body || {});
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (error) {
    return res.status(500).send(`Erreur impression: ${error.message}`);
  }
});

app.get("/api/chat", (_req, res) => {
  const anthropicModel =
    process.env.ANTHROPIC_MODEL ||
    process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ||
    process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ||
    null;
  const openaiCompatBase =
    process.env.OPENAI_COMPAT_BASE_URL || process.env.THE_OLD_API_BASE_URL || null;
  const openaiCompatKeyEnv =
    process.env.OPENAI_COMPAT_API_KEY || process.env.THE_OLD_API_KEY || "";
  const openaiCompatEnabled = Boolean(openaiCompatBase && openaiCompatKeyEnv);
  const openaiCompatModel =
    process.env.OPENAI_COMPAT_MODEL ||
    process.env.THE_OLD_MODEL ||
    (openaiCompatEnabled ? "gpt-4o" : null);
  const openaiCompatFirst =
    String(process.env.OPENAI_COMPAT_FIRST || process.env.THE_OLD_FIRST || "0").trim() === "1";
  const priority = openaiCompatFirst
    ? ["openai-compat", "anthropic", "slok", "local-fallback"]
    : ["anthropic", "slok", "openai-compat", "local-fallback"];
  res.json({
    success: true,
    message: "Route chat active. Utilise POST /api/chat avec { message, context }.",
    providerPriority: priority,
    openaiCompat: {
      enabled: openaiCompatEnabled,
      model: openaiCompatModel,
      baseUrl: openaiCompatBase,
      first: openaiCompatFirst,
      modelsListUrl:
        process.env.OPENAI_COMPAT_MODELS_URL || process.env.THE_OLD_MODELS_URL || null,
    },
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

