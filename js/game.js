/**
 * CODENAMES - Game Logic
 * Complete game implementation with Supabase real-time sync
 */

// ==========================================
// GAME STATE
// ==========================================

const GameState = {
    gameCode: null,
    seed: null,
    words: [],
    cardTypes: [],
    startingTeam: 'red',
    revealed: [],
    currentTurn: 'red',
    redRemaining: 9,
    blueRemaining: 8,
    gameOver: false,
    winner: null,
    currentClue: null,
    currentClueNumber: 0,
    guessesRemaining: 0,
    lastAction: null,
    playerRole: null,
    clueHistory: [], // Array of {team, word, number, stillApplies}
    players: {}, // Object mapping playerId -> {role, name}
};

// Generate or get unique player ID
function getPlayerId() {
    let playerId = localStorage.getItem('codenames_player_id');
    if (!playerId) {
        playerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        localStorage.setItem('codenames_player_id', playerId);
    }
    return playerId;
}

const PLAYER_ID = getPlayerId();

// Get or set player name
function getPlayerName() {
    let name = localStorage.getItem('codenames_player_name');
    if (!name) {
        name = 'Player';
    }
    return name;
}

function setPlayerName(name) {
    const trimmedName = (name || 'Player').trim().substring(0, 20) || 'Player';
    localStorage.setItem('codenames_player_name', trimmedName);
    return trimmedName;
}

// Supabase subscription
let gameSubscription = null;

// ==========================================
// SEEDED RANDOM NUMBER GENERATOR
// ==========================================

class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    next() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    
    shuffle(array) {
        const result = [...array];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    }
}

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function generateGameCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ==========================================
// SYNC STATE FUNCTIONS
// ==========================================

function getSyncableState() {
    return {
        game_code: GameState.gameCode,
        revealed: GameState.revealed,
        current_turn: GameState.currentTurn,
        red_remaining: GameState.redRemaining,
        blue_remaining: GameState.blueRemaining,
        game_over: GameState.gameOver,
        winner: GameState.winner,
        current_clue: GameState.currentClue,
        current_clue_number: GameState.currentClueNumber,
        guesses_remaining: GameState.guessesRemaining,
        clue_history: GameState.clueHistory,
        players: GameState.players,
        last_action: new Date().toISOString()
    };
}

function applySyncedState(data) {
    if (!data) return;
    
    GameState.revealed = data.revealed || Array(25).fill(false);
    GameState.currentTurn = data.current_turn || GameState.startingTeam;
    GameState.redRemaining = data.red_remaining ?? (GameState.startingTeam === 'red' ? 9 : 8);
    GameState.blueRemaining = data.blue_remaining ?? (GameState.startingTeam === 'blue' ? 9 : 8);
    GameState.gameOver = data.game_over || false;
    GameState.winner = data.winner || null;
    GameState.currentClue = data.current_clue || null;
    GameState.currentClueNumber = data.current_clue_number || 0;
    GameState.guessesRemaining = data.guesses_remaining || 0;
    GameState.clueHistory = data.clue_history || [];
    GameState.players = data.players || {};
    GameState.lastAction = data.last_action || null;
}

// Save to Supabase with retry logic
async function saveGameState(retryCount = 0) {
    const syncState = getSyncableState();
    const maxRetries = 3;
    
    // Always save to localStorage as backup
    localStorage.setItem(`codenames_${GameState.gameCode}`, JSON.stringify({
        ...syncState,
        playerRole: GameState.playerRole
    }));
    
    // If Supabase is enabled, sync there
    if (supabaseEnabled && supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('games')
                .upsert(syncState, { onConflict: 'game_code' });
            
            if (error) {
                console.error("Supabase sync error:", error);
                if (retryCount < maxRetries) {
                    console.log(`Retrying save (${retryCount + 1}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1)));
                    return saveGameState(retryCount + 1);
                } else {
                    showToast("Sync error - changes saved locally", "warning");
                }
            } else {
                console.log("State synced to Supabase");
            }
        } catch (error) {
            console.error("Supabase sync error:", error);
            if (retryCount < maxRetries) {
                console.log(`Retrying save (${retryCount + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 500 * (retryCount + 1)));
                return saveGameState(retryCount + 1);
            }
        }
    }
}

// Notify other players about a new game (redirect them to new code)
async function broadcastNewGame(oldGameCode, newGameCode) {
    if (supabaseEnabled && supabaseClient) {
        try {
            // First check if old game exists
            const { data: existingGame } = await supabaseClient
                .from('games')
                .select('game_code')
                .eq('game_code', oldGameCode)
                .maybeSingle();
            
            // Only update if the old game exists in Supabase
            if (existingGame) {
                const { error } = await supabaseClient
                    .from('games')
                    .update({ 
                        new_game_redirect: newGameCode,
                        last_action: new Date().toISOString()
                    })
                    .eq('game_code', oldGameCode);
                
                if (error) {
                    console.error("Error broadcasting new game:", error);
                } else {
                    console.log(`Broadcasted new game redirect: ${oldGameCode} -> ${newGameCode}`);
                }
            } else {
                console.log("Old game not in Supabase, skipping broadcast");
            }
        } catch (error) {
            console.error("Error broadcasting new game:", error);
        }
    }
}

// Load from localStorage
function loadLocalState(gameCode) {
    const saved = localStorage.getItem(`codenames_${gameCode}`);
    if (saved) {
        return JSON.parse(saved);
    }
    return null;
}

// Set up Supabase real-time subscription
let subscriptionRetries = 0;
const maxSubscriptionRetries = 5;

async function setupSupabaseSubscription() {
    if (!supabaseEnabled || !supabaseClient || !GameState.gameCode) {
        console.log("Supabase not enabled, skipping subscription setup");
        return;
    }
    
    // Clean up any existing subscription
    if (gameSubscription) {
        try {
            await supabaseClient.removeChannel(gameSubscription);
        } catch (e) {
            console.log("Error removing old channel:", e);
        }
    }
    
    // Subscribe to changes for this game
    gameSubscription = supabaseClient
        .channel(`game_${GameState.gameCode}`, {
            config: {
                broadcast: { self: true },
                presence: { key: '' }
            }
        })
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'games',
                filter: `game_code=eq.${GameState.gameCode}`
            },
            (payload) => {
                console.log("Received real-time update:", payload);
                if (payload.new) {
                    // Check if this is a redirect to a new game
                    if (payload.new.new_game_redirect) {
                        const newCode = payload.new.new_game_redirect;
                        console.log("New game redirect detected:", newCode);
                        showToast(`New game started! Redirecting to ${newCode}...`, 'info');
                        
                        // Small delay to show the toast, then redirect
                        setTimeout(async () => {
                            await joinNewGame(newCode);
                        }, 1000);
                        return;
                    }
                    
                    const newLastAction = new Date(payload.new.last_action).getTime();
                    const currentLastAction = GameState.lastAction ? new Date(GameState.lastAction).getTime() : 0;
                    
                    if (newLastAction > currentLastAction) {
                        applySyncedState(payload.new);
                        updateGameDisplay();
                        updatePlayerCounts();
                        showToast("Game updated!", "success");
                    }
                }
            }
        )
        .subscribe(async (status, err) => {
            console.log("Subscription status:", status, err);
            if (status === 'SUBSCRIBED') {
                subscriptionRetries = 0;
                updateSyncStatus(true);
                
                // Fetch latest state on successful subscription
                try {
                    const { data } = await supabaseClient
                        .from('games')
                        .select('*')
                        .eq('game_code', GameState.gameCode)
                        .maybeSingle();
                    
                    if (data) {
                        const newLastAction = new Date(data.last_action).getTime();
                        const currentLastAction = GameState.lastAction ? new Date(GameState.lastAction).getTime() : 0;
                        
                        if (newLastAction > currentLastAction) {
                            applySyncedState(data);
                            updateGameDisplay();
                        }
                    }
                } catch (e) {
                    console.log("Error fetching initial state:", e);
                }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.error("Subscription error:", err);
                updateSyncStatus(false);
                
                // Retry subscription
                if (subscriptionRetries < maxSubscriptionRetries) {
                    subscriptionRetries++;
                    console.log(`Retrying subscription (${subscriptionRetries}/${maxSubscriptionRetries})...`);
                    setTimeout(() => setupSupabaseSubscription(), 2000 * subscriptionRetries);
                } else {
                    showToast("Connection lost. Click refresh to reconnect.", "error");
                }
            } else if (status === 'CLOSED') {
                updateSyncStatus(false);
            }
        });
    
    console.log("Supabase subscription set up for game:", GameState.gameCode);
}

// Helper function to join a new game (used when redirected)
async function joinNewGame(newCode) {
    // Stop background sync for old game
    stopBackgroundSync();
    
    // Clean up current subscription
    if (gameSubscription && supabaseClient) {
        try {
            await supabaseClient.removeChannel(gameSubscription);
        } catch (e) {
            console.log('Error removing channel:', e);
        }
    }
    
    // Clear old game data
    localStorage.removeItem(`codenames_${GameState.gameCode}`);
    localStorage.removeItem(`codenames_${GameState.gameCode}_role`);
    
    // Reset subscription retries
    subscriptionRetries = 0;
    
    // Initialize the new game
    await initializeGame(newCode, false);
    
    // Give subscription time to connect and receive initial state
    if (supabaseEnabled && supabaseClient) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Force a sync to get the latest state
        try {
            const { data, error } = await supabaseClient
                .from('games')
                .select('*')
                .eq('game_code', newCode)
                .maybeSingle();
            
            if (data && !error) {
                applySyncedState(data);
            }
        } catch (error) {
            console.log('Error syncing in joinNewGame:', error);
        }
    }
    
    // Update URL
    const url = new URL(window.location);
    url.searchParams.set('game', newCode);
    window.history.pushState({}, '', url);
    
    // Show role selection
    document.getElementById('game-area').classList.add('hidden');
    document.getElementById('game-over-modal').classList.add('hidden');
    document.getElementById('display-game-code').textContent = newCode;
    document.getElementById('role-modal').classList.remove('hidden');
}

// ==========================================
// GAME INITIALIZATION
// ==========================================

function generateBoardFromSeed(gameCode) {
    const seed = hashCode(gameCode);
    const rng = new SeededRandom(seed);
    
    const shuffledWords = rng.shuffle(WORD_LIST);
    const words = shuffledWords.slice(0, 25);
    const startingTeam = rng.next() > 0.5 ? 'red' : 'blue';
    
    const cardTypes = [];
    for (let i = 0; i < 9; i++) cardTypes.push(startingTeam);
    for (let i = 0; i < 8; i++) cardTypes.push(startingTeam === 'red' ? 'blue' : 'red');
    for (let i = 0; i < 7; i++) cardTypes.push('neutral');
    cardTypes.push('assassin');
    
    const shuffledTypes = rng.shuffle(cardTypes);
    
    return { words, cardTypes: shuffledTypes, startingTeam };
}

async function initializeGame(gameCode, isNewGame = false) {
    GameState.gameCode = gameCode;
    GameState.seed = hashCode(gameCode);
    
    // Generate the board (deterministic - same for all players)
    const board = generateBoardFromSeed(gameCode);
    GameState.words = board.words;
    GameState.cardTypes = board.cardTypes;
    GameState.startingTeam = board.startingTeam;
    
    // Set initial state
    GameState.revealed = Array(25).fill(false);
    GameState.currentTurn = board.startingTeam;
    GameState.redRemaining = board.startingTeam === 'red' ? 9 : 8;
    GameState.blueRemaining = board.startingTeam === 'blue' ? 9 : 8;
    GameState.gameOver = false;
    GameState.winner = null;
    GameState.currentClue = null;
    GameState.currentClueNumber = 0;
    GameState.guessesRemaining = 0;
    GameState.clueHistory = [];
    
    // Set up real-time subscription
    if (supabaseEnabled && supabaseClient) {
        await setupSupabaseSubscription();
        
        // Try to load existing game state from Supabase
        if (!isNewGame) {
            try {
                const { data, error } = await supabaseClient
                    .from('games')
                    .select('*')
                    .eq('game_code', gameCode)
                    .maybeSingle();
                
                if (data && !error) {
                    console.log("Loaded existing game from Supabase:", data);
                    applySyncedState(data);
                } else {
                    console.log("No existing game found, using fresh state");
                }
            } catch (error) {
                console.log("Error loading from Supabase:", error);
            }
        }
    } else {
        // Fall back to localStorage
        const localState = loadLocalState(gameCode);
        if (localState && !isNewGame) {
            applySyncedState(localState);
        }
    }
    
    // Load player role from local storage
    const savedRole = localStorage.getItem(`codenames_${gameCode}_role`);
    if (savedRole) {
        GameState.playerRole = savedRole;
    }
}

// ==========================================
// UI RENDERING
// ==========================================

function renderBoard() {
    const board = document.getElementById('game-board');
    board.innerHTML = '';
    
    const isSpymaster = GameState.playerRole?.includes('spymaster');
    
    for (let i = 0; i < 25; i++) {
        const card = document.createElement('div');
        card.className = 'card';
        card.dataset.index = i;
        
        const cardType = GameState.cardTypes[i];
        card.classList.add(`team-${cardType}`);
        
        if (GameState.revealed[i]) {
            card.classList.add('revealed');
        } else if (isSpymaster) {
            card.classList.add('spymaster-view');
        }
        
        const wordSpan = document.createElement('span');
        wordSpan.className = 'card-word';
        wordSpan.textContent = GameState.words[i];
        card.appendChild(wordSpan);
        
        if (!GameState.revealed[i] && !isSpymaster && !GameState.gameOver) {
            card.addEventListener('click', () => handleCardClick(i));
        }
        
        board.appendChild(card);
    }
}

function updateScores() {
    document.getElementById('red-remaining').textContent = GameState.redRemaining;
    document.getElementById('blue-remaining').textContent = GameState.blueRemaining;
}

function updateTurnIndicator() {
    const indicator = document.getElementById('turn-indicator');
    indicator.className = `turn-indicator ${GameState.currentTurn}-turn`;
    
    if (GameState.gameOver) {
        indicator.textContent = `${GameState.winner?.toUpperCase()} WINS!`;
    } else {
        indicator.textContent = `${GameState.currentTurn.toUpperCase()} TEAM'S TURN`;
    }
}

function updateRoleIndicator() {
    const roleText = document.getElementById('current-role');
    const roleNames = {
        'red-spymaster': '🔴 Red Spymaster',
        'red-operative': '🔴 Red Operative',
        'blue-spymaster': '🔵 Blue Spymaster',
        'blue-operative': '🔵 Blue Operative',
        'spectator': '👁️ Spectator'
    };
    roleText.textContent = roleNames[GameState.playerRole] || 'Select a role';
}

function updateClueSection() {
    const clueSection = document.getElementById('clue-section');
    const currentClueDisplay = document.getElementById('current-clue');
    
    const isCurrentTeamSpymaster = GameState.playerRole === `${GameState.currentTurn}-spymaster`;
    
    if (isCurrentTeamSpymaster && !GameState.currentClue && !GameState.gameOver) {
        clueSection.classList.remove('hidden');
    } else {
        clueSection.classList.add('hidden');
    }
    
    if (GameState.currentClue && !GameState.gameOver) {
        currentClueDisplay.classList.remove('hidden');
        document.getElementById('clue-text').textContent = GameState.currentClue;
        document.getElementById('clue-count').textContent = GameState.currentClueNumber;
        document.getElementById('guesses-remaining').textContent = 
            `Guesses remaining: ${GameState.guessesRemaining === 99 ? '∞' : GameState.guessesRemaining}`;
    } else {
        currentClueDisplay.classList.add('hidden');
    }
}

function updateEndTurnButton() {
    const endTurnBtn = document.getElementById('end-turn-btn');
    const isOperative = GameState.playerRole?.includes('operative');
    const isCurrentTeam = GameState.playerRole?.startsWith(GameState.currentTurn);
    
    if (isOperative && isCurrentTeam && GameState.currentClue && !GameState.gameOver) {
        endTurnBtn.disabled = false;
    } else {
        endTurnBtn.disabled = true;
    }
}

function updateSyncStatus(connected = false) {
    const syncStatus = document.getElementById('sync-status');
    if (syncStatus) {
        if (supabaseEnabled && connected) {
            syncStatus.textContent = '🟢 Live';
            syncStatus.title = 'Real-time sync enabled';
            syncStatus.className = 'sync-status synced';
        } else if (supabaseEnabled) {
            syncStatus.textContent = '🟡 Connecting...';
            syncStatus.title = 'Connecting to server';
            syncStatus.className = 'sync-status connecting';
        } else {
            syncStatus.textContent = '🔴 Offline';
            syncStatus.title = 'Supabase not connected';
            syncStatus.className = 'sync-status local';
        }
    }
}

function updateClueHistory() {
    const historyContainer = document.getElementById('clue-history-list');
    const sidebar = document.getElementById('clue-history-sidebar');
    
    if (!historyContainer || !sidebar) return;
    
    const isOperative = GameState.playerRole?.includes('operative');
    const isSpymaster = GameState.playerRole?.includes('spymaster');
    const canToggle = isOperative || isSpymaster;
    
    console.log('Updating clue history. Role:', GameState.playerRole, 'canToggle:', canToggle);
    
    if (GameState.clueHistory.length === 0) {
        historyContainer.innerHTML = '<p class="no-clues">No clues given yet</p>';
    } else {
        historyContainer.innerHTML = GameState.clueHistory.map((clue, index) => `
            <div class="clue-history-item ${clue.team}-clue ${!clue.stillApplies ? 'crossed-out' : ''}">
                <div class="clue-history-content">
                    <span class="clue-history-team">${clue.team === 'red' ? '🔴' : '🔵'}</span>
                    <span class="clue-history-word">${clue.word}</span>
                    <span class="clue-history-number">${clue.number}</span>
                </div>
                ${canToggle ? `
                    <label class="clue-toggle">
                        <input type="checkbox" 
                            ${clue.stillApplies ? 'checked' : ''} 
                            onchange="toggleClueApplies(${index})">
                        <span class="toggle-slider"></span>
                    </label>
                ` : ''}
            </div>
        `).join('');
    }
}

async function toggleClueApplies(index) {
    if (index >= 0 && index < GameState.clueHistory.length) {
        GameState.clueHistory[index].stillApplies = !GameState.clueHistory[index].stillApplies;
        await saveGameState();
        updateClueHistory();
    }
}

// Expose to window for inline onclick handlers
window.toggleClueApplies = toggleClueApplies;

function updateGameDisplay() {
    renderBoard();
    updateScores();
    updateTurnIndicator();
    updateRoleIndicator();
    updateClueSection();
    updateEndTurnButton();
    updateClueHistory();
    
    document.getElementById('game-code-small').textContent = GameState.gameCode;
    
    if (GameState.gameOver && GameState.winner) {
        showGameOverModal();
    }
}

// ==========================================
// GAME ACTIONS
// ==========================================

function handleCardClick(index) {
    if (GameState.revealed[index] || GameState.gameOver) return;
    
    const isOperative = GameState.playerRole?.includes('operative');
    const isSpectator = GameState.playerRole === 'spectator';
    const isCurrentTeam = GameState.playerRole?.startsWith(GameState.currentTurn);
    
    if (isSpectator) {
        showToast("Spectators cannot make guesses", 'warning');
        return;
    }
    
    if (!isOperative) {
        showToast("Spymasters cannot click cards!", 'warning');
        return;
    }
    
    if (!isCurrentTeam) {
        showToast("It's not your team's turn!", 'warning');
        return;
    }
    
    if (!GameState.currentClue) {
        showToast("Wait for your spymaster to give a clue!", 'warning');
        return;
    }
    
    revealCard(index);
}

async function revealCard(index) {
    GameState.revealed[index] = true;
    const cardType = GameState.cardTypes[index];
    
    if (cardType === 'red') {
        GameState.redRemaining--;
    } else if (cardType === 'blue') {
        GameState.blueRemaining--;
    }
    
    if (cardType === 'assassin') {
        GameState.gameOver = true;
        GameState.winner = GameState.currentTurn === 'red' ? 'blue' : 'red';
        await saveGameState();
        updateGameDisplay();
        showToast(`ASSASSIN! ${GameState.winner.toUpperCase()} team wins!`, 'error');
    } else if (GameState.redRemaining === 0) {
        GameState.gameOver = true;
        GameState.winner = 'red';
        await saveGameState();
        updateGameDisplay();
        showToast('RED team wins!', 'success');
    } else if (GameState.blueRemaining === 0) {
        GameState.gameOver = true;
        GameState.winner = 'blue';
        await saveGameState();
        updateGameDisplay();
        showToast('BLUE team wins!', 'success');
    } else if (cardType !== GameState.currentTurn) {
        showToast(`That was a ${cardType.toUpperCase()} card! Turn ends.`, 'warning');
        await endTurn();
        return;
    } else {
        GameState.guessesRemaining--;
        
        if (GameState.guessesRemaining === 0) {
            showToast('No guesses remaining. Turn ends.', 'info');
            await endTurn();
            return;
        } else {
            await saveGameState();
            updateGameDisplay();
            showToast('Correct! Keep guessing or end your turn.', 'success');
        }
    }
}

async function giveClue(word, number) {
    if (!word.trim()) {
        showToast('Please enter a clue word!', 'error');
        return false;
    }
    
    if (word.trim().includes(' ')) {
        showToast('Clue must be a single word!', 'error');
        return false;
    }
    
    GameState.currentClue = word.toUpperCase().trim();
    GameState.currentClueNumber = number;
    GameState.guessesRemaining = number === 0 ? 99 : number + 1;
    
    // Add to clue history
    GameState.clueHistory.push({
        id: Date.now(),
        team: GameState.currentTurn,
        word: GameState.currentClue,
        number: number,
        stillApplies: true
    });
    
    await saveGameState();
    updateGameDisplay();
    showToast(`Clue given: ${GameState.currentClue} - ${number}`, 'success');
    return true;
}

async function endTurn() {
    GameState.currentClue = null;
    GameState.currentClueNumber = 0;
    GameState.guessesRemaining = 0;
    GameState.currentTurn = GameState.currentTurn === 'red' ? 'blue' : 'red';
    
    await saveGameState();
    updateGameDisplay();
    showToast(`Now it's ${GameState.currentTurn.toUpperCase()} team's turn!`, 'info');
}

function showGameOverModal() {
    const modal = document.getElementById('game-over-modal');
    const winnerText = document.getElementById('winner-text');
    const reasonText = document.getElementById('game-over-reason');
    
    winnerText.textContent = `${GameState.winner.toUpperCase()} TEAM WINS!`;
    winnerText.className = `${GameState.winner}-wins`;
    
    let reason = '';
    if (GameState.revealed.some((r, i) => r && GameState.cardTypes[i] === 'assassin')) {
        const loser = GameState.winner === 'red' ? 'BLUE' : 'RED';
        reason = `The ${loser} team found the ASSASSIN!`;
    } else {
        reason = `All ${GameState.winner.toUpperCase()} agents have been found!`;
    }
    reasonText.textContent = reason;
    
    modal.classList.remove('hidden');
}

// ==========================================
// MANUAL SYNC
// ==========================================

async function manualSync() {
    if (supabaseEnabled && supabaseClient) {
        try {
            showToast('Syncing...', 'info');
            
            // Reset subscription retries and reconnect
            subscriptionRetries = 0;
            await setupSupabaseSubscription();
            
            const { data, error } = await supabaseClient
                .from('games')
                .select('*')
                .eq('game_code', GameState.gameCode)
                .maybeSingle();
            
            if (data && !error) {
                applySyncedState(data);
                updateGameDisplay();
                showToast('Game synced!', 'success');
            } else if (error) {
                console.error('Sync error:', error);
                showToast('Sync failed - check connection', 'error');
            } else {
                showToast('No game data found', 'warning');
            }
        } catch (error) {
            console.error("Sync error:", error);
            showToast('Sync failed - check connection', 'error');
        }
    } else {
        showToast('Not connected to server', 'warning');
    }
}

// ==========================================
// UI EVENT HANDLERS
// ==========================================

function setupEventListeners() {
    document.getElementById('new-game-btn').addEventListener('click', async () => {
        const newCode = generateGameCode();
        await initializeGame(newCode, true);
        await saveGameState();
        showRoleSelection();
    });
    
    document.getElementById('join-game-btn').addEventListener('click', async () => {
        const codeInput = document.getElementById('game-code-input');
        const code = codeInput.value.toUpperCase().trim();
        
        if (code.length < 4) {
            showToast('Please enter a valid game code!', 'error');
            return;
        }
        
        await initializeGame(code, false);
        showRoleSelection();
    });
    
    document.getElementById('game-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('join-game-btn').click();
        }
    });
    
    document.querySelectorAll('.btn-role').forEach(btn => {
        btn.addEventListener('click', async () => {
            const role = btn.dataset.role;
            GameState.playerRole = role;
            GameState.players[PLAYER_ID] = role;
            localStorage.setItem(`codenames_${GameState.gameCode}_role`, role);
            
            await saveGameState();
            await startGame();
        // Pre-fill current name
        document.getElementById('player-name-input').value = getPlayerName();
    });
    
    document.getElementById('change-name-btn').addEventListener('click', () => {
        const newName = prompt('Enter your new name:', getPlayerName());
        if (newName !== null && newName.trim()) {
            const playerName = setPlayerName(newName);
            // Update current player in GameState
            if (GameState.players[PLAYER_ID]) {
                const currentRole = typeof GameState.players[PLAYER_ID] === 'string' 
                    ? GameState.players[PLAYER_ID] 
                    : GameState.players[PLAYER_ID].role;
                GameState.players[PLAYER_ID] = { role: currentRole, name: playerName };
                saveGameState();
                updatePlayerNameDisplay();
                updatePlayerCounts();
            }
        }
        });
    });
    
    document.getElementById('spectator-btn').addEventListener('click', async () => {
        GameState.playerRole = 'spectator';
        GameState.players[PLAYER_ID] = 'spectator';
        localStorage.setItem(`codenames_${GameState.gameCode}_role`, 'spectator');
        
        await saveGameState();
        await startGame();
    });
    
    document.getElementById('change-role-btn').addEventListener('click', () => {
        document.getElementById('game-area').classList.add('hidden');
        document.getElementById('role-modal').classList.remove('hidden');
        // Pre-fill current name
        document.getElementById('player-name-input').value = getPlayerName();
    });
    
    document.getElementById('change-name-btn').addEventListener('click', () => {
        const newName = prompt('Enter your new name:', getPlayerName());
        if (newName !== null && newName.trim()) {
            const playerName = setPlayerName(newName);
            // Update current player in GameState
            if (GameState.players[PLAYER_ID]) {
                const currentRole = typeof GameState.players[PLAYER_ID] === 'string' 
                    ? GameState.players[PLAYER_ID] 
                    : GameState.players[PLAYER_ID].role;
                GameState.players[PLAYER_ID] = { role: currentRole, name: playerName };
                saveGameState();
                updatePlayerNameDisplay();
                updatePlayerCounts();
            }
        }
    });
    
    document.getElementById('clue-history-toggle').addEventListener('click', () => {
        const sidebar = document.getElementById('clue-history-sidebar');
        sidebar.classList.toggle('open');
        document.body.classList.toggle('sidebar-open');
        
        // Save preference
        const isOpen = sidebar.classList.contains('open');
        localStorage.setItem('clue_sidebar_open', isOpen);
    });
    
    document.getElementById('give-clue-btn').addEventListener('click', async () => {
        const wordInput = document.getElementById('clue-word');
        const numberInput = document.getElementById('clue-number');
        
        if (await giveClue(wordInput.value, parseInt(numberInput.value) || 0)) {
            wordInput.value = '';
            numberInput.value = '1';
        }
    });
    
    document.getElementById('clue-word').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('give-clue-btn').click();
        }
    });
    
    document.getElementById('end-turn-btn').addEventListener('click', async () => {
        await endTurn();
    });
    
    document.getElementById('new-game-from-board').addEventListener('click', async () => {
        if (confirm('Start a new game? This will generate new words and a new key. All players will be redirected to the new game.')) {
            const oldCode = GameState.gameCode;
            const newCode = generateGameCode();
            
            // Clean up current subscription
            if (gameSubscription && supabaseClient) {
                await supabaseClient.removeChannel(gameSubscription);
            }
            
            // Initialize and save the new game FIRST
            await initializeGame(newCode, true);
            await saveGameState();
            
            // THEN broadcast to other players after the game exists
            await broadcastNewGame(oldCode, newCode);
            
            // Clean up old game data
            localStorage.removeItem(`codenames_${oldCode}`);
            localStorage.removeItem(`codenames_${oldCode}_role`);
            
            const url = new URL(window.location);
            url.searchParams.set('game', newCode);
            window.history.pushState({}, '', url);
            
            document.getElementById('display-game-code').textContent = newCode;
            document.getElementById('game-area').classList.add('hidden');
            document.getElementById('role-modal').classList.remove('hidden');
        }
    });
    
    document.getElementById('copy-code-btn').addEventListener('click', () => {
        const url = `${window.location.origin}${window.location.pathname}?game=${GameState.gameCode}`;
        navigator.clipboard.writeText(url).then(() => {
            showToast('Game link copied to clipboard!', 'success');
        }).catch(() => {
            showToast(`Share this code: ${GameState.gameCode}`, 'info');
        });
    });
    
    document.getElementById('refresh-btn').addEventListener('click', async () => {
        await manualSync();
    });
    
    document.getElementById('new-words-btn').addEventListener('click', async () => {
        const oldCode = GameState.gameCode;
    // Pre-fill name input with saved name
    document.getElementById('player-name-input').value = getPlayerName();
        const newCode = generateGameCode();
        
        // Clean up current subscription
        if (gameSubscription && supabaseClient) {
            await supabaseClient.removeChannel(gameSubscription);
        }
        
        // Initialize and save the new game FIRST
        await initializeGame(newCode, true);
        await saveGameState();
        GameState.playerRole = null;
        
        // THEN broadcast to other players after the game exists
        await broadcastNewGame(oldCode, newCode);
        
        // Clean up old game data
        localStorage.removeItem(`codenames_${oldCode}`);
        localStorage.removeItem(`codenames_${oldCode}_role`);
        
        const url = new URL(window.location);
        url.searchParams.set('game', newCode);
        window.history.pushState({}, '', url);
        
        document.getElementById('game-over-modal').classList.add('hidden');
        document.getElementById('game-area').classList.add('hidden');
        document.getElementById('display-game-code').textContent = newCode;
        document.getElementById('role-modal').classList.remove('hidden');
    });
}

function showRoleSelection() {
    document.getElementById('setup-modal').classList.add('hidden');
    document.getElementById('role-modal').classList.remove('hidden');
    document.getElementById('display-game-code').textContent = GameState.gameCode;
function updatePlayerNameDisplay() {
    const nameDisplay = document.getElementById('player-name-display');
    if (nameDisplay) {
        nameDisplay.textContent = getPlayerName();
    }
}

    
    updatePlayerCounts();
    
    const url = new URL(window.location);
    url.searchParams.set('game', GameState.gameCode);
    window.history.pushState({}, '', url);
}

function updatePlayerCounts() {
    const counts = {
        'red-spymaster': 0,
        'red-operative': 0,
        'blue-spymaster': 0,
        'blue-operative': 0,
        'spectator': 0
    };
    
    const playersByRole = {
        'red-spymaster': [],
        'red-operative': [],
        'blue-spymaster': [],
        'blue-operative': [],
        'spectator': []
    };
    
    // Count players in each role and collect names
    Object.entries(GameState.players || {}).forEach(([playerId, playerData]) => {
        // Handle both old format (string role) and new format (object with role and name)
        const role = typeof playerData === 'string' ? playerData : playerData.role;
        const name = typeof playerData === 'object' ? playerData.name : 'Player';
        
        if (counts.hasOwnProperty(role)) {
            counts[role]++;
            playersByRole[role].push({ id: playerId, name: name });
        }
    });
    
    // Update badges
    Object.keys(counts).forEach(role => {
        const badge = document.getElementById(`count-${role}`);
        if (badge) {
            badge.textContent = counts[role];
            badge.style.display = counts[role] > 0 ? 'inline-block' : 'none';
        }
        
        // Update player lists
        const playerList = document.getElementById(`players-${role}`);
        if (playerList) {
            if (playersByRole[role].length > 0) {
                playerList.innerHTML = playersByRole[role].map(p => 
                    `<div class="player-tag${p.id === PLAYER_ID ? ' current-player' : ''}">${p.name}</div>`
                ).join('');
                playerList.style.display = 'block';
            } else {
                playerList.innerHTML = '';
                playerList.style.display = 'none';
            }
        }
    });
}

function updatePlayerNameDisplay() {
    const nameDisplay = document.getElementById('player-name-display');
    if (nameDisplay) {
        nameDisplay.textContent = getPlayerName();
    }
}

async function startGame() {
    // Always sync the latest state before starting
    if (supabaseEnabled && supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('games')
                .select('*')
                .eq('game_code', GameState.gameCode)
                .maybeSingle();
            
            if (data && !error) {
                applySyncedState(data);
            }
        } catch (error) {
            console.log('Error syncing in startGame:', error);
        }
    }
    
    document.getElementById('role-modal').classList.add('hidden');
    document.getElementById('game-area').classList.remove('hidden');
    updateGameDisplay();
    updatePlayerNameDisplay();
    updateSyncStatus(supabaseEnabled);
    
    // Restore sidebar state
    const sidebarOpen = localStorage.getItem('clue_sidebar_open') === 'true';
    if (sidebarOpen) {
        document.getElementById('clue-history-sidebar').classList.add('open');
        document.body.classList.add('sidebar-open');
    }
    
    // Start background sync interval to catch any missed updates
    startBackgroundSync();
    
    if (!supabaseEnabled) {
        showToast('⚠️ Offline mode - sync not available', 'warning');
    } else {
        showToast('🟢 Connected! Game syncs in real-time.', 'success');
    }
}

// Background sync to catch any missed real-time updates
let backgroundSyncInterval = null;

function startBackgroundSync() {
    // Clear any existing interval
    if (backgroundSyncInterval) {
        clearInterval(backgroundSyncInterval);
    }
    
    // Sync every 5 seconds as a fallback
    backgroundSyncInterval = setInterval(async () => {
        if (!supabaseEnabled || !supabaseClient || !GameState.gameCode || GameState.gameOver) {
            return;
        }
        
        try {
            const { data, error } = await supabaseClient
                .from('games')
                .select('*')
                .eq('game_code', GameState.gameCode)
                .maybeSingle();
            
            if (data && !error) {
                const newLastAction = new Date(data.last_action).getTime();
                const currentLastAction = GameState.lastAction ? new Date(GameState.lastAction).getTime() : 0;
                
                if (newLastAction > currentLastAction) {
                    console.log('Background sync found new data');
                    applySyncedState(data);
                    updateGameDisplay();
                }
            }
        } catch (error) {
            console.log('Background sync error:', error);
        }
    }, 5000);
}

function stopBackgroundSync() {
    if (backgroundSyncInterval) {
        clearInterval(backgroundSyncInterval);
        backgroundSyncInterval = null;
    }
}

// Sync when user returns to the page or reconnects
function setupVisibilityAndNetworkHandlers() {
    // Sync when tab becomes visible again
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && GameState.gameCode && !GameState.gameOver) {
            console.log('Tab visible, syncing...');
            await syncLatestState();
        }
    });
    
    // Sync when coming back online
    window.addEventListener('online', async () => {
        console.log('Back online, reconnecting...');
        if (GameState.gameCode) {
            subscriptionRetries = 0;
            await setupSupabaseSubscription();
            await syncLatestState();
            showToast('Reconnected!', 'success');
        }
    });
    
    // Update status when going offline
    window.addEventListener('offline', () => {
        console.log('Went offline');
        updateSyncStatus(false);
        showToast('Connection lost', 'warning');
    });
}

async function syncLatestState() {
    if (!supabaseEnabled || !supabaseClient || !GameState.gameCode) return;
    
    try {
        const { data, error } = await supabaseClient
            .from('games')
            .select('*')
            .eq('game_code', GameState.gameCode)
            .maybeSingle();
        
        if (data && !error) {
            const newLastAction = new Date(data.last_action).getTime();
            const currentLastAction = GameState.lastAction ? new Date(GameState.lastAction).getTime() : 0;
            
            if (newLastAction > currentLastAction) {
                applySyncedState(data);
                updateGameDisplay();
            }
        }
    } catch (error) {
        console.log('Sync error:', error);
    }
}

// ==========================================
// INITIALIZATION
// ==========================================

async function init() {
    // Wait for Supabase to initialize
    await new Promise(resolve => setTimeout(resolve, 200));
    
    setupEventListeners();
    setupVisibilityAndNetworkHandlers();
    updateSyncStatus(false);
    
    const urlParams = new URLSearchParams(window.location.search);
    const gameCode = urlParams.get('game');
    
    if (gameCode) {
        await initializeGame(gameCode, false);
        
        const savedRole = localStorage.getItem(`codenames_${gameCode}_role`);
        if (savedRole) {
            GameState.playerRole = savedRole;
            document.getElementById('setup-modal').classList.add('hidden');
            await startGame();
        } else {
            showRoleSelection();
        }
    }
}

document.addEventListener('DOMContentLoaded', init);
