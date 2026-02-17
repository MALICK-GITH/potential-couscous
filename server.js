const express = require("express");
const path = require("path");
const { API_URL, getPenaltyMatches, getStructure, getMatchPredictionDetails, getCouponSelection } = require("./services/liveFeed");

const app = express();
const DEFAULT_PORT = Number(process.env.PORT) || 3029;
const MAX_PORT_TRIES = 20;

app.use(express.static(path.join(__dirname, "public")));

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
    const coupon = await getCouponSelection(size, league);
    res.json({ success: true, source: API_URL, ...coupon });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Impossible de generer le coupon optimise.",
      error: error.message,
    });
  }
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
