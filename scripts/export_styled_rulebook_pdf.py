#!/usr/bin/env python3
"""Create a styled playtest rulebook PDF for The Quiet Vale.

The PDF is generated from the current repository data so that map counts,
component counts, starting resources, and encounter references stay aligned
with the prototype.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    LongTable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "exports" / "rulebook"
PDF_PATH = OUT_DIR / "The_Quiet_Vale_Rulebook_Styled_Draft_v0_1.pdf"
MANIFEST_PATH = OUT_DIR / "manifest.txt"

DATA_DIR = ROOT / "src" / "data"
ASSET_DIR = ROOT / "src" / "assets"

PAGE_WIDTH, PAGE_HEIGHT = A4


PALETTE = {
    "smoke": colors.HexColor("#050505"),
    "graphite": colors.HexColor("#1D2521"),
    "graphite_2": colors.HexColor("#26332D"),
    "brass": colors.HexColor("#B9934F"),
    "brass_dark": colors.HexColor("#7B5E2E"),
    "parchment": colors.HexColor("#F3E9D7"),
    "parchment_light": colors.HexColor("#FBF6EA"),
    "parchment_deep": colors.HexColor("#E2D0AD"),
    "ink": colors.HexColor("#171512"),
    "muted": colors.HexColor("#5C554C"),
    "line": colors.HexColor("#BCA985"),
    "slate": colors.HexColor("#5E7482"),
    "green": colors.HexColor("#61724C"),
    "brown": colors.HexColor("#8A6B4D"),
    "red": colors.HexColor("#7C5A52"),
}


def load_json(relative: str):
    return json.loads((ROOT / relative).read_text(encoding="utf-8"))


def clean(value: object) -> str:
    text = str(value or "")
    replacements = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u00a0": " ",
        "\u2122": "(TM)",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return re.sub(r"\s+", " ", text).strip()


def safe(value: object) -> str:
    return escape(clean(value))


def without_timer_clause(value: object) -> str:
    text = clean(value)
    return re.sub(r"\s*within three rounds\.\s*Place three tokens on this card to track\.?", "", text, flags=re.I)


def parse_hex(value: str) -> colors.Color:
    try:
        return colors.HexColor(value)
    except Exception:
        return PALETTE["brass"]


def make_styles():
    base = getSampleStyleSheet()
    styles = {}

    styles["cover_title"] = ParagraphStyle(
        "CoverTitle",
        parent=base["Title"],
        fontName="Times-Roman",
        fontSize=38,
        leading=42,
        textColor=PALETTE["brass"],
        alignment=TA_CENTER,
        spaceAfter=7,
    )
    styles["cover_subtitle"] = ParagraphStyle(
        "CoverSubtitle",
        parent=base["Normal"],
        fontName="Times-Roman",
        fontSize=15,
        leading=19,
        textColor=PALETTE["parchment_deep"],
        alignment=TA_CENTER,
        spaceAfter=20,
    )
    styles["cover_small"] = ParagraphStyle(
        "CoverSmall",
        parent=base["Normal"],
        fontName="Helvetica",
        fontSize=8.7,
        leading=12,
        textColor=PALETTE["parchment_deep"],
        alignment=TA_CENTER,
        spaceAfter=4,
        uppercase=True,
    )
    styles["h1"] = ParagraphStyle(
        "QVHeading1",
        parent=base["Heading1"],
        fontName="Times-Bold",
        fontSize=22,
        leading=27,
        textColor=PALETTE["graphite"],
        spaceBefore=18,
        spaceAfter=8,
        keepWithNext=True,
    )
    styles["h2"] = ParagraphStyle(
        "QVHeading2",
        parent=base["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=12,
        leading=15,
        textColor=PALETTE["brass_dark"],
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True,
    )
    styles["body"] = ParagraphStyle(
        "QVBody",
        parent=base["BodyText"],
        fontName="Times-Roman",
        fontSize=10.2,
        leading=14.2,
        textColor=PALETTE["ink"],
        spaceAfter=6,
    )
    styles["small"] = ParagraphStyle(
        "QVSmall",
        parent=styles["body"],
        fontSize=8.2,
        leading=10.8,
        textColor=PALETTE["muted"],
    )
    styles["table_header"] = ParagraphStyle(
        "QVTableHeader",
        parent=base["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.6,
        leading=9.2,
        textColor=PALETTE["parchment_light"],
        alignment=TA_LEFT,
    )
    styles["table_cell"] = ParagraphStyle(
        "QVTableCell",
        parent=base["Normal"],
        fontName="Times-Roman",
        fontSize=7.8,
        leading=9.7,
        textColor=PALETTE["ink"],
    )
    styles["table_cell_small"] = ParagraphStyle(
        "QVTableCellSmall",
        parent=styles["table_cell"],
        fontSize=7.1,
        leading=8.7,
    )
    styles["callout_label"] = ParagraphStyle(
        "QVCalloutLabel",
        parent=base["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.8,
        leading=9.5,
        textColor=PALETTE["brass_dark"],
        alignment=TA_LEFT,
    )
    styles["callout_body"] = ParagraphStyle(
        "QVCalloutBody",
        parent=styles["body"],
        fontName="Helvetica",
        fontSize=8.4,
        leading=11.2,
        textColor=PALETTE["graphite"],
        spaceAfter=0,
    )
    return styles


STYLES = make_styles()


def para(text: object, style: str = "body") -> Paragraph:
    return Paragraph(safe(text), STYLES[style])


def rich(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, STYLES[style])


def heading(text: str, level: int = 1):
    return [Paragraph(safe(text), STYLES["h1" if level == 1 else "h2"])]


def bullet(text: object):
    return Paragraph(f'<font color="#7B5E2E">-</font> {safe(text)}', STYLES["body"])


def numbered(items: list[str]):
    flow = []
    for index, item in enumerate(items, start=1):
        flow.append(Paragraph(f'<b>{index}.</b> {safe(item)}', STYLES["body"]))
    return flow


def callout(label: str, text: str, tint=PALETTE["parchment_deep"]):
    table = Table(
        [[Paragraph(safe(label.upper()), STYLES["callout_label"]), Paragraph(safe(text), STYLES["callout_body"])]],
        colWidths=[31 * mm, 128 * mm],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), tint),
                ("BOX", (0, 0), (-1, -1), 0.8, PALETTE["line"]),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return KeepTogether([table, Spacer(1, 7)])


def styled_table(headers: list[str], rows: list[list[object]], widths: list[float], small=False):
    cell_style = STYLES["table_cell_small" if small else "table_cell"]
    data = [[Paragraph(safe(header), STYLES["table_header"]) for header in headers]]
    for row in rows:
        data.append([Paragraph(safe(cell), cell_style) for cell in row])

    table = LongTable(data, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=True)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALETTE["graphite"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), PALETTE["parchment_light"]),
                ("GRID", (0, 0), (-1, -1), 0.35, PALETTE["line"]),
                ("BACKGROUND", (0, 1), (-1, -1), PALETTE["parchment_light"]),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PALETTE["parchment_light"], colors.HexColor("#F0E3CC")]),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def draw_body_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PALETTE["parchment"])
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setStrokeColor(PALETTE["line"])
    canvas.setLineWidth(0.65)
    canvas.rect(13 * mm, 12 * mm, PAGE_WIDTH - 26 * mm, PAGE_HEIGHT - 24 * mm, fill=0, stroke=1)
    canvas.setStrokeColor(PALETTE["brass"])
    canvas.setLineWidth(0.35)
    canvas.line(20 * mm, PAGE_HEIGHT - 17 * mm, PAGE_WIDTH - 20 * mm, PAGE_HEIGHT - 17 * mm)
    canvas.line(20 * mm, 17 * mm, PAGE_WIDTH - 20 * mm, 17 * mm)
    canvas.setFont("Helvetica", 7.4)
    canvas.setFillColor(PALETTE["muted"])
    canvas.drawString(20 * mm, 10 * mm, "The Quiet Vale: Seasons of Settlement")
    canvas.drawRightString(PAGE_WIDTH - 20 * mm, 10 * mm, f"Draft v0.1 - Page {doc.page}")
    canvas.restoreState()


def draw_cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PALETTE["smoke"])
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setStrokeColor(PALETTE["brass_dark"])
    canvas.setLineWidth(1.0)
    canvas.rect(12 * mm, 12 * mm, PAGE_WIDTH - 24 * mm, PAGE_HEIGHT - 24 * mm, fill=0, stroke=1)
    canvas.setStrokeColor(PALETTE["brass"])
    canvas.setLineWidth(0.45)
    canvas.rect(16 * mm, 16 * mm, PAGE_WIDTH - 32 * mm, PAGE_HEIGHT - 32 * mm, fill=0, stroke=1)
    canvas.line(30 * mm, 78 * mm, PAGE_WIDTH - 30 * mm, 78 * mm)
    canvas.line(30 * mm, PAGE_HEIGHT - 82 * mm, PAGE_WIDTH - 30 * mm, PAGE_HEIGHT - 82 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(PALETTE["brass"])
    canvas.drawCentredString(PAGE_WIDTH / 2, 24 * mm, "www.thequietvalegame.com")
    canvas.restoreState()


def cover_story():
    logo = ASSET_DIR / "quiet_vale_reddit_profile_icon_256.png"
    story = [Spacer(1, 42 * mm)]
    if logo.exists():
        image = Image(str(logo), width=27 * mm, height=27 * mm)
        image.hAlign = "CENTER"
        story.extend([image, Spacer(1, 12 * mm)])
    story.extend(
        [
            Paragraph("The Quiet Vale", STYLES["cover_title"]),
            Paragraph("Seasons of Settlement", STYLES["cover_subtitle"]),
            Paragraph("Draft Rulebook for Playtest Review", STYLES["cover_small"]),
            Spacer(1, 54 * mm),
            Paragraph("A game of stewardship, renewal, and hard choices after the old realm falls quiet.", STYLES["cover_subtitle"]),
            Spacer(1, 8 * mm),
            Paragraph("Styled PDF draft v0.1 - generated from the current Codex prototype repository.", STYLES["cover_small"]),
            PageBreak(),
        ]
    )
    return story


def terrain_table(map_data, terrain_colours):
    counts = map_data["expected_terrain_counts"]
    colour_by_terrain = {row["terrain"].replace(" / River", ""): row for row in terrain_colours}
    rows = []
    for terrain in ["Grasslands", "Water", "Woodland", "Mountains", "Heaths", "Arable Land", "Ruins"]:
        source_key = "Water" if terrain == "Water" else terrain
        colour_key = "Water" if terrain == "Water" else terrain
        colour_row = colour_by_terrain.get(colour_key, {})
        rows.append([terrain if terrain != "Water" else "Water / River", counts[source_key], colour_row.get("role", "")])

    return styled_table(
        ["Terrain", "Hexes", "Role"],
        rows,
        [36 * mm, 19 * mm, 104 * mm],
    )


def terrain_swatch_strip(terrain_colours):
    cells = []
    for row in terrain_colours:
        label = clean(row["terrain"])
        cells.append(Paragraph(safe(label), STYLES["table_cell_small"]))
    table = Table([cells], colWidths=[159 * mm / len(cells)] * len(cells), hAlign="LEFT")
    style = [
        ("GRID", (0, 0), (-1, -1), 0.25, PALETTE["line"]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]
    for index, row in enumerate(terrain_colours):
        style.append(("BACKGROUND", (index, 0), (index, 0), parse_hex(row["hex"])))
    table.setStyle(TableStyle(style))
    return table


def encounter_counts_table(cards):
    counts = Counter(card["encounter_type"] for card in cards)
    rows = [[kind, counts[kind]] for kind in ["Arrival", "Boon", "Burden", "Golden Boon"]]
    rows.append(["Total", sum(counts.values())])
    return styled_table(["Encounter type", "Cards"], rows, [90 * mm, 28 * mm])


def component_summary(map_data, tiles, cards):
    core_pieces = sum(int(tile.get("stock") or 0) for tile in tiles if tile.get("tile_family") == "Core" and tile.get("side") == "Basic")
    special_pieces = sum(int(tile.get("stock") or 0) for tile in tiles if tile.get("tile_family") == "Special")
    counts = Counter(card["encounter_type"] for card in cards)
    terrain_counts = ", ".join(f"{terrain}: {count}" for terrain, count in sorted(map_data["expected_terrain_counts"].items()))
    rows = [
        ["Map board", "1", f"{map_data['name']}; 126 flat-top hexes; {terrain_counts}"],
        ["Core tile pieces", core_pieces, "Double-sided Basic/Upgraded pieces."],
        ["Special tile pieces", special_pieces, "One-sided tiles unlocked by Arrivals."],
        ["Encounter Cards", sum(counts.values()), "Arrival: 25, Boon: 25, Burden: 25, Golden Boon: 5."],
        ["Warehouse resources", "TBD", "Wood, Stone, Metal, Food, Herbs, Goods. Prototype cap: 15 of each."],
        ["Strain tokens", "TBD", "3 Strain makes a tile Overstrained."],
        ["Arrival timer tokens", "TBD", "Arrivals begin with 3 timer tokens."],
        ["Steward markers", "1/player", "Track each player's Steward location / last interacted tile."],
        ["Supported markers", "TBD", "Used for manual or passive Supported state."],
    ]
    return styled_table(["Component", "Qty", "Notes"], rows, [38 * mm, 20 * mm, 101 * mm])


def starting_resources_table(rules_config):
    starts = rules_config["starting_warehouse_resources_by_player_count"]["value"]
    rows = [[players, f"{amount} of each resource"] for players, amount in starts.items()]
    return styled_table(["Player count", "Starting Warehouse"], rows, [54 * mm, 72 * mm])


def arrival_reference(cards, tiles):
    special_by_reward = {}
    for tile in tiles:
        arrival = clean(tile.get("unlocked_by_arrival"))
        if arrival:
            special_by_reward[arrival.lower()] = clean(tile.get("tile_name"))

    rows = []
    arrivals = sorted([card for card in cards if card["encounter_type"] == "Arrival"], key=lambda item: clean(item["card_name"]).lower())
    for card in arrivals:
        name = clean(card["card_name"])
        reward = clean(card.get("reward")).replace("Unlock ", "")
        special = special_by_reward.get(name.lower(), reward)
        rows.append([name, without_timer_clause(card.get("requirement")), special])
    return styled_table(["Arrival", "Requirement", "Unlocked Special Tile"], rows, [42 * mm, 68 * mm, 49 * mm], small=True)


def steward_power_table():
    rows = [
        ["Vanguard Home", "Once per Season, eligible Travel or Resource placement costs 0 Actions."],
        ["Knight Home", "Once per Season, eligible Housing placement costs 0 Actions."],
        ["Sentinel Home", "Once per Season, eligible Core upgrade costs 0 Actions."],
        ["Ranger Home", "Once per Season, disconnected placement can ignore the extra Travel action."],
        ["Quartermaster Home", "Once per Season, exchange up to 3 Warehouse resources."],
        ["Warden Home", "Once per Season, resolve an active Burden without spending an Action."],
    ]
    return styled_table(["Steward House", "Power"], rows, [47 * mm, 112 * mm])


def golden_boon_table():
    rows = [
        ["The Golden Bell", "Reveal an eligible Arrival from the game box as an active Arrival."],
        ["The Golden Eyed Traveler", "Open one additional Player Turns phase before end-of-round effects."],
        ["The Golden Scroll", "Refresh selected standard cards in player hands."],
        ["The Golden Signet Ring", "Relocate up to 5 placed tiles while preserving tile state and obeying map restrictions."],
        ["The Golden Vial", "Create a rest-of-game, once-per-round disconnected Travel action discount."],
    ]
    return styled_table(["Golden Boon", "Effect"], rows, [48 * mm, 111 * mm])


def rules_sections(rules_config, map_data, terrain_colours, tiles, cards):
    story = []

    story += heading("Welcome To The Vale")
    story.append(callout("Draft status", "This is a styled playtest rulebook draft generated from the current prototype data. It is suitable for review and table testing, but not yet locked production wording."))
    story.append(para("The players guide a settlement through three Seasons. Over 15 rounds, players seed and reveal Encounter Cards, place and improve tiles on the hex map, manage a shared Warehouse, complete Arrivals to unlock Special Tiles, and resolve or endure Burdens."))
    story.append(para("The final score is Population plus Renown, reduced by unresolved active Burdens and remaining Strain."))

    story += heading("At A Glance")
    story.append(
        styled_table(
            ["Topic", "Rule"],
            [
                ["Players", "Standard game supports 1-4 players."],
                ["Length", "3 Seasons, 15 rounds total."],
                ["Actions", "Each player has 4 Actions per round."],
                ["Resources", "Wood, Stone, Metal, Food, Herbs, Goods. Warehouse maximum is 15 of each."],
                ["Strain", "3 Strain makes a tile Overstrained."],
                ["Final burden penalty", f"{rules_config['final_active_burden_penalty_renown']['value']} Renown per unresolved active Burden."],
                ["Final Strain penalty", f"{rules_config['final_strain_penalty_renown']['value']} Renown per Strain token."],
            ],
            [45 * mm, 114 * mm],
        )
    )

    story += heading("Components")
    story.append(component_summary(map_data, tiles, cards))
    story.append(Spacer(1, 5))
    story.append(terrain_swatch_strip(terrain_colours))

    story += heading("Setup")
    story += numbered(
        [
            "Choose 1-4 players.",
            "Use Redesigned Basic Map v0.2 as the default locked map.",
            "Place all directly placeable Core Basic tiles in the tile supply. Upgraded faces are used only when tiles are upgraded.",
            "Keep Special Tiles locked until their matching Arrival is completed.",
            "Stock the shared Warehouse using the table below. The Warehouse maximum remains 15 of each resource.",
            "Build a balanced standard Encounter pool with 5 Boons, 5 Burdens, and 5 Arrivals per player.",
            "Shuffle the standard pool. Deal 10 hidden Encounter Cards to each player.",
            "Deal 5 standard Encounter Cards per player to the Encounter Deck.",
            "Add exactly 1 random Golden Boon to the Encounter Deck. Golden Boons are never dealt to player hands.",
            "Start at Round 1, Season I, Seed Encounters phase.",
        ]
    )
    story.append(starting_resources_table(rules_config))

    story += heading("Round And Season Structure")
    story.append(para("Season I is rounds 1-5, Season II is rounds 6-10, and Season III is rounds 11-15. Each round follows the same structure:"))
    story += numbered(["Seed Encounter Cards.", "Reveal Encounters.", "Player Turns.", "End of Round."])
    story.append(callout("Season pressure", "At the start of Rounds 6 and 11, unresolved active Burdens reapply using the new Season's text."))

    story += heading("Encounter Cards")
    story += heading("Seed Encounters", 2)
    story.append(para("During the Seed Encounters phase, each player contributes 1 hidden Encounter Card from their hand if able. A round can seed Encounter Cards only once. The prototype allows deck-position choices for testing; final production wording should confirm the exact insertion method."))
    story += heading("Reveal Encounters", 2)
    story.append(para("During Reveal Encounters, reveal standard Encounter Cards equal to the player count. Golden Boons are extra reveals: they do not count toward the standard reveal total, and revealing continues until the required number of standard cards has appeared."))
    story.append(encounter_counts_table(cards))
    story += heading("Encounter Types", 2)
    for item in [
        "Boon: resolve the current Season effect. If it modifies a future action, keep it visible until used or expired by its text.",
        "Burden: apply the current Season effect, then place it as an active Burden unless the card says otherwise.",
        "Arrival: place it as an active Arrival with 3 timer tokens.",
        "Golden Boon: resolve its bespoke effect as an extra reveal.",
    ]:
        story.append(bullet(item))

    story += heading("Player Turns And Actions")
    story.append(para("During Player Turns, each player receives 4 Actions for the round. Unspent Actions do not carry forward."))
    for item in ["Place a Tile.", "Upgrade a Tile.", "Activate a Tile.", "Complete an Arrival.", "Resolve a Burden.", "Use a Steward Power.", "Travel to a disconnected tile as part of a tile action.", "Cross a river without a Bridge connection when applicable."]:
        story.append(bullet(item))

    story += heading("Map, Terrain, And River")
    story.append(terrain_table(map_data, terrain_colours))
    story.append(para(f"Water/River hexes: {', '.join(map_data['river_coordinates'])}. Every Water/River hex is a legal potential Bridge placement site. Bridge Candidate markers are optional review/test annotations only, not placement restrictions."))
    for item in [
        "Use flat-top hex adjacency only.",
        "No tile may be placed on a River/Water hex unless the tile explicitly permits Water/River placement.",
        "Bridge is the normal tile placed on a Water/River hex and is a Travel Tile.",
        "Placed, non-Overstrained tiles adjacent to a Bridge connect through that Bridge, including across the river.",
        "An Overstrained Bridge loses Travel connectivity.",
        "Crossing the river without a Bridge connection costs 1 Action.",
    ]:
        story.append(bullet(item))

    story += heading("Tiles And The Settlement Network")
    story += heading("Place A Tile", 2)
    story += numbered(
        [
            "Choose an available tile.",
            "Choose a legal empty footprint on the map.",
            "Pay the tile's resource cost from the shared Warehouse.",
            "Spend the Place action cost.",
            "If the placement is disconnected from the player's travel access, spend the disconnected Travel action cost unless a rule waives it.",
            "Place the tile, reduce its stock, and move the acting player's Steward marker to that tile.",
        ]
    )
    story.append(para("A tile must obey its printed terrain and adjacency restrictions. Multihex tiles must keep their full footprint on legal empty hexes. Single-hex tiles do not require rotation."))

    story += heading("Connected Settlement Network", 2)
    story.append(para("All placed, non-Overstrained tiles create the connected settlement network when connected by side adjacency. Travel Tiles remain a tile category and component identity, but they are no longer the only tiles that carry reachability. Active Bridges and eligible Docks connect networks according to their printed rules."))
    story.append(callout("Steward location", "The acting player's current Steward tile anchors local access. After a disconnected placement, the Steward moves there, so that same tile can later be upgraded or activated without paying the disconnected Travel action again."))
    story.append(para("Overstrained tiles do not contribute to the connected settlement network."))

    story += heading("Upgrade A Tile", 2)
    story += numbered(
        [
            "Choose a placed tile with a matching Upgraded face.",
            "The tile must not be Overstrained.",
            "Pay the listed upgrade resource cost, if any.",
            "Spend the Upgrade action cost.",
            "If the tile is disconnected from the player's travel access, spend the disconnected Travel action cost unless the tile is the acting player's Steward tile or another rule waives the cost.",
            "Replace the placed Basic face with its Upgraded face while preserving its map position and state.",
        ]
    )
    story.append(para("Resource tile upgrades cost only the Upgrade action when their source cost is 0."))

    story += heading("Activate A Tile", 2)
    story += numbered(
        [
            "Choose a placed tile with a supported activation effect.",
            "The tile must not be Overstrained.",
            "Spend the Activate action cost.",
            "If the tile is disconnected from the player's travel access, spend the disconnected Travel action cost unless the tile is the acting player's Steward tile or another rule waives the cost.",
            "Resolve the tile's printed effect and move the Steward marker to that tile.",
        ]
    )

    story += heading("Warehouse, Strain, And Supported")
    story.append(para("The shared Warehouse stores Wood, Stone, Metal, Food, Herbs, and Goods. The Warehouse cap is 15 per resource unless a rule explicitly changes that cap. Costs are paid from the shared Warehouse. Gains cannot exceed the cap."))
    for item in [
        "A tile with 3 Strain is Overstrained.",
        "Overstrained tiles cannot activate or upgrade.",
        "Overstrained tiles do not provide passive effects.",
        "Overstrained tiles do not contribute Population or Renown to final scoring.",
        "Overstrained tiles do not contribute to the connected settlement network or provide Travel-specific benefits.",
        "Overstrained tiles cannot receive more Strain.",
        "Supported prevents the first Strain placed on a tile each round. Supported use resets at end of round.",
    ]:
        story.append(bullet(item))

    story += heading("Burdens")
    story.append(para("When a Burden is revealed, apply its current Season effect. If it has a supported reveal choice, resolve or record that choice. Then place the card as an active Burden unless its text says otherwise."))
    story.append(para("Burdens that place Strain can affect disconnected or unreachable tiles unless the card says otherwise. If fewer valid targets exist than requested, choose all valid targets. If no valid targets exist, no Strain is placed, but the Burden remains active unless resolved."))
    story.append(para("If a Burden has a supported resolution cost, a player may resolve it by paying the listed requirement and spending the listed action cost. Resolved Burdens leave active play and do not reapply at future Season starts. Some source Burdens are persistent active Burdens and cannot be resolved by the player."))

    story += heading("Arrivals")
    story.append(para("When an Arrival is revealed, place it as an active Arrival with 3 timer tokens. Timer tokens cannot exceed 3."))
    story += numbered(
        [
            "Fulfill the Arrival requirement all at once.",
            "Spend 1 Action to complete it.",
            "Pay any required resources.",
            "Move the Arrival to completed state.",
            "Unlock its matching Special Tile.",
        ]
    )
    story.append(para("At end of round, remove 1 timer token from each active Arrival. Failed Arrivals with no remaining timer tokens expire."))

    story += heading("Golden Boons")
    story.append(para("Golden Boons are special Encounter Cards added to the deck during setup. They are not dealt to player hands and do not count as standard reveals."))
    story.append(golden_boon_table())

    story += heading("Steward Houses And Powers")
    story.append(para("The current prototype represents Steward Tokens as each player's last-interaction marker. The upgraded Steward House powers are:"))
    story.append(steward_power_table())

    story += heading("End Of Round")
    story += numbered(
        [
            "Remove 1 timer token from each active Arrival.",
            "Expire failed Arrivals with no timer tokens remaining.",
            "Discard Boons that expire at end of round.",
            "Reset per-round Supported use.",
            "Reset once-per-round effects such as The Golden Vial.",
            "Advance to the next round, or complete the game after Round 15.",
        ]
    )

    story += heading("Final Scoring")
    story += numbered(
        [
            "Add Population from non-Overstrained placed tiles.",
            "Add Renown from non-Overstrained placed tiles.",
            f"Subtract {rules_config['final_active_burden_penalty_renown']['value']} Renown for each unresolved active Burden.",
            f"Subtract {rules_config['final_strain_penalty_renown']['value']} Renown for each Strain token on the board.",
        ]
    )
    story.append(callout("Score formula", "Final score = Population + Renown - active Burden penalties - Strain penalties."))

    story.append(PageBreak())
    story += heading("Arrival Unlock Reference")
    story.append(para("Use this reference when players complete Arrivals and unlock Special Tiles. Each Arrival normally has three rounds to complete after it is revealed."))
    story.append(arrival_reference(cards, tiles))

    story.append(PageBreak())
    story += heading("Production Notes To Resolve")
    for item in [
        "Confirm exact final seeding wording and deck insertion method.",
        "Confirm physical token quantities for resources, Strain, timers, Supported markers, and Steward/player markers.",
        "Run final copy-editing on all card-facing text.",
        "Confirm whether last-interaction marker language should become final Steward Token language or remain prototype language.",
        "Confirm final component naming for the map board and any player aids.",
    ]:
        story.append(bullet(item))

    return story


def build_pdf():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rules_config = load_json("src/data/rules_config.json")
    map_data = load_json("src/data/redesigned_basic_map_v0_2.json")
    terrain_colours = load_json("src/data/map_terrain_colours.json")
    tiles = load_json("src/data/tiles.json")
    cards = load_json("src/data/encounter_cards.json")

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=25 * mm,
        leftMargin=25 * mm,
        topMargin=24 * mm,
        bottomMargin=24 * mm,
        title="The Quiet Vale Rulebook Styled Draft v0.1",
        author="Robert Little",
        subject="The Quiet Vale: Seasons of Settlement playtest rulebook draft",
    )

    story = []
    story.extend(cover_story())
    story.extend(rules_sections(rules_config, map_data, terrain_colours, tiles, cards))
    doc.build(story, onFirstPage=draw_cover_page, onLaterPages=draw_body_page)

    reader = PdfReader(str(PDF_PATH))
    MANIFEST_PATH.write_text(
        "\n".join(
            [
                "The Quiet Vale styled rulebook draft",
                f"PDF: {PDF_PATH.name}",
                f"Pages: {len(reader.pages)}",
                "Source data: src/data/rules_config.json, src/data/redesigned_basic_map_v0_2.json, src/data/tiles.json, src/data/encounter_cards.json",
                "Visual direction: smoke black, warm parchment, muted brass, blue-grey slate, restrained ledger styling.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    print(PDF_PATH)
    print(f"pages={len(reader.pages)}")


if __name__ == "__main__":
    build_pdf()
