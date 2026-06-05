#!/usr/bin/env python3
"""Export tarot-size encounter card front print sheets for The Quiet Vale."""

from __future__ import annotations

import argparse
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


PAGE_W_MM = 210
PAGE_H_MM = 297
MM_TO_PT = 72 / 25.4

CARD_W_MM = 70
CARD_H_MM = 121
COLS = 2
ROWS = 2
GAP_X_MM = 12
GAP_Y_MM = 12
MARGIN_X_MM = (PAGE_W_MM - (COLS * CARD_W_MM + (COLS - 1) * GAP_X_MM)) / 2
MARGIN_Y_MM = (PAGE_H_MM - (ROWS * CARD_H_MM + (ROWS - 1) * GAP_Y_MM)) / 2

TYPE_ACCENTS = {
    "Boon": "#7CA86B",
    "Burden": "#9B789F",
    "Arrival": "#7D8FBE",
    "Golden Boon": "#D6B73E",
}
TYPE_MARKS = {
    "Boon": "B",
    "Burden": "!",
    "Arrival": "A",
    "Golden Boon": "G",
}


@dataclass(frozen=True)
class CardCopy:
    card: dict


def mm(value: float) -> float:
    return value * MM_TO_PT


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
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return re.sub(r"\s+", " ", text).strip()


def page_xy(origin_x: float, origin_y: float, local_x: float, local_y_from_top: float) -> tuple[float, float]:
    return mm(origin_x + local_x), mm(PAGE_H_MM - origin_y - local_y_from_top)


def hex_color(value: str, fallback: str = "#8F6B35") -> colors.Color:
    try:
        return colors.HexColor(value or fallback)
    except ValueError:
        return colors.HexColor(fallback)


def text_width_mm(text: str, font: str, size: float) -> float:
    return pdfmetrics.stringWidth(text, font, size) / MM_TO_PT


def wrap_text(text: object, width_mm: float, font: str, size: float, max_lines: int | None = None) -> list[str]:
    words = clean(text).split()
    if not words:
        return []

    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or text_width_mm(candidate, font, size) <= width_mm:
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
    if max_lines is not None and lines and len(consumed) < len(full):
        last = lines[-1]
        while last and text_width_mm(f"{last}...", font, size) > width_mm:
            last = last[:-1]
        lines[-1] = f"{last}..." if last else "..."

    return lines


def fit_text_box(
    text: object,
    width_mm: float,
    height_mm: float,
    *,
    max_size: float,
    min_size: float,
    font: str = "Helvetica",
    line_height_factor: float = 1.18,
) -> tuple[list[str], float, float]:
    size = max_size
    while size >= min_size:
        line_height_mm = (size * line_height_factor) / MM_TO_PT
        max_lines = max(1, math.floor(height_mm / line_height_mm))
        lines = wrap_text(text, width_mm, font, size, max_lines)
        if not lines or not lines[-1].endswith("..."):
            return lines, size, line_height_mm
        size -= 0.25

    size = min_size
    line_height_mm = (size * line_height_factor) / MM_TO_PT
    max_lines = max(1, math.floor(height_mm / line_height_mm))
    return wrap_text(text, width_mm, font, size, max_lines), size, line_height_mm


def draw_text(
    pdf: canvas.Canvas,
    origin_x: float,
    origin_y: float,
    text: object,
    x: float,
    y: float,
    font_size: float,
    *,
    font: str = "Helvetica",
    color: str = "#171512",
    align: str = "left",
):
    px, py = page_xy(origin_x, origin_y, x, y)
    pdf.setFont(font, font_size)
    pdf.setFillColor(hex_color(color))
    value = clean(text)
    if align == "center":
        pdf.drawCentredString(px, py, value)
    elif align == "right":
        pdf.drawRightString(px, py, value)
    else:
        pdf.drawString(px, py, value)


def draw_text_box(
    pdf: canvas.Canvas,
    origin_x: float,
    origin_y: float,
    text: object,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    max_size: float,
    min_size: float,
    font: str = "Helvetica",
    color: str = "#171512",
    bold: bool = False,
    center: bool = False,
):
    use_font = "Helvetica-Bold" if bold else font
    lines, size, line_height = fit_text_box(text, w, h, max_size=max_size, min_size=min_size, font=use_font)
    for index, line in enumerate(lines):
        line_y = y + 0.8 + index * line_height
        draw_text(
            pdf,
            origin_x,
            origin_y,
            line,
            x + w / 2 if center else x,
            line_y,
            size,
            font=use_font,
            color=color,
            align="center" if center else "left",
        )


def rect_from_top(
    pdf: canvas.Canvas,
    origin_x: float,
    origin_y: float,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    fill,
    stroke=None,
    line_width: float = 0.25,
):
    px = mm(origin_x + x)
    py = mm(PAGE_H_MM - origin_y - y - h)
    pdf.setFillColor(fill)
    if stroke:
        pdf.setStrokeColor(stroke)
        pdf.setLineWidth(mm(line_width))
        pdf.rect(px, py, mm(w), mm(h), fill=1, stroke=1)
    else:
        pdf.rect(px, py, mm(w), mm(h), fill=1, stroke=0)


def round_rect_from_top(
    pdf: canvas.Canvas,
    origin_x: float,
    origin_y: float,
    x: float,
    y: float,
    w: float,
    h: float,
    radius: float,
    *,
    fill,
    stroke,
    line_width: float = 0.25,
):
    px = mm(origin_x + x)
    py = mm(PAGE_H_MM - origin_y - y - h)
    pdf.setFillColor(fill)
    pdf.setStrokeColor(stroke)
    pdf.setLineWidth(mm(line_width))
    pdf.roundRect(px, py, mm(w), mm(h), mm(radius), fill=1, stroke=1)


def circle_from_top(
    pdf: canvas.Canvas,
    origin_x: float,
    origin_y: float,
    x: float,
    y: float,
    r: float,
    *,
    fill,
    stroke,
    line_width: float = 0.25,
):
    px, py = page_xy(origin_x, origin_y, x, y)
    pdf.setFillColor(fill)
    pdf.setStrokeColor(stroke)
    pdf.setLineWidth(mm(line_width))
    pdf.circle(px, py, mm(r), fill=1, stroke=1)


def draw_card_frame(pdf: canvas.Canvas, origin_x: float, origin_y: float, card_type: str):
    accent = hex_color(TYPE_ACCENTS.get(card_type, "#8F6B35"))
    outer = colors.HexColor("#202726")
    round_rect_from_top(pdf, origin_x, origin_y, 0, 0, CARD_W_MM, CARD_H_MM, 2.6, fill=colors.HexColor("#f7efd9"), stroke=outer, line_width=0.55)
    rect_from_top(pdf, origin_x, origin_y, 0, 0, 3.2, CARD_H_MM, fill=accent)
    rect_from_top(pdf, origin_x, origin_y, 3.2, 0, CARD_W_MM - 3.2, 8.8, fill=outer)


def draw_header(pdf: canvas.Canvas, origin_x: float, origin_y: float, card: dict):
    card_type = card["encounter_type"]
    accent = hex_color(TYPE_ACCENTS.get(card_type, "#8F6B35"))
    mark = TYPE_MARKS.get(card_type, "?")
    circle_from_top(pdf, origin_x, origin_y, 9.2, 4.4, 2.8, fill=colors.HexColor("#202726"), stroke=accent, line_width=0.22)
    draw_text(pdf, origin_x, origin_y, mark, 9.2, 5.5, 5.2, font="Helvetica-Bold", color=TYPE_ACCENTS.get(card_type, "#D6B73E"), align="center")
    draw_text(pdf, origin_x, origin_y, card_type.upper(), 14.0, 5.7, 5.5, font="Helvetica-Bold", color="#f6f1e6")

    rect_from_top(pdf, origin_x, origin_y, 3.2, 8.8, CARD_W_MM - 3.2, 15.5, fill=colors.HexColor("#38403D"), stroke=colors.HexColor("#8f7c48"), line_width=0.18)
    draw_text_box(
        pdf,
        origin_x,
        origin_y,
        card["card_name"],
        7.5,
        11.2,
        CARD_W_MM - 11,
        10,
        max_size=10.2,
        min_size=6.8,
        color="#f8f3e8",
        bold=True,
        center=True,
    )


def draw_flavour(pdf: canvas.Canvas, origin_x: float, origin_y: float, card: dict):
    round_rect_from_top(
        pdf,
        origin_x,
        origin_y,
        5.6,
        27.2,
        CARD_W_MM - 11.2,
        30,
        1.2,
        fill=colors.HexColor("#fbf2d5"),
        stroke=colors.HexColor("#d5be82"),
        line_width=0.22,
    )
    draw_text_box(
        pdf,
        origin_x,
        origin_y,
        card.get("flavour_text"),
        8.0,
        29.1,
        CARD_W_MM - 16,
        26.5,
        max_size=5.5,
        min_size=4.3,
        color="#26332d",
    )


def is_default_boon_lifecycle(text: str) -> bool:
    return re.fullmatch(r"Resolve the current Season effect, then discard this card\.?", clean(text), flags=re.I) is not None


def extract_burden_resolve_text(card: dict) -> str:
    lifecycle = clean(card.get("lifecycle_or_resolution"))
    match = re.search(r"To resolve:\s*(.*)", lifecycle, flags=re.I)
    return clean(match.group(1) if match else "")


def burden_resolve_rows(card: dict) -> dict[str, str]:
    resolve = extract_burden_resolve_text(card)
    if not resolve:
        return {}

    match = re.match(
        r"Spend 1 Action and pay (.*?) based on the current Season:\s*Season I\s+([^;]+);\s*Season II\s+([^;]+);\s*Season III\s+([^.;]+)\.?\s*(.*)",
        resolve,
        flags=re.I,
    )
    if not match:
        return {"I": resolve, "II": resolve, "III": resolve}

    base, one, two, three, trailing = match.groups()
    trailing = clean(trailing)

    def format_cost(value: str) -> str:
        cost = clean(value)
        if "resources of your choice" in base.lower() and re.search(r"\bresources\b", cost, flags=re.I):
            cost = re.sub(r"\bresources\b", "resources of your choice", cost, flags=re.I)
        return clean(f"Resolve: 1 Action + {cost}. {trailing}")

    return {"I": format_cost(one), "II": format_cost(two), "III": format_cost(three)}


def draw_season_rows(pdf: canvas.Canvas, origin_x: float, origin_y: float, card: dict, panel_x: float, panel_y: float, panel_w: float):
    card_type = card["encounter_type"]
    resolve = burden_resolve_rows(card) if card_type == "Burden" else {}
    row_h = 13.8 if card_type == "Boon" else 15.3
    y = panel_y + 2.4

    for marker, field in [("I", "season_i"), ("II", "season_ii"), ("III", "season_iii")]:
        row_text = clean(card.get(field))
        if resolve.get(marker):
            row_text = clean(f"{row_text} {resolve[marker]}")
        rect_from_top(
            pdf,
            origin_x,
            origin_y,
            panel_x + 2.0,
            y,
            panel_w - 4.0,
            row_h,
            fill=colors.HexColor("#2d3634"),
            stroke=colors.HexColor("#514f45"),
            line_width=0.12,
        )
        circle_from_top(pdf, origin_x, origin_y, panel_x + 6.0, y + 4.5, 2.5, fill=colors.HexColor("#2d3634"), stroke=colors.HexColor("#d7bd67"), line_width=0.16)
        draw_text(pdf, origin_x, origin_y, marker, panel_x + 6.0, y + 5.5, 4.6, font="Helvetica-Bold", color="#d7bd67", align="center")
        draw_text_box(
            pdf,
            origin_x,
            origin_y,
            row_text,
            panel_x + 10.0,
            y + 1.4,
            panel_w - 14.0,
            row_h - 2.2,
            max_size=4.8 if card_type == "Boon" else 4.45,
            min_size=3.5,
            color="#f6f1e6",
            bold=True,
        )
        y += row_h + 1.1

    lifecycle = clean(card.get("lifecycle_or_resolution"))
    if card_type == "Boon" and not is_default_boon_lifecycle(lifecycle):
        footer = lifecycle
    elif card_type == "Burden":
        footer = "Active Burden. Reapply at Season starts until resolved."
    else:
        footer = ""

    if footer:
        draw_text_box(
            pdf,
            origin_x,
            origin_y,
            footer,
            panel_x + 2.5,
            panel_y + 50.3,
            panel_w - 5.0,
            3.9,
            max_size=3.7,
            min_size=3.1,
            color="#d8d2c4",
        )


def draw_arrival_panel(pdf: canvas.Canvas, origin_x: float, origin_y: float, card: dict, panel_x: float, panel_y: float, panel_w: float):
    draw_text(pdf, origin_x, origin_y, "REQUIREMENT", panel_x + 3.2, panel_y + 6.4, 5.1, font="Helvetica-Bold", color="#d7bd67")
    draw_text_box(
        pdf,
        origin_x,
        origin_y,
        card.get("requirement"),
        panel_x + 3.2,
        panel_y + 9.2,
        panel_w - 6.4,
        17.0,
        max_size=5.1,
        min_size=4.1,
        color="#f6f1e6",
        bold=True,
    )
    rect_from_top(pdf, origin_x, origin_y, panel_x + 2.0, panel_y + 29.2, panel_w - 4.0, 10.0, fill=colors.HexColor("#333b38"), stroke=colors.HexColor("#6b654d"), line_width=0.12)
    draw_text(pdf, origin_x, origin_y, "REWARD", panel_x + 4.0, panel_y + 35.2, 5.0, font="Helvetica-Bold", color="#d7bd67")
    draw_text_box(
        pdf,
        origin_x,
        origin_y,
        card.get("reward"),
        panel_x + 18.0,
        panel_y + 32.0,
        panel_w - 21.0,
        6.8,
        max_size=5.5,
        min_size=4.3,
        color="#f6f1e6",
        bold=True,
    )
    draw_text_box(
        pdf,
        origin_x,
        origin_y,
        "Complete: spend 1 Action while fulfilled. Remove timers and place unlocked Special Tile on this card.",
        panel_x + 3.0,
        panel_y + 42.0,
        panel_w - 6.0,
        9.5,
        max_size=4.25,
        min_size=3.5,
        color="#d8d2c4",
    )


def draw_golden_panel(pdf: canvas.Canvas, origin_x: float, origin_y: float, card: dict, panel_x: float, panel_y: float, panel_w: float):
    draw_text(pdf, origin_x, origin_y, "EFFECT", panel_x + 3.2, panel_y + 6.5, 5.2, font="Helvetica-Bold", color="#d7bd67")
    draw_text_box(
        pdf,
        origin_x,
        origin_y,
        card.get("effect"),
        panel_x + 3.2,
        panel_y + 10.0,
        panel_w - 6.4,
        37.2,
        max_size=4.9,
        min_size=3.55,
        color="#f6f1e6",
        bold=True,
    )
    draw_text_box(
        pdf,
        origin_x,
        origin_y,
        "Golden Boon: extra reveal. Does not count toward standard Encounter reveals.",
        panel_x + 3.2,
        panel_y + 48.5,
        panel_w - 6.4,
        5.0,
        max_size=4.0,
        min_size=3.25,
        color="#d8d2c4",
    )


def draw_mechanics_panel(pdf: canvas.Canvas, origin_x: float, origin_y: float, card: dict):
    panel_x, panel_y, panel_w, panel_h = 5.6, 60.2, CARD_W_MM - 11.2, 55.6
    round_rect_from_top(
        pdf,
        origin_x,
        origin_y,
        panel_x,
        panel_y,
        panel_w,
        panel_h,
        1.8,
        fill=colors.HexColor("#222A29"),
        stroke=colors.HexColor("#8f7c48"),
        line_width=0.22,
    )

    card_type = card["encounter_type"]
    if card_type in {"Boon", "Burden"}:
        draw_season_rows(pdf, origin_x, origin_y, card, panel_x, panel_y, panel_w)
    elif card_type == "Arrival":
        draw_arrival_panel(pdf, origin_x, origin_y, card, panel_x, panel_y, panel_w)
    else:
        draw_golden_panel(pdf, origin_x, origin_y, card, panel_x, panel_y, panel_w)


def draw_card_front(pdf: canvas.Canvas, origin_x: float, origin_y: float, copy: CardCopy):
    card = copy.card
    draw_card_frame(pdf, origin_x, origin_y, card["encounter_type"])
    draw_header(pdf, origin_x, origin_y, card)
    draw_flavour(pdf, origin_x, origin_y, card)
    draw_mechanics_panel(pdf, origin_x, origin_y, card)
    draw_text(pdf, origin_x, origin_y, "The Quiet Vale", CARD_W_MM / 2, 118.0, 4.3, font="Helvetica-Bold", color="#7c6a46", align="center")


def card_position(index: int) -> tuple[float, float]:
    col = index % COLS
    row = index // COLS
    return MARGIN_X_MM + col * (CARD_W_MM + GAP_X_MM), MARGIN_Y_MM + row * (CARD_H_MM + GAP_Y_MM)


def draw_footer(pdf: canvas.Canvas, label: str):
    pdf.setFont("Helvetica", 6)
    pdf.setFillColor(colors.HexColor("#4f4639"))
    pdf.drawRightString(mm(PAGE_W_MM - 8), mm(5), label)
    pdf.setStrokeColor(colors.HexColor("#171512"))
    pdf.setLineWidth(mm(0.2))
    pdf.line(mm(8), mm(7), mm(58), mm(7))
    pdf.drawCentredString(mm(33), mm(3.5), "50mm calibration line")


def draw_front_page(pdf: canvas.Canvas, copies: list[CardCopy], label: str):
    pdf.setFillColor(colors.white)
    pdf.rect(0, 0, mm(PAGE_W_MM), mm(PAGE_H_MM), fill=1, stroke=0)
    for index, copy in enumerate(copies):
        draw_card_front(pdf, *card_position(index), copy)
    draw_footer(pdf, label)


def export_fronts_only_pdf(path: Path, title: str, copies: list[CardCopy]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    per_sheet = COLS * ROWS
    sheet_count = math.ceil(len(copies) / per_sheet)
    pdf = canvas.Canvas(str(path), pagesize=(mm(PAGE_W_MM), mm(PAGE_H_MM)))
    pdf.setTitle(f"The Quiet Vale - {title}")
    pdf.setAuthor("The Quiet Vale")

    for sheet_index in range(sheet_count):
        page_copies = copies[sheet_index * per_sheet : (sheet_index + 1) * per_sheet]
        draw_front_page(pdf, page_copies, f"{title} sheet {sheet_index + 1} fronts")
        pdf.showPage()

    pdf.save()
    return sheet_count


def export_single_page_fronts(output_dir: Path, prefix: str, title: str, copies: list[CardCopy]) -> list[tuple[str, int]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    per_sheet = COLS * ROWS
    sheet_count = math.ceil(len(copies) / per_sheet)
    written: list[tuple[str, int]] = []

    for sheet_index in range(sheet_count):
        page_copies = copies[sheet_index * per_sheet : (sheet_index + 1) * per_sheet]
        path = output_dir / f"{prefix}_{sheet_index + 1:02d}_fronts_only_70x121mm_a4.pdf"
        pdf = canvas.Canvas(str(path), pagesize=(mm(PAGE_W_MM), mm(PAGE_H_MM)))
        pdf.setTitle(f"The Quiet Vale - {title} sheet {sheet_index + 1}")
        pdf.setAuthor("The Quiet Vale")
        draw_front_page(pdf, page_copies, f"{title} sheet {sheet_index + 1} fronts")
        pdf.showPage()
        pdf.save()
        written.append((path.name, len(page_copies)))

    return written


def write_manifest(path: Path, sheet_files: list[tuple[str, int]], combined_pages: int, total_cards: int):
    lines = [
        "# The Quiet Vale - Encounter Card Front Print Sheets",
        "",
        f"- Card size: {CARD_W_MM:.2f}mm x {CARD_H_MM:.2f}mm.",
        "- Page size: A4 portrait.",
        "- Layout: 2 columns x 2 rows, 4 cards per full page.",
        f"- Total card fronts: {total_cards}.",
        f"- Combined PDF pages: {combined_pages}.",
        "- Print at Actual Size / 100% scaling.",
        "- Measure the 50mm calibration line before approving a print run.",
        "- No backs are included.",
        "",
        "## Files",
        "",
        "- `quiet_vale_encounter_cards_all_fronts_70x121mm_a4.pdf`: all Encounter and Golden Boon fronts in one multi-page PDF.",
        "- `front_pages/`: one single-page PDF per A4 sheet.",
        "",
        "## Single Page Front Files",
        "",
        "| File | Card fronts on page |",
        "| --- | ---: |",
    ]
    lines.extend(f"| `{name}` | {count} |" for name, count in sheet_files)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def verify_outputs(combined_path: Path, front_page_paths: list[Path], expected_combined_pages: int):
    combined = PdfReader(str(combined_path))
    if len(combined.pages) != expected_combined_pages:
        raise RuntimeError(f"{combined_path} has {len(combined.pages)} pages, expected {expected_combined_pages}")
    for path in front_page_paths:
        reader = PdfReader(str(path))
        if len(reader.pages) != 1:
            raise RuntimeError(f"{path} has {len(reader.pages)} pages, expected 1")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("exports/print_encounter_cards_70x121mm"))
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    output_dir = args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
    cards = json.loads((root / "src/data/encounter_cards.json").read_text(encoding="utf-8"))
    card_copies = [CardCopy(card) for card in cards]

    combined_path = output_dir / "quiet_vale_encounter_cards_all_fronts_70x121mm_a4.pdf"
    combined_pages = export_fronts_only_pdf(combined_path, "Encounter cards", card_copies)
    sheet_files = export_single_page_fronts(
        output_dir / "front_pages",
        "quiet_vale_encounter_cards_sheet",
        "Encounter cards",
        card_copies,
    )
    write_manifest(output_dir / "manifest.md", sheet_files, combined_pages, len(card_copies))
    verify_outputs(combined_path, list((output_dir / "front_pages").glob("*.pdf")), combined_pages)
    print(f"Wrote encounter card print sheets to {output_dir}")


if __name__ == "__main__":
    main()
