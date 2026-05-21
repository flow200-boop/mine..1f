const CHOICES = ['rock', 'paper', 'scissors'];
const CHOICE_ICONS = { rock: '✊', paper: '✋', scissors: '✌️' };
const CHOICE_NAMES = { rock: 'Rock', paper: 'Paper', scissors: 'Scissors' };

const WINNERS = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

// DOM refs
const playerChoiceDisplay = document.getElementById('player-choice-display');
const computerChoiceDisplay = document.getElementById('computer-choice-display');
const playerChoiceName = document.getElementById('player-choice-name');
const computerChoiceName = document.getElementById('computer-choice-name');
const playerScoreEl = document.getElementById('player-score');
const computerScoreEl = document.getElementById('computer-score');
const tieScoreEl = document.getElementById('tie-score');
const roundNumberEl = document.getElementById('round-number');
const resultText = document.getElementById('result-text');
const resultBanner = document.getElementById('result-banner');
const historyList = document.getElementById('history-list');
const choiceBtns = document.querySelectorAll('.choice-btn');
const resetBtn = document.getElementById('reset-btn');

let state = {
  playerScore: 0,
  computerScore: 0,
  ties: 0,
  round: 0,
  isPlaying: false,
  history: [],
};

function getRandomChoice() {
  return CHOICES[Math.floor(Math.random() * CHOICES.length)];
}

function determineWinner(player, computer) {
  if (player === computer) return 'tie';
  return WINNERS[player] === computer ? 'win' : 'lose';
}

function getResultMessage(result, playerChoice, computerChoice) {
  const verbs = {
    rock: 'smashes',
    paper: 'covers',
    scissors: 'cuts',
  };

  if (result === 'tie') return "It's a tie!";
  if (result === 'win') {
    const action = verbs[playerChoice];
    return `${CHOICE_NAMES[playerChoice]} ${action} ${CHOICE_NAMES[computerChoice]}!`;
  }
  const action = verbs[computerChoice];
  return `${CHOICE_NAMES[computerChoice]} ${action} ${CHOICE_NAMES[playerChoice]}!`;
}

function clearHighlights() {
  playerChoiceDisplay.className = 'choice-display';
  computerChoiceDisplay.className = 'choice-display computer';
  resultBanner.className = 'result-banner';
}

function showChoices(playerChoice, computerChoice, result) {
  // Update player
  playerChoiceDisplay.querySelector('.choice-icon').textContent = CHOICE_ICONS[playerChoice];
  playerChoiceName.textContent = `You (${CHOICE_NAMES[playerChoice]})`;
  playerChoiceDisplay.className = 'choice-display reveal';

  // Update computer
  computerChoiceDisplay.querySelector('.choice-icon').textContent = CHOICE_ICONS[computerChoice];
  computerChoiceName.textContent = `Bot (${CHOICE_NAMES[computerChoice]})`;
  computerChoiceDisplay.className = 'choice-display computer reveal';

  // Result highlights
  const isWin = result === 'win';
  const isLose = result === 'lose';
  const isTie = result === 'tie';

  if (isWin) {
    playerChoiceDisplay.classList.add('win');
    computerChoiceDisplay.classList.add('lose');
    resultBanner.className = 'result-banner win';
  } else if (isLose) {
    playerChoiceDisplay.classList.add('lose');
    computerChoiceDisplay.classList.add('win');
    resultBanner.className = 'result-banner lose';
  } else {
    playerChoiceDisplay.classList.add('tie');
    computerChoiceDisplay.classList.add('tie');
    resultBanner.className = 'result-banner tie';
  }
}

function updateScores() {
  playerScoreEl.textContent = state.playerScore;
  computerScoreEl.textContent = state.computerScore;
  tieScoreEl.textContent = state.ties;
  roundNumberEl.textContent = state.round;
}

function addHistoryEntry(playerChoice, computerChoice, result) {
  state.history.unshift({ playerChoice, computerChoice, result, round: state.round });

  // Remove empty state if present
  const emptyEl = historyList.querySelector('.history-empty');
  if (emptyEl) emptyEl.remove();

  const entry = document.createElement('div');
  entry.className = 'history-item';

  const resultLabel = result === 'win' ? 'Win' : result === 'lose' ? 'Loss' : 'Tie';

  entry.innerHTML = `
    <div>
      <span class="round-tag">R${state.round}</span>
      <span class="move-icons">
        ${CHOICE_ICONS[playerChoice]} <span>vs</span> ${CHOICE_ICONS[computerChoice]}
      </span>
    </div>
    <span class="result-tag ${result}">${resultLabel}</span>
  `;

  historyList.insertBefore(entry, historyList.firstChild);
}

function playRound(playerChoice) {
  if (state.isPlaying) return;
  state.isPlaying = true;

  // Disable buttons
  choiceBtns.forEach(btn => (btn.disabled = true));

  clearHighlights();
  state.round++;

  // Shake animation
  playerChoiceDisplay.querySelector('.choice-icon').textContent = '✊';
  computerChoiceDisplay.querySelector('.choice-icon').textContent = '🤖';
  playerChoiceDisplay.classList.add('shake');
  computerChoiceDisplay.classList.add('shake');
  resultText.textContent = '...';

  setTimeout(() => {
    playerChoiceDisplay.classList.remove('shake');
    computerChoiceDisplay.classList.remove('shake');

    const computerChoice = getRandomChoice();
    const result = determineWinner(playerChoice, computerChoice);

    // Update scores
    if (result === 'win') state.playerScore++;
    else if (result === 'lose') state.computerScore++;
    else state.ties++;

    updateScores();

    // Show choices and result
    showChoices(playerChoice, computerChoice, result);
    resultText.textContent = getResultMessage(result, playerChoice, computerChoice);

    // Pulse effect on scores
    const activeScore = result === 'win'
      ? playerScoreEl.parentElement
      : result === 'lose'
        ? computerScoreEl.parentElement
        : tieScoreEl.parentElement;
    activeScore.classList.add('pulse');
    setTimeout(() => activeScore.classList.remove('pulse'), 400);

    // Add to history
    addHistoryEntry(playerChoice, computerChoice, result);

    // Re-enable buttons
    state.isPlaying = false;
    choiceBtns.forEach(btn => (btn.disabled = false));
  }, 400);
}

function resetGame() {
  state = {
    playerScore: 0,
    computerScore: 0,
    ties: 0,
    round: 0,
    isPlaying: false,
    history: [],
  };

  clearHighlights();
  playerChoiceDisplay.querySelector('.choice-icon').textContent = '🤔';
  computerChoiceDisplay.querySelector('.choice-icon').textContent = '🤖';
  playerChoiceName.textContent = 'You';
  computerChoiceName.textContent = 'Bot';
  resultText.textContent = 'Pick a move!';
  resultBanner.className = 'result-banner';
  updateScores();
  choiceBtns.forEach(btn => (btn.disabled = false));

  // Clear history
  historyList.innerHTML = '<div class="history-empty">No rounds played yet</div>';
}

// Event listeners
choiceBtns.forEach(btn => {
  btn.addEventListener('click', () => playRound(btn.dataset.choice));
});

resetBtn.addEventListener('click', resetGame);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'r' && !e.ctrlKey && !e.metaKey) {
    const rockBtn = document.querySelector('[data-choice="rock"]');
    if (!rockBtn.disabled) rockBtn.click();
  } else if (e.key === 'p' && !e.ctrlKey && !e.metaKey) {
    const paperBtn = document.querySelector('[data-choice="paper"]');
    if (!paperBtn.disabled) paperBtn.click();
  } else if (e.key === 's' && !e.ctrlKey && !e.metaKey) {
    const scissorsBtn = document.querySelector('[data-choice="scissors"]');
    if (!scissorsBtn.disabled) scissorsBtn.click();
  }
});
