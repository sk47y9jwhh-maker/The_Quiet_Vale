import { GAME_PHASES } from "./setup.js";

export const PLAYTEST_RATING_FIELDS = Object.freeze([
  {
    key: "fun",
    label: "Fun",
    options: ["Not fun", "Flat", "Promising", "Fun", "Very fun"]
  },
  {
    key: "pace",
    label: "Pace",
    options: ["Too slow", "A little slow", "About right", "A little fast", "Too fast"]
  },
  {
    key: "tension",
    label: "Tension",
    options: ["Too gentle", "Light", "Good tension", "High", "Too punishing"]
  },
  {
    key: "choices",
    label: "Choices",
    options: ["Obvious", "Light", "Interesting", "Rich", "Overwhelming"]
  },
  {
    key: "friction",
    label: "Friction",
    options: ["Smooth", "Minor", "Noticeable", "Heavy", "Blocked play"]
  }
]);

export const PLAYTEST_TEXT_FIELDS = Object.freeze([
  {
    key: "bestMoment",
    label: "Best moment",
    placeholder: "What felt satisfying, surprising, or exciting?"
  },
  {
    key: "dragMoment",
    label: "Dragged",
    placeholder: "What felt slow, repetitive, confusing, or low-stakes?"
  },
  {
    key: "balanceNotes",
    label: "Balance notes",
    placeholder: "Pressure, rewards, resources, travel cost, tile tempo..."
  },
  {
    key: "ruleQuestions",
    label: "Rule questions",
    placeholder: "Anything that felt unclear or worth revisiting?"
  }
]);

export function createDefaultPlaytestNotes() {
  return {
    sessionLabel: "",
    fun: "",
    pace: "",
    tension: "",
    choices: "",
    friction: "",
    bestMoment: "",
    dragMoment: "",
    balanceNotes: "",
    ruleQuestions: ""
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function formatPhase(phase) {
  const labels = {
    [GAME_PHASES.SEED_ENCOUNTERS]: "Seed Encounters",
    [GAME_PHASES.REVEAL_ENCOUNTERS]: "Reveal Encounters",
    [GAME_PHASES.PLAYER_TURNS]: "Player Turns",
    [GAME_PHASES.END_ROUND]: "End of Round",
    [GAME_PHASES.COMPLETE]: "Complete"
  };

  return labels[phase] ?? phase;
}

function formatRating(notes, field) {
  const value = cleanText(notes[field.key]);

  return value || "Unrated";
}

function formatTextNote(notes, field) {
  const value = cleanText(notes[field.key]);

  return value || "No note.";
}

function formatList(items) {
  return items.length ? items.join(", ") : "None";
}

export function createPlaytestReportMarkdown({ state, metrics, pacingSignals, notes = createDefaultPlaytestNotes() }) {
  const sessionLabel = cleanText(notes.sessionLabel) || `Round ${state.round} ${formatPhase(state.phase)}`;

  return [
    `# The Quiet Vale Playtest Note: ${sessionLabel}`,
    "",
    "## Session",
    `- Season: ${state.season}`,
    `- Round: ${state.round}/${state.rules.totalRounds}`,
    `- Phase: ${formatPhase(state.phase)}`,
    `- Players: ${state.playerCount}`,
    `- Score: ${metrics.score.total}`,
    "",
    "## Feel Ratings",
    ...PLAYTEST_RATING_FIELDS.map((field) => `- ${field.label}: ${formatRating(notes, field)}`),
    "",
    "## Pulse",
    `- Logged actions spent: ${metrics.totalLoggedActionsSpent}`,
    `- Current round actions spent: ${metrics.currentRoundActionsSpent}/${state.playerCount * state.rules.actionsPerPlayer}`,
    `- Action mix: ${metrics.actionMix.placements} placed, ${metrics.actionMix.upgrades} upgraded, ${metrics.actionMix.activations} activated`,
    `- Disconnected Travel: ${metrics.disconnectedTravel.paid} paid, ${metrics.disconnectedTravel.waived} waived`,
    `- Active Encounters: ${metrics.encounters.active.arrivals} Arrivals, ${metrics.encounters.active.burdens} Burdens, ${metrics.encounters.active.boons} Boons, ${metrics.encounters.active.goldenBoons} Golden Boons`,
    `- Board: ${metrics.board.placedTiles} placed, ${metrics.board.upgradedTiles} upgraded, ${metrics.board.specialTiles} special, ${metrics.board.strainTokens} Strain`,
    `- Resources: ${metrics.economy.totalResources} total; capped ${formatList(metrics.economy.cappedResources)}; empty ${formatList(metrics.economy.emptyResources)}`,
    "",
    "## Pacing Signals",
    ...pacingSignals.map((signal) => `- ${signal}`),
    "",
    "## Notes",
    ...PLAYTEST_TEXT_FIELDS.flatMap((field) => [`### ${field.label}`, formatTextNote(notes, field), ""])
  ].join("\n");
}
