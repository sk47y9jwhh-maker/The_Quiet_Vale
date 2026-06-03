# The Quiet Vale Encounter Card Balance Audit

Source reviewed: `src/data/encounter_cards.json`

Date: 2026-06-03

Purpose: record the light-touch Encounter card balance changes selected for the next blind playtest. This note started as an audit and now reflects the implemented balance pass.

## Summary

- Current Encounter set: 25 Boons, 25 Burdens, 25 Arrivals, 5 Golden Boons.
- 10 Burdens have no normal resolution text.
- 2 Burdens explicitly do nothing when no Arrival is active.
- 3 Boons already stay face-up until used: Shared Hands, Raised in Season, Welcome Well Met.
- 12 Boons create round-limited effects that can fizzle if the board is not ready.

Recommended first balance pass:

1. Add Season III-only fallback targets to the narrowest Burdens, especially adjacency Burdens and Arrival-pressure Burdens.
2. Add Season III resolution opportunities to the unresolvable Burdens at a standard 4 Goods cost.
3. Make a small number of high-feel Boons stay until used, not every Boon.
4. Leave a few misses intact so the deck still has breathing room and board-state texture.

## Burden Audit

| Card | Current Risk | Recommendation | Priority | Prototype Impact |
| --- | --- | --- | --- | --- |
| Smoke over Hearths | Misses until Housing is adjacent to Crafting. No resolution, so it can become a permanent penalty even when it missed. | Add Season III-only fallback: if no valid Housing target, strain 1 Crafting Tile if possible. Add Season III resolve. | High | Implemented. |
| Wares of War | Misses until Housing is adjacent to Merchant. No resolution. | Add Season III-only fallback: if no valid Housing target, strain 1 Merchant Tile if possible. Add Season III resolve. | High | Implemented. |
| The Long Cough | Misses until Housing is adjacent to Social. No resolution. | Add Season III-only fallback: if no valid Housing target, strain 1 Social Tile if possible. Add Season III resolve. | High | Implemented. |
| Coin Before Craft | Requires Merchant/Crafting adjacency, so it can miss often. No resolution. | Add Season III-only fallback: if no Merchant/Crafting pair exists, strain 1 Merchant or Crafting Tile. Add Season III resolve. | High | Implemented. |
| Old Trenches Return | Requires Travel adjacent to Resource. Can miss if Travel tiles are not placed yet or are not near Resource tiles. No resolution. | Add Season III-only fallback: if no valid Travel target, strain 1 Resource Tile. Add Season III resolve. | High | Implemented. |
| Omen of Discontent | Very narrow: Travel adjacent to strained Housing. Likely to miss unless the board is already under pressure. No resolution. | Add Season III-only fallback: if no valid strained-Housing target, strain 1 Travel Tile. Add Season III resolve. | Very High | Implemented. |
| Bare Walls | Broad Housing target, so it rarely misses once Housing exists. No resolution means it can feel unavoidable late. | Add Season III resolve. No fallback needed. | Medium | Mostly data, if using existing resolution pattern. |
| Empty Shelves | Can miss if no Social tile exists. No resolution. | Add Season III-only fallback to 1 Housing Tile if no Social target. Add Season III resolve. | Medium | Implemented. |
| Storehouses Disagree | Already has a resource-loss fallback into Resource Strain. No resolution. | Keep effect, add Season III resolve. | Medium | Implemented. |
| Promises Overstretched | Explicitly has no effect without active Arrivals, then remains as an unresolvable active Burden. | In Season III only, if no active Arrival exists, strain 1 placed tile. Add Season III resolve. | Very High | Implemented. |
| Welcome Wears Thin | Explicitly has no effect without active Arrivals, but it is resolvable. | In Season III only, if no active Arrival exists, strain 1 placed tile. | Medium | Implemented. |
| Blighted Lands | Can miss if no Farm exists. It is resolvable, so a miss is not purely dead. | Leave Season I as a possible miss. Consider Season II/III fallback to any Resource Tile if Strain remains too low. | Low | Needs code only if fallback is added. |
| Forest's Grudge | Can miss if no Forest exists. Resolvable. | Same as Blighted Lands. | Low | Needs code only if fallback is added. |
| Awoken Below | Can miss if no Mine exists. Resolvable. | Same as Blighted Lands. | Low | Needs code only if fallback is added. |
| Stampede | Can miss if no Wildlands exists. Resolvable. | Same as Blighted Lands. | Low | Needs code only if fallback is added. |
| Rot in the Vault | Can miss if no Dig Site exists. Dig Sites may be less common because they depend on Ruins. Resolvable. | Best candidate among resource-family Burdens for a Season II/III fallback to any Resource Tile. | Medium | Needs code only if fallback is added. |
| Roads Too Far | Punishes isolated Travel. Misses if Travel stays near Housing or is absent. Resolvable. | Keep. It rewards good placement and misses for a clear board-state reason. | Low | None. |
| Houses, Not Homes | Broad Housing pressure with payment choice and normal resolution. | Keep. | Low | None. |
| Old Wounds Reopen | Targets Social/Wellbeing and has payment choice plus resolution. | Keep unless playtesters ignore Wellbeing/Social, then add a placed-tile fallback in Season III. | Low | None for now. |
| Stores Run Thin | Already has a strong fallback if no resource is lost. Resolvable. | Keep. | Low | None. |
| Foundations Remember War | Misses until upgraded Core tiles exist. Resolvable. | Keep. This is a good late-game pressure card and should miss early. | Low | None. |
| Old Names, Old Debts | Misses until Renown tiles exist. Resolvable. | Keep. It rewards alternate scoring paths by making them visible risks. | Low | None. |
| Burden of Command | Uses Steward location, so it should almost always matter after opening moves. Resolvable. | Keep. | Low | None. |
| Tools Left to Rust | Broad Crafting/Merchant target plus resource loss. Resolvable. | Keep. | Low | None. |
| The Quiet Fractures | Misses only if the board has no Strain. Resolvable. | Keep. If it misses, the table is already doing well. | Low | None. |

## Recommended Season III Resolve Pattern

For the currently unresolvable Burdens, add a late-game safety valve rather than a full all-season resolution.

Implemented wording pattern:

> In Season III, to resolve: Spend 1 Action and pay 4 Goods. Then discard this card.

Applied to:

| Card Group | Season III Cost |
| --- | --- |
| Smoke over Hearths, Wares of War, The Long Cough, Coin Before Craft, Old Trenches Return, Omen of Discontent, Bare Walls, Empty Shelves, Storehouses Disagree, Promises Overstretched | 4 Goods |

Reasoning: this keeps early Burdens threatening, but prevents blind playtesters from feeling trapped by cards that cannot be cleared. Goods also gives the late-game economy a clear pressure-release purpose.

## Boon Audit

| Card | Current Risk | Recommendation | Priority | Prototype Impact |
| --- | --- | --- | --- | --- |
| Apprentice Steward | High-feel card, but it can fizzle if players cannot or do not want to place the matching tile this round. | Make it stay face-up until the next qualifying placement. Keep the resource costs intact. | Very High | Implemented. |
| Roads Filled Again | Travel placement is already a usability pain point. A same-round timing window makes the card easy to waste. | Make it stay face-up until the next qualifying Travel placement or upgrade. | High | Implemented. |
| A Little Time | Can miss completely if no Arrival is active. Arrival timing is hard for new players. | Make it stay face-up until it can add timer tokens to an active Arrival. | High | Implemented. |
| The Wonderful Find | Dig Site is terrain-gated and may not be in play when revealed. | Make it stay until the next Dig Site Production, or add a small fallback gain if no Dig Site exists. | Medium | Needs either persistent support or fallback support. |
| Many Hands, Light Work | Generic and useful, but can still fizzle. Making it persistent may be strong. | Test only if players still miss discount timing. Do not change in the first pass unless blind-test confusion continues. | Medium | Existing persistent pattern can likely be extended. |
| Trade Festival | Merchant timing can miss, but Merchant is optional and strong. | Leave for now. Consider persistent only if Merchant tiles are underused. | Low | None for now. |
| Crafting Fair | Crafting timing can miss, but Crafting is already useful for Goods/discount engines. | Leave for now. | Low | None for now. |
| Hearths Soften Feuds | Housing is already a strong scoring route. | Leave round-limited to avoid further boosting Housing. | Low | None. |
| Old Foundations | Housing is already strong, and this card can be very efficient. | Leave round-limited for now. | Low | None. |
| First Harvest Bounty | Farm-specific production can miss before Farm exists. | Leave for now unless production Boons feel disappointing as a group. | Low | None. |
| Pickaxe Reveals Passage | Mine-specific production can miss before Mine exists. | Leave for now. | Low | None. |
| Ancient Paths Reopen | Forest-specific production can miss before Forest exists. | Leave for now. | Low | None. |
| Rain Brings Bounty | Wildlands-specific production can miss before Wildlands exists. | Leave for now. | Low | None. |
| Settlement of Plenty | Optional Strain relief can fizzle if players cannot pay Goods or have no Strain. | Keep. It is already a player-choice relief card rather than a pure timing discount. | Low | None. |
| Herb & Tonic | Same as Settlement of Plenty, but with Herbs. | Keep. | Low | None. |
| Lanterns in the Dark | Same as Settlement of Plenty, but narrower target later. | Keep. | Low | None. |
| Shelter Holds | Can miss if no Supported tile has Strain. | Keep. Supported should sometimes feel like prevention rather than guaranteed repair. | Low | None. |
| From the Brink | Already has a fallback if no Overstrained tile exists. | Keep. This is the model for good fallback design. | Low | None. |
| Shared Hands | Already persistent until used. | Keep. | Low | None. |
| Raised in Season | Already persistent until used. | Keep. | Low | None. |
| Welcome Well Met | Already persistent until used. | Keep. | Low | None. |
| Stars Guide Plans | Always gives deck information. | Keep. | Low | None. |
| Clear Nights and Plans | Always gives deck information. | Keep. | Low | None. |
| Help Stands | Uses Steward locations and has a resource fallback. | Keep. | Low | None. |
| Stores Ready | Always useful when resources exist. | Keep. | Low | None. |

## First Implementation Batch

Recommended first batch for the next blind test:

1. Add Season III-only fallbacks to Omen of Discontent, Promises Overstretched, Welcome Wears Thin, Smoke over Hearths, Wares of War, The Long Cough, Coin Before Craft, Old Trenches Return, and Empty Shelves.
2. Add Season III 4 Goods resolution opportunities to all 10 previously unresolvable Burdens.
3. Make Apprentice Steward and Roads Filled Again stay until used.
4. Make A Little Time stay until it can add timer tokens to an active Arrival.
5. Leave the resource-family Burdens mostly unchanged for one more test, except optionally Rot in the Vault.

This is deliberately conservative: it should increase consequential Strain, reduce dead cards, and reduce player frustration without flattening the deck into every card always hitting.

## Implementation Notes

- Generic Season III fallback target wording is now supported in `src/game/encounters.js`.
- Persistent Apprentice Steward and Roads Filled Again action discounts now stay face-up and discard after their final use.
- A Little Time now stays face-up when it cannot add timer tokens and applies before end-of-round timer loss once an Arrival can receive tokens.
- Season III-only 4 Goods Burden resolution text is now parsed and enforced.
- Tests cover Season III fallbacks, Season I/II misses, persistent Boon expiry, A Little Time timing, and Season III-only Burden resolution.
