import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeMapSource } from "../src/game/map.js";
import {
  runAutomatedGame,
  simulationRoundsToCsv
} from "../src/game/simulation.js";

const resources = ["Wood", "Stone", "Metal", "Food", "Herbs", "Goods"];
const categories = ["Resource", "Housing", "Travel", "Crafting", "Merchant", "Social", "Wellbeing", "Special"];
const playerCounts = [1, 2, 3, 4];
const gamesPerPlayerCount = Number(process.env.QV_SIM_GAMES_PER_PLAYER_COUNT ?? 20);
const seedPrefix = process.env.QV_SIM_SEED_PREFIX ?? "playtester-bot-balance-2026-06-13";
const outputDir = path.resolve(
  process.env.QV_SIM_OUTPUT_DIR ?? "exports/simulations/playtester_bot_20x4_2026-06-13"
);

function numberValue(value) {
  return Number(value ?? 0) || 0;
}

function resourceTotal(entries = []) {
  return entries.reduce((total, entry) => total + numberValue(entry.amount ?? entry.gained), 0);
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function toCsv(rows, fields) {
  return [fields.join(","), ...rows.map((row) => fields.map((field) => escapeCsv(row[field])).join(","))].join("\n");
}

function getCardName(encounterIndex, cardId) {
  return encounterIndex.get(cardId)?.card_name ?? cardId ?? "";
}

function effectCardKey(effect) {
  return effect?.cardId ?? effect?.card_id ?? effect?.sourceCardId ?? "unknown_burden";
}

function ensureBurdenRow(burdenRowsByKey, base) {
  const key = `${base.game_id}|${base.card_id}`;
  if (!burdenRowsByKey.has(key)) {
    burdenRowsByKey.set(key, {
      game_id: base.game_id,
      random_seed: base.random_seed,
      player_count: base.player_count,
      card_id: base.card_id,
      card_name: base.card_name,
      revealed: 0,
      resolved: 0,
      active_unresolved_final: 0,
      resolution_actions: 0,
      effect_events: 0,
      target_hits: 0,
      target_misses: 0,
      target_count: 0,
      strain_attempted: 0,
      strain_added: 0,
      strain_prevented: 0,
      strain_blocked_by_cap: 0,
      pay_decisions: 0,
      strain_decisions: 0,
      timer_decisions: 0,
      payment_total: 0
    });
  }
  return burdenRowsByKey.get(key);
}

function collectApplicationMetrics(applications = []) {
  return applications.reduce(
    (total, application) => ({
      attempted: total.attempted + numberValue(application.requestedStrain),
      added: total.added + numberValue(application.strainAdded),
      prevented: total.prevented + numberValue(application.strainPrevented),
      blocked: total.blocked + numberValue(application.blockedByMax)
    }),
    { attempted: 0, added: 0, prevented: 0, blocked: 0 }
  );
}

function countEffectTargets(effect) {
  const targetIds = new Set();
  for (const target of effect?.targets ?? []) {
    if (target.placedTileId) targetIds.add(target.placedTileId);
    if (target.activeEncounterId) targetIds.add(target.activeEncounterId);
  }
  for (const application of effect?.applications ?? []) {
    if (application.placedTileId) targetIds.add(application.placedTileId);
  }
  for (const placedTileId of effect?.stewardOccupiedPlacedTileIds ?? []) {
    targetIds.add(placedTileId);
  }
  if (effect?.stewardHouseTargetPlacedTileId) {
    targetIds.add(effect.stewardHouseTargetPlacedTileId);
  }
  return targetIds.size;
}

function effectLooksTargetBased(effect) {
  return [
    "strain_placement",
    "pay_or_strain_choice",
    "arrival_pay_or_timer_choice",
    "resource_loss_or_strain_choice"
  ].includes(effect?.type);
}

function applyBurdenEffectToRow(row, effect) {
  if (!effect) {
    return;
  }

  const applications = effect.applications ?? [];
  const appMetrics = collectApplicationMetrics(applications);
  const targetCount = countEffectTargets(effect);
  const decisions = effect.decisions ?? [];

  row.effect_events += 1;
  row.target_count += targetCount;
  row.strain_attempted += appMetrics.attempted;
  row.strain_added += appMetrics.added;
  row.strain_prevented += appMetrics.prevented;
  row.strain_blocked_by_cap += appMetrics.blocked;
  row.pay_decisions += decisions.filter((decision) => decision.mode === "pay").length;
  row.strain_decisions += decisions.filter((decision) => decision.mode === "strain").length;
  row.timer_decisions += decisions.filter((decision) => decision.mode === "timer").length;
  row.payment_total += resourceTotal(effect.payment ?? []);

  if (targetCount > 0 || applications.length > 0 || decisions.length > 0 || resourceTotal(effect.payment ?? []) > 0) {
    row.target_hits += 1;
  } else if (effectLooksTargetBased(effect)) {
    row.target_misses += 1;
  }
}

function analyzeGame(result, context) {
  const { tileIndex, encounterIndex } = context;
  const state = result.finalState;
  const game = { ...result.game };
  const log = state.log ?? [];
  const placedTiles = state.map.placedTiles ?? [];
  const productionRows = [];
  const actionRows = [];
  const burdenRowsByKey = new Map();
  const finalTileRows = [];
  const extra = {
    score_per_player: Math.round(game.final_score / game.player_count),
    final_overstrained_tiles: placedTiles.filter((placedTile) => numberValue(placedTile.strain) >= 3).length,
    total_place_actions: 0,
    total_activate_actions: 0,
    total_production_activations: 0,
    resource_node_activations: 0,
    strain_relief_activations: 0,
    burden_resolution_activations: 0,
    arrival_timer_activations: 0,
    steward_power_uses: 0,
    goods_substitutions_used: 0,
    placement_discounts_used: 0,
    upgrade_discounts_used: 0
  };

  for (const category of categories) {
    extra[`final_${category.toLowerCase()}_tiles`] = 0;
    extra[`placed_${category.toLowerCase()}_tiles`] = 0;
    extra[`upgraded_${category.toLowerCase()}_tiles`] = 0;
  }
  for (const resource of resources) {
    extra[`production_gained_${resource.toLowerCase()}`] = 0;
    extra[`production_capped_${resource.toLowerCase()}`] = 0;
  }

  for (const placedTile of placedTiles) {
    const tile = tileIndex.get(placedTile.tileId);
    const category = tile?.tile_category ?? "Unknown";
    if (categories.includes(category)) {
      extra[`final_${category.toLowerCase()}_tiles`] += 1;
      if (tile?.side === "Upgraded") {
        extra[`upgraded_${category.toLowerCase()}_tiles`] += 1;
      }
    }
    finalTileRows.push({
      game_id: game.game_id,
      random_seed: game.random_seed,
      player_count: game.player_count,
      placed_tile_id: placedTile.id,
      tile_id: placedTile.tileId,
      tile_name: tile?.tile_name ?? placedTile.tileId,
      tile_category: category,
      tile_side: tile?.side ?? "",
      coordinate: placedTile.coordinate,
      coordinates: (placedTile.coordinates ?? [placedTile.coordinate]).filter(Boolean).join(";"),
      strain: numberValue(placedTile.strain),
      overstrained: numberValue(placedTile.strain) >= 3
    });
  }

  for (const entry of log) {
    const data = entry.data ?? {};
    const tileId = data.tileId ?? data.toTileId ?? data.fromTileId ?? null;
    const tile = tileIndex.get(tileId);
    const category = tile?.tile_category ?? "";
    const cardId = data.cardId ?? data.burdenEffect?.cardId ?? data.effect?.cardId ?? null;
    const card = encounterIndex.get(cardId);
    const actionRow = {
      game_id: game.game_id,
      random_seed: game.random_seed,
      player_count: game.player_count,
      round: entry.round,
      season: entry.season,
      log_type: entry.type,
      message: entry.message,
      tile_id: tileId ?? "",
      tile_name: tile?.tile_name ?? "",
      tile_category: category,
      card_id: cardId ?? "",
      card_name: card?.card_name ?? data.cardName ?? data.effect?.cardName ?? "",
      encounter_type: data.encounterType ?? "",
      action_cost: numberValue(data.actionCost?.total),
      resource_gained_total: resourceTotal(data.applied ?? []),
      strain_added: 0,
      strain_prevented: 0,
      strain_removed: numberValue(data.strainRemoved)
    };

    if (entry.type === "place_tile") {
      extra.total_place_actions += 1;
      if (categories.includes(category)) {
        extra[`placed_${category.toLowerCase()}_tiles`] += 1;
      }
      if (data.stewardPower) extra.steward_power_uses += 1;
      if (data.resourceCostSubstitution) extra.goods_substitutions_used += 1;
      if (data.placementCostReduction || data.actionCostDiscount || data.stewardPlacementResourceDiscount) {
        extra.placement_discounts_used += 1;
      }
    }

    if (entry.type === "upgrade_tile") {
      if (data.stewardPower) extra.steward_power_uses += 1;
      if (data.resourceCostSubstitution) extra.goods_substitutions_used += 1;
      if (data.upgradeCostReduction || data.actionCostDiscount || data.stewardStartingCostReduction) {
        extra.upgrade_discounts_used += 1;
      }
    }

    if (entry.type === "activate_tile") {
      extra.total_activate_actions += 1;
      if (data.applied?.length) {
        extra.total_production_activations += 1;
        if (category === "Resource") {
          extra.resource_node_activations += 1;
        }
        for (const applied of data.applied) {
          const resource = String(applied.resource ?? "").toLowerCase();
          if (resources.map((candidate) => candidate.toLowerCase()).includes(resource)) {
            extra[`production_gained_${resource}`] += numberValue(applied.gained);
            extra[`production_capped_${resource}`] += applied.capped
              ? numberValue(applied.amount) - numberValue(applied.gained)
              : 0;
          }
          productionRows.push({
            game_id: game.game_id,
            random_seed: game.random_seed,
            player_count: game.player_count,
            round: entry.round,
            season: entry.season,
            placed_tile_id: data.placedTileId ?? "",
            tile_id: data.tileId ?? "",
            tile_name: tile?.tile_name ?? data.tileId ?? "",
            tile_category: category,
            resource: applied.resource,
            printed_amount: numberValue(applied.amount),
            gained: numberValue(applied.gained),
            capped: Boolean(applied.capped)
          });
        }
      }
      if (/strain/i.test(entry.message) || data.strainRemoved) extra.strain_relief_activations += 1;
      if (/resolve/i.test(entry.message) && /burden/i.test(entry.message)) extra.burden_resolution_activations += 1;
      if (/timer/i.test(entry.message)) extra.arrival_timer_activations += 1;
    }

    const eventCardId = data.cardId ?? data.burdenEffect?.cardId ?? data.effect?.cardId ?? null;
    const isBurdenEvent = eventCardId?.startsWith?.("burden_");
    const isBurdenReveal = isBurdenEvent && entry.message.startsWith("Revealed ");
    const isBurdenResolve = isBurdenEvent && entry.message.startsWith("Resolved ");

    if (isBurdenReveal || isBurdenResolve) {
      const row = ensureBurdenRow(burdenRowsByKey, {
        game_id: game.game_id,
        random_seed: game.random_seed,
        player_count: game.player_count,
        card_id: eventCardId,
        card_name: data.cardName ?? getCardName(encounterIndex, eventCardId)
      });
      if (isBurdenReveal) row.revealed += 1;
      if (isBurdenResolve) {
        row.resolved += 1;
        row.resolution_actions += numberValue(data.actionCost?.total);
      }
    }

    const burdenEffect = data.burdenEffect ?? data.effect;
    if (burdenEffect?.source === "burden" || burdenEffect?.cardId?.startsWith?.("burden_")) {
      const burdenCardId = effectCardKey(burdenEffect);
      const row = ensureBurdenRow(burdenRowsByKey, {
        game_id: game.game_id,
        random_seed: game.random_seed,
        player_count: game.player_count,
        card_id: burdenCardId,
        card_name: burdenEffect.cardName ?? getCardName(encounterIndex, burdenCardId)
      });
      applyBurdenEffectToRow(row, burdenEffect);
      const appMetrics = collectApplicationMetrics(burdenEffect.applications ?? []);
      actionRow.strain_added += appMetrics.added;
      actionRow.strain_prevented += appMetrics.prevented;
    }

    actionRows.push(actionRow);
  }

  for (const active of state.encounter.active ?? []) {
    if (active.encounterType !== "Burden" || active.resolved) continue;
    const row = ensureBurdenRow(burdenRowsByKey, {
      game_id: game.game_id,
      random_seed: game.random_seed,
      player_count: game.player_count,
      card_id: active.cardId,
      card_name: getCardName(encounterIndex, active.cardId)
    });
    row.active_unresolved_final += 1;
  }

  return {
    gameRow: { ...game, ...extra },
    roundRows: result.rounds,
    productionRows,
    actionRows,
    burdenRows: [...burdenRowsByKey.values()],
    finalTileRows
  };
}

function summarizeByPlayerCount(gameRows) {
  const groups = new Map();
  for (const row of gameRows) {
    const group = groups.get(row.player_count) ?? { player_count: row.player_count, games: 0 };
    group.games += 1;
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== "number" || key === "player_count") continue;
      group[`sum_${key}`] = numberValue(group[`sum_${key}`]) + value;
      group[`min_${key}`] = group[`min_${key}`] === undefined ? value : Math.min(group[`min_${key}`], value);
      group[`max_${key}`] = group[`max_${key}`] === undefined ? value : Math.max(group[`max_${key}`], value);
    }
    groups.set(row.player_count, group);
  }

  const outputFields = [
    "final_score",
    "score_per_player",
    "final_population",
    "final_renown",
    "final_active_burdens",
    "total_burdens_revealed",
    "total_burden_applications_with_no_valid_target",
    "total_strain_placed",
    "total_strain_prevented_by_supported",
    "total_strain_removed",
    "arrivals_completed",
    "arrivals_expired",
    "total_upgrade_actions",
    "resource_node_activations",
    "placed_travel_tiles",
    "placed_housing_tiles",
    "placed_resource_tiles",
    "placed_special_tiles"
  ];

  return [...groups.values()]
    .map((group) => {
      const row = { player_count: group.player_count, games: group.games };
      for (const field of outputFields) {
        row[`avg_${field}`] = Number((numberValue(group[`sum_${field}`]) / group.games).toFixed(2));
        row[`min_${field}`] = group[`min_${field}`] ?? 0;
        row[`max_${field}`] = group[`max_${field}`] ?? 0;
      }
      return row;
    })
    .sort((left, right) => left.player_count - right.player_count);
}

const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const [encounterCards, tiles, mapSource] = await Promise.all([
  readJson("src/data/encounter_cards.json"),
  readJson("src/data/tiles.json"),
  readJson("src/data/redesigned_basic_map_v0_2.json")
]);
const mapHexes = normalizeMapSource(mapSource);
const tileIndex = new Map(tiles.map((tile) => [tile.tile_id, tile]));
const encounterIndex = new Map(encounterCards.map((card) => [card.card_id, card]));
const gameRows = [];
const roundRows = [];
const productionRows = [];
const actionRows = [];
const burdenRows = [];
const finalTileRows = [];

await mkdir(outputDir, { recursive: true });

for (let gameNumber = 1; gameNumber <= gamesPerPlayerCount; gameNumber += 1) {
  for (const playerCount of playerCounts) {
    const seed = `${seedPrefix}-deal-${String(gameNumber).padStart(2, "0")}-${playerCount}p`;
    const result = runAutomatedGame({
      gameIndex: gameNumber,
      playerCount,
      botProfile: "balanced",
      seed,
      encounterCards,
      tiles,
      mapHexes
    });
    const analyzed = analyzeGame(result, { tileIndex, encounterIndex });
    gameRows.push(analyzed.gameRow);
    roundRows.push(...analyzed.roundRows);
    productionRows.push(...analyzed.productionRows);
    actionRows.push(...analyzed.actionRows);
    burdenRows.push(...analyzed.burdenRows);
    finalTileRows.push(...analyzed.finalTileRows);
    console.log(
      `completed deal ${String(gameNumber).padStart(2, "0")} / ${gamesPerPlayerCount}, ${playerCount}p: score ${result.game.final_score}`
    );
  }
}

const summaryRows = summarizeByPlayerCount(gameRows);
const writeCsv = (filename, rows) => writeFile(path.join(outputDir, filename), toCsv(rows, Object.keys(rows[0] ?? {})));

await Promise.all([
  writeCsv("games_summary.csv", gameRows),
  writeFile(path.join(outputDir, "rounds.csv"), simulationRoundsToCsv(roundRows)),
  writeCsv("production_activations.csv", productionRows),
  writeCsv("burdens_by_card.csv", burdenRows),
  writeCsv("action_log.csv", actionRows),
  writeCsv("final_tiles.csv", finalTileRows),
  writeCsv("summary_by_player_count.csv", summaryRows),
  writeFile(
    path.join(outputDir, "results.json"),
    JSON.stringify(
      {
        metadata: {
          generated_at: new Date().toISOString(),
          bot_profile: "balanced / Playtester Bot",
          seed_prefix: seedPrefix,
          games_per_player_count: gamesPerPlayerCount,
          player_counts: playerCounts,
          total_games: gameRows.length,
          map: "redesigned_basic_map_v0_2"
        },
        summary_by_player_count: summaryRows,
        games: gameRows,
        rounds: roundRows,
        production_activations: productionRows,
        burdens_by_card: burdenRows,
        action_log: actionRows,
        final_tiles: finalTileRows
      },
      null,
      2
    )
  )
]);

const manifest = `The Quiet Vale automated playtester bot export
Generated: ${new Date().toISOString()}
Bot: Playtester Bot
Games: ${gameRows.length} total, ${gamesPerPlayerCount} per player count for 1p, 2p, 3p, 4p
Seed prefix: ${seedPrefix}

Files:
- summary_by_player_count.csv: averages/min/max by player count
- games_summary.csv: one row per completed game with extended balance metrics
- rounds.csv: one row per round
- production_activations.csv: one row per produced resource per activation
- burdens_by_card.csv: one row per Burden card per game, including reveal, resolution, hit/miss, Strain, and payment metrics
- action_log.csv: simplified action log rows
- final_tiles.csv: final board tile rows
- results.json: all exported rows in one JSON bundle
`;
await writeFile(path.join(outputDir, "manifest.txt"), manifest);

console.log(`EXPORT_DIR=${outputDir}`);
console.table(
  summaryRows.map((row) => ({
    player_count: row.player_count,
    games: row.games,
    avg_final_score: row.avg_final_score,
    avg_score_per_player: row.avg_score_per_player,
    avg_active_burdens: row.avg_final_active_burdens,
    avg_arrivals_completed: row.avg_arrivals_completed,
    avg_upgrades: row.avg_total_upgrade_actions,
    avg_resource_node_activations: row.avg_resource_node_activations,
    avg_travel_tiles_placed: row.avg_placed_travel_tiles,
    avg_housing_tiles_placed: row.avg_placed_housing_tiles
  }))
);
