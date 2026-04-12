(() => {
  const PLAYER_COLORS = ["Blue", "Red", "Gold"];
  const DEFAULT_NAMES = ["You", "Blaze", "Rogue", "Ember", "Flint"];
  const MODE_INFO = {
    "Race to Zero": "Race to 0 and stay there until another player loses a duel.",
    "Last Stand": "Duel mode with harsher penalties and elimination at 15+ cards.",
    "Survive the Deck": "Complete House streak runs while specials disrupt the turn.",
    "Party Mode": "Shared-table deck mode where everyone attempts the same run.",
    "Player Battle": "No House deck. Attack the table and win by succeeding with your final card.",
  };
  const SPEED_INFO = {
    fast: { label: "Fast", delay: 1400, resultDelay: 900 },
    normal: { label: "Normal", delay: 2200, resultDelay: 1500 },
    slow: { label: "Slow", delay: 3200, resultDelay: 2200 },
  };
  const PARTY_ALLOWED_SPECIALS = new Set(["bomb", "insideoutside", "colormatch", "suddendeath"]);

  const app = document.getElementById("app");
  let state = { screen: "menu", config: defaultConfig() };
  let aiTimer = null;
  let advanceTimer = null;
  let uiState = { logOpen: false, currentHumanView: null };

  function defaultConfig() {
    return {
      mode: "Race to Zero",
      players: 3,
      speed: "normal",
      seats: [
        { name: "You", type: "Human" },
        { name: "Blaze", type: "AI" },
        { name: "Rogue", type: "AI" },
        { name: "Ember", type: "AI" },
        { name: "Flint", type: "AI" },
      ],
    };
  }

  const isDuelMode = (mode) => mode === "Race to Zero" || mode === "Last Stand";
  const isSoloDeckMode = (mode) => mode === "Survive the Deck";
  const isPartyMode = (mode) => mode === "Party Mode";
  const isBattleMode = (mode) => mode === "Player Battle";

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildPlayerDeck() {
    const dist = { 1: 3, 2: 3, 3: 4, 4: 4, 5: 5, 6: 5, 7: 5, 8: 5, 9: 5, 10: 4, 11: 4, 12: 3, 13: 3 };
    const deck = [];
    for (const color of PLAYER_COLORS) {
      for (const [v, n] of Object.entries(dist)) {
        for (let i = 0; i < n; i++) deck.push({ type: "player", color, value: Number(v), id: uid() });
      }
    }
    return shuffle(deck);
  }

  function buildHouseDeck() {
    const deck = [];
    for (const color of PLAYER_COLORS) {
      for (let v = 1; v <= 13; v++) {
        deck.push({ type: "house", color, value: v, id: uid() });
        deck.push({ type: "house", color, value: v, id: uid() });
      }
    }
    const specials = [
      { special: "bomb", label: "Bomb" },
      { special: "double", label: "Double Down" },
      { special: "double", label: "Double Down" },
      { special: "double", label: "Double Down" },
      { special: "magnet", label: "Magnet" },
      { special: "handoff", label: "Hand Off" },
      { special: "handoff", label: "Hand Off" },
      { special: "insideoutside", label: "Inside / Outside" },
      { special: "insideoutside", label: "Inside / Outside" },
      { special: "colormatch", label: "Color Match" },
      { special: "colormatch", label: "Color Match" },
      { special: "suddendeath", label: "Sudden Death" },
    ];
    for (const s of specials) deck.push({ type: "special", id: uid(), ...s });
    return shuffle(deck);
  }

  function makeDeck(cards) {
    return { cards, reshuffles: 0 };
  }

  function drawMany(deckObj, count, builder) {
    const out = [];
    for (let i = 0; i < count; i++) {
      if (!deckObj.cards.length) {
        deckObj.cards = builder();
        deckObj.reshuffles += 1;
      }
      out.push(deckObj.cards.pop());
    }
    return out;
  }

  function drawHouse(s) {
    return drawMany(s.houseDeck, 1, buildHouseDeck)[0];
  }

  function drawNumberHouse(s, logDiscard = true) {
    while (true) {
      const card = drawHouse(s);
      if (card.type === "house") return card;
      if (logDiscard) addLog(s, `Discarded ${card.label} while redrawing for a numbered House card.`, "major");
    }
  }

  function drawTwoNumberHouse(s, logDiscard = true) {
    return [drawNumberHouse(s, logDiscard), drawNumberHouse(s, logDiscard)];
  }

  function drawPartyHouseCard(s) {
    while (true) {
      const card = drawHouse(s);
      if (card.type === "house") return card;
      if (PARTY_ALLOWED_SPECIALS.has(card.special)) return card;
      addLog(s, `Discarded ${card.label} because it is not used in Party Mode.`, "major");
    }
  }

  function addLog(s, text, kind = "normal") {
    s.log.unshift({ text, kind, id: uid() });
    if (s.log.length > 240) s.log.length = 240;
  }

  function setBanner(s, text, tone = "normal") {
    s.banner = { text, tone };
  }

  function setResult(s, tone, text) {
    s.result = { tone, text };
  }

  function clearResult(s) {
    s.result = null;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function cardLabel(card) {
    if (!card) return "";
    if (card.type === "special") return card.label;
    return `${card.color} ${card.value}`;
  }

  function visibleHumanId(s) {
    const humans = s.players.filter((p) => p.isHuman);
    return humans[0]?.id ?? 0;
  }

  function getHumanIds(s) {
    return s.players.filter((p) => p.isHuman).map((p) => p.id);
  }

  function displayedHumanId(s) {
    const humanIds = getHumanIds(s);
    if (!humanIds.length) return 0;
    if (uiState.currentHumanView == null || !humanIds.includes(uiState.currentHumanView)) {
      const actorId = activeActorId(s);
      uiState.currentHumanView = s.players[actorId]?.isHuman ? actorId : humanIds[0];
    }
    return uiState.currentHumanView;
  }

  function requiresHumanPassScreen(s) {
    const actorId = activeActorId(s);
    return !!s.players[actorId]?.isHuman && actorId !== displayedHumanId(s);
  }

  function switchHumanView(playerId) {
    uiState.currentHumanView = playerId;
    render();
    scheduleTimers();
  }

  function activeActorId(s) {
    if (isBattleMode(s.mode)) {
      if (!s.battle) return s.turnOwner;
      if (s.phase === "battle_defender_select") return s.battle.currentDefenderId;
      return s.battle.attackerId;
    }
    if (isPartyMode(s.mode)) {
      if (s.partyRun?.currentPlayerId != null) return s.partyRun.currentPlayerId;
      return s.turnOwner;
    }
    if (isSoloDeckMode(s.mode)) {
      if (s.deckRun?.magnet?.activePlayerId != null) return s.deckRun.magnet.activePlayerId;
      return s.turnOwner;
    }
    if (s.duel?.magnet?.activePlayerId != null) return s.duel.magnet.activePlayerId;
    if (s.duel) return s.duel.actorId;
    return s.turnOwner;
  }

  function alivePlayers(s) {
    return s.players.filter((p) => !p.eliminated);
  }

  function nextAliveFrom(s, startId) {
    let idx = startId;
    for (let i = 0; i < s.players.length; i++) {
      idx = (idx + 1) % s.players.length;
      if (!s.players[idx].eliminated) return idx;
    }
    return startId;
  }

  function makeSeat(cfg, i, hand) {
    return {
      id: i,
      name: (cfg.name || DEFAULT_NAMES[i] || `Seat ${i + 1}`).trim(),
      isHuman: cfg.type === "Human",
      hand,
      eliminated: false,
      battleZero: false,
    };
  }

  function makeGame(config) {
    const playerDeck = makeDeck(buildPlayerDeck());
    const houseDeck = makeDeck(buildHouseDeck());
    const handSize = config.mode === "Last Stand" ? 7 : (config.mode === "Player Battle" ? 8 : 6);
    const players = [];
    for (let i = 0; i < config.players; i++) {
      players.push(makeSeat(config.seats[i], i, drawMany(playerDeck, handSize, buildPlayerDeck)));
    }

    const initialTurnOwner = isBattleMode(config.mode) ? Math.floor(Math.random() * players.length) : 0;

    const game = {
      screen: "game",
      config: clone(config),
      mode: config.mode,
      speed: config.speed,
      players,
      playerDeck,
      houseDeck,
      turnOwner: initialTurnOwner,
      turnAnchor: initialTurnOwner,
      winner: null,
      banner: { text: "Game started.", tone: "important" },
      result: null,
      log: [],
      stack: [],
      center: { houseCards: [], hiddenCount: 0, label: "House" },
      selection: { handIndex: null, opponentId: null },
      duel: null,
      deckRun: null,
      partyRun: null,
      battle: null,
      pendingAdvance: null,
      phase: isBattleMode(config.mode) ? "battle_start" : (isDuelMode(config.mode) ? "choose_opponent" : (isPartyMode(config.mode) ? "party_start" : "deck_start")),
      visibleHumanSeatId: visibleHumanId({ players }),
    };

    addLog(game, `${config.mode} started.`, "major");
    if (isBattleMode(config.mode)) {
      addLog(game, `${players[initialTurnOwner].name} was chosen randomly to start Player Battle.`, "major");
      setBanner(game, `${players[initialTurnOwner].name} starts first in Player Battle.`, "important");
    }
    else if (isDuelMode(config.mode)) setBanner(game, "Choose an opponent.", "important");
    else if (isPartyMode(config.mode)) setBanner(game, "Start the shared run.", "important");
    else setBanner(game, "Start your run.", "important");
    return game;
  }

  function showCenterCards(s, cards, label = "House", hiddenCount = 0) {
    s.center.houseCards = cards || [];
    s.center.hiddenCount = hiddenCount || 0;
    s.center.label = label;
  }

  function clearCenter(s) {
    s.center.houseCards = [];
    s.center.hiddenCount = 0;
    s.center.label = "House";
  }

  function ensureCardToAct(s, playerId) {
    const p = s.players[playerId];
    if (p.hand.length > 0) return;
    const drawn = drawMany(s.playerDeck, 1, buildPlayerDeck);
    p.hand.push(...drawn);
    addLog(s, `${p.name} had no cards and drew 1 to continue.`, "major");
  }

  function duelPenalty(mode, stackSize, s = null) {
    if (mode === "Last Stand") {
      const dangerLevel = s ? s.players.filter((p) => p.eliminated).length : 0;
      return Math.min(7, Math.ceil(stackSize / 2) + 2 + dangerLevel);
    }
    return Math.max(2, Math.min(5, Math.ceil(stackSize / 2) + 1));
  }

  function deckPenalty(unresolvedIncludingFailed) {
    return Math.max(2, Math.min(5, unresolvedIncludingFailed + 1));
  }

  function battleActivePlayers(s) {
    return s.players.filter((p) => !p.battleZero);
  }

  function battleNeeded(defenderCount) {
    return Math.floor(defenderCount / 2) + 1;
  }

  function battleHasMultipleZeroPlayers(s) {
    return s.players.filter((p) => p.battleZero).length > 1;
  }

  function battleResetZeroPlayers(s) {
    const zeroPlayers = s.players.filter((p) => p.battleZero);
    zeroPlayers.forEach((p) => {
      applyDrawPenalty(s, p.id, 1);
      p.battleZero = false;
    });
    return zeroPlayers.map((p) => p.name);
  }

  function battleMarkZero(s, playerId) {
    s.players[playerId].battleZero = true;
  }

  function battleAdvanceTurnOwner(s) {
    const candidate = (s.turnOwner + 1) % s.players.length;
    const candidatePlayer = s.players[candidate];

    if (candidatePlayer?.battleZero) {
      const zeroPlayers = s.players.filter((p) => p.battleZero);
      if (zeroPlayers.length === 1) {
        s.winner = candidatePlayer.name;
        setBanner(s, `${candidatePlayer.name} wins Player Battle.`, "win");
        setResult(s, "win", `${candidatePlayer.name} completed a full cycle at 0 cards.`);
        addLog(s, `${candidatePlayer.name} completed a full cycle at 0 and wins Player Battle.`, "win");
        return;
      }
      const names = battleResetZeroPlayers(s);
      addLog(s, `${names.join(", ")} were tied at 0 when the turn cycled back. They each draw 1 and rejoin play.`, "major");
      setBanner(s, `Tied players at 0 draw 1 and rejoin play.`, "important");
    }

    s.turnOwner = candidate;
  }

  function weightedIndex(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  function battleDefenseIndex(hand) {
    if (!hand.length) return 0;
    const sortedByMiddle = hand.map((c, i) => ({ i, score: Math.abs(c.value - 7) })).sort((a, b) => a.score - b.score);
    const sortedLow = hand.map((c, i) => ({ i, score: c.value })).sort((a, b) => a.score - b.score);
    const sortedHigh = hand.map((c, i) => ({ i, score: c.value })).sort((a, b) => b.score - a.score);

    const style = weightedIndex([55, 20, 15, 10]);
    if (style === 0) return sortedByMiddle[0].i;
    if (style === 1) return sortedLow[0].i;
    if (style === 2) return sortedHigh[0].i;

    const pool = Array.from(new Set([
      sortedByMiddle[0]?.i,
      sortedByMiddle[1]?.i,
      sortedLow[0]?.i,
      sortedHigh[0]?.i,
    ].filter((v) => v != null)));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function battleChooseAttackMove(hand) {
    if (!hand.length) return { index: 0, guess: "higher" };
    const ranked = hand.map((card, index) => {
      const up = 13 - card.value;
      const down = card.value - 1;
      return {
        index,
        card,
        guess: up >= down ? "higher" : "lower",
        score: Math.max(up, down),
        altGuess: up >= down ? "lower" : "higher",
      };
    }).sort((a, b) => b.score - a.score);

    const style = weightedIndex([60, 25, 15]);
    if (style === 0) return { index: ranked[0].index, guess: ranked[0].guess };
    if (style === 1) {
      const second = ranked[Math.min(1, ranked.length - 1)];
      return { index: second.index, guess: second.guess };
    }

    const riskyPool = ranked.slice(Math.min(2, ranked.length - 1)).concat(ranked.slice(0, Math.min(2, ranked.length)));
    const pick = riskyPool[Math.floor(Math.random() * riskyPool.length)];
    const riskyGuess = Math.random() < 0.7 ? pick.guess : pick.altGuess;
    return { index: pick.index, guess: riskyGuess };
  }

  function streakFromValue(v) {
    if (v <= 4) return 2;
    if (v <= 8) return 3;
    if (v <= 11) return 4;
    return 5;
  }

  function bestIndex(hand) {
    if (!hand.length) return 0;
    let best = 0;
    let bestScore = -1;
    hand.forEach((c, i) => {
      const score = Math.max(c.value - 1, 13 - c.value);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  function bestHigherLower(card) {
    return card.value <= 7 ? "higher" : "lower";
  }

  function compareHigherLower(played, house, guess) {
    if (house.value === played.value) return false;
    return guess === "higher" ? house.value > played.value : house.value < played.value;
  }

  function compareColor(house, guess) {
    return house.color === guess;
  }

  function compareInsideOutside(played, houseA, houseB, guess) {
    if (houseA.value === played.value || houseB.value === played.value) return false;
    const low = Math.min(houseA.value, houseB.value);
    const high = Math.max(houseA.value, houseB.value);
    if (guess === "inside") return played.value > low && played.value < high;
    return played.value < low || played.value > high;
  }

  function refreshEliminations(s) {
    if (isDuelMode(s.mode)) {
      if (s.mode !== "Last Stand") return;
    }
    for (const p of s.players) {
      if (!p.eliminated && p.hand.length >= 15 && (s.mode === "Last Stand" || s.mode === "Survive the Deck" || s.mode === "Party Mode")) {
        p.eliminated = true;
        addLog(s, `${p.name} is eliminated at ${p.hand.length} cards.`, "loss");
      }
    }
  }

  function maybeSetWinner(s) {
    if (s.mode === "Race to Zero" || isBattleMode(s.mode)) return;
    refreshEliminations(s);
    const alive = alivePlayers(s);
    if (alive.length === 1) {
      s.winner = alive[0].name;
      setBanner(s, `${alive[0].name} wins ${s.mode}.`, "win");
      setResult(s, "win", `${alive[0].name} is the winner.`);
    } else if (alive.length === 0) {
      s.winner = "No winner";
      setBanner(s, `All players were eliminated.`, "loss");
      setResult(s, "loss", `All players were eliminated.`);
    }
  }

  function playerCommitCard(s, playerId, handIndex, toStack = true) {
    const p = s.players[playerId];
    const card = p.hand.splice(handIndex, 1)[0];
    if (toStack && card) s.stack.push(card);
    return card;
  }

  function applyDrawPenalty(s, playerId, count) {
    const cards = drawMany(s.playerDeck, count, buildPlayerDeck);
    s.players[playerId].hand.push(...cards);
    addLog(s, `${s.players[playerId].name} draws ${count} card${count === 1 ? "" : "s"}.`, "loss");
  }

  function raceToZeroWinnerCheckOnPenalty(s, loserId) {
    if (s.mode !== "Race to Zero") return;
    const zeroPlayers = s.players.filter((p, idx) => idx !== loserId && p.hand.length === 0);
    if (zeroPlayers.length) {
      s.winner = zeroPlayers[0].name;
      setBanner(s, `${s.winner} wins Race to Zero.`, "win");
      setResult(s, "win", `${s.winner} stayed at 0 until another player lost a duel.`);
    }
  }

  function clearRoundArtifacts(s) {
    s.stack = [];
    clearCenter(s);
    clearResult(s);
    s.selection.handIndex = null;
  }

  function finishTurnAdvance(s) {
    maybeSetWinner(s);
    s.pendingAdvance = null;
    if (s.winner) {
      s.stack = [];
      return;
    }
    if (isBattleMode(s.mode)) {
      battleAdvanceTurnOwner(s);
      s.phase = "battle_start";
      s.battle = null;
      clearRoundArtifacts(s);
      if (!s.winner) {
        setBanner(s, `${s.players[s.turnOwner].name}'s turn. Begin the attack.`, "important");
      }
    } else if (isPartyMode(s.mode)) {
      s.turnOwner = nextAliveFrom(s, s.turnAnchor);
      s.turnAnchor = s.turnOwner;
      s.phase = "party_start";
      s.partyRun = null;
      clearRoundArtifacts(s);
      setBanner(s, `${s.players[s.turnOwner].name}'s turn. Start the shared run.`, "important");
    } else if (isSoloDeckMode(s.mode)) {
      s.turnOwner = nextAliveFrom(s, s.turnAnchor);
      s.turnAnchor = s.turnOwner;
      s.phase = "deck_start";
      s.deckRun = null;
      clearRoundArtifacts(s);
      setBanner(s, `${s.players[s.turnOwner].name}'s turn. Start a run.`, "important");
    } else {
      s.turnOwner = nextAliveFrom(s, s.turnOwner);
      s.phase = "choose_opponent";
      s.selection.opponentId = null;
      s.duel = null;
      clearRoundArtifacts(s);
      setBanner(s, `${s.players[s.turnOwner].name}'s turn. Choose an opponent.`, "important");
    }
  }

  function queueAdvance(s, type, extra = {}) {
    s.pendingAdvance = { type, ...extra };
  }

  function currentResultDelay(s) {
    return SPEED_INFO[s.speed]?.resultDelay || SPEED_INFO.normal.resultDelay;
  }

  function duelLoss(s, loserId) {
    const pen = duelPenalty(s.mode, s.stack.length, s);
    addLog(s, `${s.players[loserId].name} loses the duel and takes ${pen}.`, "loss");
    applyDrawPenalty(s, loserId, pen);
    raceToZeroWinnerCheckOnPenalty(s, loserId);
    refreshEliminations(s);
    queueAdvance(s, "finish_turn");
  }

  function deckUnresolvedIncludingFailed(s) {
    if (!s.deckRun) return 0;
    return Math.max(1, s.deckRun.streak - s.deckRun.progress);
  }

  function partyUnresolvedIncludingCurrent(s) {
    if (!s.partyRun) return 0;
    return Math.max(1, s.partyRun.streak - s.partyRun.step);
  }

  function deckRunLoss(s, loserId, unresolvedIncludingFailed) {
    const pen = deckPenalty(unresolvedIncludingFailed);
    addLog(s, `${s.players[loserId].name} fails the run and takes ${pen}.`, "loss");
    applyDrawPenalty(s, loserId, pen);
    refreshEliminations(s);
    queueAdvance(s, "finish_turn");
  }

  function partyPlayerFails(s, playerId) {
    const pen = deckPenalty(partyUnresolvedIncludingCurrent(s));
    addLog(s, `${s.players[playerId].name} fails the shared run attempt and takes ${pen}.`, "loss");
    applyDrawPenalty(s, playerId, pen);
    refreshEliminations(s);
    queueAdvance(s, "party_continue", { removeFromFuture: true });
  }

  function battleHitPenalty() {
    return 1;
  }

  function startBattleTurn(s) {
    const attackerId = s.turnOwner;
    ensureCardToAct(s, attackerId);
    const defenderIds = s.players.filter((p) => p.id !== attackerId && !p.battleZero).map((p) => p.id);
    s.stack = [];
    s.battle = {
      attackerId,
      defenderIds,
      currentDefenderId: null,
      committed: {},
      attackerCard: null,
      guess: null,
      correctCount: 0,
      needed: battleNeeded(defenderIds.length),
      resolvedCards: [],
    };
    clearResult(s);
    clearCenter(s);
    addLog(s, `${s.players[attackerId].name} begins a Player Battle attack.`, "major");
    processBattleSetup(s);
  }

  function processBattleSetup(s) {
    const battle = s.battle;
    while (true) {
      const unresolved = battle.defenderIds.filter((id) => !battle.committed[id]);
      if (!unresolved.length) {
        battle.currentDefenderId = null;
        s.phase = "battle_attack_select";
        s.selection.handIndex = null;
        showCenterCards(s, battle.attackerCard ? [battle.attackerCard] : [], "Defender Cards", battle.defenderIds.length);
        setBanner(s, `${s.players[battle.attackerId].name}, choose your attack card.`, "important");
        return;
      }
      const nextId = unresolved[0];
      battle.currentDefenderId = nextId;
      ensureCardToAct(s, nextId);
      if (s.players[nextId].isHuman) {
        s.phase = "battle_defender_select";
        s.selection.handIndex = null;
        showCenterCards(s, battle.attackerCard ? [battle.attackerCard] : [], "Defender Cards", Object.keys(battle.committed).length);
        setBanner(s, `${s.players[nextId].name}, commit a defense card.`, "important");
        return;
      }
      commitBattleDefense(s, nextId, battleDefenseIndex(s.players[nextId].hand));
    }
  }

  function commitBattleDefense(s, defenderId, handIndex) {
    const card = playerCommitCard(s, defenderId, handIndex, false);
    s.battle.committed[defenderId] = card;
    addLog(s, `${s.players[defenderId].name} commits a face-down defense card.`, "major");
    if (s.players[defenderId].hand.length === 0) {
      battleMarkZero(s, defenderId);
      addLog(s, `${s.players[defenderId].name} reached 0 on defense and is temporarily out of active play.`, "major");
    }
    showCenterCards(s, s.battle.attackerCard ? [s.battle.attackerCard] : [], "Defender Cards", Object.keys(s.battle.committed).length);
  }

  function resolveBattleAttack(s, handIndex, guess) {
    const battle = s.battle;
    const attackerId = battle.attackerId;
    const attackerCard = playerCommitCard(s, attackerId, handIndex, false);
    battle.attackerCard = attackerCard;
    battle.guess = guess;
    const revealed = battle.defenderIds.map((id) => ({ playerId: id, card: battle.committed[id] }));
    battle.resolvedCards = revealed;
    const correctIds = [];
    const wrongIds = [];
    revealed.forEach(({ playerId, card }) => {
      const ok = compareHigherLower(attackerCard, card, guess);
      if (ok) correctIds.push(playerId);
      else wrongIds.push(playerId);
      addLog(s, `${s.players[playerId].name} revealed ${cardLabel(card)}. ${guess} was ${ok ? "right" : "wrong"} against ${cardLabel(attackerCard)}.`, ok ? "win" : "loss");
    });
    battle.correctCount = correctIds.length;
    const success = correctIds.length >= battle.needed;
    showCenterCards(s, [attackerCard, ...revealed.map((r) => r.card)], "Player Battle Reveal");
    if (success) {
      correctIds.forEach((playerId) => {
        applyDrawPenalty(s, playerId, battleHitPenalty());
      });
      setResult(s, "win", `${s.players[attackerId].name} was correct against ${correctIds.length} of ${battle.defenderIds.length}.`);
      addLog(s, `${s.players[attackerId].name} wins the attack (${correctIds.length}/${battle.defenderIds.length}).`, "win");
      if (s.players[attackerId].hand.length === 0) {
        battleMarkZero(s, attackerId);
        setBanner(s, `${s.players[attackerId].name} reached 0 and is out until the cycle returns.`, "important");
        setResult(s, "win", `${s.players[attackerId].name} reached 0. The cycle continues for the remaining players.`);
        addLog(s, `${s.players[attackerId].name} reached 0 and is temporarily out of active play.`, "major");
      }
      queueAdvance(s, "finish_turn");
      return;
    }
    const failPenalty = correctIds.length > 0 ? 3 : 4;
    applyDrawPenalty(s, attackerId, failPenalty);
    setResult(s, "loss", `${s.players[attackerId].name} failed the attack (${correctIds.length}/${battle.defenderIds.length}).`);
    addLog(s, `${s.players[attackerId].name} fails the attack and draws ${failPenalty}.`, "loss");
    queueAdvance(s, "finish_turn");
  }

  function beginDuel(s, defenderId) {
    const attackerId = s.turnOwner;
    ensureCardToAct(s, attackerId);
    s.duel = {
      attackerId,
      defenderId,
      actorId: attackerId,
      successfulExchangeCompleted: false,
      special: null,
      magnet: null,
    };
    s.phase = "select_card";
    s.selection.opponentId = defenderId;
    s.selection.handIndex = null;
    clearResult(s);
    clearCenter(s);
    addLog(s, `${s.players[attackerId].name} challenges ${s.players[defenderId].name}.`, "major");
    setBanner(s, `${s.players[attackerId].name} attacks ${s.players[defenderId].name}.`, "important");
  }

  function startDeckRun(s) {
    const pid = s.turnOwner;
    ensureCardToAct(s, pid);
    const top = drawNumberHouse(s, true);
    const streak = streakFromValue(top.value);
    s.stack = [];
    s.deckRun = {
      originalPlayerId: pid,
      currentResolverId: pid,
      streak,
      progress: 0,
      startCard: top,
      special: null,
      magnet: null,
      handoffFrom: null,
    };
    s.phase = "select_card";
    clearResult(s);
    showCenterCards(s, [top], "Run Start");
    addLog(s, `${s.players[pid].name} starts a ${streak}-guess run from ${cardLabel(top)}.`, "major");
    setBanner(s, `${s.players[pid].name} started a ${streak}-guess run.`, "important");
  }

  function orderedAliveIdsFrom(s, startId) {
    const aliveIds = alivePlayers(s).map((p) => p.id);
    const startIndex = aliveIds.indexOf(startId);
    const ordered = [];
    for (let i = 0; i < aliveIds.length; i++) ordered.push(aliveIds[(startIndex + i) % aliveIds.length]);
    return ordered;
  }

  function preparePartySubmissionTurn(s) {
      const pr = s.partyRun;
      if (!pr || !pr.order.length) return;
      pr.currentPlayerId = pr.order[pr.index];
      ensureCardToAct(s, pr.currentPlayerId);
      s.phase = "select_card";
      s.selection.handIndex = null;
      clearResult(s);
      clearCenter(s);
      setBanner(s, `${s.players[pr.currentPlayerId].name} chooses for shared guess ${pr.step + 1} of ${pr.streak}.`, "important");
    }
  
    function preparePartySpecialChoiceTurn(s) {
      const pr = s.partyRun;
      const sp = pr?.special;
      if (!sp) return;
      const entry = sp.entries[sp.choiceIndex];
      pr.currentPlayerId = entry.playerId;
      ensureCardToAct(s, pr.currentPlayerId);
      s.phase = "special_guess";
      s.selection.handIndex = null;
      if (sp.type === "insideoutside") setBanner(s, `${s.players[pr.currentPlayerId].name} chooses Inside or Outside.`, "important");
      else if (sp.type === "colormatch") setBanner(s, `${s.players[pr.currentPlayerId].name} chooses a color.`, "important");
    }
  
    function partyApplyFailurePenalties(s, failedIds) {
      const pen = deckPenalty(partyUnresolvedIncludingCurrent(s));
      failedIds.forEach((playerId) => {
        addLog(s, `${s.players[playerId].name} takes ${pen} from the shared run.`, "loss");
        applyDrawPenalty(s, playerId, pen);
      });
      refreshEliminations(s);
    }
  
    function finalizePartyStepResults(s, failedIds, removedIds = []) {
      const pr = s.partyRun;
      const removalSet = new Set([...failedIds, ...removedIds]);
      partyApplyFailurePenalties(s, failedIds);
      pr.activeIds = pr.activeIds.filter((id) => !removalSet.has(id) && !s.players[id].eliminated);

      const aliveCount = alivePlayers(s).length;
      if (aliveCount <= 1) {
        queueAdvance(s, "finish_turn");
        return;
      }

      if (pr.activeIds.length === 0) {
        addLog(s, `No players remain in the shared run.`, "major");
        queueAdvance(s, "finish_turn");
        return;
      }
      if (pr.step + 1 >= pr.streak) {
        addLog(s, `The shared run is complete.`, "win");
        queueAdvance(s, "finish_turn");
        return;
      }
      queueAdvance(s, "party_next_step");
    }
  
    function resolvePartySubmittedStep(s) {
      const pr = s.partyRun;
      const house = drawPartyHouseCard(s);
      if (house.type === "special") return resolvePartySpecial(s, house);
      showCenterCards(s, [house], "Shared Reveal");
      const failedIds = [];
      let successCount = 0;
      pr.entries.forEach((entry) => {
        const ok = compareHigherLower(entry.playedCard, house, entry.guess);
        addLog(s, `${s.players[entry.playerId].name} used ${cardLabel(entry.playedCard)}, guessed ${entry.guess}, shared House was ${cardLabel(house)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
        if (ok) successCount += 1;
        else failedIds.push(entry.playerId);
      });
      setResult(s, failedIds.length ? "loss" : "win", failedIds.length ? `${failedIds.length} player${failedIds.length === 1 ? "" : "s"} failed the shared reveal.` : `Everyone survived the shared reveal.`);
      finalizePartyStepResults(s, failedIds, []);
    }
  
    function resolvePartySharedSpecialChoices(s) {
      const pr = s.partyRun;
      const sp = pr?.special;
      if (!sp) return;
      if (sp.type === "insideoutside") {
        const [h1, h2] = sp.housePair;
        showCenterCards(s, [h1, h2], "Inside / Outside");
        const failedIds = [];
        let successCount = 0;
        sp.entries.forEach((entry) => {
          const choice = sp.choices[entry.playerId];
          const ok = compareInsideOutside(entry.playedCard, h1, h2, choice);
          addLog(s, `${s.players[entry.playerId].name} chose ${choice} with ${cardLabel(entry.playedCard)} against ${cardLabel(h1)} and ${cardLabel(h2)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
          if (ok) successCount += 1;
          else failedIds.push(entry.playerId);
        });
        setResult(s, failedIds.length ? "loss" : "win", failedIds.length ? `${failedIds.length} player${failedIds.length === 1 ? "" : "s"} failed Inside / Outside.` : `Everyone survived Inside / Outside.`);
        pr.special = null;
        finalizePartyStepResults(s, failedIds, []);
        return;
      }
      if (sp.type === "colormatch") {
        const h = sp.houseCard;
        showCenterCards(s, [h], "Color Match");
        const failedIds = [];
        let successCount = 0;
        sp.entries.forEach((entry) => {
          const choice = sp.choices[entry.playerId];
          const ok = compareColor(h, choice);
          addLog(s, `${s.players[entry.playerId].name} guessed ${choice} and shared House was ${cardLabel(h)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
          if (ok) successCount += 1;
          else failedIds.push(entry.playerId);
        });
        setResult(s, failedIds.length ? "loss" : "win", failedIds.length ? `${failedIds.length} player${failedIds.length === 1 ? "" : "s"} missed the color.` : `Everyone matched the color.`);
        pr.special = null;
        finalizePartyStepResults(s, failedIds, []);
        return;
      }
    }
  
    function partyAdvanceToNextStep(s) {
      const pr = s.partyRun;
      if (!pr) return;
      pr.step += 1;
      pr.order = [...pr.activeIds];
      pr.index = 0;
      pr.entries = [];
      pr.special = null;
      preparePartySubmissionTurn(s);
    }

  function startPartyRound(s) {
    const pid = s.turnOwner;
    ensureCardToAct(s, pid);
    const top = drawNumberHouse(s, true);
    const streak = streakFromValue(top.value);
    const order = orderedAliveIdsFrom(s, pid);
    s.stack = [];
    s.partyRun = {
      streak,
      step: 0,
      startCard: top,
      activeIds: [...order],
      order: [...order],
      index: 0,
      currentPlayerId: order[0],
      entries: [],
      special: null,
    };
    clearResult(s);
    showCenterCards(s, [top], "Shared Run Start");
    addLog(s, `${s.players[pid].name} starts a shared ${streak}-guess run from ${cardLabel(top)}.`, "major");
    preparePartySubmissionTurn(s);
  }

  function partyAdvanceAfterResolvedPlayer(s, removeFromFuture) {
    partyAdvanceToNextStep(s);
  }

  function postDuelSuccessAdvance(s) {
    const duel = s.duel;
    if (!duel) return;
    if (duel.actorId === duel.attackerId) {
      duel.actorId = duel.defenderId;
      ensureCardToAct(s, duel.defenderId);
      s.phase = "select_card";
      s.selection.handIndex = null;
      setBanner(s, `${s.players[duel.defenderId].name} must respond.`, "important");
      addLog(s, `Duel passes to ${s.players[duel.defenderId].name} to respond.`, "major");
    } else {
      duel.successfulExchangeCompleted = true;
      duel.actorId = duel.attackerId;
      ensureCardToAct(s, duel.attackerId);
      s.phase = "press_or_pass";
      s.selection.handIndex = null;
      setBanner(s, `${s.players[duel.attackerId].name} may press or pass.`, "important");
      addLog(s, `${s.players[duel.defenderId].name} survived. ${s.players[duel.attackerId].name} may press or pass.`, "major");
    }
  }

  function resolveDuelNormalGuess(s, actorId, handIndex, guess) {
    const played = playerCommitCard(s, actorId, handIndex, true);
    const house = drawHouse(s);
    if (house.type === "special") return resolveDuelSpecial(s, actorId, played, house, guess);
    showCenterCards(s, [house], "House Reveal");
    const ok = compareHigherLower(played, house, guess);
    addLog(s, `${s.players[actorId].name} played ${cardLabel(played)}, guessed ${guess}, House was ${cardLabel(house)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
    setResult(s, ok ? "win" : "loss", `${s.players[actorId].name} ${ok ? "was correct" : "was wrong"}. House: ${cardLabel(house)}.`);
    if (!ok) duelLoss(s, actorId);
    else postDuelSuccessAdvance(s);
  }

  function resolveDuelSpecial(s, actorId, played, specialCard, originalGuess) {
    const duel = s.duel;
    const name = s.players[actorId].name;
    showCenterCards(s, [specialCard], "Special Reveal");
    addLog(s, `${name} revealed ${specialCard.label} in a duel.`, "major");

    if (specialCard.special === "bomb") {
      setResult(s, "loss", `Bomb. ${name} immediately loses the duel.`);
      duelLoss(s, actorId);
      return;
    }
    if (specialCard.special === "double") {
      const [h1, h2] = drawTwoNumberHouse(s, true);
      duel.special = { type: "double", actorId, playedCard: played, hiddenQueue: [h1, h2] };
      showCenterCards(s, [], "Double Down", 2);
      s.phase = "special_guess";
      setBanner(s, `${name} must clear 2 hidden House cards.`, "important");
      setResult(s, "normal", "Double Down. Use the same committed card against 2 House cards.");
      return;
    }
    if (specialCard.special === "insideoutside") {
      const [h1, h2] = drawTwoNumberHouse(s, true);
      duel.special = { type: "insideoutside", actorId, playedCard: played, housePair: [h1, h2] };
      showCenterCards(s, [], "Inside / Outside", 2);
      s.phase = "special_guess";
      setBanner(s, `${name} must choose Inside or Outside.`, "important");
      setResult(s, "normal", "Inside / Outside. One committed card versus two hidden House cards.");
      addLog(s, `Inside / Outside pair prepared: ${cardLabel(h1)} and ${cardLabel(h2)}.`, "major");
      return;
    }
    if (specialCard.special === "colormatch") {
      const h = drawNumberHouse(s, true);
      duel.special = { type: "colormatch", actorId, playedCard: played, houseCard: h };
      showCenterCards(s, [], "Color Match", 1);
      s.phase = "special_guess";
      setBanner(s, `${name} must choose a color.`, "important");
      setResult(s, "normal", "Color Match. Choose Blue, Red, or Gold.");
      return;
    }
    if (specialCard.special === "handoff") {
      addLog(s, `Hand Off is not used in duel modes. Discarding and drawing a replacement House card.`, "major");
      const replacement = drawHouse(s);
      if (replacement.type === "special") return resolveDuelSpecial(s, actorId, played, replacement, originalGuess);
      showCenterCards(s, [replacement], "House Reveal");
      const ok = compareHigherLower(played, replacement, originalGuess);
      addLog(s, `${name} continued after Hand Off redraw. Guessed ${originalGuess}, House was ${cardLabel(replacement)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "was correct" : "was wrong"}. House: ${cardLabel(replacement)}.`);
      if (!ok) duelLoss(s, actorId);
      else postDuelSuccessAdvance(s);
      return;
    }
    if (specialCard.special === "magnet") {
      const ordered = orderedAliveIdsFrom(s, actorId);
      duel.magnet = { triggerActorId: actorId, committedCard: played, order: ordered, currentIndex: 0, activePlayerId: actorId };
      s.phase = "magnet_guess";
      setBanner(s, `${name} begins Magnet using the committed card.`, "important");
      setResult(s, "normal", "Magnet interrupts the duel.");
      addLog(s, `${name}'s committed card stays spent for Magnet.`, "major");
      return;
    }
    if (specialCard.special === "suddendeath") {
      addLog(s, `Sudden Death is only active in Party Mode. Redrawing a numbered House card.`, "major");
      const fallback = drawNumberHouse(s, true);
      showCenterCards(s, [fallback], "House Reveal");
      const ok = compareHigherLower(played, fallback, originalGuess);
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "was correct" : "was wrong"}. House: ${cardLabel(fallback)}.`);
      if (!ok) duelLoss(s, actorId); else postDuelSuccessAdvance(s);
    }
  }

  function resolveDuelSpecialChoice(s, guess) {
    const sp = s.duel?.special;
    if (!sp) return;
    const actorId = sp.actorId;
    const name = s.players[actorId].name;
    if (sp.type === "double") {
      const house = sp.hiddenQueue.shift();
      showCenterCards(s, [house], "Double Down Reveal", sp.hiddenQueue.length);
      const ok = compareHigherLower(sp.playedCard, house, guess);
      addLog(s, `${name} Double Down guessed ${guess} against ${cardLabel(house)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "cleared" : "failed"} a Double Down card.`);
      if (!ok) {
        s.duel.special = null;
        duelLoss(s, actorId);
        return;
      }
      if (sp.hiddenQueue.length) {
        showCenterCards(s, [], "Double Down", sp.hiddenQueue.length);
        setBanner(s, `${name} cleared one. One hidden card remains.`, "important");
        return;
      }
      s.duel.special = null;
      setBanner(s, `${name} cleared Double Down. Duel continues.`, "important");
      addLog(s, `${name} cleared Double Down.`, "major");
      postDuelSuccessAdvance(s);
      return;
    }
    if (sp.type === "insideoutside") {
      const [h1, h2] = sp.housePair;
      showCenterCards(s, [h1, h2], "Inside / Outside");
      const ok = compareInsideOutside(sp.playedCard, h1, h2, guess);
      addLog(s, `${name} Inside / Outside with ${cardLabel(sp.playedCard)} against ${cardLabel(h1)} and ${cardLabel(h2)}, guessed ${guess}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "was correct" : "was wrong"} on Inside / Outside.`);
      s.duel.special = null;
      if (!ok) duelLoss(s, actorId); else postDuelSuccessAdvance(s);
      return;
    }
    if (sp.type === "colormatch") {
      const h = sp.houseCard;
      showCenterCards(s, [h], "Color Match");
      const ok = compareColor(h, guess);
      addLog(s, `${name} Color Match guessed ${guess}, House was ${cardLabel(h)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "matched" : "missed"} the color.`);
      s.duel.special = null;
      if (!ok) duelLoss(s, actorId); else postDuelSuccessAdvance(s);
    }
  }

  function resumeAfterSuccessfulDuelMagnet(s) {
    const duel = s.duel;
    if (!duel?.magnet) return;
    const triggerActor = duel.magnet.triggerActorId;
    duel.magnet = null;
    if (triggerActor === duel.attackerId) {
      duel.actorId = duel.defenderId;
      ensureCardToAct(s, duel.defenderId);
      s.phase = "select_card";
      s.selection.handIndex = null;
      setBanner(s, `${s.players[duel.defenderId].name} must respond after Magnet.`, "important");
      addLog(s, `Magnet ended with no failure. Duel returns to ${s.players[duel.defenderId].name}.`, "major");
    } else {
      duel.actorId = duel.attackerId;
      ensureCardToAct(s, duel.attackerId);
      s.phase = "press_or_pass";
      s.selection.handIndex = null;
      duel.successfulExchangeCompleted = true;
      setBanner(s, `${s.players[duel.attackerId].name} may press or pass after Magnet.`, "important");
      addLog(s, `Magnet ended with no failure. Duel returns to ${s.players[duel.attackerId].name}.`, "major");
    }
  }

  function resolveDuelMagnetGuess(s, guess, handIndex = null) {
    const magnet = s.duel?.magnet;
    if (!magnet) return;
    const pid = magnet.activePlayerId;
    const player = s.players[pid];
    let played;
    if (pid === magnet.triggerActorId) played = magnet.committedCard;
    else {
      ensureCardToAct(s, pid);
      played = playerCommitCard(s, pid, handIndex, true);
    }
    const house = drawNumberHouse(s, true);
    showCenterCards(s, [house], "Magnet");
    const ok = compareHigherLower(played, house, guess);
    addLog(s, `${player.name} Magnet guessed ${guess} with ${cardLabel(played)} vs ${cardLabel(house)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
    setResult(s, ok ? "win" : "loss", `${player.name} ${ok ? "survived" : "failed"} Magnet.`);
    if (!ok) {
      duelLoss(s, pid);
      return;
    }
    magnet.currentIndex += 1;
    if (magnet.currentIndex >= magnet.order.length) {
      resumeAfterSuccessfulDuelMagnet(s);
      return;
    }
    magnet.activePlayerId = magnet.order[magnet.currentIndex];
    s.phase = "magnet_guess";
    setBanner(s, `${s.players[magnet.activePlayerId].name} resolves the next Magnet guess.`, "important");
  }

  function resolveDeckGuessWithPlayed(s, resolverId, played, guess) {
    const house = drawHouse(s);
    if (house.type === "special") return resolveDeckSpecial(s, resolverId, played, guess, house);
    showCenterCards(s, [house], "House Reveal");
    const ok = compareHigherLower(played, house, guess);
    addLog(s, `${s.players[resolverId].name} played ${cardLabel(played)}, guessed ${guess}, House was ${cardLabel(house)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
    setResult(s, ok ? "win" : "loss", `${s.players[resolverId].name} ${ok ? "was correct" : "was wrong"}.`);
    if (!ok) {
      deckRunLoss(s, resolverId, deckUnresolvedIncludingFailed(s));
      return;
    }
    s.deckRun.progress += 1;
    if (s.deckRun.progress >= s.deckRun.streak) {
      addLog(s, `${s.players[s.deckRun.originalPlayerId].name} completed the run.`, "win");
      queueAdvance(s, "finish_turn");
      return;
    }
    s.phase = "select_card";
    s.selection.handIndex = null;
    setBanner(s, `${s.players[s.deckRun.currentResolverId].name} continues the run.`, "important");
  }

  function resolveDeckSpecial(s, resolverId, played, originalGuess, specialCard) {
    const name = s.players[resolverId].name;
    showCenterCards(s, [specialCard], "Special Reveal");
    addLog(s, `${name} revealed ${specialCard.label} during a run.`, "major");
    if (specialCard.special === "bomb") {
      setResult(s, "loss", `Bomb. ${name} immediately fails the run.`);
      deckRunLoss(s, resolverId, deckUnresolvedIncludingFailed(s));
      return;
    }
    if (specialCard.special === "double") {
      const [h1, h2] = drawTwoNumberHouse(s, true);
      s.deckRun.special = { type: "double", actorId: resolverId, playedCard: played, hiddenQueue: [h1, h2] };
      showCenterCards(s, [], "Double Down", 2);
      s.phase = "special_guess";
      setBanner(s, `${name} must clear 2 hidden House cards with the same committed card.`, "important");
      setResult(s, "normal", "Double Down interrupted the run.");
      return;
    }
    if (specialCard.special === "insideoutside") {
      const [h1, h2] = drawTwoNumberHouse(s, true);
      s.deckRun.special = { type: "insideoutside", actorId: resolverId, playedCard: played, housePair: [h1, h2] };
      showCenterCards(s, [], "Inside / Outside", 2);
      s.phase = "special_guess";
      setBanner(s, `${name} must choose Inside or Outside.`, "important");
      setResult(s, "normal", "Inside / Outside. One committed card versus two hidden House cards.");
      addLog(s, `Inside / Outside pair prepared: ${cardLabel(h1)} and ${cardLabel(h2)}.`, "major");
      return;
    }
    if (specialCard.special === "colormatch") {
      const h = drawNumberHouse(s, true);
      s.deckRun.special = { type: "colormatch", actorId: resolverId, playedCard: played, houseCard: h };
      showCenterCards(s, [], "Color Match", 1);
      s.phase = "special_guess";
      setBanner(s, `${name} must choose a color.`, "important");
      setResult(s, "normal", "Color Match interrupted the run.");
      return;
    }
    if (specialCard.special === "magnet") {
      const ordered = orderedAliveIdsFrom(s, resolverId);
      s.deckRun.magnet = { originalResolverId: resolverId, committedCard: played, order: ordered, currentIndex: 0, activePlayerId: resolverId };
      s.phase = "magnet_guess";
      setBanner(s, `${name} begins Magnet with the committed card.`, "important");
      setResult(s, "normal", "Magnet paused the run.");
      addLog(s, `${name}'s committed card stays spent for Magnet.`, "major");
      return;
    }
    if (specialCard.special === "handoff") {
      applyDrawPenalty(s, resolverId, 1);
      s.deckRun.special = { type: "handoff", actorId: resolverId };
      s.phase = "choose_handoff_target";
      s.selection.handIndex = null;
      setBanner(s, `${name} must choose who takes the remaining run.`, "important");
      setResult(s, "normal", "Hand Off. Another player will take the remaining guesses.");
      return;
    }
    if (specialCard.special === "suddendeath") {
      addLog(s, `Sudden Death is only active in Party Mode. Redrawing a numbered House card.`, "major");
      const fallback = drawNumberHouse(s, true);
      showCenterCards(s, [fallback], "House Reveal");
      const ok = compareHigherLower(played, fallback, originalGuess);
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "was correct" : "was wrong"}.`);
      if (!ok) deckRunLoss(s, resolverId, deckUnresolvedIncludingFailed(s));
      else {
        s.deckRun.progress += 1;
        if (s.deckRun.progress >= s.deckRun.streak) queueAdvance(s, "finish_turn");
        else {
          s.phase = "select_card";
          s.selection.handIndex = null;
          setBanner(s, `${s.players[s.deckRun.currentResolverId].name} continues the run.`, "important");
        }
      }
    }
  }

  function resolveDeckSpecialChoice(s, guess) {
    const sp = s.deckRun?.special;
    if (!sp) return;
    const actorId = sp.actorId;
    const name = s.players[actorId].name;
    if (sp.type === "double") {
      const house = sp.hiddenQueue.shift();
      showCenterCards(s, [house], "Double Down Reveal", sp.hiddenQueue.length);
      const ok = compareHigherLower(sp.playedCard, house, guess);
      addLog(s, `${name} Double Down guessed ${guess} against ${cardLabel(house)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "cleared" : "failed"} a Double Down card.`);
      if (!ok) {
        s.deckRun.special = null;
        deckRunLoss(s, actorId, deckUnresolvedIncludingFailed(s));
        return;
      }
      if (sp.hiddenQueue.length) {
        showCenterCards(s, [], "Double Down", sp.hiddenQueue.length);
        setBanner(s, `${name} cleared one. One hidden card remains.`, "important");
        return;
      }
      s.deckRun.special = null;
      s.deckRun.progress += 1;
      addLog(s, `${name} cleared Double Down.`, "major");
      if (s.deckRun.progress >= s.deckRun.streak) queueAdvance(s, "finish_turn");
      else {
        s.phase = "select_card";
        s.selection.handIndex = null;
        setBanner(s, `${s.players[s.deckRun.currentResolverId].name} continues the run.`, "important");
      }
      return;
    }
    if (sp.type === "insideoutside") {
      const [h1, h2] = sp.housePair;
      showCenterCards(s, [h1, h2], "Inside / Outside");
      const ok = compareInsideOutside(sp.playedCard, h1, h2, guess);
      addLog(s, `${name} Inside / Outside with ${cardLabel(sp.playedCard)} against ${cardLabel(h1)} and ${cardLabel(h2)}, guessed ${guess}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "was correct" : "was wrong"} on Inside / Outside.`);
      s.deckRun.special = null;
      if (!ok) deckRunLoss(s, actorId, deckUnresolvedIncludingFailed(s));
      else {
        s.deckRun.progress += 1;
        if (s.deckRun.progress >= s.deckRun.streak) queueAdvance(s, "finish_turn");
        else {
          s.phase = "select_card";
          s.selection.handIndex = null;
          setBanner(s, `${s.players[s.deckRun.currentResolverId].name} continues the run.`, "important");
        }
      }
      return;
    }
    if (sp.type === "colormatch") {
      const h = sp.houseCard;
      showCenterCards(s, [h], "Color Match");
      const ok = compareColor(h, guess);
      addLog(s, `${name} Color Match guessed ${guess}, House was ${cardLabel(h)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      setResult(s, ok ? "win" : "loss", `${name} ${ok ? "matched" : "missed"} the color.`);
      s.deckRun.special = null;
      if (!ok) deckRunLoss(s, actorId, deckUnresolvedIncludingFailed(s));
      else {
        s.deckRun.progress += 1;
        if (s.deckRun.progress >= s.deckRun.streak) queueAdvance(s, "finish_turn");
        else {
          s.phase = "select_card";
          s.selection.handIndex = null;
          setBanner(s, `${s.players[s.deckRun.currentResolverId].name} continues the run.`, "important");
        }
      }
    }
  }

  function chooseHandoffTarget(s, targetId) {
    if (!s.deckRun?.special || s.deckRun.special.type !== "handoff") return;
    s.deckRun.special = null;
    s.deckRun.currentResolverId = targetId;
    ensureCardToAct(s, targetId);
    s.phase = "select_card";
    s.selection.handIndex = null;
    setBanner(s, `${s.players[targetId].name} takes the remaining run.`, "important");
    addLog(s, `${s.players[targetId].name} takes over the remaining run from Hand Off.`, "major");
  }

  function finishDeckMagnetSuccess(s) {
    const magnet = s.deckRun?.magnet;
    if (!magnet) return;
    s.deckRun.magnet = null;
    s.deckRun.progress += 1;
    addLog(s, `Magnet ended with no failures and counts as one completed step in the run.`, "major");
    if (s.deckRun.progress >= s.deckRun.streak) {
      addLog(s, `${s.players[s.deckRun.originalPlayerId].name} completed the run.`, "win");
      queueAdvance(s, "finish_turn");
      return;
    }
    s.phase = "select_card";
    s.selection.handIndex = null;
    s.deckRun.currentResolverId = magnet.originalResolverId;
    setBanner(s, `${s.players[s.deckRun.currentResolverId].name} resumes the run.`, "important");
  }

  function resolveDeckMagnetGuess(s, guess, handIndex = null) {
    const magnet = s.deckRun?.magnet;
    if (!magnet) return;
    const pid = magnet.activePlayerId;
    const player = s.players[pid];
    let played;
    if (pid === magnet.originalResolverId) played = magnet.committedCard;
    else {
      ensureCardToAct(s, pid);
      played = playerCommitCard(s, pid, handIndex, true);
    }
    const house = drawNumberHouse(s, true);
    showCenterCards(s, [house], "Magnet");
    const ok = compareHigherLower(played, house, guess);
    addLog(s, `${player.name} Magnet guessed ${guess} with ${cardLabel(played)} vs ${cardLabel(house)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
    setResult(s, ok ? "win" : "loss", `${player.name} ${ok ? "survived" : "failed"} Magnet.`);
    if (!ok) {
      deckRunLoss(s, pid, deckUnresolvedIncludingFailed(s));
      return;
    }
    magnet.currentIndex += 1;
    if (magnet.currentIndex >= magnet.order.length) {
      finishDeckMagnetSuccess(s);
      return;
    }
    magnet.activePlayerId = magnet.order[magnet.currentIndex];
    ensureCardToAct(s, magnet.activePlayerId);
    s.phase = "magnet_guess";
    setBanner(s, `${s.players[magnet.activePlayerId].name} resolves the next Magnet guess.`, "important");
  }

  function resolvePartyGuessWithPlayed(s, actorId, played, guess) {
    const pr = s.partyRun;
    pr.entries.push({ playerId: actorId, playedCard: played, guess });
    addLog(s, `${s.players[actorId].name} locks in ${cardLabel(played)} with a ${guess} guess for shared step ${pr.step + 1}.`, "major");
    pr.index += 1;
    if (pr.index < pr.order.length) {
      preparePartySubmissionTurn(s);
      return;
    }
    setBanner(s, `Shared House reveal resolves all committed cards.`, "important");
    resolvePartySubmittedStep(s);
  }

  function resolvePartySpecial(s, specialCard) {
    const pr = s.partyRun;
    showCenterCards(s, [specialCard], "Party Special");
    addLog(s, `Party Mode revealed ${specialCard.label} for the whole shared step.`, "major");

    if (specialCard.special === "bomb") {
      const failedIds = pr.entries.map((entry) => entry.playerId);
      setResult(s, "loss", `Bomb hit the whole shared step.`);
      finalizePartyStepResults(s, failedIds, []);
      return;
    }

    if (specialCard.special === "insideoutside") {
      const [h1, h2] = drawTwoNumberHouse(s, true);
      pr.special = { type: "insideoutside", entries: pr.entries, housePair: [h1, h2], choiceIndex: 0, choices: {} };
      showCenterCards(s, [], "Inside / Outside", 2);
      preparePartySpecialChoiceTurn(s);
      setResult(s, "normal", "Inside / Outside applies to everyone in the shared step.");
      return;
    }

    if (specialCard.special === "colormatch") {
      const h = drawNumberHouse(s, true);
      pr.special = { type: "colormatch", entries: pr.entries, houseCard: h, choiceIndex: 0, choices: {} };
      showCenterCards(s, [], "Color Match", 1);
      preparePartySpecialChoiceTurn(s);
      setResult(s, "normal", "Color Match applies to everyone in the shared step.");
      return;
    }

    if (specialCard.special === "suddendeath") {
      const h = drawNumberHouse(s, true);
      showCenterCards(s, [specialCard, h], "Sudden Death");
      const failedIds = [];
      const safeIds = [];
      pr.entries.forEach((entry) => {
        const ok = compareHigherLower(entry.playedCard, h, entry.guess);
        addLog(s, `${s.players[entry.playerId].name} Sudden Death guessed ${entry.guess} with ${cardLabel(entry.playedCard)} vs ${cardLabel(h)}: ${ok ? "safe" : "fail"}.`, ok ? "win" : "loss");
        if (ok) safeIds.push(entry.playerId);
        else failedIds.push(entry.playerId);
      });
      setResult(s, failedIds.length ? "loss" : "win", `${safeIds.length} safe, ${failedIds.length} failed in Sudden Death.`);
      finalizePartyStepResults(s, failedIds, safeIds);
      return;
    }

    const fallback = drawNumberHouse(s, true);
    showCenterCards(s, [fallback], "Shared Reveal");
    const failedIds = [];
    pr.entries.forEach((entry) => {
      const ok = compareHigherLower(entry.playedCard, fallback, entry.guess);
      addLog(s, `${s.players[entry.playerId].name} used ${cardLabel(entry.playedCard)}, guessed ${entry.guess}, shared House was ${cardLabel(fallback)}: ${ok ? "success" : "fail"}.`, ok ? "win" : "loss");
      if (!ok) failedIds.push(entry.playerId);
    });
    setResult(s, failedIds.length ? "loss" : "win", failedIds.length ? `${failedIds.length} player${failedIds.length === 1 ? "" : "s"} failed the shared reveal.` : `Everyone survived the shared reveal.`);
    finalizePartyStepResults(s, failedIds, []);
  }

  function resolvePartySpecialChoice(s, guess) {
    const pr = s.partyRun;
    const sp = pr?.special;
    if (!sp) return;
    const entry = sp.entries[sp.choiceIndex];
    sp.choices[entry.playerId] = guess;
    addLog(s, `${s.players[entry.playerId].name} chooses ${guess} for the shared ${sp.type === "insideoutside" ? "Inside / Outside" : "Color Match"} step.`, "major");
    sp.choiceIndex += 1;
    if (sp.choiceIndex < sp.entries.length) {
      preparePartySpecialChoiceTurn(s);
      return;
    }
    resolvePartySharedSpecialChoices(s);
  }

  function pressDuel(s) {
    if (!s.duel || s.duel.actorId !== s.duel.attackerId || !s.duel.successfulExchangeCompleted) return;
    ensureCardToAct(s, s.duel.attackerId);
    s.phase = "select_card";
    s.selection.handIndex = null;
    setBanner(s, `${s.players[s.duel.attackerId].name} presses the duel.`, "important");
    addLog(s, `${s.players[s.duel.attackerId].name} presses the duel.`, "major");
  }

  function passDuel(s) {
    if (!s.duel || s.duel.actorId !== s.duel.attackerId || !s.duel.successfulExchangeCompleted) return;
    addLog(s, `${s.players[s.duel.attackerId].name} passes. Duel ends safely.`, "major");
    queueAdvance(s, "finish_turn");
  }

  function actChooseOpponent(opponentId) {
    const s = clone(state);
    beginDuel(s, opponentId);
    setStateAndRender(s);
  }

  function actStartRound() {
    const s = clone(state);
    if (isBattleMode(s.mode)) startBattleTurn(s);
    else if (isPartyMode(s.mode)) startPartyRound(s);
    else startDeckRun(s);
    setStateAndRender(s);
  }

  function actSelectCard(index) {
    const s = clone(state);
    const actorId = activeActorId(s);
    ensureCardToAct(s, actorId);
    if (!s.players[actorId].hand[index]) return;
    s.selection.handIndex = index;
    setBanner(s, `${s.players[actorId].name} selected ${cardLabel(s.players[actorId].hand[index])}.`, "important");
    setStateAndRender(s);
  }

  function actGuess(guess) {
    const s = clone(state);
    const actorId = activeActorId(s);
    const handIndex = s.selection.handIndex;

    if (isBattleMode(s.mode)) {
      if (!s.battle || s.phase !== "battle_attack_select" || handIndex == null) return;
      resolveBattleAttack(s, handIndex, guess);
      s.selection.handIndex = null;
      setStateAndRender(s);
      return;
    }

    if (isPartyMode(s.mode)) {
      ensureCardToAct(s, actorId);
      if (s.partyRun?.special) {
        resolvePartySpecialChoice(s, guess);
        s.selection.handIndex = null;
        setStateAndRender(s);
        return;
      }
      if (handIndex == null) return;
      const played = playerCommitCard(s, actorId, handIndex, true);
      resolvePartyGuessWithPlayed(s, actorId, played, guess);
      s.selection.handIndex = null;
      setStateAndRender(s);
      return;
    }

    if (isSoloDeckMode(s.mode)) {
      ensureCardToAct(s, actorId);
      if (s.deckRun?.magnet) {
        resolveDeckMagnetGuess(s, guess, handIndex);
        s.selection.handIndex = null;
        setStateAndRender(s);
        return;
      }
      if (s.deckRun?.special) {
        resolveDeckSpecialChoice(s, guess);
        s.selection.handIndex = null;
        setStateAndRender(s);
        return;
      }
      if (handIndex == null) return;
      const played = playerCommitCard(s, actorId, handIndex, true);
      resolveDeckGuessWithPlayed(s, actorId, played, guess);
      s.selection.handIndex = null;
      setStateAndRender(s);
      return;
    }

    ensureCardToAct(s, actorId);
    if (s.duel?.magnet) {
      if (s.duel.magnet.triggerActorId !== actorId && handIndex == null) return;
      resolveDuelMagnetGuess(s, guess, handIndex);
      s.selection.handIndex = null;
      setStateAndRender(s);
      return;
    }
    if (s.duel?.special) {
      resolveDuelSpecialChoice(s, guess);
      s.selection.handIndex = null;
      setStateAndRender(s);
      return;
    }
    if (handIndex == null) return;
    resolveDuelNormalGuess(s, actorId, handIndex, guess);
    s.selection.handIndex = null;
    setStateAndRender(s);
  }

  function actCommitBattleDefense() {
    const s = clone(state);
    if (!s.battle || s.phase !== "battle_defender_select" || s.selection.handIndex == null) return;
    const defenderId = s.battle.currentDefenderId;
    commitBattleDefense(s, defenderId, s.selection.handIndex);
    s.selection.handIndex = null;
    processBattleSetup(s);
    setStateAndRender(s);
  }

  function actPress() {
    const s = clone(state);
    pressDuel(s);
    setStateAndRender(s);
  }

  function actPass() {
    const s = clone(state);
    passDuel(s);
    setStateAndRender(s);
  }

  function actHandoffTarget(targetId) {
    const s = clone(state);
    chooseHandoffTarget(s, targetId);
    setStateAndRender(s);
  }

  function processPendingAdvance() {
    if (!state.pendingAdvance) return;
    const s = clone(state);
    const pending = s.pendingAdvance;
    s.pendingAdvance = null;
    if (pending.type === "finish_turn") {
      finishTurnAdvance(s);
    } else if (pending.type === "party_continue") {
      partyAdvanceAfterResolvedPlayer(s, !!pending.removeFromFuture);
    } else if (pending.type === "party_next_step") {
      partyAdvanceToNextStep(s);
    }
    setStateAndRender(s);
  }

  function setStateAndRender(next) {
    state = next;
    render();
    scheduleTimers();
  }

  function shouldAIAct(s) {
    if (!s || s.screen !== "game" || s.winner || s.pendingAdvance) return false;
    const actorId = activeActorId(s);
    return !s.players[actorId].isHuman;
  }

  function runAITurn() {
    const s = clone(state);
    if (!shouldAIAct(s)) return;
    const actorId = activeActorId(s);
    const actor = s.players[actorId];
    ensureCardToAct(s, actorId);

    if (isBattleMode(s.mode)) {
      if (!s.battle) {
        startBattleTurn(s);
        setStateAndRender(s);
        return;
      }
      if (s.phase === "battle_defender_select") {
        commitBattleDefense(s, s.battle.currentDefenderId, battleDefenseIndex(actor.hand));
        processBattleSetup(s);
        setStateAndRender(s);
        return;
      }
      if (s.phase === "battle_attack_select") {
        const move = battleChooseAttackMove(actor.hand);
        resolveBattleAttack(s, move.index, move.guess);
        setStateAndRender(s);
        return;
      }
    }

    if (isDuelMode(s.mode)) {
      if (!s.duel) {
        const targets = s.players.filter((p) => p.id !== actorId && !p.eliminated);
        beginDuel(s, targets[0].id);
        setStateAndRender(s);
        return;
      }
      if (s.phase === "press_or_pass") {
        const shouldPress = actor.hand.length > 0 && s.stack.length < 5;
        if (shouldPress) pressDuel(s); else passDuel(s);
        setStateAndRender(s);
        return;
      }
      if (s.duel?.special) {
        const sp = s.duel.special;
        if (sp.type === "double") return actAIGuessOnState(s, bestHigherLower(sp.playedCard));
        if (sp.type === "insideoutside") return actAIGuessOnState(s, "inside");
        if (sp.type === "colormatch") return actAIGuessOnState(s, sp.playedCard.color);
      }
      if (s.duel?.magnet) {
        const guess = bestHigherLower(actor.hand[bestIndex(actor.hand)] || s.duel.magnet.committedCard);
        if (actorId === s.duel.magnet.triggerActorId) resolveDuelMagnetGuess(s, guess, null);
        else {
          const idx = bestIndex(actor.hand);
          s.selection.handIndex = idx;
          resolveDuelMagnetGuess(s, guess, idx);
        }
        s.selection.handIndex = null;
        setStateAndRender(s);
        return;
      }
      const idx = bestIndex(actor.hand);
      s.selection.handIndex = idx;
      resolveDuelNormalGuess(s, actorId, idx, bestHigherLower(actor.hand[idx]));
      s.selection.handIndex = null;
      setStateAndRender(s);
      return;
    }

    if (isSoloDeckMode(s.mode)) {
      if (!s.deckRun) {
        startDeckRun(s);
        setStateAndRender(s);
        return;
      }
      if (s.phase === "choose_handoff_target") {
        const targets = s.players.filter((p) => !p.eliminated && p.id !== actorId);
        chooseHandoffTarget(s, targets[0].id);
        setStateAndRender(s);
        return;
      }
      if (s.deckRun?.special) {
        const sp = s.deckRun.special;
        if (sp.type === "double") return actAIGuessOnState(s, bestHigherLower(sp.playedCard));
        if (sp.type === "insideoutside") return actAIGuessOnState(s, "inside");
        if (sp.type === "colormatch") return actAIGuessOnState(s, sp.playedCard.color);
      }
      if (s.deckRun?.magnet) {
        const currentActor = s.players[activeActorId(s)];
        ensureCardToAct(s, currentActor.id);
        const idx = currentActor.hand.length ? bestIndex(currentActor.hand) : null;
        const guess = currentActor.hand.length ? bestHigherLower(currentActor.hand[idx]) : "higher";
        if (activeActorId(s) === s.deckRun.magnet.originalResolverId) resolveDeckMagnetGuess(s, guess, null);
        else {
          s.selection.handIndex = idx;
          resolveDeckMagnetGuess(s, guess, idx);
        }
        s.selection.handIndex = null;
        setStateAndRender(s);
        return;
      }
      const idx = bestIndex(actor.hand);
      s.selection.handIndex = idx;
      const played = playerCommitCard(s, actorId, idx, true);
      resolveDeckGuessWithPlayed(s, actorId, played, bestHigherLower(played));
      s.selection.handIndex = null;
      setStateAndRender(s);
      return;
    }

    if (!s.partyRun) {
      startPartyRound(s);
      setStateAndRender(s);
      return;
    }
    if (s.partyRun?.special) {
      const sp = s.partyRun.special;
      const entry = sp.entries[sp.choiceIndex];
      if (sp.type === "insideoutside") return actAIGuessOnState(s, "inside");
      if (sp.type === "colormatch") return actAIGuessOnState(s, entry.playedCard.color);
    }
    const idx = bestIndex(actor.hand);
    s.selection.handIndex = idx;
    const played = playerCommitCard(s, actorId, idx, true);
    resolvePartyGuessWithPlayed(s, actorId, played, bestHigherLower(played));
    s.selection.handIndex = null;
    setStateAndRender(s);
  }

  function actAIGuessOnState(s, guess) {
    if (isPartyMode(s.mode)) {
      if (s.partyRun?.special) {
        resolvePartySpecialChoice(s, guess);
        setStateAndRender(s);
        return;
      }
    } else if (isSoloDeckMode(s.mode)) {
      if (s.deckRun?.special) {
        resolveDeckSpecialChoice(s, guess);
        setStateAndRender(s);
        return;
      }
    } else if (s.duel?.special) {
      resolveDuelSpecialChoice(s, guess);
      setStateAndRender(s);
    }
  }

  function scheduleTimers() {
    if (aiTimer) clearTimeout(aiTimer);
    if (advanceTimer) clearTimeout(advanceTimer);
    if (state.pendingAdvance) {
      advanceTimer = setTimeout(() => {
        advanceTimer = null;
        processPendingAdvance();
      }, currentResultDelay(state));
      return;
    }
    if (!shouldAIAct(state)) return;
    const delay = SPEED_INFO[state.speed]?.delay || SPEED_INFO.normal.delay;
    aiTimer = setTimeout(() => {
      aiTimer = null;
      runAITurn();
    }, delay);
  }

  function updateConfig(partial) {
    const next = clone(state);
    next.config = { ...next.config, ...partial };
    state = next;
    render();
  }

  function updateSeatName(index, name) {
    const next = clone(state);
    next.config.seats[index].name = name;
    state = next;
    render();
  }

  function updateSeatType(index, type) {
    const next = clone(state);
    next.config.seats[index].type = type;
    state = next;
    render();
  }

  function startGameFromMenu() {
    const config = clone(state.config);
    for (let i = 0; i < config.players; i++) {
      if (!config.seats[i].name.trim()) config.seats[i].name = DEFAULT_NAMES[i] || `Seat ${i + 1}`;
    }
    uiState.currentHumanView = null;
    setStateAndRender(makeGame(config));
  }

  function backToMenu() {
    if (aiTimer) clearTimeout(aiTimer);
    if (advanceTimer) clearTimeout(advanceTimer);
    uiState.currentHumanView = null;
    state = { screen: "menu", config: clone(state.config || defaultConfig()) };
    render();
  }

  function rematch() {
    uiState.currentHumanView = null;
    setStateAndRender(makeGame(clone(state.config)));
  }

  function roleBadge(s, player) {
    if (player.battleZero) return `<span class="seat-badge out">At 0</span>`;
    if (player.eliminated) return `<span class="seat-badge out">Out</span>`;
    if (isDuelMode(s.mode) && s.duel) {
      if (player.id === s.duel.attackerId) return `<span class="seat-badge attacker">Attacker</span>`;
      if (player.id === s.duel.defenderId) return `<span class="seat-badge defender">Defender</span>`;
    }
    if (activeActorId(s) === player.id) return `<span class="seat-badge active">Acting</span>`;
    if (s.turnOwner === player.id) return `<span class="seat-badge turn">Turn</span>`;
    return "";
  }

  function renderCard(card, faceDown) {
    if (faceDown || !card) return `<div class="card card-back"></div>`;
    if (card.type === "special") return `<div class="card special"><div class="card-special">${escapeHtml(card.label)}</div></div>`;
    return `<div class="card ${card.color.toLowerCase()}"><div class="card-value">${card.value}</div><div class="card-color">${escapeHtml(card.color)}</div></div>`;
  }

  function renderStackMini(card) {
    return `<div class="stack-mini ${card.color.toLowerCase()}">${card.value}</div>`;
  }

  function renderSeatHandStrip(count) {
    const visible = Math.min(count, 8);
    return `
      <div class="seat-hand-strip" aria-hidden="true">
        ${Array.from({ length: visible }).map((_, i) => `<div class="seat-mini-card${i > 0 ? ' overlap' : ''}"></div>`).join('')}
      </div>
    `;
  }

  function toggleLog() {
    uiState.logOpen = !uiState.logOpen;
    render();
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function opponentSeatClass(totalPlayers, index) {
    const layouts = {
      2: ["top-center"],
      3: ["top-left", "top-right"],
      4: ["left-mid", "top-center", "right-mid"],
      5: ["top-left", "left-mid", "top-right", "right-mid"],
    };
    return layouts[totalPlayers]?.[index] || "top-center";
  }

  function renderMenu() {
    const cfg = state.config;
    app.innerHTML = `
      <div class="screen menu-screen">
        <div class="menu-wrap">
          <div class="menu-title">HIGH STAKES</div>
          <div class="menu-subtitle">Mobile Build v3.1.1</div>
          <div class="panel">
            <div class="section-label">Mode</div>
            <div class="mode-grid">
              ${Object.keys(MODE_INFO).map((mode) => `
                <button class="mode-btn ${cfg.mode === mode ? "selected" : ""}" data-mode="${mode}">
                  <div class="mode-name">${mode}</div>
                  <div class="mode-desc">${MODE_INFO[mode]}</div>
                </button>
              `).join("")}
            </div>
          </div>
          <div class="panel">
            <div class="section-label">Players</div>
            <div class="pill-row">
              ${[2, 3, 4, 5].map((n) => `<button class="pill-btn ${cfg.players === n ? "selected" : ""}" data-players="${n}">${n}</button>`).join("")}
            </div>
            <div class="seat-configs">
              ${cfg.seats.slice(0, cfg.players).map((seat, i) => `
                <div class="seat-config">
                  <input class="name-input" data-seat-name="${i}" value="${escapeHtml(seat.name)}" />
                  <div class="toggle-wrap">
                    <button class="toggle-btn ${seat.type === "Human" ? "selected-human" : ""}" data-seat-type="${i}" data-type="Human">Human</button>
                    <button class="toggle-btn ${seat.type === "AI" ? "selected-ai" : ""}" data-seat-type="${i}" data-type="AI">AI</button>
                  </div>
                </div>
              `).join("")}
            </div>
          </div>
          <div class="panel">
            <div class="section-label">Speed</div>
            <div class="pill-row">
              ${Object.keys(SPEED_INFO).map((speed) => `<button class="pill-btn ${cfg.speed === speed ? "selected" : ""}" data-speed="${speed}">${SPEED_INFO[speed].label}</button>`).join("")}
            </div>
          </div>
          <button class="deal-btn" id="deal-btn">Deal Cards</button>
        </div>
      </div>
    `;

    app.querySelectorAll("[data-mode]").forEach((el) => el.onclick = () => updateConfig({ mode: el.dataset.mode }));
    app.querySelectorAll("[data-players]").forEach((el) => el.onclick = () => updateConfig({ players: Number(el.dataset.players) }));
    app.querySelectorAll("[data-speed]").forEach((el) => el.onclick = () => updateConfig({ speed: el.dataset.speed }));
    app.querySelectorAll("[data-seat-name]").forEach((el) => el.oninput = () => updateSeatName(Number(el.dataset.seatName), el.value));
    app.querySelectorAll("[data-seat-type]").forEach((el) => el.onclick = () => updateSeatType(Number(el.dataset.seatType), el.dataset.type));
    document.getElementById("deal-btn").onclick = startGameFromMenu;
  }

  function currentPenaltyPreview(s) {
    if (isBattleMode(s.mode)) return battleHitPenalty();
    if (isPartyMode(s.mode)) return deckPenalty(partyUnresolvedIncludingCurrent(s));
    if (isSoloDeckMode(s.mode)) return deckPenalty(deckUnresolvedIncludingFailed(s));
    return duelPenalty(s.mode, Math.max(1, s.stack.length), s);
  }

  function currentProgressLabel(s) {
    if (isBattleMode(s.mode) && s.battle) return `Need ${s.battle.needed}/${s.battle.defenderIds.length}`;
    if (isBattleMode(s.mode)) {
      const zeroCount = s.players.filter((p) => p.battleZero).length;
      return zeroCount ? `At 0: ${zeroCount}` : "";
    }
    if (isPartyMode(s.mode) && s.partyRun) return `Shared: ${Math.min(s.partyRun.step + 1, s.partyRun.streak)}/${s.partyRun.streak}`;
    if (isSoloDeckMode(s.mode) && s.deckRun) return `Run: ${s.deckRun.progress}/${s.deckRun.streak}`;
    return "";
  }

  function renderGame() {
    const s = state;
    const humanId = displayedHumanId(s);
    const me = s.players[humanId];
    const others = s.players.filter((p) => p.id !== humanId);
    const actorId = activeActorId(s);
    const myTurn = actorId === humanId;
    const centerCards = s.center.houseCards.map((c) => renderCard(c, false)).join("");
    const hidden = Array.from({ length: s.center.hiddenCount }).map(() => renderCard(null, true)).join("");
    const progressLabel = currentProgressLabel(s);
    const latestAction = s.log?.[0]?.text || "";
    const visibleLogs = uiState.logOpen ? s.log : s.log.slice(0, 4);
    const passScreenNeeded = requiresHumanPassScreen(s);
    const activeHumanId = activeActorId(s);

    app.innerHTML = `
      <div class="screen game-screen">
        <div class="top-banner ${s.banner.tone}">
          <div class="banner-main">${escapeHtml(s.banner.text)}</div>
          ${latestAction ? `<div class="banner-sub">${escapeHtml(latestAction)}</div>` : ""}
        </div>

        <div class="table-shell">
          <div class="table-board">
            <div class="table-felt-glow"></div>
            ${others.map((p, i) => `
              <div class="seat-slot ${opponentSeatClass(s.players.length, i)} ${s.phase === "choose_opponent" && s.turnOwner === humanId && !p.eliminated ? "seat-slot-clickable" : ""}" ${s.phase === "choose_opponent" && s.turnOwner === humanId && !p.eliminated ? `data-challenge="${p.id}"` : ""}>
                <div class="seat seat-opponent ${actorId === p.id ? "seat-acting" : ""} ${s.turnOwner === p.id ? "seat-turn" : ""} ${p.eliminated ? "seat-eliminated" : ""}">
                  <div class="seat-head">
                    <div class="seat-avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</div>
                    <div class="seat-meta">
                      <div class="seat-name">${escapeHtml(p.name)}</div>
                      <div class="seat-count">${p.hand.length} cards</div>
                    </div>
                  </div>
                  <div class="seat-badges">${roleBadge(s, p)}</div>
                  ${renderSeatHandStrip(p.hand.length)}
                  ${s.phase === "choose_opponent" && s.turnOwner === humanId && !p.eliminated ? `<button class="challenge-btn" data-challenge="${p.id}">Challenge</button>` : ""}
                </div>
              </div>
            `).join("")}

            <div class="center-panel sacred-center">
              <div class="status-pills">
                <span class="status-pill">Mode: ${escapeHtml(s.mode)}</span>
                <span class="status-pill">Stack: ${s.stack.length}</span>
                <span class="status-pill danger">Penalty: ${currentPenaltyPreview(s)}</span>
                ${progressLabel ? `<span class="status-pill run">${progressLabel}</span>` : ""}
              </div>

              <div class="house-area">
                <div class="house-label">${escapeHtml(s.center.label)}</div>
                <div class="house-cards">${centerCards}${hidden}</div>
              </div>

              <div class="stack-area">
                <div class="stack-label">Stack</div>
                <div class="stack-cards">${s.stack.slice(-10).map((card) => renderStackMini(card)).join("")}</div>
              </div>

              ${s.result ? `<div class="result-box ${s.result.tone}">${escapeHtml(s.result.text)}</div>` : ""}
            </div>

            <div class="seat-slot me-slot">
              <div class="seat seat-me ${actorId === me.id ? "seat-acting" : ""} ${s.turnOwner === me.id ? "seat-turn" : ""}">
                <div class="seat-head">
                  <div class="seat-avatar me">${escapeHtml(me.name.charAt(0).toUpperCase())}</div>
                  <div class="seat-meta">
                    <div class="seat-name">${escapeHtml(me.name)}</div>
                    <div class="seat-count">${me.hand.length} cards</div>
                  </div>
                </div>
                <div class="seat-badges">${roleBadge(s, me)}</div>
              </div>
            </div>
          </div>
        </div>

        <div class="hand-zone">
          <div class="hand-zone-inner">
            <div class="hand-row">
              ${me.hand.map((card, i) => {
                const magnetSelectable = !s.winner && !s.pendingAdvance && myTurn && s.phase === "magnet_guess" && (
                  (s.duel?.magnet && s.duel.magnet.triggerActorId !== humanId) ||
                  (s.deckRun?.magnet && s.deckRun.magnet.originalResolverId !== humanId)
                );
                const battleSelectable = !s.winner && !s.pendingAdvance && myTurn && (s.phase === "battle_attack_select" || s.phase === "battle_defender_select");
                const selectable = !s.winner && !s.pendingAdvance && myTurn && (s.phase === "select_card" || magnetSelectable || battleSelectable);
                return `<button class="hand-card-btn ${s.selection.handIndex === i ? "selected" : ""}" ${selectable ? `data-select="${i}"` : "disabled"}>${renderCard(card, false)}</button>`;
              }).join("")}
            </div>
            <div class="action-row">${renderActionButtons(s, humanId)}</div>
          </div>
        </div>

        <div class="log-panel ${uiState.logOpen ? "open" : "collapsed"}">
          <div class="log-header">
            <div class="log-title">Action Log</div>
            <button class="log-toggle-btn" id="log-toggle-btn">${uiState.logOpen ? "Hide Log" : "Show Log"}</button>
          </div>
          <div class="log-list">${visibleLogs.map((entry) => `<div class="log-entry ${entry.kind}">${escapeHtml(entry.text)}</div>`).join("")}</div>
        </div>

        <div class="footer-row">
          <button class="footer-btn" id="menu-btn">Menu</button>
          ${s.winner ? `<button class="footer-btn primary" id="rematch-btn">Rematch</button>` : ""}
        </div>

        ${passScreenNeeded ? `
          <div class="winner-overlay pass-overlay">
            <div class="winner-card">
              <div class="winner-title">Pass Device</div>
              <div class="winner-name">${escapeHtml(s.players[activeHumanId].name)}</div>
              <div class="banner-sub" style="margin-top:8px; text-align:center;">Hand the device to ${escapeHtml(s.players[activeHumanId].name)} and tap ready to continue.</div>
              <div class="winner-actions">
                <button class="footer-btn primary" id="pass-ready-btn">Ready</button>
              </div>
            </div>
          </div>` : ""}

        ${s.winner ? `
          <div class="winner-overlay">
            <div class="winner-card">
              <div class="winner-title">Winner</div>
              <div class="winner-name">${escapeHtml(s.winner)}</div>
              <div class="winner-actions">
                <button class="footer-btn primary" id="overlay-rematch-btn">Rematch</button>
                <button class="footer-btn" id="overlay-menu-btn">Menu</button>
              </div>
            </div>
          </div>` : ""}
      </div>
    `;

    app.querySelectorAll("[data-challenge]").forEach((el) => el.onclick = () => actChooseOpponent(Number(el.dataset.challenge)));
    app.querySelectorAll("[data-select]").forEach((el) => el.onclick = () => actSelectCard(Number(el.dataset.select)));
    app.querySelectorAll("[data-guess]").forEach((el) => el.onclick = () => actGuess(el.dataset.guess));
    app.querySelectorAll("[data-handoff]").forEach((el) => el.onclick = () => actHandoffTarget(Number(el.dataset.handoff)));
    const menuBtn = document.getElementById("menu-btn");
    if (menuBtn) menuBtn.onclick = backToMenu;
    const rematchBtn = document.getElementById("rematch-btn");
    if (rematchBtn) rematchBtn.onclick = rematch;
    const overlayRematchBtn = document.getElementById("overlay-rematch-btn");
    if (overlayRematchBtn) overlayRematchBtn.onclick = rematch;
    const overlayMenuBtn = document.getElementById("overlay-menu-btn");
    if (overlayMenuBtn) overlayMenuBtn.onclick = backToMenu;
    const pressBtn = document.getElementById("press-btn");
    if (pressBtn) pressBtn.onclick = actPress;
    const passBtn = document.getElementById("pass-btn");
    if (passBtn) passBtn.onclick = actPass;
    const startRunBtn = document.getElementById("start-run-btn");
    if (startRunBtn) startRunBtn.onclick = actStartRound;
    const commitDefenseBtn = document.getElementById("commit-defense-btn");
    if (commitDefenseBtn) commitDefenseBtn.onclick = actCommitBattleDefense;
    const logToggleBtn = document.getElementById("log-toggle-btn");
    if (logToggleBtn) logToggleBtn.onclick = toggleLog;
    const passReadyBtn = document.getElementById("pass-ready-btn");
    if (passReadyBtn) passReadyBtn.onclick = () => switchHumanView(activeHumanId);
  }

  function renderActionButtons(s, humanId) {
    if (s.winner) return "";
    if (s.pendingAdvance) return `<div class="waiting-text">Resolving result...</div>`;
    const actorId = activeActorId(s);
    if (actorId !== humanId) return `<div class="waiting-text">Waiting for ${escapeHtml(s.players[actorId].name)}...</div>`;

    if (isBattleMode(s.mode)) {
      if (!s.battle) {
        if (s.turnOwner !== humanId) return "";
        return `<button class="action-btn primary" id="start-run-btn">Start Attack</button>`;
      }
      if (s.phase === "battle_defender_select") {
        if (s.selection.handIndex == null) return `<div class="waiting-text">Select a defense card.</div>`;
        return `<button class="action-btn primary" id="commit-defense-btn">Commit Defense</button>`;
      }
      if (s.phase === "battle_attack_select") {
        if (s.selection.handIndex == null) return `<div class="waiting-text">Select your attack card.</div>`;
        return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
      }
      return `<div class="waiting-text">Waiting...</div>`;
    }

    if (isPartyMode(s.mode)) {
      if (!s.partyRun) {
        if (s.turnOwner !== humanId) return "";
        return `<button class="action-btn primary" id="start-run-btn">Start Shared Run</button>`;
      }
      if (s.partyRun?.special?.type === "insideoutside") {
        return `<button class="action-btn" data-guess="inside">Inside</button><button class="action-btn" data-guess="outside">Outside</button>`;
      }
      if (s.partyRun?.special?.type === "colormatch") {
        return PLAYER_COLORS.map((c) => `<button class="action-btn" data-guess="${c}">${c}</button>`).join("");
      }
      if (s.selection.handIndex == null) return `<div class="waiting-text">Select a card.</div>`;
      return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
    }

    if (isSoloDeckMode(s.mode)) {
      if (!s.deckRun) {
        if (s.turnOwner !== humanId) return "";
        return `<button class="action-btn primary" id="start-run-btn">Start Run</button>`;
      }
      if (s.phase === "choose_handoff_target") {
        return s.players.filter((p) => !p.eliminated && p.id !== humanId).map((p) => `<button class="action-btn" data-handoff="${p.id}">${escapeHtml(p.name)}</button>`).join("");
      }
      if (s.deckRun?.special?.type === "insideoutside") return `<button class="action-btn" data-guess="inside">Inside</button><button class="action-btn" data-guess="outside">Outside</button>`;
      if (s.deckRun?.special?.type === "colormatch") return PLAYER_COLORS.map((c) => `<button class="action-btn" data-guess="${c}">${c}</button>`).join("");
      if (s.deckRun?.special?.type === "double") return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
      if (s.deckRun?.magnet) {
        if (s.deckRun.magnet.originalResolverId !== humanId && s.selection.handIndex == null) return `<div class="waiting-text">Select a card for Magnet.</div>`;
        return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
      }
      if (s.selection.handIndex == null) return `<div class="waiting-text">Select a card.</div>`;
      return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
    }

    if (s.phase === "choose_opponent") return `<div class="waiting-text">Choose an opponent.</div>`;
    if (s.phase === "press_or_pass") return `<button class="action-btn primary" id="press-btn">Press</button><button class="action-btn" id="pass-btn">Pass</button>`;
    if (s.duel?.special?.type === "insideoutside") return `<button class="action-btn" data-guess="inside">Inside</button><button class="action-btn" data-guess="outside">Outside</button>`;
    if (s.duel?.special?.type === "colormatch") return PLAYER_COLORS.map((c) => `<button class="action-btn" data-guess="${c}">${c}</button>`).join("");
    if (s.duel?.special?.type === "double") return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
    if (s.duel?.magnet) {
      if (s.duel.magnet.triggerActorId !== humanId && s.selection.handIndex == null) return `<div class="waiting-text">Select a card for Magnet.</div>`;
      return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
    }
    if (s.selection.handIndex == null) return `<div class="waiting-text">Select a card.</div>`;
    return `<button class="action-btn" data-guess="higher">Higher</button><button class="action-btn" data-guess="lower">Lower</button>`;
  }

  function render() {
    if (state.screen === "menu") renderMenu();
    else renderGame();
  }

  render();
})();
