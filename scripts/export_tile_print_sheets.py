#!/usr/bin/env python3
"""Export A4 print sheets for The Quiet Vale tile prototypes.

The sheets are generated from the repository JSON data and fixed v1.7.4
hex wireframe geometry. Physical sizing is controlled by point-to-point
hex width in millimetres.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


PAGE_W_MM = 210
PAGE_H_MM = 297
MM_TO_PT = 72 / 25.4

VIEW_W = 1000
VIEW_H = 866.0254

HEX_POINTS = [
    (250, 0),
    (750, 0),
    (1000, 433.0127),
    (750, 866.0254),
    (250, 866.0254),
    (0, 433.0127),
]

RESOURCE_ORDER = ["Wood", "Stone", "Metal", "Food", "Herbs", "Goods"]
CATEGORY_MARKS = {
    "Resource": "R",
    "Housing": "H",
    "Crafting": "C",
    "Merchant": "M",
    "Social": "S",
    "Wellbeing": "W",
    "Travel": "T",
    "Community": "C",
    "Special": "Sp",
}
CATEGORY_ACCENTS = {
    "Resource": "#61724C",
    "Housing": "#8A6B4D",
    "Crafting": "#6C7377",
    "Merchant": "#967540",
    "Social": "#7C5A52",
    "Wellbeing": "#6D8378",
    "Travel": "#5E7482",
    "Special": "#8F6B35",
}


@dataclass(frozen=True)
class TileCopy:
    tile: dict
    copy_number: int
    copy_total: int
    upgrade_tile: dict | None = None


@dataclass(frozen=True)
class SheetLayout:
    tile_w_mm: float
    tile_h_mm: float
    cols: int
    rows: int
    gap_x_mm: float
    gap_y_mm: float
    margin_x_mm: float
    margin_y_mm: float

    @property
    def per_page(self) -> int:
        return self.cols * self.rows


def sanitize_text(value: object) -> str:
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
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return re.sub(r"\s+", " ", text).strip()


def hex_color(value: str, fallback: str = "#8F6B35") -> colors.Color:
    try:
        return colors.HexColor(value or fallback)
    except ValueError:
        return colors.HexColor(fallback)


def parse_hex(value: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", value or "")
    if not match:
        return (143, 107, 53)
    raw = int(match.group(1), 16)
    return ((raw >> 16) & 255, (raw >> 8) & 255, raw & 255)


def mix_hex(source: str, target: str, target_weight: float) -> str:
    sr, sg, sb = parse_hex(source)
    tr, tg, tb = parse_hex(target)
    source_weight = 1 - max(0, min(1, target_weight))
    target_weight = max(0, min(1, target_weight))
    return "#{:02x}{:02x}{:02x}".format(
        round(sr * source_weight + tr * target_weight),
        round(sg * source_weight + tg * target_weight),
        round(sb * source_weight + tb * target_weight),
    )


def normalize_name(value: object) -> str:
    return sanitize_text(value).lower()


def load_json(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def variation_names(row: dict) -> tuple[str, str]:
    return (
        normalize_name(row.get("base_tile") or row.get("baseTile")),
        normalize_name(row.get("upgraded_tile") or row.get("upgradedTile")),
    )


def tile_accent(tile: dict, variations: list[dict]) -> tuple[str, str, str]:
    category = tile.get("tile_category") or "Special"
    category_accent = CATEGORY_ACCENTS.get(category, CATEGORY_ACCENTS["Special"])

    for row in variations:
        if row.get("tile_type") == category:
            category_accent = row.get("type_base_hex") or category_accent
            break

    variant = None
    names_to_check = [normalize_name(tile.get("tile_name")), normalize_name(tile.get("base_tile"))]
    for row in variations:
        base_name, upgraded_name = variation_names(row)
        if base_name in names_to_check or upgraded_name in names_to_check:
            variant = row.get("tile_variant_hex")
            break

    variant = variant or category_accent
    card_fill = mix_hex(category_accent, "#f8f2e6", 0.88)
    return category_accent, variant, card_fill


def format_cost_entries(cost_text: object) -> list[str]:
    if cost_text is None or cost_text == "":
        return []
    if cost_text == 0 or cost_text == "0":
        return ["0"]

    entries: list[tuple[int, str]] = []
    fallback: list[str] = []
    for raw_line in str(cost_text).splitlines():
        line = sanitize_text(raw_line)
        if not line:
            continue
        match = re.fullmatch(r"(\d+)\s+(.+)", line)
        if not match:
            fallback.append(line)
            continue
        amount = int(match.group(1))
        resource = match.group(2)
        if resource in RESOURCE_ORDER:
            entries.append((amount, resource))
        else:
            fallback.append(f"{amount}x {resource}")

    entries.sort(key=lambda item: RESOURCE_ORDER.index(item[1]))
    formatted = [f"{amount}x {resource}" for amount, resource in entries]
    return formatted + fallback if formatted or fallback else ["0"]


def placement_requirement(tile: dict) -> str | None:
    if tile.get("side") == "Upgraded":
        return None

    rules = sanitize_text(tile.get("placement_rules"))
    if re.search(r"any placed,\s*non-Overstrained tile", rules, re.I):
        return None

    requirements = [
        (r"Woodland", "Wood"),
        (r"Mountains", "Mtn"),
        (r"Heaths", "Heath"),
        (r"Arable Land", "Arab"),
        (r"Grasslands", "Grass"),
        (r"Ruins", "Ruin"),
        (r"Water|River", "River"),
        (r"Housing", "H"),
        (r"Travel", "T"),
        (r"Wellbeing", "W"),
        (r"Resource", "R"),
        (r"Crafting", "C"),
        (r"Merchant", "M"),
        (r"Social", "S"),
        (r"Community", "C"),
    ]
    for pattern, mark in requirements:
        if re.search(pattern, rules, re.I):
            return mark
    return None


def effect_mark(tile: dict) -> str:
    benefit = sanitize_text(tile.get("benefit"))
    if re.search(r"Production", benefit, re.I):
        return "P"
    if re.search(r"Steward Power", benefit, re.I):
        return "SP"
    if re.search(r"Passive", benefit, re.I):
        return "Pa"
    if re.search(r"Activate|Activated Effect", benefit, re.I):
        return "A"
    return CATEGORY_MARKS.get(tile.get("tile_category"), "E")


def effect_text(tile: dict) -> str:
    text = sanitize_text(tile.get("benefit") or "No printed effect.")
    text = re.sub(r"^(Production|Activated Effect|Activate|Passive|Steward Power):\s*", "", text, flags=re.I)
    text = re.sub(r"\.$", "", text)
    text = re.sub(r"^Gain\s+", "+", text, flags=re.I)
    text = re.sub(r"\band\s+(\d+\s+(Wood|Stone|Metal|Food|Herbs|Goods))", r"+ \1", text, flags=re.I)
    text = re.sub(r"^Remove\s+", "-", text, flags=re.I)
    return text or "No printed effect"


def make_layout(tile_w_mm: float) -> SheetLayout:
    tile_h_mm = tile_w_mm * math.sqrt(3) / 2
    cols = 3
    rows = 5
    gap_x_mm = 6
    gap_y_mm = 5
    margin_x_mm = (PAGE_W_MM - (cols * tile_w_mm + (cols - 1) * gap_x_mm)) / 2
    margin_y_mm = (PAGE_H_MM - (rows * tile_h_mm + (rows - 1) * gap_y_mm)) / 2
    if margin_x_mm < 4 or margin_y_mm < 4:
        raise ValueError("Tile size is too large for the fixed 3 x 5 A4 layout.")
    return SheetLayout(tile_w_mm, tile_h_mm, cols, rows, gap_x_mm, gap_y_mm, margin_x_mm, margin_y_mm)


class TileDrawer:
    def __init__(self, pdf: canvas.Canvas, layout: SheetLayout, variations: list[dict]):
        self.pdf = pdf
        self.layout = layout
        self.variations = variations
        self.scale_mm = layout.tile_w_mm / VIEW_W
        self.scale_pt = self.scale_mm * MM_TO_PT

    def pt(self, origin_x_mm: float, origin_y_mm: float, x: float, y: float) -> tuple[float, float]:
        page_x_mm = origin_x_mm + x * self.scale_mm
        page_y_mm = origin_y_mm + y * self.scale_mm
        return page_x_mm * MM_TO_PT, (PAGE_H_MM - page_y_mm) * MM_TO_PT

    def line(self, origin_x: float, origin_y: float, x1: float, y1: float, x2: float, y2: float, width: float, color: colors.Color):
        self.pdf.setStrokeColor(color)
        self.pdf.setLineWidth(max(0.15, width * self.scale_pt))
        self.pdf.line(*self.pt(origin_x, origin_y, x1, y1), *self.pt(origin_x, origin_y, x2, y2))

    def polygon(self, origin_x: float, origin_y: float, points: list[tuple[float, float]], fill: colors.Color, stroke: colors.Color, width: float):
        path = self.pdf.beginPath()
        first = True
        for x, y in points:
            px, py = self.pt(origin_x, origin_y, x, y)
            if first:
                path.moveTo(px, py)
                first = False
            else:
                path.lineTo(px, py)
        path.close()
        self.pdf.setFillColor(fill)
        self.pdf.setStrokeColor(stroke)
        self.pdf.setLineWidth(max(0.15, width * self.scale_pt))
        self.pdf.drawPath(path, fill=1, stroke=1)

    def circle(self, origin_x: float, origin_y: float, cx: float, cy: float, radius: float, fill: colors.Color, stroke: colors.Color, width: float = 1.5):
        x, y = self.pt(origin_x, origin_y, cx, cy)
        r = radius * self.scale_pt
        self.pdf.setFillColor(fill)
        self.pdf.setStrokeColor(stroke)
        self.pdf.setLineWidth(max(0.12, width * self.scale_pt))
        self.pdf.circle(x, y, r, fill=1, stroke=1)

    def font_size(self, local_size: float) -> float:
        return max(1.2, local_size * self.scale_pt)

    def text_width(self, text: str, font_size_local: float, font_name: str = "Helvetica") -> float:
        return pdfmetrics.stringWidth(text, font_name, self.font_size(font_size_local)) / self.scale_pt

    def wrap(self, text: str, max_width: float, font_size: float, max_lines: int | None = None) -> list[str]:
        words = sanitize_text(text).split()
        if not words:
            return [""]

        lines: list[str] = []
        current = ""
        for word in words:
            candidate = f"{current} {word}".strip()
            if not current or self.text_width(candidate, font_size) <= max_width:
                current = candidate
                continue
            lines.append(current)
            current = word
            if max_lines is not None and len(lines) >= max_lines:
                break

        if max_lines is None or len(lines) < max_lines:
            if current:
                lines.append(current)

        full = " ".join(words)
        consumed = " ".join(lines)
        if max_lines is not None and len(lines) >= max_lines and len(consumed) < len(full):
            last = lines[-1]
            while last and self.text_width(f"{last}...", font_size) > max_width:
                last = last[:-1]
            lines[-1] = f"{last}..." if last else "..."
        return lines

    def draw_text(
        self,
        origin_x: float,
        origin_y: float,
        text: str,
        x: float,
        y: float,
        font_size: float,
        *,
        font_name: str = "Helvetica",
        color: colors.Color = colors.HexColor("#191715"),
        align: str = "center",
    ):
        px, py = self.pt(origin_x, origin_y, x, y)
        self.pdf.setFont(font_name, self.font_size(font_size))
        self.pdf.setFillColor(color)
        if align == "center":
            self.pdf.drawCentredString(px, py, sanitize_text(text))
        elif align == "right":
            self.pdf.drawRightString(px, py, sanitize_text(text))
        else:
            self.pdf.drawString(px, py, sanitize_text(text))

    def draw_lines_center(
        self,
        origin_x: float,
        origin_y: float,
        lines: list[str],
        x: float,
        start_y: float,
        line_height: float,
        font_size: float,
        *,
        font_name: str = "Helvetica",
        color: colors.Color = colors.HexColor("#191715"),
    ):
        for index, line in enumerate(lines):
            self.draw_text(origin_x, origin_y, line, x, start_y + index * line_height, font_size, font_name=font_name, color=color)

    def draw_cost_entries(self, origin_x: float, origin_y: float, entries: list[str], y: float):
        if not entries:
            return
        positions = {
            1: [500],
            2: [440, 615],
            3: [370, 535, 700],
            4: [330, 455, 580, 705],
        }.get(min(len(entries), 4), [330, 455, 580, 705])
        visible = entries[:4]
        if len(entries) > 4:
            visible = entries[:3] + [f"+{len(entries) - 3} more"]
        for x, entry in zip(positions, visible):
            lines = self.wrap(entry, 140, 26, 2)
            self.draw_lines_center(origin_x, origin_y, lines, x, y - (len(lines) - 1) * 14, 28, 26, font_name="Helvetica-Bold")

    def draw_effect_text(self, origin_x: float, origin_y: float, tile: dict):
        text = effect_text(tile)
        for size in [24, 22, 20, 18, 16, 14]:
            line_height = size + 4
            max_lines = max(1, int(96 // line_height))
            lines = self.wrap(text, 330, size, max_lines)
            overflow = lines and lines[-1].endswith("...")
            if not overflow or size == 14:
                total_h = (len(lines) - 1) * line_height
                start_y = 780 - total_h / 2
                self.draw_lines_center(origin_x, origin_y, lines, 500, start_y, line_height, size)
                return

    def draw_tile(self, origin_x: float, origin_y: float, tile_copy: TileCopy):
        tile = tile_copy.tile
        category_accent, variant_accent, card_fill = tile_accent(tile, self.variations)
        accent = hex_color(variant_accent)
        category_color = hex_color(category_accent)
        fill = hex_color(card_fill, "#fcf8ee")
        ink = colors.HexColor("#171512")
        guide = colors.HexColor("#8b8479")
        plaque = colors.HexColor("#efe8dc")

        self.polygon(origin_x, origin_y, HEX_POINTS, fill, accent, 10)
        self.polygon(origin_x, origin_y, HEX_POINTS, colors.Color(1, 1, 1, alpha=0), ink, 3)

        is_upgraded = tile.get("side") == "Upgraded"
        is_one_sided = tile.get("side") == "One-sided"
        upgrade_tile = tile_copy.upgrade_tile

        for x1, y1, x2, y2 in [
            (151.85, 170, 848.15, 170),
            (50.222, 520, 949.778, 520),
            (154.145, 700, 845.855, 700),
        ]:
            self.line(origin_x, origin_y, x1, y1, x2, y2, 3.2, category_color)

        if not is_upgraded and not is_one_sided:
            self.line(origin_x, origin_y, 102.184, 610, 897.816, 610, 3, category_color)

        for x1, y1, x2, y2 in [
            (335, 40, 335, 140),
            (320, 712, 320, 836.0254),
            (680, 712, 680, 836.0254),
        ]:
            self.line(origin_x, origin_y, x1, y1, x2, y2, 2.2, ink)

        for x1, y1, x2, y2 in [
            (151.85, 170, 500, 345),
            (848.15, 170, 500, 345),
            (151.85, 520, 500, 345),
            (848.15, 520, 500, 345),
        ]:
            self.line(origin_x, origin_y, x1, y1, x2, y2, 1.3, guide)

        self.circle(origin_x, origin_y, 264, 87, 34, plaque, accent, 1.5)
        self.draw_text(origin_x, origin_y, CATEGORY_MARKS.get(tile.get("tile_category"), "T"), 264, 96, 22, font_name="Helvetica-Bold")

        requirement = placement_requirement(tile)
        if requirement and not is_upgraded and not is_one_sided:
            self.circle(origin_x, origin_y, 729, 87, 34, plaque, accent, 1.5)
            self.draw_text(origin_x, origin_y, requirement, 729, 96, 18, font_name="Helvetica-Bold")

        title_center_x = 592 if is_upgraded or is_one_sided else 515
        title_lines = self.wrap(tile.get("tile_name", ""), 285 if not is_upgraded else 410, 44, 2)
        title_start = 70 if len(title_lines) > 1 else 88
        self.draw_lines_center(origin_x, origin_y, title_lines, title_center_x, title_start, 45, 44, font_name="Helvetica-Bold")
        side_text = "Special Tile" if is_one_sided else ("Upgraded" if is_upgraded else "Basic")
        self.draw_text(origin_x, origin_y, side_text, title_center_x, title_start + len(title_lines) * 45 - 3, 18, color=colors.HexColor("#5c554c"))

        self.draw_text(origin_x, origin_y, "Artwork Area", 500, 355, 28, font_name="Helvetica-Bold", color=colors.HexColor("#59524b"))

        if is_upgraded or is_one_sided:
            lineage = f"Upgraded {tile.get('base_tile')}" if is_upgraded and tile.get("base_tile") else "Unlocked Special Tile"
            lineage_lines = self.wrap(lineage, 480, 32, 2)
            self.draw_lines_center(origin_x, origin_y, lineage_lines, 500, 595 - (len(lineage_lines) - 1) * 16, 36, 32, font_name="Helvetica-Bold")
            self.draw_text(origin_x, origin_y, "Lineage", 500, 652, 16, color=colors.HexColor("#5c554c"))
        else:
            self.draw_text(origin_x, origin_y, "Place", 150, 576, 32, font_name="Helvetica-Bold", align="left")
            self.draw_cost_entries(origin_x, origin_y, format_cost_entries(tile.get("place_cost")), 575)
            self.draw_text(origin_x, origin_y, "Upgrade", 150, 666, 32, font_name="Helvetica-Bold", align="left")
            upgrade_cost = upgrade_tile.get("upgrade_cost") if upgrade_tile else tile.get("upgrade_cost")
            self.draw_cost_entries(origin_x, origin_y, format_cost_entries(upgrade_cost), 665)

        self.circle(origin_x, origin_y, 369, 745, 27, plaque, accent, 1.2)
        self.draw_text(origin_x, origin_y, effect_mark(tile), 369, 753, 18, font_name="Helvetica-Bold")
        self.draw_effect_text(origin_x, origin_y, tile)

        population = int(tile.get("population") or 0)
        renown = int(tile.get("renown") or 0)
        if population:
            self.circle(origin_x, origin_y, 250, 750, 32, plaque, accent, 1.2)
            self.draw_text(origin_x, origin_y, "Pop", 250, 755, 14, font_name="Helvetica-Bold", color=colors.HexColor("#5c554c"))
            self.draw_text(origin_x, origin_y, str(population), 250, 816, 40, font_name="Helvetica-Bold")
        if renown:
            self.circle(origin_x, origin_y, 750, 750, 32, plaque, accent, 1.2)
            self.draw_text(origin_x, origin_y, "Ren", 750, 755, 14, font_name="Helvetica-Bold", color=colors.HexColor("#5c554c"))
            self.draw_text(origin_x, origin_y, str(renown), 750, 816, 40, font_name="Helvetica-Bold")

        copy_label = f"{tile_copy.copy_number}/{tile_copy.copy_total}" if tile_copy.copy_total > 1 else ""
        if copy_label:
            self.draw_text(origin_x, origin_y, copy_label, 500, 842, 14, color=colors.HexColor("#70685e"))


def draw_footer(pdf: canvas.Canvas, page_label: str):
    pdf.setStrokeColor(colors.HexColor("#171512"))
    pdf.setLineWidth(0.5)
    y = 4.8 * MM_TO_PT
    x = 9 * MM_TO_PT
    pdf.line(x, y, x + 50 * MM_TO_PT, y)
    pdf.setFont("Helvetica", 5)
    pdf.setFillColor(colors.HexColor("#171512"))
    pdf.drawCentredString(x + 25 * MM_TO_PT, 2.3 * MM_TO_PT, "50mm calibration line")
    pdf.drawRightString((PAGE_W_MM - 9) * MM_TO_PT, 2.3 * MM_TO_PT, page_label)


def draw_page_background(pdf: canvas.Canvas):
    pdf.setFillColor(colors.white)
    pdf.rect(0, 0, PAGE_W_MM * MM_TO_PT, PAGE_H_MM * MM_TO_PT, fill=1, stroke=0)


def draw_tile_sheet_page(
    pdf: canvas.Canvas,
    drawer: TileDrawer,
    layout: SheetLayout,
    page_copies: list[TileCopy],
    page_label: str,
    *,
    mirror_positions: bool = False,
):
    draw_page_background(pdf)
    for index, tile_copy in enumerate(page_copies):
        source_col = index % layout.cols
        col = layout.cols - 1 - source_col if mirror_positions else source_col
        row = index // layout.cols
        x = layout.margin_x_mm + col * (layout.tile_w_mm + layout.gap_x_mm)
        y = layout.margin_y_mm + row * (layout.tile_h_mm + layout.gap_y_mm)
        drawer.draw_tile(x, y, tile_copy)

    draw_footer(pdf, page_label)


def draw_generic_back_sheet_page(
    pdf: canvas.Canvas,
    layout: SheetLayout,
    page_copies: list[TileCopy],
    page_label: str,
    *,
    mirror_positions: bool = False,
):
    draw_page_background(pdf)
    drawer = TileDrawer(pdf, layout, [])
    fill = colors.HexColor("#f4ecdd")
    accent = colors.HexColor("#8F6B35")
    ink = colors.HexColor("#171512")

    for index, _tile_copy in enumerate(page_copies):
        source_col = index % layout.cols
        col = layout.cols - 1 - source_col if mirror_positions else source_col
        row = index // layout.cols
        origin_x = layout.margin_x_mm + col * (layout.tile_w_mm + layout.gap_x_mm)
        origin_y = layout.margin_y_mm + row * (layout.tile_h_mm + layout.gap_y_mm)
        drawer.polygon(origin_x, origin_y, HEX_POINTS, fill, accent, 10)
        drawer.polygon(origin_x, origin_y, HEX_POINTS, colors.Color(1, 1, 1, alpha=0), ink, 3)
        drawer.draw_text(origin_x, origin_y, "The Quiet Vale", 500, 410, 42, font_name="Helvetica-Bold")
        drawer.draw_text(origin_x, origin_y, "Seasons of Settlement", 500, 465, 22, color=colors.HexColor("#6f5730"))

    draw_footer(pdf, page_label)


def export_pdf(path: Path, title: str, copies: list[TileCopy], layout: SheetLayout, variations: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(path), pagesize=(PAGE_W_MM * MM_TO_PT, PAGE_H_MM * MM_TO_PT))
    total_pages = max(1, math.ceil(len(copies) / layout.per_page))
    drawer = TileDrawer(pdf, layout, variations)

    for page_index in range(total_pages):
        page_copies = copies[page_index * layout.per_page : (page_index + 1) * layout.per_page]
        draw_tile_sheet_page(pdf, drawer, layout, page_copies, f"{title} - page {page_index + 1} of {total_pages}")
        pdf.showPage()

    pdf.save()


def export_two_page_upload_pairs(
    output_dir: Path,
    filename_prefix: str,
    title: str,
    front_copies: list[TileCopy],
    back_copies: list[TileCopy] | None,
    layout: SheetLayout,
    variations: list[dict],
    *,
    mirror_back_positions: bool = False,
    generic_back: bool = False,
) -> list[tuple[str, int]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    sheet_count = max(1, math.ceil(len(front_copies) / layout.per_page))
    written: list[tuple[str, int]] = []

    for sheet_index in range(sheet_count):
        start = sheet_index * layout.per_page
        end = start + layout.per_page
        front_page = front_copies[start:end]
        back_page = (back_copies or [])[start:end]
        path = output_dir / f"{filename_prefix}_{sheet_index + 1:02d}_front_back_60mm_a4.pdf"
        pdf = canvas.Canvas(str(path), pagesize=(PAGE_W_MM * MM_TO_PT, PAGE_H_MM * MM_TO_PT))
        drawer = TileDrawer(pdf, layout, variations)

        draw_tile_sheet_page(pdf, drawer, layout, front_page, f"{title} sheet {sheet_index + 1} front")
        pdf.showPage()

        if generic_back:
            draw_generic_back_sheet_page(
                pdf,
                layout,
                front_page,
                f"{title} sheet {sheet_index + 1} back",
                mirror_positions=mirror_back_positions,
            )
        else:
            draw_tile_sheet_page(
                pdf,
                drawer,
                layout,
                back_page,
                f"{title} sheet {sheet_index + 1} back",
                mirror_positions=mirror_back_positions,
            )

        pdf.showPage()
        pdf.save()
        written.append((path.name, len(front_page)))

    return written


def write_upload_pair_manifest(path: Path, layout: SheetLayout, standard_files: list[tuple[str, int]], mirrored_files: list[tuple[str, int]]):
    lines = [
        "# The Quiet Vale - Two-Page Upload Pair PDFs",
        "",
        "Each PDF is exactly two pages:",
        "",
        "1. Front sheet",
        "2. Matching back sheet",
        "",
        f"Tile physical size: {layout.tile_w_mm:.2f}mm point-to-point x {layout.tile_h_mm:.2f}mm flat-to-flat.",
        "",
        "## Which Folder To Use",
        "",
        "- `standard_back_order`: back page reads in the same left-to-right order as the front page.",
        "- `mirrored_back_order`: back page is mirrored left-to-right for services that require duplex sheet backs to be reversed.",
        "",
        "If the printer is unsure, ask them which folder matches their duplex setup. A one-sheet proof is strongly recommended before ordering the full set.",
        "",
        "## Standard Back Order Files",
        "",
        "| File | Front tile copies |",
        "| --- | ---: |",
    ]
    lines.extend(f"| `{name}` | {copies} |" for name, copies in standard_files)
    lines.extend(
        [
            "",
            "## Mirrored Back Order Files",
            "",
            "| File | Front tile copies |",
            "| --- | ---: |",
        ]
    )
    lines.extend(f"| `{name}` | {copies} |" for name, copies in mirrored_files)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def expand_copies(tiles: list[dict], upgrade_lookup: dict[str, dict] | None = None) -> list[TileCopy]:
    copies: list[TileCopy] = []
    for tile in tiles:
        total = int(tile.get("stock") or 1)
        upgrade_tile = upgrade_lookup.get(tile.get("upgrade_to")) if upgrade_lookup else None
        for copy_number in range(1, total + 1):
            copies.append(TileCopy(tile=tile, copy_number=copy_number, copy_total=total, upgrade_tile=upgrade_tile))
    return copies


def write_manifest(path: Path, layout: SheetLayout, files: list[tuple[str, int, int]]):
    lines = [
        "# The Quiet Vale - 60mm Tile Print Sheets",
        "",
        "Generated from repository data in `src/data/tiles.json`.",
        "",
        f"- Tile physical size: {layout.tile_w_mm:.2f}mm point-to-point x {layout.tile_h_mm:.2f}mm flat-to-flat.",
        "- Page size: A4 portrait.",
        f"- Layout: {layout.cols} columns x {layout.rows} rows, {layout.per_page} tiles per full page.",
        "- Print at Actual Size / 100% scaling.",
        "- Measure the 50mm calibration line before cutting.",
        "",
        "## Files",
        "",
        "| File | Tile copies | Pages |",
        "| --- | ---: | ---: |",
    ]
    for file_name, copies, pages in files:
        lines.append(f"| `{file_name}` | {copies} | {pages} |")
    lines.extend(
        [
            "",
            "Notes:",
            "- Core fronts and Core backs use matching copy order for manual mounting.",
            "- Home-printer duplex alignment varies; test one page before printing the full set double-sided.",
            "- Long Special Tile effects may be reduced to fit the physical 60mm tile.",
        ]
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tile-width-mm", type=float, default=60, help="single tile point-to-point width in millimetres")
    parser.add_argument("--output-dir", type=Path, default=Path("exports/print_tiles_60mm"))
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    output_dir = args.output_dir if args.output_dir.is_absolute() else root / args.output_dir

    tiles = load_json(root / "src/data/tiles.json")
    variations = load_json(root / "src/data/tile_colour_variations.json")
    layout = make_layout(args.tile_width_mm)

    core_basic = [tile for tile in tiles if tile.get("tile_source_type") == "Core" and tile.get("side") == "Basic"]
    core_upgraded = [tile for tile in tiles if tile.get("tile_source_type") == "Core" and tile.get("side") == "Upgraded"]
    special = [tile for tile in tiles if tile.get("tile_source_type") == "Special"]
    by_name = {tile.get("tile_name"): tile for tile in tiles}

    core_fronts = expand_copies(core_basic, by_name)
    core_backs = []
    for basic_copy in core_fronts:
        upgrade = basic_copy.upgrade_tile
        if not upgrade:
            continue
        core_backs.append(
            TileCopy(
                tile=upgrade,
                copy_number=basic_copy.copy_number,
                copy_total=basic_copy.copy_total,
                upgrade_tile=None,
            )
        )
    special_copies = expand_copies(special)
    all_single_sided = core_fronts + core_backs + special_copies

    outputs = [
        ("quiet_vale_core_fronts_basic_60mm_a4.pdf", "Core fronts", core_fronts),
        ("quiet_vale_core_backs_upgraded_60mm_a4.pdf", "Core backs", core_backs),
        ("quiet_vale_special_tiles_60mm_a4.pdf", "Special tiles", special_copies),
        ("quiet_vale_all_tile_faces_single_sided_60mm_a4.pdf", "All tile faces", all_single_sided),
    ]

    manifest_rows: list[tuple[str, int, int]] = []
    for filename, title, copies in outputs:
        export_pdf(output_dir / filename, title, copies, layout, variations)
        manifest_rows.append((filename, len(copies), max(1, math.ceil(len(copies) / layout.per_page))))

    write_manifest(output_dir / "manifest.md", layout, manifest_rows)

    pair_output_dir = output_dir / "upload_pairs"
    standard_dir = pair_output_dir / "standard_back_order"
    mirrored_dir = pair_output_dir / "mirrored_back_order"
    standard_files: list[tuple[str, int]] = []
    mirrored_files: list[tuple[str, int]] = []

    standard_files.extend(
        export_two_page_upload_pairs(
            standard_dir,
            "quiet_vale_core_sheet",
            "Core tiles",
            core_fronts,
            core_backs,
            layout,
            variations,
        )
    )
    standard_files.extend(
        export_two_page_upload_pairs(
            standard_dir,
            "quiet_vale_special_sheet",
            "Special tiles",
            special_copies,
            None,
            layout,
            variations,
            generic_back=True,
        )
    )
    mirrored_files.extend(
        export_two_page_upload_pairs(
            mirrored_dir,
            "quiet_vale_core_sheet",
            "Core tiles",
            core_fronts,
            core_backs,
            layout,
            variations,
            mirror_back_positions=True,
        )
    )
    mirrored_files.extend(
        export_two_page_upload_pairs(
            mirrored_dir,
            "quiet_vale_special_sheet",
            "Special tiles",
            special_copies,
            None,
            layout,
            variations,
            mirror_back_positions=True,
            generic_back=True,
        )
    )
    write_upload_pair_manifest(pair_output_dir / "manifest.md", layout, standard_files, mirrored_files)
    print(f"Wrote print sheets to {output_dir}")


if __name__ == "__main__":
    main()
