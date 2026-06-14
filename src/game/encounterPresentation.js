const ENCOUNTER_SEASON_FIELDS = Object.freeze({
  I: "season_i",
  II: "season_ii",
  III: "season_iii"
});

const ENCOUNTER_SEASON_RESOLUTION_FIELDS = Object.freeze({
  I: "season_i_resolution",
  II: "season_ii_resolution",
  III: "season_iii_resolution"
});

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getEncounterSeasonText(card, season) {
  return normalizeText(card?.[ENCOUNTER_SEASON_FIELDS[season]]);
}

export function getEncounterSeasonResolutionText(card, season) {
  return normalizeText(card?.[ENCOUNTER_SEASON_RESOLUTION_FIELDS[season]]);
}

export function getEncounterFlavorText(card) {
  return normalizeText(card?.flavour_text ?? card?.flavor_text);
}

export function getEncounterRuleLines(card, season, prototypeText = "") {
  if (!card) {
    return [];
  }

  return [
    { label: "This season", value: getEncounterSeasonText(card, season) },
    { label: "Requirement", value: card.requirement },
    { label: "Reward", value: card.reward },
    {
      label: card.encounter_type === "Burden" ? "To resolve" : "Resolution",
      value:
        card.encounter_type === "Burden"
          ? getEncounterSeasonResolutionText(card, season)
          : card.lifecycle_or_resolution
    },
    { label: "Effect", value: card.effect },
    { label: "Prototype did", value: prototypeText }
  ].filter(({ value }) => normalizeText(value) !== "");
}

export function createEncounterStorySummary(card, { season, prototypeText = "" } = {}) {
  if (!card) {
    return null;
  }

  return {
    cardId: card.card_id ?? "",
    cardName: normalizeText(card.card_name) || card.card_id || "Unknown Encounter",
    encounterType: normalizeText(card.encounter_type),
    flavorText: getEncounterFlavorText(card),
    seasonText: getEncounterSeasonText(card, season),
    ruleLines: getEncounterRuleLines(card, season, prototypeText)
  };
}
