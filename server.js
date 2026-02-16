const express = require('express');
const path = require('path');
const config = require('./config');
const { fetchVirtualMatches, isPenaltyMatch } = require('./services/apiService');
const { predict, getUltimatePredictions } = require('./services/predictionService');
const { getAlternativePredictionsOnly } = require('./services/alternativePredictionService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Route API - Matches penalty FIFA
app.get('/api/fifa-penalty', async (req, res) => {
  try {
    const events = await fetchVirtualMatches(config.sports.fifa.id);
    const penaltyMatches = events.filter((e) =>
      isPenaltyMatch(e, config.sports.fifa.keywords)
    );
    const toUse = penaltyMatches.length > 0 ? penaltyMatches : events;
    const results = toUse.map((event) => ({
      id: event.I,
      team1: event.O1,
      team2: event.O2,
      league: event.L,
      status: event.SC,
      startTime: event.S,
      prediction: predict(event),
    }));
    res.json({ success: true, data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tous les matchs virtuels FIFA (fallback si peu de penalty)
app.get('/api/all-virtual', async (req, res) => {
  try {
    const events = await fetchVirtualMatches(config.sports.fifa.id);
    const results = events.map((e) => ({
      ...formatMatch(e, predict(e)),
      sport: 'FIFA',
    }));
    res.json({ success: true, data: results, total: results.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const MATCH_DURATION_SEC = (config.prediction?.matchDurationMinutes || 7) * 60;

function formatMatch(event, pred) {
  const startTime = event.S ? parseInt(event.S, 10) : null;
  const endTime = startTime ? startTime + MATCH_DURATION_SEC : null;
  return {
    id: event.I,
    team1: event.O1,
    team2: event.O2,
    league: event.L,
    status: event.SC,
    startTime,
    endTime,
    prediction: pred,
    ultimatePredictions: getUltimatePredictions(event),
    alternativePredictions: getAlternativePredictionsOnly(event),
    raw: event,
  };
}

app.get('/api/match/:id', async (req, res) => {
  try {
    const events = await fetchVirtualMatches(config.sports.fifa.id);
    const event = events.find((e) => String(e.I) === String(req.params.id));
    if (!event) {
      return res.status(404).json({ success: false, error: 'Match introuvable' });
    }
    const formatted = {
      ...formatMatch(event, predict(event)),
      sport: 'FIFA',
    };
    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/match', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'match.html'));
});

app.listen(PORT, () => {
  console.log(`\n Penalty Predictor - FIFA`);
  console.log(` http://localhost:${PORT}\n`);
});
