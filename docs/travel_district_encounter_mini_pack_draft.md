# Travel And District Encounter Mini-Pack Draft

Status: design draft only. Not implemented in the online prototype.

Purpose: test whether Travel Tiles feel more useful and whether Encounters can read the board state more clearly. This packet avoids new scoring rules. It uses resources, Strain, Supported, action timing, and existing adjacency language only.

Drafting constraints:

- 5 Boons and 5 Burdens.
- Similar text weight to the current Encounter deck.
- No final art, scoring changes, or component-count changes implied.
- Avoid direct duplication of existing cards such as Roads Filled Again, Roads Too Far, Old Trenches Return, Omen of Discontent, Coin Before Craft, and Tools Left to Rust.
- Use "connected group" to mean placed tiles connected by side adjacency.

## Boons

### Market Road, Morning Bell

Flavour:
At dawn the road filled with barrows, ledgers, and the smell of fresh bread. Gatherers, makers, and traders met without summons, each knowing the next hand waiting for their work.

Season I:
If a Resource, Crafting, and Merchant Tile form a connected group, gain 2 Goods.

Season II:
If a Resource, Crafting, and Merchant Tile form a connected group and at least 1 is adjacent to a Travel Tile, gain 3 Goods.

Season III:
If a Resource, Crafting, and Merchant Tile form a connected group and all 3 are adjacent to Travel Tiles, gain 4 Goods.

Lifecycle:
Resolve the current Season effect, then discard this card. If no valid group exists, discard with no effect.

Design note:
Tests the specific Resource-Crafting-Merchant district feedback while making Travel adjacency an upgrade to the reward, not a requirement in every Season.

### Safe Steps Home

Flavour:
Fresh stones marked the common turns, and lantern hooks appeared beside doorways. The way home no longer depended on memory alone; even tired feet could follow small signs toward warmth.

Season I:
Choose 1 tile adjacent to a Travel Tile. It has Supported this round.

Season II:
Choose up to 2 tiles adjacent to Travel Tiles. They have Supported this round.

Season III:
Choose up to 3 tiles adjacent to Travel Tiles. They have Supported this round.

Lifecycle:
Resolve the current Season effect, then discard this card.

Design note:
Makes Travel Tiles feel protective without changing placement or scoring. It should be easy to understand at the table because it uses existing Supported rules.

### Well-Worn Errands

Flavour:
The settlement learned its own rhythm: who rose early, which paths stayed dry, and where a borrowed cart could save an hour. Work that once scattered now moved in quiet sequence.

Season I:
Next Resource Tile activated this round while adjacent to a Travel Tile costs 0 Actions.

Season II:
Next tile activated this round while adjacent to a Travel Tile costs 0 Actions.

Season III:
Next 2 tiles activated this round while adjacent to Travel Tiles cost 0 Actions.

Lifecycle:
Keep this card face-up. Discard it after its effect is used.

Design note:
Tests Travel as efficiency infrastructure. This is deliberately not another placement discount, because Roads Filled Again already covers Travel placement and upgrade action discounts.

### Three Bells Answer

Flavour:
When one bell rang, two more answered: from homes, workyards, and the green beyond. The settlement was beginning to sound less like scattered labour and more like a place at last.

Season I:
If 3 Housing Tiles form a connected group, remove 1 Strain from 1 of them.

Season II:
If 3 tiles of one category form a connected group, remove 1 Strain from up to 2 of them.

Season III:
If 3 tiles of different categories form a connected group, remove 1 Strain from each of them.

Lifecycle:
Resolve the current Season effect, then discard this card. If no valid group exists, discard with no effect.

Design note:
Tests board-state cluster rewards without adding score. It starts with Housing because players naturally build Housing clusters, then opens into broader district planning.

### The Road Takes Notice

Flavour:
Once the paths were marked, every journey brought back something useful: spare nails, gathered herbs, a warning, a name. Roads did not merely shorten distance; they carried attention back home.

Season I:
When you next place or upgrade a Travel Tile this round, gain 1 resource of your choice.

Season II:
When you next place or upgrade a Travel Tile this round, gain 2 different resources of your choice.

Season III:
For the next 2 Travel Tiles placed or upgraded this round, gain 2 resources of your choice after each.

Lifecycle:
Keep this card face-up. Discard it after its effect is used.

Design note:
Rewards choosing Travel without making Travel cheaper. This should help Travel feel worthwhile even when the map is already connected.

## Burdens

### Ruts Deepen

Flavour:
Wheels followed the same tired lines until the road remembered every burden placed upon it. Where many hands passed daily, the ground softened, sank, and began to pull back.

Season I:
Choose 1 Travel Tile with fewer than 3 Strain that is adjacent to at least 2 placed tiles. Place 1 Strain on it.

Season II:
Choose 1 Travel Tile with fewer than 3 Strain that is adjacent to at least 3 placed tiles. Place 2 Strain on it.

Season III:
Choose 2 Travel Tiles with fewer than 3 Strain that are each adjacent to at least 3 placed tiles. Place 1 Strain on each. If none are valid, choose 1 Travel Tile with fewer than 3 Strain instead.

Lifecycle:
Place this card on the Stewards Board as an active Burden. To resolve: Spend 1 Action and pay Goods based on the current Season: Season I 2 Goods; Season II 4 Goods; Season III 6 Goods. Then discard this card.

Design note:
Targets useful Travel hubs rather than isolated roads, making good infrastructure feel important enough to maintain.

### Stalls Without Roads

Flavour:
Goods piled neatly, then stubbornly, then uselessly. Without clear routes between hands that gathered, shaped, and sold them, the market became a room full of almost-finished promises.

Season I:
Choose 1 Merchant or Crafting Tile with fewer than 3 Strain that is not adjacent to any Travel Tile. Place 1 Strain on it.

Season II:
Choose 2 Merchant and/or Crafting Tiles with fewer than 3 Strain that are not adjacent to Travel Tiles. Place 1 Strain on each.

Season III:
Choose 3 Merchant, Crafting, and/or Resource Tiles with fewer than 3 Strain that are not adjacent to Travel Tiles. Place 1 Strain on each. If none are valid, choose 1 Merchant or Crafting Tile with fewer than 3 Strain instead.

Lifecycle:
Place this card on the Stewards Board as an active Burden. To resolve: Spend 1 Action and pay Goods based on the current Season: Season I 2 Goods; Season II 4 Goods; Season III 6 Goods. Then discard this card.

Design note:
Encourages placing Travel near economic tiles without making Travel adjacency a permanent placement requirement.

### Crowded Doorways

Flavour:
The new homes stood close enough to share warmth, gossip, and every small worry. A cough travelled faster than reassurance, and each doorway seemed to open onto another unmet need.

Season I:
Choose 1 Housing or Social Tile in a connected group of 3 Housing and/or Social Tiles. Pay 1 Food or place 1 Strain on it.

Season II:
Choose 2 Housing and/or Social Tiles in connected groups of 3 Housing and/or Social Tiles. For each, pay 1 Food or Goods, or place 1 Strain on it.

Season III:
Choose 3 Housing and/or Social Tiles in connected groups of 3 Housing and/or Social Tiles. For each, pay 1 Food or Goods, or place 1 Strain on it. If none are valid, choose 1 Housing Tile with fewer than 3 Strain instead.

Lifecycle:
Place this card on the Stewards Board as an active Burden. To resolve: Spend 1 Action and pay Goods based on the current Season: Season I 2 Goods; Season II 4 Goods; Season III 6 Goods. Then discard this card.

Design note:
Tests the "three houses / three social tiles" feedback through a common district shape. It pressures dense growth but still gives a resource choice.

### The Unkept Crossing

Flavour:
Everyone agreed the crossing mattered; no one agreed who should mend it. Each day the loose boards shifted a little further from trust, and travellers learned to step carefully.

Season I:
Choose 1 Bridge, Docks, or Travel Tile on or adjacent to Water with fewer than 3 Strain. Place 1 Strain on it.

Season II:
Choose 2 Bridge, Docks, and/or Travel Tiles on or adjacent to Water with fewer than 3 Strain. Place 1 Strain on each.

Season III:
Choose 3 Bridge, Docks, and/or Travel Tiles on or adjacent to Water with fewer than 3 Strain. Place 1 Strain on each. If none are valid, choose 1 tile adjacent to Water with fewer than 3 Strain instead.

Lifecycle:
Place this card on the Stewards Board as an active Burden. To resolve: Spend 1 Action and pay Goods based on the current Season: Season I 2 Goods; Season II 4 Goods; Season III 6 Goods. Then discard this card.

Design note:
Gives rivers, Bridges, Docks, and water-adjacent route planning more Encounter relevance without changing river rules.

### The Chain Pulls Tight

Flavour:
Ore, tools, and coin moved faster than care could follow. Each table depended on another table, and when one promise slipped, the whole little chain tightened at once.

Season I:
Choose 1 Resource, Crafting, or Merchant Tile in a connected group containing all 3 categories. Place 1 Strain on it.

Season II:
Choose 2 Resource, Crafting, and/or Merchant Tiles in connected groups containing all 3 categories. Place 1 Strain on each.

Season III:
Choose 3 Resource, Crafting, and/or Merchant Tiles in connected groups containing all 3 categories. Place 1 Strain on each. If none are valid, choose 1 Crafting or Merchant Tile with fewer than 3 Strain instead.

Lifecycle:
Place this card on the Stewards Board as an active Burden. To resolve: Spend 1 Action and pay Goods based on the current Season: Season I 2 Goods; Season II 4 Goods; Season III 6 Goods. Then discard this card.

Design note:
Tests whether players enjoy Encounters that notice productive economic clusters. It is intentionally paired with Market Road, Morning Bell, so the same board pattern can be opportunity or pressure.
