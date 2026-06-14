#!/usr/bin/env python3
"""Export an A5 landscape current Core Tile menu PDF for The Quiet Vale."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import A5, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import Image, Paragraph


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "src" / "data"
OUT_DIR = ROOT / "exports" / "tile_menu"
PDF_PATH = OUT_DIR / "The_Quiet_Vale_Core_Tile_Menu_A5_Landscape_Current_v0_2.pdf"
MANIFEST_PATH = OUT_DIR / "manifest_core_tile_menu_v0_2.txt"

PAGE_WIDTH, PAGE_HEIGHT = landscape(A5)

PALETTE = {
    "smoke": "#060806",
    "graphite": "#1D2521",
    "graphite_2": "#26332D",
    "brass": "#B9934F",
    "brass_dark": "#7B5E2E",
    "parchment": "#F1E6D0",
    "parchment_light": "#FBF6EA",
    "parchment_deep": "#E1CFAB",
    "paper_edge": "#C8B890",
    "ink": "#171512",
    "muted": "#5C554C",
    "line": "#A89570",
}

CATEGORY_ORDER = [
    "Resource",
    "Travel",
    "Housing",
    "Social",
    "Wellbeing",
    "Crafting",
    "Merchant",
]

CATEGORY_FALLBACKS = {
    "Resource": "#61724C",
    "Housing": "#8A6B4D",
    "Crafting": "#6C7377",
    "Merchant": "#967540",
    "Social": "#7C5A52",
    "Wellbeing": "#6D8378",
    "Travel": "#5E7482",
}

PAGE_GROUPS = [
    {
        "title": "Resource Tiles I",
        "subtitle": "Reliable production. Resource tiles begin on matching terrain and upgrade into stronger production.",
        "tiles": ["Lumber Yard", "Mine Shaft", "Farmstead"],
    },
    {
        "title": "Resource Tiles II",
        "subtitle": "Further production options, including Arable Land and Ruins placement.",
        "tiles": ["Gatherers Lodge", "Dig Site"],
    },
    {
        "title": "Travel Routes",
        "subtitle": "Routes, bridges, support, and separated-cluster tools. Travel tiles are specialist infrastructure.",
        "tiles": ["Path", "Street", "Track"],
    },
    {
        "title": "Travel Infrastructure",
        "subtitle": "Specialist settlement links and river crossings. Bridges are the normal way to connect across rivers.",
        "tiles": ["Common Land", "Bridge"],
    },
    {
        "title": "Housing Growth I",
        "subtitle": "Population tiles and Arrival support. Housing is a major late-game scoring engine.",
        "tiles": ["Cabin", "Cottage", "Stedding"],
    },
    {
        "title": "Housing Growth II",
        "subtitle": "Arrival support and stronger housing lines. Steward Houses are retired from the current rules.",
        "tiles": ["Inn"],
    },
    {
        "title": "Social and Wellbeing",
        "subtitle": "Settlement care, recovery, and Strain management. These keep the board from fraying.",
        "tiles": ["Tavern", "Eatery", "Washhouse"],
    },
    {
        "title": "Wellbeing II",
        "subtitle": "Focused Strain recovery and ruins-linked wellbeing tools.",
        "tiles": ["Apothecary", "The Vaults"],
    },
    {
        "title": "Crafting and Merchant",
        "subtitle": "Discounts, resource flexibility, and stronger upgrade turns.",
        "tiles": ["Workshops", "Market Stalls"],
    },
]


@dataclass(frozen=True)
class TilePair:
    basic: dict
    upgraded: dict
    accent: str
    variant_name: str


def load_json(relative_path: str):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


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


def hex_color(value: str) -> colors.Color:
    return colors.HexColor(value)


def blend(hex_a: str, hex_b: str, amount: float) -> str:
    """Blend amount of hex_a into hex_b."""
    def parts(value: str):
        value = value.strip().lstrip("#")
        return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))

    a = parts(hex_a)
    b = parts(hex_b)
    mixed = tuple(round((a[i] * amount) + (b[i] * (1 - amount))) for i in range(3))
    return "#" + "".join(f"{part:02X}" for part in mixed)


def cost_text(value: object) -> str:
    if value is None or value == "":
        return "-"
    if isinstance(value, (int, float)):
        return "0" if value == 0 else clean(value)
    text = clean(value)
    text = text.replace("\\n", "\n")
    pieces = [piece.strip() for piece in re.split(r"\n|,", text) if piece.strip()]
    normalized = []
    for piece in pieces:
        match = re.match(r"^(\d+)\s+(.+)$", piece)
        if match:
            normalized.append(f"{match.group(1)} {match.group(2)}")
        else:
            normalized.append(piece)
    return ", ".join(normalized) if normalized else "-"


def summary_text(value: object) -> str:
    text = clean(value)
    if not text:
        return "-"
    text = text.replace("Production: Gain ", "Produce: ")
    text = text.replace("Activated Effect: ", "Activate: ")
    text = text.replace("Passive: ", "Passive: ")
    text = text.replace("Steward Power: ", "Power: ")
    text = text.replace("Place adjacent to any placed, non-Overstrained tile.", "Place adjacent to the settlement.")
    text = text.replace("Place as a normal Housing Tile.", "Place as Housing.")
    text = text.replace("All normal costs and requirements still apply.", "Normal costs and requirements apply.")
    text = text.replace("up to the normal maximum of 3 timer tokens", "up to 3 timer tokens")
    return text


def score_text(tile: dict) -> str:
    values = []
    if tile.get("population"):
        values.append(f"{tile['population']} Pop")
    if tile.get("renown"):
        values.append(f"{tile['renown']} Ren")
    return ", ".join(values) if values else "-"


def build_pairs() -> dict[str, TilePair]:
    tiles = load_json("src/data/tiles.json")
    colours = load_json("src/data/tile_colour_variations.json")

    core_tiles = [
        tile
        for tile in tiles
        if tile.get("tile_source_type") == "Core"
        and tile.get("subtype") != "Steward House"
        and not clean(tile.get("notes")).lower().startswith("retired:")
    ]
    by_name = {tile["tile_name"]: tile for tile in core_tiles}
    colour_by_base = {row["base_tile"]: row for row in colours}

    pairs = {}
    for tile in core_tiles:
        if tile.get("side") != "Basic":
            continue
        upgrade_name = tile.get("upgrade_to")
        if not upgrade_name:
            continue
        upgraded = by_name.get(upgrade_name)
        if not upgraded:
            continue
        colour_row = colour_by_base.get(tile["tile_name"], {})
        accent = colour_row.get("tile_variant_hex") or CATEGORY_FALLBACKS.get(tile["tile_category"], "#8A6B4D")
        pairs[tile["tile_name"]] = TilePair(
            basic=tile,
            upgraded=upgraded,
            accent=accent,
            variant_name=colour_row.get("tile_variant_name", tile["tile_category"]),
        )
    return pairs


def paragraph_style(name: str, size: float, leading: float, color: str, bold: bool = False, align: int = 0) -> ParagraphStyle:
    return ParagraphStyle(
        name,
        fontName="Helvetica-Bold" if bold else "Helvetica",
        fontSize=size,
        leading=leading,
        textColor=hex_color(color),
        alignment=align,
        spaceAfter=0,
    )


STYLES = {
    "tiny": paragraph_style("Tiny", 4.75, 5.45, PALETTE["muted"]),
    "small": paragraph_style("Small", 5.35, 6.1, PALETTE["ink"]),
    "small_bold": paragraph_style("SmallBold", 5.35, 6.1, PALETTE["ink"], True),
    "body": paragraph_style("TileBody", 5.8, 6.55, PALETTE["ink"]),
    "body_bold": paragraph_style("TileBodyBold", 5.8, 6.55, PALETTE["ink"], True),
    "medium": paragraph_style("Medium", 6.45, 7.2, PALETTE["ink"]),
    "header": paragraph_style("Header", 7.6, 8.2, PALETTE["ink"], True),
    "muted": paragraph_style("Muted", 5.1, 5.8, PALETTE["muted"]),
    "cream": paragraph_style("Cream", 6.2, 7.0, PALETTE["parchment_light"], True),
}


def draw_text(c: canvas.Canvas, text: str, x: float, y_top: float, width: float, height: float, style: ParagraphStyle) -> float:
    if not text:
        return 0
    text = safe(text)
    for step in range(4):
        local = ParagraphStyle(
            f"{style.name}_{step}",
            parent=style,
            fontSize=max(4.25, style.fontSize - (0.45 * step)),
            leading=max(4.75, style.leading - (0.48 * step)),
        )
        paragraph = Paragraph(text, local)
        wrapped_width, wrapped_height = paragraph.wrap(width, height)
        if wrapped_height <= height or step == 3:
            paragraph.drawOn(c, x, y_top - min(wrapped_height, height))
            return wrapped_height
    return 0


def draw_corner_marks(c: canvas.Canvas, x: float, y: float, w: float, h: float, color: str) -> None:
    c.setStrokeColor(hex_color(color))
    c.setLineWidth(0.45)
    mark = 5 * mm
    inset = 2.4 * mm
    for sx in (x + inset, x + w - inset):
        c.line(sx, y + inset, sx + (mark if sx < x + w / 2 else -mark), y + inset)
        c.line(sx, y + h - inset, sx + (mark if sx < x + w / 2 else -mark), y + h - inset)
    for sy in (y + inset, y + h - inset):
        c.line(x + inset, sy, x + inset, sy + (mark if sy < y + h / 2 else -mark))
        c.line(x + w - inset, sy, x + w - inset, sy + (mark if sy < y + h / 2 else -mark))


def draw_interior_page(c: canvas.Canvas, page_title: str, subtitle: str, page_number: int) -> None:
    c.setFillColor(hex_color(PALETTE["smoke"]))
    c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)

    margin = 6 * mm
    c.setFillColor(hex_color(PALETTE["parchment"]))
    c.roundRect(margin, margin, PAGE_WIDTH - (2 * margin), PAGE_HEIGHT - (2 * margin), 3 * mm, stroke=0, fill=1)

    c.setStrokeColor(hex_color(PALETTE["brass_dark"]))
    c.setLineWidth(0.65)
    c.roundRect(margin, margin, PAGE_WIDTH - (2 * margin), PAGE_HEIGHT - (2 * margin), 3 * mm, stroke=1, fill=0)
    draw_corner_marks(c, margin, margin, PAGE_WIDTH - (2 * margin), PAGE_HEIGHT - (2 * margin), PALETTE["brass"])

    header_x = 10 * mm
    header_y = PAGE_HEIGHT - 20 * mm
    header_w = PAGE_WIDTH - 20 * mm
    header_h = 13 * mm
    c.setFillColor(hex_color(PALETTE["graphite"]))
    c.roundRect(header_x, header_y, header_w, header_h, 2.2 * mm, stroke=0, fill=1)
    c.setStrokeColor(hex_color(PALETTE["brass"]))
    c.setLineWidth(0.45)
    c.roundRect(header_x, header_y, header_w, header_h, 2.2 * mm, stroke=1, fill=0)

    c.setFont("Times-Roman", 13)
    c.setFillColor(hex_color(PALETTE["brass"]))
    c.drawString(header_x + 5 * mm, header_y + 7.3 * mm, page_title)
    c.setFont("Helvetica", 5.6)
    c.setFillColor(hex_color(PALETTE["parchment_deep"]))
    c.drawString(header_x + 5 * mm, header_y + 3.3 * mm, subtitle[:160])

    c.setFont("Helvetica", 5.4)
    c.setFillColor(hex_color(PALETTE["muted"]))
    c.drawRightString(PAGE_WIDTH - 10 * mm, 8.5 * mm, f"The Quiet Vale - Core Tile Menu Current v0.2 - Page {page_number}")


def draw_cover(c: canvas.Canvas) -> None:
    c.setFillColor(hex_color(PALETTE["smoke"]))
    c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, stroke=0, fill=1)
    margin = 7 * mm
    c.setStrokeColor(hex_color(PALETTE["brass_dark"]))
    c.setLineWidth(0.7)
    c.rect(margin, margin, PAGE_WIDTH - (2 * margin), PAGE_HEIGHT - (2 * margin), stroke=1, fill=0)
    draw_corner_marks(c, margin, margin, PAGE_WIDTH - (2 * margin), PAGE_HEIGHT - (2 * margin), PALETTE["brass"])

    logo_path = ROOT / "exports" / "rulebook" / "quiet_vale_tree_brass_transparent.png"
    if logo_path.exists():
        image = Image(str(logo_path), width=12 * mm, height=15 * mm)
        image.drawOn(c, (PAGE_WIDTH - 12 * mm) / 2, PAGE_HEIGHT - 35 * mm)

    c.setFont("Times-Roman", 30)
    c.setFillColor(hex_color(PALETTE["brass"]))
    c.drawCentredString(PAGE_WIDTH / 2, PAGE_HEIGHT - 47 * mm, "The Quiet Vale")
    c.setFont("Times-Roman", 11)
    c.setFillColor(hex_color(PALETTE["parchment_deep"]))
    c.drawCentredString(PAGE_WIDTH / 2, PAGE_HEIGHT - 55 * mm, "Seasons of Settlement")
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(hex_color(PALETTE["brass"]))
    c.drawCentredString(PAGE_WIDTH / 2, PAGE_HEIGHT - 65 * mm, "Core Tile Menu")
    c.setFont("Helvetica", 6.1)
    c.setFillColor(hex_color(PALETTE["parchment_deep"]))
    c.drawCentredString(PAGE_WIDTH / 2, PAGE_HEIGHT - 70 * mm, "A5 landscape current build - Basic side paired with upgraded side")

    panel_x = 22 * mm
    panel_y = 20 * mm
    panel_w = PAGE_WIDTH - 44 * mm
    panel_h = 40 * mm
    c.setFillColor(hex_color(PALETTE["parchment"]))
    c.roundRect(panel_x, panel_y, panel_w, panel_h, 2.5 * mm, stroke=0, fill=1)
    c.setStrokeColor(hex_color(PALETTE["brass_dark"]))
    c.setLineWidth(0.55)
    c.roundRect(panel_x, panel_y, panel_w, panel_h, 2.5 * mm, stroke=1, fill=0)

    draw_text(
        c,
        "How to use this menu: find the tile category, then read the Basic tile on the left and its Upgraded side on the right. Costs are written as plain resource text. Effects are shortened only where needed for table readability; tile data remains the source.",
        panel_x + 6 * mm,
        panel_y + panel_h - 6 * mm,
        panel_w - 12 * mm,
        panel_h - 12 * mm,
        ParagraphStyle("CoverBody", fontName="Helvetica", fontSize=7.1, leading=9, textColor=hex_color(PALETTE["ink"])),
    )


def draw_chip(c: canvas.Canvas, text: str, x: float, y: float, width: float, accent: str) -> None:
    c.setFillColor(hex_color(blend(accent, PALETTE["parchment_light"], 0.15)))
    c.roundRect(x, y, width, 4.5 * mm, 1.6 * mm, stroke=0, fill=1)
    c.setStrokeColor(hex_color(blend(accent, PALETTE["line"], 0.5)))
    c.setLineWidth(0.35)
    c.roundRect(x, y, width, 4.5 * mm, 1.6 * mm, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 4.6)
    c.setFillColor(hex_color(PALETTE["ink"]))
    c.drawCentredString(x + width / 2, y + 1.45 * mm, clean(text))


def tile_lines(tile: dict, side: str) -> list[tuple[str, str]]:
    action_label = "Place" if side == "Basic" else "Upgrade"
    action_cost = cost_text(tile.get("place_cost") if side == "Basic" else tile.get("upgrade_cost"))
    lines = [(action_label, action_cost)]

    rule = summary_text(tile.get("placement_rules"))
    if rule != "-":
        lines.append(("Where", rule))

    benefit = summary_text(tile.get("benefit"))
    if benefit != "-":
        lines.append(("Does", benefit))

    score = score_text(tile)
    if score != "-":
        lines.append(("Score", score))

    return lines


def draw_tile_panel(c: canvas.Canvas, tile: dict, x: float, y: float, w: float, h: float, accent: str, side: str) -> None:
    fill = blend(accent, PALETTE["parchment_light"], 0.06)
    edge = accent
    c.setFillColor(hex_color(fill))
    c.roundRect(x, y, w, h, 1.8 * mm, stroke=0, fill=1)
    c.setStrokeColor(hex_color(edge))
    c.setLineWidth(0.65)
    c.roundRect(x, y, w, h, 1.8 * mm, stroke=1, fill=0)

    top_h = 7 * mm
    c.setFillColor(hex_color(blend(accent, PALETTE["parchment"], 0.17)))
    c.roundRect(x, y + h - top_h, w, top_h, 1.8 * mm, stroke=0, fill=1)
    c.setStrokeColor(hex_color(blend(accent, PALETTE["line"], 0.6)))
    c.setLineWidth(0.35)
    c.line(x, y + h - top_h, x + w, y + h - top_h)

    title = clean(tile["tile_name"])
    title_style = STYLES["header"] if len(title) < 24 else STYLES["medium"]
    draw_text(c, title, x + 3 * mm, y + h - 2 * mm, w - 31 * mm, 5.2 * mm, title_style)

    chip = f"{side} x{tile.get('stock', '-')}"
    if tile.get("size_hexes", 1) > 1:
        chip += f" / {tile['size_hexes']} hexes"
    draw_chip(c, chip, x + w - 27.5 * mm, y + h - 6.15 * mm, 24.5 * mm, accent)

    content_top = y + h - top_h - 2 * mm
    content_bottom = y + 2.6 * mm
    label_w = 13 * mm
    line_gap = 0.8 * mm
    lines = tile_lines(tile, side)
    available_h = content_top - content_bottom
    weights = []
    for label, value in lines:
        if label == "Does" and len(value) > 145:
            weights.append(2.85)
        elif label == "Does" and len(value) > 95:
            weights.append(2.25)
        elif label == "Does" and len(value) > 58:
            weights.append(1.65)
        elif label == "Where" and len(value) > 55:
            weights.append(1.25)
        else:
            weights.append(1)
    unit_h = (available_h - (line_gap * (len(lines) - 1))) / sum(weights)
    row_heights = [max(4.1 * mm, unit_h * weight) for weight in weights]
    total_h = sum(row_heights) + (line_gap * (len(lines) - 1))
    if total_h > available_h:
        scale = available_h / total_h
        row_heights = [height * scale for height in row_heights]
    cursor = content_top

    for (label, value), row_h in zip(lines, row_heights):
        c.setFillColor(hex_color(blend(accent, PALETTE["parchment_light"], 0.11)))
        c.roundRect(x + 2.2 * mm, cursor - row_h, label_w, row_h, 1 * mm, stroke=0, fill=1)
        c.setStrokeColor(hex_color(blend(accent, PALETTE["line"], 0.55)))
        c.setLineWidth(0.25)
        c.roundRect(x + 2.2 * mm, cursor - row_h, label_w, row_h, 1 * mm, stroke=1, fill=0)
        c.setFont("Helvetica-Bold", 4.6)
        c.setFillColor(hex_color(PALETTE["ink"]))
        c.drawCentredString(x + 2.2 * mm + label_w / 2, cursor - (row_h / 2) - 1.35, label)

        text_style = STYLES["body"] if len(value) < 95 else STYLES["small"]
        draw_text(c, value, x + label_w + 4.6 * mm, cursor - 0.8 * mm, w - label_w - 7.2 * mm, row_h - 1 * mm, text_style)
        cursor -= row_h + line_gap


def draw_tile_pair(c: canvas.Canvas, pair: TilePair, x: float, y: float, w: float, h: float) -> None:
    accent = pair.accent
    c.setFillColor(hex_color(blend(accent, PALETTE["parchment"], 0.08)))
    c.roundRect(x, y, w, h, 2.2 * mm, stroke=0, fill=1)
    c.setStrokeColor(hex_color(blend(accent, PALETTE["line"], 0.45)))
    c.setLineWidth(0.4)
    c.roundRect(x, y, w, h, 2.2 * mm, stroke=1, fill=0)

    gutter = 3 * mm
    panel_w = (w - gutter - 4 * mm) / 2
    panel_h = h - 4 * mm
    panel_y = y + 2 * mm
    draw_tile_panel(c, pair.basic, x + 2 * mm, panel_y, panel_w, panel_h, accent, "Basic")
    draw_tile_panel(c, pair.upgraded, x + 2 * mm + panel_w + gutter, panel_y, panel_w, panel_h, accent, "Upgraded")


def draw_tile_page(c: canvas.Canvas, title: str, subtitle: str, names: list[str], page_number: int, pairs: dict[str, TilePair]) -> None:
    draw_interior_page(c, title, subtitle, page_number)

    left = 10 * mm
    right = PAGE_WIDTH - 10 * mm
    top = PAGE_HEIGHT - 25 * mm
    bottom = 12 * mm
    width = right - left
    available_h = top - bottom
    gap = 2.1 * mm
    row_h = (available_h - gap * (len(names) - 1)) / len(names)
    cursor_y = top - row_h

    for name in names:
        pair = pairs[name]
        draw_tile_pair(c, pair, left, cursor_y, width, row_h)
        cursor_y -= row_h + gap


def draw_reference_page(c: canvas.Canvas, page_number: int) -> None:
    draw_interior_page(
        c,
        "Quick Reference",
        "Category colours, resource names, and reading order for the Core Tile Menu.",
        page_number,
    )
    left = 13 * mm
    top = PAGE_HEIGHT - 32 * mm
    col_w = 54 * mm
    row_h = 10 * mm
    c.setFont("Helvetica-Bold", 7.5)
    c.setFillColor(hex_color(PALETTE["ink"]))
    c.drawString(left, top + 4 * mm, "Tile category colour key")
    for index, category in enumerate(CATEGORY_ORDER):
        x = left + (index % 3) * (col_w + 7 * mm)
        y = top - ((index // 3) * (row_h + 3 * mm))
        accent = CATEGORY_FALLBACKS[category]
        c.setFillColor(hex_color(blend(accent, PALETTE["parchment_light"], 0.25)))
        c.roundRect(x, y - row_h, col_w, row_h, 1.5 * mm, stroke=0, fill=1)
        c.setStrokeColor(hex_color(accent))
        c.setLineWidth(0.55)
        c.roundRect(x, y - row_h, col_w, row_h, 1.5 * mm, stroke=1, fill=0)
        c.setFillColor(hex_color(accent))
        c.circle(x + 5 * mm, y - 5 * mm, 2 * mm, stroke=0, fill=1)
        c.setFillColor(hex_color(PALETTE["ink"]))
        c.setFont("Helvetica-Bold", 6.3)
        c.drawString(x + 9 * mm, y - 6.4 * mm, category)

    note_x = left
    note_y = 37 * mm
    note_w = PAGE_WIDTH - (2 * left)
    note_h = 22 * mm
    c.setFillColor(hex_color(PALETTE["parchment_light"]))
    c.roundRect(note_x, note_y, note_w, note_h, 2 * mm, stroke=0, fill=1)
    c.setStrokeColor(hex_color(PALETTE["line"]))
    c.setLineWidth(0.45)
    c.roundRect(note_x, note_y, note_w, note_h, 2 * mm, stroke=1, fill=0)
    draw_text(
        c,
        "Reading order: read the Basic tile first, then the Upgraded tile. The left panel shows placement cost, placement rule, and base effect. The right panel shows upgrade cost, upgraded effect, and final Pop/Ren score. Stock count is shown in the top-right chip.",
        note_x + 5 * mm,
        note_y + note_h - 5 * mm,
        note_w - 10 * mm,
        note_h - 8 * mm,
        ParagraphStyle("ReferenceNote", fontName="Helvetica", fontSize=7, leading=9, textColor=hex_color(PALETTE["ink"])),
    )


def write_manifest(path: Path, page_count: int, pairs: dict[str, TilePair]) -> None:
    grouped_counts = {}
    for pair in pairs.values():
        grouped_counts[pair.basic["tile_category"]] = grouped_counts.get(pair.basic["tile_category"], 0) + 1

    lines = [
        "The Quiet Vale - Core Tile Menu A5 Landscape Current v0.2",
        f"PDF: {PDF_PATH}",
        f"Pages: {page_count}",
        f"Core Basic tile entries: {len(pairs)}",
        "Category counts:",
    ]
    for category in CATEGORY_ORDER:
        if category in grouped_counts:
            lines.append(f"- {category}: {grouped_counts[category]}")
    lines.extend(
        [
            "",
            "Source data:",
            "- src/data/tiles.json",
            "- src/data/tile_colour_variations.json",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def export_pdf() -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    pairs = build_pairs()

    c = canvas.Canvas(str(PDF_PATH), pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    draw_cover(c)
    c.showPage()

    for offset, group in enumerate(PAGE_GROUPS, start=2):
        draw_tile_page(c, group["title"], group["subtitle"], group["tiles"], offset, pairs)
        c.showPage()

    draw_reference_page(c, len(PAGE_GROUPS) + 2)
    c.showPage()
    c.save()

    page_count = len(PdfReader(str(PDF_PATH)).pages)
    write_manifest(MANIFEST_PATH, page_count, pairs)
    return PDF_PATH


if __name__ == "__main__":
    output = export_pdf()
    print(output)
