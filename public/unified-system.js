// Unified System - All-in-One Match Selector, Master Controller, and AI Coupon Generator
class UnifiedSystem {
  constructor() {
    this.currentRole = null;
    this.selectedMatches = new Set();
    this.masterData = {
      totalMatches: 0,
      activeCoupons: 0,
      systemStatus: 'ready',
      lastUpdate: new Date()
    };
    this.aiData = {
      isProcessing: false,
      progress: 0,
      currentStep: '',
      generatedCoupons: []
    };
    
    this.init();
  }

  init() {
    console.log('🎯 Unified System Initializing...');
    
    // Setup UI
    this.setupUI();
    
    // Setup role switching
    this.setupRoleSwitching();
    
    // Setup match selector
    this.setupMatchSelector();
    
    // Setup master controller
    this.setupMasterController();
    
    // Setup AI coupon generator
    this.setupAICouponGenerator();
    
    // Setup real-time updates
    this.setupRealTimeUpdates();
    
    // Setup data synchronization
    this.setupDataSync();
    
    console.log('✅ Unified System Ready');
  }

  setupUI() {
    // Create unified interface
    this.createUnifiedInterface();
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Initialize status indicators
    this.initializeStatusIndicators();
  }

  createUnifiedInterface() {
    const mainContent = document.querySelector('main') || document.body;
    
    // Create master panel
    const masterPanel = document.createElement('div');
    masterPanel.className = 'unified-master-panel';
    masterPanel.innerHTML = `
      <div class="master-header">
        <h2>🎯 Système Unifié FIFA PRO</h2>
        <p>Sélecteur de Matchs • Maître du Système • Générateur IA</p>
      </div>
      
      <div class="role-selector">
        <div class="role-card" data-role="selector">
          <div class="role-icon">🔍</div>
          <div class="role-title">Sélecteur de Matchs</div>
          <div class="role-description">Trouver et analyser les meilleurs matchs FIFA</div>
        </div>
        
        <div class="role-card" data-role="master">
          <div class="role-icon">👑</div>
          <div class="role-title">Maître du Système</div>
          <div class="role-description">Contrôler et monitorer toute la plateforme</div>
        </div>
        
        <div class="role-card" data-role="ai-coupon">
          <div class="role-icon">🤖</div>
          <div class="role-title">Générateur IA</div>
          <div class="role-description">Créer des coupons optimisés avec l'IA</div>
        </div>
      </div>
      
      <div class="unified-controls">
        <div class="control-group">
          <label class="control-label">Mode de fonctionnement</label>
          <select class="control-select" id="operationMode">
            <option value="manual">Manuel</option>
            <option value="semi-auto">Semi-Automatique</option>
            <option value="full-auto">Automatique</option>
          </select>
        </div>
        
        <div class="control-group">
          <label class="control-label">Niveau de confiance minimal</label>
          <input type="range" class="control-input" id="minConfidence" min="0" max="100" value="65">
          <span id="confidenceValue">65%</span>
        </div>
        
        <div class="control-group">
          <label class="control-label">Fréquence de mise à jour (minutes)</label>
          <input type="number" class="control-input" id="updateFrequency" min="1" max="60" value="5">
        </div>
      </div>
      
      <div class="unified-actions">
        <button class="unified-btn primary" id="startSystem">Démarrer le Système</button>
        <button class="unified-btn" id="syncData">Synchroniser les Données</button>
        <button class="unified-btn" id="exportResults">Exporter les Résultats</button>
        <button class="unified-btn" id="systemSettings">Paramètres</button>
      </div>
    `;
    
    mainContent.appendChild(masterPanel);
    
    // Create role-specific interfaces
    this.createRoleInterfaces(mainContent);
  }

  createRoleInterfaces(mainContent) {
    // Match Selector Interface
    const selectorInterface = document.createElement('div');
    selectorInterface.className = 'match-selector-interface';
    selectorInterface.innerHTML = `
      <h3>🔍 Sélecteur de Matchs</h3>
      
      <div class="match-filters">
        <div class="control-group">
          <label class="control-label">Ligue</label>
          <select class="control-select" id="selectorLeague">
            <option value="all">Toutes les ligues</option>
            <option value="premier">Premier League</option>
            <option value="laliga">La Liga</option>
            <option value="bundesliga">Bundesliga</option>
            <option value="seriea">Serie A</option>
          </select>
        </div>
        
        <div class="control-group">
          <label class="control-label">Type de match</label>
          <select class="control-select" id="matchType">
            <option value="all">Tous les matchs</option>
            <option value="live">En direct</option>
            <option value="upcoming">À venir</option>
            <option value="finished">Terminés</option>
          </select>
        </div>
        
        <div class="control-group">
          <label class="control-label">Cotes minimales</label>
          <input type="number" class="control-input" id="minOdds" min="1" max="10" step="0.1" value="1.5">
        </div>
        
        <div class="control-group">
          <label class="control-label">Fenêtre de temps (heures)</label>
          <input type="number" class="control-input" id="timeWindow" min="1" max="48" value="6">
        </div>
      </div>
      
      <div class="unified-actions">
        <button class="unified-btn" id="searchMatches">Rechercher</button>
        <button class="unified-btn" id="filterMatches">Filtrer</button>
        <button class="unified-btn" id="selectBest">Sélectionner les Meilleurs</button>
        <button class="unified-btn primary" id="sendToAI">Envoyer à l'IA</button>
      </div>
      
      <div class="match-grid" id="matchGrid">
        <!-- Matches will be populated here -->
      </div>
    `;
    
    // Master Controller Interface
    const masterInterface = document.createElement('div');
    masterInterface.className = 'master-interface';
    masterInterface.innerHTML = `
      <h3>👑 Maître du Système</h3>
      
      <div class="master-dashboard">
        <div class="dashboard-card">
          <div class="dashboard-title">Matchs Actifs</div>
          <div class="dashboard-value" id="activeMatches">0</div>
        </div>
        
        <div class="dashboard-card">
          <div class="dashboard-title">Coupons Générés</div>
          <div class="dashboard-value" id="generatedCoupons">0</div>
        </div>
        
        <div class="dashboard-card">
          <div class="dashboard-title">Taux de Succès</div>
          <div class="dashboard-value" id="successRate">0%</div>
        </div>
        
        <div class="dashboard-card">
          <div class="dashboard-title">Statut Système</div>
          <div class="dashboard-value" id="systemStatus">Prêt</div>
        </div>
      </div>
      
      <div class="unified-controls">
        <div class="control-group">
          <label class="control-label">Mode de surveillance</label>
          <select class="control-select" id="monitoringMode">
            <option value="passive">Passif</option>
            <option value="active">Actif</option>
            <option value="aggressive">Agressif</option>
          </select>
        </div>
        
        <div class="control-group">
          <label class="control-label">Alertes automatiques</label>
          <select class="control-select" id="alertMode">
            <option value="off">Désactivées</option>
            <option value="important">Important seulement</option>
            <option value="all">Toutes</option>
          </select>
        </div>
      </div>
      
      <div class="master-controls">
        <button class="unified-btn" id="scanSystem">Scanner le Système</button>
        <button class="unified-btn" id="optimizePerformance">Optimiser</button>
        <button class="unified-btn" id="backupData">Sauvegarder</button>
        <button class="unified-btn primary" id="emergencyStop">Arrêt d'Urgence</button>
      </div>
    `;
    
    // AI Coupon Interface
    const aiInterface = document.createElement('div');
    aiInterface.className = 'ai-coupon-interface';
    aiInterface.innerHTML = `
      <h3>🤖 Générateur IA de Coupons</h3>
      
      <div class="ai-controls">
        <div class="control-group">
          <label class="control-label">Stratégie IA</label>
          <select class="control-select" id="aiStrategy">
            <option value="conservative">Conservatrice</option>
            <option value="balanced">Équilibrée</option>
            <option value="aggressive">Agressive</option>
            <option value="adaptive">Adaptative</option>
          </select>
        </div>
        
        <div class="control-group">
          <label class="control-label">Nombre de matchs</label>
          <input type="number" class="control-input" id="aiMatchCount" min="1" max="12" value="4">
        </div>
        
        <div class="control-group">
          <label class="control-label">Mode d'apprentissage</label>
          <select class="control-select" id="learningMode">
            <option value="historical">Historique</option>
            <option value="real-time">Temps réel</option>
            <option value="hybrid">Hybride</option>
          </select>
        </div>
        
        <div class="control-group">
          <label class="control-label">Facteur de risque</label>
          <input type="range" class="control-input" id="riskFactor" min="0" max="100" value="30">
          <span id="riskValue">30%</span>
        </div>
      </div>
      
      <div class="unified-actions">
        <button class="unified-btn" id="analyzeMatches">Analyser les Matchs</button>
        <button class="unified-btn" id="trainAI">Entraîner l'IA</button>
        <button class="unified-btn primary" id="generateAICoupons">Générer Coupons IA</button>
        <button class="unified-btn" id="optimizeAI">Optimiser l'IA</button>
      </div>
      
      <div class="ai-progress" id="aiProgress" style="display: none;">
        <div class="ai-progress-header">
          <div class="ai-progress-title">Traitement IA</div>
          <div class="ai-progress-percentage" id="aiProgressPercentage">0%</div>
        </div>
        <div class="ai-progress-bar">
          <div class="ai-progress-fill" id="aiProgressFill" style="width: 0%"></div>
        </div>
        <div class="ai-progress-details">
          <span id="aiProgressStep">Initialisation...</span>
          <span id="aiProgressTime">00:00</span>
        </div>
      </div>
      
      <div class="ai-results" id="aiResults">
        <!-- AI-generated coupons will appear here -->
      </div>
    `;
    
    mainContent.appendChild(selectorInterface);
    mainContent.appendChild(masterInterface);
    mainContent.appendChild(aiInterface);
  }

  setupRoleSwitching() {
    const roleCards = document.querySelectorAll('.role-card');
    
    roleCards.forEach(card => {
      card.addEventListener('click', () => {
        const role = card.dataset.role;
        this.switchRole(role);
      });
    });
  }

  switchRole(role) {
    // Update current role
    this.currentRole = role;
    
    // Update UI
    const roleCards = document.querySelectorAll('.role-card');
    roleCards.forEach(card => {
      card.classList.remove('active');
      if (card.dataset.role === role) {
        card.classList.add('active');
      }
    });
    
    // Hide all interfaces
    document.querySelectorAll('.match-selector-interface, .master-interface, .ai-coupon-interface').forEach(interface => {
      interface.classList.remove('active');
    });
    
    // Show relevant interface
    switch (role) {
      case 'selector':
        document.querySelector('.match-selector-interface').classList.add('active');
        this.startMatchSelector();
        break;
      case 'master':
        document.querySelector('.master-interface').classList.add('active');
        this.startMasterController();
        break;
      case 'ai-coupon':
        document.querySelector('.ai-coupon-interface').classList.add('active');
        this.startAICouponGenerator();
        break;
    }
    
    console.log(`🎯 Switched to role: ${role}`);
  }

  setupMatchSelector() {
    // Setup match search
    const searchBtn = document.getElementById('searchMatches');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        this.searchMatches();
      });
    }
    
    // Setup match filtering
    const filterBtn = document.getElementById('filterMatches');
    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        this.filterMatches();
      });
    }
    
    // Setup best selection
    const selectBestBtn = document.getElementById('selectBest');
    if (selectBestBtn) {
      selectBestBtn.addEventListener('click', () => {
        this.selectBestMatches();
      });
    }
    
    // Setup send to AI
    const sendToAIBtn = document.getElementById('sendToAI');
    if (sendToAIBtn) {
      sendToAIBtn.addEventListener('click', () => {
        this.sendMatchesToAI();
      });
    }
  }

  setupMasterController() {
    // Setup system scan
    const scanBtn = document.getElementById('scanSystem');
    if (scanBtn) {
      scanBtn.addEventListener('click', () => {
        this.scanSystem();
      });
    }
    
    // Setup performance optimization
    const optimizeBtn = document.getElementById('optimizePerformance');
    if (optimizeBtn) {
      optimizeBtn.addEventListener('click', () => {
        this.optimizePerformance();
      });
    }
    
    // Setup data backup
    const backupBtn = document.getElementById('backupData');
    if (backupBtn) {
      backupBtn.addEventListener('click', () => {
        this.backupData();
      });
    }
    
    // Setup emergency stop
    const emergencyBtn = document.getElementById('emergencyStop');
    if (emergencyBtn) {
      emergencyBtn.addEventListener('click', () => {
        this.emergencyStop();
      });
    }
  }

  setupAICouponGenerator() {
    // Setup match analysis
    const analyzeBtn = document.getElementById('analyzeMatches');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => {
        this.analyzeMatchesAI();
      });
    }
    
    // Setup AI training
    const trainBtn = document.getElementById('trainAI');
    if (trainBtn) {
      trainBtn.addEventListener('click', () => {
        this.trainAI();
      });
    }
    
    // Setup AI coupon generation
    const generateBtn = document.getElementById('generateAICoupons');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        this.generateAICoupons();
      });
    }
    
    // Setup AI optimization
    const optimizeAIBtn = document.getElementById('optimizeAI');
    if (optimizeAIBtn) {
      optimizeAIBtn.addEventListener('click', () => {
        this.optimizeAI();
      });
    }
  }

  setupEventListeners() {
    // Setup main system controls
    const startBtn = document.getElementById('startSystem');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.startSystem();
      });
    }
    
    // Setup data sync
    const syncBtn = document.getElementById('syncData');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        this.syncData();
      });
    }
    
    // Setup confidence slider
    const confidenceSlider = document.getElementById('minConfidence');
    const confidenceValue = document.getElementById('confidenceValue');
    if (confidenceSlider && confidenceValue) {
      confidenceSlider.addEventListener('input', (e) => {
        confidenceValue.textContent = `${e.target.value}%`;
      });
    }
    
    // Setup risk slider
    const riskSlider = document.getElementById('riskFactor');
    const riskValue = document.getElementById('riskValue');
    if (riskSlider && riskValue) {
      riskSlider.addEventListener('input', (e) => {
        riskValue.textContent = `${e.target.value}%`;
      });
    }
  }

  // Role-specific methods
  startMatchSelector() {
    console.log('🔍 Starting Match Selector...');
    this.loadMatches();
    this.startRealTimeUpdates();
  }

  startMasterController() {
    console.log('👑 Starting Master Controller...');
    this.updateDashboard();
    this.startSystemMonitoring();
  }

  startAICouponGenerator() {
    console.log('🤖 Starting AI Coupon Generator...');
    this.initializeAI();
    this.loadAIModels();
  }

  // Match Selector Methods
  async searchMatches() {
    console.log('🔍 Searching matches...');
    
    try {
      // Get search criteria
      const league = document.getElementById('selectorLeague')?.value || 'all';
      const matchType = document.getElementById('matchType')?.value || 'all';
      const minOdds = parseFloat(document.getElementById('minOdds')?.value) || 1.5;
      const timeWindow = parseInt(document.getElementById('timeWindow')?.value) || 6;
      
      // Fetch matches from API
      const response = await fetch(`/api/matches/search?league=${league}&type=${matchType}&minOdds=${minOdds}&timeWindow=${timeWindow}`);
      const data = await response.json();
      
      // Display matches
      this.displayMatches(data.matches || []);
      
      console.log(`✅ Found ${data.matches?.length || 0} matches`);
      
    } catch (error) {
      console.error('❌ Search failed:', error);
      this.showNotification('Erreur lors de la recherche des matchs', 'error');
    }
  }

  displayMatches(matches) {
    const matchGrid = document.getElementById('matchGrid');
    if (!matchGrid) return;
    
    matchGrid.innerHTML = '';
    
    matches.forEach((match, index) => {
      const matchCard = document.createElement('div');
      matchCard.className = 'match-card';
      matchCard.dataset.matchId = match.id;
      
      matchCard.innerHTML = `
        <div class="match-teams">${match.teamHome} vs ${match.teamAway}</div>
        <div class="match-details">
          <div class="match-detail"><strong>Ligue:</strong> ${match.league}</div>
          <div class="match-detail"><strong>Début:</strong> ${new Date(match.startTime).toLocaleString()}</div>
          <div class="match-detail"><strong>Confiance:</strong> ${match.confidence}%</div>
        </div>
        <div class="match-odds">
          <span class="match-odd">1: ${match.odd1?.toFixed(2) || 'N/A'}</span>
          <span class="match-odd">X: ${match.oddX?.toFixed(2) || 'N/A'}</span>
          <span class="match-odd">2: ${match.odd2?.toFixed(2) || 'N/A'}</span>
        </div>
      `;
      
      // Add click handler for selection
      matchCard.addEventListener('click', () => {
        this.toggleMatchSelection(match.id);
      });
      
      matchGrid.appendChild(matchCard);
    });
  }

  toggleMatchSelection(matchId) {
    const matchCard = document.querySelector(`[data-match-id="${matchId}"]`);
    if (!matchCard) return;
    
    if (this.selectedMatches.has(matchId)) {
      this.selectedMatches.delete(matchId);
      matchCard.classList.remove('selected');
    } else {
      this.selectedMatches.add(matchId);
      matchCard.classList.add('selected');
    }
    
    console.log(`🎯 Selected matches: ${this.selectedMatches.size}`);
  }

  selectBestMatches() {
    console.log('🏆 Selecting best matches...');
    
    const matchCards = document.querySelectorAll('.match-card');
    const matches = [];
    
    matchCards.forEach(card => {
      const matchId = card.dataset.matchId;
      if (matchId) {
        // Calculate match score based on confidence and odds
        const confidence = parseInt(card.querySelector('.match-detail:nth-child(3)')?.textContent) || 0;
        const odds = this.extractOddsFromCard(card);
        const score = this.calculateMatchScore(confidence, odds);
        
        matches.push({ id: matchId, card, score, confidence, odds });
      }
    });
    
    // Sort by score and select top matches
    matches.sort((a, b) => b.score - a.score);
    const topMatches = matches.slice(0, 5); // Select top 5
    
    // Clear previous selections
    this.selectedMatches.clear();
    matchCards.forEach(card => card.classList.remove('selected'));
    
    // Select top matches
    topMatches.forEach(match => {
      this.selectedMatches.add(match.id);
      match.card.classList.add('selected');
    });
    
    console.log(`✅ Selected ${topMatches.length} best matches`);
    this.showNotification(`${topMatches.length} meilleurs matchs sélectionnés`, 'success');
  }

  extractOddsFromCard(card) {
    const oddElements = card.querySelectorAll('.match-odd');
    const odds = [];
    
    oddElements.forEach(element => {
      const oddText = element.textContent;
      const oddValue = parseFloat(oddText.split(':')[1]);
      if (!isNaN(oddValue)) {
        odds.push(oddValue);
      }
    });
    
    return odds;
  }

  calculateMatchScore(confidence, odds) {
    // Simple scoring algorithm
    const confidenceScore = confidence / 100;
    const oddsScore = odds.length > 0 ? Math.min(2.5, Math.max(1.5, odds.reduce((a, b) => a + b) / odds.length)) / 2.5 : 0;
    
    return (confidenceScore * 0.7) + (oddsScore * 0.3);
  }

  sendMatchesToAI() {
    if (this.selectedMatches.size === 0) {
      this.showNotification('Veuillez sélectionner des matchs d\'abord', 'error');
      return;
    }
    
    console.log('🤖 Sending matches to AI...');
    
    // Switch to AI role
    this.switchRole('ai-coupon');
    
    // Store selected matches for AI processing
    this.aiMatches = Array.from(this.selectedMatches);
    
    this.showNotification(`${this.selectedMatches.size} matchs envoyés à l'IA`, 'success');
  }

  // Master Controller Methods
  async scanSystem() {
    console.log('🔍 Scanning system...');
    
    try {
      // Update system status
      this.masterData.systemStatus = 'scanning';
      this.updateDashboard();
      
      // Perform system scan
      const response = await fetch('/api/system/scan');
      const data = await response.json();
      
      // Update master data
      this.masterData = { ...this.masterData, ...data };
      this.masterData.systemStatus = 'ready';
      this.masterData.lastUpdate = new Date();
      
      // Update UI
      this.updateDashboard();
      
      console.log('✅ System scan completed');
      this.showNotification('Scan système terminé', 'success');
      
    } catch (error) {
      console.error('❌ System scan failed:', error);
      this.masterData.systemStatus = 'error';
      this.updateDashboard();
      this.showNotification('Erreur lors du scan système', 'error');
    }
  }

  updateDashboard() {
    // Update dashboard values
    const activeMatchesEl = document.getElementById('activeMatches');
    const generatedCouponsEl = document.getElementById('generatedCoupons');
    const successRateEl = document.getElementById('successRate');
    const systemStatusEl = document.getElementById('systemStatus');
    
    if (activeMatchesEl) activeMatchesEl.textContent = this.masterData.totalMatches || 0;
    if (generatedCouponsEl) generatedCouponsEl.textContent = this.masterData.activeCoupons || 0;
    if (successRateEl) successRateEl.textContent = `${this.masterData.successRate || 0}%`;
    if (systemStatusEl) systemStatusEl.textContent = this.getSystemStatusText(this.masterData.systemStatus);
  }

  getSystemStatusText(status) {
    const statusMap = {
      'ready': 'Prêt',
      'scanning': 'Scan en cours',
      'processing': 'Traitement',
      'error': 'Erreur',
      'stopped': 'Arrêté'
    };
    return statusMap[status] || 'Inconnu';
  }

  async optimizePerformance() {
    console.log('⚡ Optimizing performance...');
    
    try {
      const response = await fetch('/api/system/optimize', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        this.showNotification('Performance optimisée', 'success');
        this.updateDashboard();
      } else {
        throw new Error(data.message);
      }
      
    } catch (error) {
      console.error('❌ Optimization failed:', error);
      this.showNotification('Erreur lors de l\'optimisation', 'error');
    }
  }

  async backupData() {
    console.log('💾 Backing up data...');
    
    try {
      const response = await fetch('/api/system/backup', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        this.showNotification('Sauvegarde terminée', 'success');
      } else {
        throw new Error(data.message);
      }
      
    } catch (error) {
      console.error('❌ Backup failed:', error);
      this.showNotification('Erreur lors de la sauvegarde', 'error');
    }
  }

  emergencyStop() {
    console.log('🚨 Emergency stop activated!');
    
    // Stop all processes
    this.masterData.systemStatus = 'stopped';
    this.aiData.isProcessing = false;
    
    // Update UI
    this.updateDashboard();
    
    // Clear intervals
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    this.showNotification('Arrêt d\'urgence activé', 'warning');
  }

  // AI Coupon Generator Methods
  async analyzeMatchesAI() {
    console.log('🧠 Analyzing matches with AI...');
    
    try {
      this.startAIProgress('Analyse des matchs');
      
      const response = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matches: this.aiMatches || [],
          strategy: document.getElementById('aiStrategy')?.value || 'balanced',
          learningMode: document.getElementById('learningMode')?.value || 'historical'
        })
      });
      
      const data = await response.json();
      
      this.endAIProgress();
      
      if (data.success) {
        this.showNotification('Analyse IA terminée', 'success');
        this.displayAIAnalysis(data.analysis);
      } else {
        throw new Error(data.message);
      }
      
    } catch (error) {
      console.error('❌ AI analysis failed:', error);
      this.endAIProgress();
      this.showNotification('Erreur lors de l\'analyse IA', 'error');
    }
  }

  async generateAICoupons() {
    console.log('🤖 Generating AI coupons...');
    
    try {
      this.startAIProgress('Génération de coupons IA');
      
      const strategy = document.getElementById('aiStrategy')?.value || 'balanced';
      const matchCount = parseInt(document.getElementById('aiMatchCount')?.value) || 4;
      const riskFactor = parseInt(document.getElementById('riskFactor')?.value) || 30;
      
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matches: this.aiMatches || [],
          strategy,
          matchCount,
          riskFactor,
          confidence: parseInt(document.getElementById('minConfidence')?.value) || 65
        })
      });
      
      const data = await response.json();
      
      this.endAIProgress();
      
      if (data.success) {
        this.showNotification('Coupons IA générés', 'success');
        this.displayAICoupons(data.coupons);
        this.aiData.generatedCoupons = data.coupons;
        this.masterData.activeCoupons += data.coupons.length;
        this.updateDashboard();
      } else {
        throw new Error(data.message);
      }
      
    } catch (error) {
      console.error('❌ AI generation failed:', error);
      this.endAIProgress();
      this.showNotification('Erreur lors de la génération IA', 'error');
    }
  }

  displayAICoupons(coupons) {
    const resultsContainer = document.getElementById('aiResults');
    if (!resultsContainer) return;
    
    resultsContainer.innerHTML = '';
    
    coupons.forEach((coupon, index) => {
      const couponCard = document.createElement('div');
      couponCard.className = 'ai-coupon-card';
      
      couponCard.innerHTML = `
        <div class="ai-coupon-title">Coupon IA #${index + 1}</div>
        <div class="ai-coupon-selections">
          ${coupon.selections.map(selection => `
            <div class="ai-selection">
              <span class="ai-selection-teams">${selection.teams}</span>
              <span class="ai-selection-odds">${selection.odds}</span>
            </div>
          `).join('')}
        </div>
        <div class="ai-coupon-stats">
          <div class="ai-stat">
            <div class="ai-stat-label">Confiance</div>
            <div class="ai-stat-value">${coupon.confidence}%</div>
          </div>
          <div class="ai-stat">
            <div class="ai-stat-label">Cotes</div>
            <div class="ai-stat-value">${coupon.totalOdds.toFixed(2)}</div>
          </div>
          <div class="ai-stat">
            <div class="ai-stat-label">Valeur</div>
            <div class="ai-stat-value">${coupon.value}%</div>
          </div>
        </div>
      `;
      
      resultsContainer.appendChild(couponCard);
    });
  }

  startAIProgress(step) {
    this.aiData.isProcessing = true;
    this.aiData.progress = 0;
    this.aiData.currentStep = step;
    
    const progressEl = document.getElementById('aiProgress');
    const stepEl = document.getElementById('aiProgressStep');
    const percentageEl = document.getElementById('aiProgressPercentage');
    const fillEl = document.getElementById('aiProgressFill');
    
    if (progressEl) progressEl.style.display = 'block';
    if (stepEl) stepEl.textContent = step;
    if (percentageEl) percentageEl.textContent = '0%';
    if (fillEl) fillEl.style.width = '0%';
    
    // Start progress animation
    this.progressInterval = setInterval(() => {
      if (this.aiData.progress < 90) {
        this.aiData.progress += Math.random() * 10;
        this.updateAIProgress();
      }
    }, 500);
  }

  updateAIProgress() {
    const percentageEl = document.getElementById('aiProgressPercentage');
    const fillEl = document.getElementById('aiProgressFill');
    
    if (percentageEl) percentageEl.textContent = `${Math.round(this.aiData.progress)}%`;
    if (fillEl) fillEl.style.width = `${this.aiData.progress}%`;
  }

  endAIProgress() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
    }
    
    this.aiData.progress = 100;
    this.aiData.isProcessing = false;
    this.updateAIProgress();
    
    setTimeout(() => {
      const progressEl = document.getElementById('aiProgress');
      if (progressEl) progressEl.style.display = 'none';
    }, 1000);
  }

  // System Methods
  async startSystem() {
    console.log('🚀 Starting unified system...');
    
    try {
      // Initialize all components
      await this.initializeComponents();
      
      // Start real-time updates
      this.startRealTimeUpdates();
      
      // Update system status
      this.masterData.systemStatus = 'ready';
      this.updateDashboard();
      
      this.showNotification('Système unifié démarré', 'success');
      
    } catch (error) {
      console.error('❌ System start failed:', error);
      this.showNotification('Erreur lors du démarrage du système', 'error');
    }
  }

  async initializeComponents() {
    // Initialize match selector
    await this.loadMatches();
    
    // Initialize AI models
    await this.loadAIModels();
    
    // Initialize monitoring
    this.startSystemMonitoring();
  }

  async loadMatches() {
    try {
      const response = await fetch('/api/matches');
      const data = await response.json();
      this.masterData.totalMatches = data.matches?.length || 0;
    } catch (error) {
      console.error('Failed to load matches:', error);
    }
  }

  async loadAIModels() {
    try {
      const response = await fetch('/api/ai/models');
      const data = await response.json();
      console.log('AI models loaded:', data.models);
    } catch (error) {
      console.error('Failed to load AI models:', error);
    }
  }

  startRealTimeUpdates() {
    const frequency = parseInt(document.getElementById('updateFrequency')?.value) || 5;
    
    this.updateInterval = setInterval(async () => {
      await this.syncData();
    }, frequency * 60 * 1000);
  }

  startSystemMonitoring() {
    // Monitor system health
    setInterval(() => {
      this.checkSystemHealth();
    }, 30000); // Every 30 seconds
  }

  async checkSystemHealth() {
    try {
      const response = await fetch('/api/system/health');
      const health = await response.json();
      
      if (!health.healthy) {
        console.warn('⚠️ System health issue:', health.issues);
        this.showNotification('Problème de santé système détecté', 'warning');
      }
    } catch (error) {
      console.error('Health check failed:', error);
    }
  }

  async syncData() {
    try {
      const response = await fetch('/api/sync', { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        this.masterData.lastUpdate = new Date();
        console.log('📊 Data synchronized');
      }
    } catch (error) {
      console.error('Sync failed:', error);
    }
  }

  initializeStatusIndicators() {
    // Add status indicators to the interface
    const statusContainer = document.createElement('div');
    statusContainer.className = 'status-indicators';
    statusContainer.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      z-index: 1000;
    `;
    
    // System status indicator
    const systemStatus = document.createElement('div');
    systemStatus.className = 'status-indicator active';
    systemStatus.innerHTML = `
      <span class="status-dot"></span>
      <span>Système: Actif</span>
    `;
    
    // AI status indicator
    const aiStatus = document.createElement('div');
    aiStatus.className = 'status-indicator';
    aiStatus.innerHTML = `
      <span class="status-dot"></span>
      <span>IA: Prête</span>
    `;
    
    statusContainer.appendChild(systemStatus);
    statusContainer.appendChild(aiStatus);
    document.body.appendChild(statusContainer);
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</span>
        <span class="notification-text">${message}</span>
        <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 5000);
  }

  // Placeholder methods for features to be implemented
  async filterMatches() {
    console.log('🔍 Filtering matches...');
    this.showNotification('Filtrage des matchs', 'info');
  }

  async trainAI() {
    console.log('🧠 Training AI...');
    this.showNotification('Entraînement de l\'IA', 'info');
  }

  async optimizeAI() {
    console.log('⚡ Optimizing AI...');
    this.showNotification('Optimisation de l\'IA', 'info');
  }

  displayAIAnalysis(analysis) {
    console.log('📊 AI Analysis:', analysis);
    this.showNotification('Analyse IA affichée', 'success');
  }

  async exportResults() {
    console.log('📤 Exporting results...');
    this.showNotification('Export des résultats', 'info');
  }

  async systemSettings() {
    console.log('⚙️ Opening system settings...');
    this.showNotification('Paramètres système', 'info');
  }

  setupRealTimeUpdates() {
    // Setup WebSocket or polling for real-time updates
    console.log('🔄 Setting up real-time updates...');
  }

  setupDataSync() {
    // Setup automatic data synchronization
    console.log('📊 Setting up data synchronization...');
  }
}

// Initialize unified system
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.unifiedSystem = new UnifiedSystem();
    });
  } else {
    window.unifiedSystem = new UnifiedSystem();
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UnifiedSystem;
}
