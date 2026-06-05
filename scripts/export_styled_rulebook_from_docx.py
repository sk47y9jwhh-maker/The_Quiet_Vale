#!/usr/bin/env python3
"""Convert the current production rulebook DOCX into a styled PDF draft."""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Iterable
from xml.sax.saxutils import escape

from docx import Document
from docx.document import Document as DocxDocument
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph as DocxParagraph
from pypdf import PdfReader
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


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = Path("/Users/robertlittle/Downloads/The_Quiet_Vale_Production_Rulebook_v2_3_Encounter_Balance_Tables_Left.docx")
OUT_DIR = ROOT / "exports" / "rulebook"
DEFAULT_OUTPUT = OUT_DIR / "The_Quiet_Vale_Rulebook_Styled_Draft_v0_2.pdf"
MANIFEST = OUT_DIR / "manifest_v0_2.txt"
LOGO = ROOT / "src" / "assets" / "quiet_vale_reddit_profile_icon_256.png"

PAGE_WIDTH, PAGE_HEIGHT = A4
CONTENT_WIDTH = 159 * mm

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
    "note": colors.HexColor("#E6D2A9"),
}


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


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base["Title"],
            fontName="Times-Roman",
            fontSize=38,
            leading=42,
            textColor=PALETTE["brass"],
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=15,
            leading=19,
            textColor=PALETTE["parchment_deep"],
            alignment=TA_CENTER,
            spaceAfter=14,
        ),
        "cover_body": ParagraphStyle(
            "CoverBody",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=10.6,
            leading=15,
            textColor=PALETTE["parchment_deep"],
            alignment=TA_CENTER,
            spaceAfter=7,
        ),
        "cover_small": ParagraphStyle(
            "CoverSmall",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=7.7,
            leading=10.2,
            textColor=PALETTE["brass"],
            alignment=TA_CENTER,
            spaceAfter=4,
        ),
        "h1": ParagraphStyle(
            "QVHeading1",
            parent=base["Heading1"],
            fontName="Times-Bold",
            fontSize=20.5,
            leading=25,
            textColor=PALETTE["graphite"],
            spaceBefore=15,
            spaceAfter=7,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "QVHeading2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=11.2,
            leading=14,
            textColor=PALETTE["brass_dark"],
            spaceBefore=10,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "QVHeading3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=9.2,
            leading=12,
            textColor=PALETTE["slate"],
            spaceBefore=8,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "QVBody",
            parent=base["BodyText"],
            fontName="Times-Roman",
            fontSize=9.7,
            leading=13.2,
            textColor=PALETTE["ink"],
            spaceAfter=5,
        ),
        "small": ParagraphStyle(
            "QVSmall",
            parent=base["BodyText"],
            fontName="Times-Roman",
            fontSize=7.2,
            leading=8.8,
            textColor=PALETTE["ink"],
        ),
        "table_header": ParagraphStyle(
            "QVTableHeader",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=6.7,
            leading=8.2,
            textColor=PALETTE["parchment_light"],
            alignment=TA_LEFT,
        ),
        "table_cell": ParagraphStyle(
            "QVTableCell",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=6.8,
            leading=8.3,
            textColor=PALETTE["ink"],
        ),
        "note_label": ParagraphStyle(
            "QVNoteLabel",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=7.4,
            leading=9,
            textColor=PALETTE["brass_dark"],
        ),
        "note_body": ParagraphStyle(
            "QVNoteBody",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10.6,
            textColor=PALETTE["graphite"],
        ),
    }


STYLES = styles()


def prepared_cover_logo() -> Path | None:
    """Extract the brass tree from the square web icon for use on dark covers."""
    if not LOGO.exists():
        return None

    try:
        from PIL import Image as PilImage
    except Exception:
        return None

    output = OUT_DIR / "quiet_vale_tree_brass_transparent.png"
    image = PilImage.open(LOGO).convert("RGBA")
    pixels = image.load()
    width, height = image.size
    brass = (185, 147, 79)
    kept: list[tuple[int, int]] = []

    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b)
            is_tree = r > 72 and g > 52 and luminance > 68 and r > b * 1.35 and g > b * 1.08

            if is_tree:
                strength = max(0, min(255, int((luminance - 54) * 2.2)))
                pixels[x, y] = (
                    int(r * 0.72 + brass[0] * 0.28),
                    int(g * 0.72 + brass[1] * 0.28),
                    int(b * 0.72 + brass[2] * 0.28),
                    strength,
                )
                kept.append((x, y))
            else:
                pixels[x, y] = (0, 0, 0, 0)

    if not kept:
        return None

    min_x = max(0, min(x for x, _ in kept) - 8)
    max_x = min(width, max(x for x, _ in kept) + 9)
    min_y = max(0, min(y for _, y in kept) - 8)
    max_y = min(height, max(y for _, y in kept) + 9)
    cropped = image.crop((min_x, min_y, max_x, max_y))
    output.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(output)
    return output


def block_items(parent: DocxDocument) -> Iterable[DocxParagraph | DocxTable]:
    body = parent.element.body
    for child in body.iterchildren():
        if child.tag.endswith("}p"):
            yield DocxParagraph(child, parent)
        elif child.tag.endswith("}tbl"):
            yield DocxTable(child, parent)


def draw_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PALETTE["smoke"])
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    canvas.setStrokeColor(PALETTE["brass_dark"])
    canvas.setLineWidth(1.0)
    canvas.rect(12 * mm, 12 * mm, PAGE_WIDTH - 24 * mm, PAGE_HEIGHT - 24 * mm, fill=0, stroke=1)
    canvas.setStrokeColor(PALETTE["brass"])
    canvas.setLineWidth(0.45)
    canvas.rect(16 * mm, 16 * mm, PAGE_WIDTH - 32 * mm, PAGE_HEIGHT - 32 * mm, fill=0, stroke=1)
    canvas.line(30 * mm, PAGE_HEIGHT - 83 * mm, 88 * mm, PAGE_HEIGHT - 83 * mm)
    canvas.line(122 * mm, PAGE_HEIGHT - 83 * mm, PAGE_WIDTH - 30 * mm, PAGE_HEIGHT - 83 * mm)
    canvas.line(30 * mm, 74 * mm, PAGE_WIDTH - 30 * mm, 74 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(PALETTE["brass"])
    canvas.drawCentredString(PAGE_WIDTH / 2, 24 * mm, "www.thequietvalegame.com")
    canvas.restoreState()


def draw_body(canvas, doc):
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
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(PALETTE["muted"])
    canvas.drawString(20 * mm, 10 * mm, "The Quiet Vale: Seasons of Settlement")
    canvas.drawRightString(PAGE_WIDTH - 20 * mm, 10 * mm, f"Styled draft v0.2 - Page {doc.page}")
    canvas.restoreState()


def table_widths(rows: list[list[str]]) -> list[float]:
    cols = max((len(row) for row in rows), default=1)
    if cols == 1:
        return [CONTENT_WIDTH]

    scores = []
    for col in range(cols):
        values = [clean(row[col]) if col < len(row) else "" for row in rows]
        max_len = max((len(value) for value in values), default=1)
        avg_len = sum(len(value) for value in values) / max(1, len(values))
        scores.append(max(7, min(42, avg_len * 0.75 + max_len * 0.25)))

    total = sum(scores)
    widths = [CONTENT_WIDTH * score / total for score in scores]
    min_width = 13 * mm if cols >= 6 else 20 * mm
    widths = [max(min_width, width) for width in widths]
    scale = CONTENT_WIDTH / sum(widths)
    return [width * scale for width in widths]


def docx_table_to_flowable(table: DocxTable):
    rows: list[list[str]] = []
    for row in table.rows:
        rows.append([clean(cell.text) for cell in row.cells])
    if not rows:
        return Spacer(1, 0)

    data = []
    for row_index, row in enumerate(rows):
        style = STYLES["table_header"] if row_index == 0 else STYLES["table_cell"]
        data.append([Paragraph(safe(cell), style) for cell in row])

    flowable = LongTable(data, colWidths=table_widths(rows), repeatRows=1, hAlign="LEFT", splitByRow=True)
    flowable.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), PALETTE["graphite"]),
                ("TEXTCOLOR", (0, 0), (-1, 0), PALETTE["parchment_light"]),
                ("BACKGROUND", (0, 1), (-1, -1), PALETTE["parchment_light"]),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PALETTE["parchment_light"], colors.HexColor("#F0E3CC")]),
                ("GRID", (0, 0), (-1, -1), 0.32, PALETTE["line"]),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 3.6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.8),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return flowable


def note_box(text: str):
    if ":" in text:
        label, body = text.split(":", 1)
    else:
        label, body = "Note", text
    table = Table(
        [[Paragraph(safe(label.upper()), STYLES["note_label"]), Paragraph(safe(body), STYLES["note_body"])]],
        colWidths=[36 * mm, 123 * mm],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALETTE["note"]),
                ("BOX", (0, 0), (-1, -1), 0.65, PALETTE["line"]),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return KeepTogether([table, Spacer(1, 5)])


def paragraph_to_flowable(paragraph: DocxParagraph, number: int | None = None):
    text = clean(paragraph.text)
    if not text:
        return None

    style_name = paragraph.style.name
    if style_name == "Heading 1":
        return Paragraph(safe(text), STYLES["h1"])
    if style_name == "Heading 2":
        return Paragraph(safe(text), STYLES["h2"])
    if style_name == "Heading 3":
        return Paragraph(safe(text), STYLES["h3"])
    if style_name == "List Bullet":
        return Paragraph(f'<font color="#7B5E2E">-</font> {safe(text)}', STYLES["body"])
    if style_name == "List Number":
        prefix = f"{number}." if number is not None else "-"
        return Paragraph(f'<font color="#7B5E2E"><b>{prefix}</b></font> {safe(text)}', STYLES["body"])
    if style_name.lower().startswith("note"):
        return note_box(text)
    return Paragraph(safe(text), STYLES["body"])


def title_material(doc: DocxDocument) -> tuple[list[str], int]:
    paragraphs = [clean(p.text) for p in doc.paragraphs]
    material = []
    for index, text in enumerate(paragraphs):
        if text == "Contents":
            return material, index
        if text:
            material.append(text)
    return material, 0


def cover_story(title_lines: list[str]):
    title = title_lines[0] if title_lines else "THE QUIET VALE"
    subtitle = title_lines[1] if len(title_lines) > 1 else "Seasons of Settlement"
    version = title_lines[2] if len(title_lines) > 2 else "Production Rulebook"
    authority = title_lines[3] if len(title_lines) > 3 else ""
    tagline = "A game of stewardship, renewal, and hard choices after the old realm falls quiet."

    flow = [Spacer(1, 50 * mm)]
    logo = prepared_cover_logo()
    if logo:
        image = Image(str(logo), width=18 * mm, height=22 * mm)
        image.hAlign = "CENTER"
        flow.extend([image, Spacer(1, 16 * mm)])

    flow.extend(
        [
            Paragraph(safe(title.title()), STYLES["cover_title"]),
            Paragraph(safe(subtitle), STYLES["cover_subtitle"]),
            Paragraph(safe(version), STYLES["cover_small"]),
            Spacer(1, 52 * mm),
            Paragraph(safe(tagline), STYLES["cover_body"]),
            Spacer(1, 7 * mm),
            Paragraph(safe(authority), STYLES["cover_small"]),
        ]
    )
    flow.append(PageBreak())
    return flow


def build_story(doc: DocxDocument):
    title_lines, body_start_paragraph_index = title_material(doc)
    story = cover_story(title_lines)

    paragraph_seen = -1
    list_number = 0
    for block in block_items(doc):
        if isinstance(block, DocxParagraph):
            paragraph_seen += 1
            if paragraph_seen < body_start_paragraph_index:
                continue
            if block.style.name == "List Number" and clean(block.text):
                list_number += 1
                flowable = paragraph_to_flowable(block, list_number)
            else:
                if block.style.name != "List Number":
                    list_number = 0
                flowable = paragraph_to_flowable(block)
            if flowable is not None:
                story.append(flowable)
        else:
            list_number = 0
            story.append(docx_table_to_flowable(block))
            story.append(Spacer(1, 7))
    return story


def build_pdf(source: Path, output: Path):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    docx = Document(source)
    pdf = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=25 * mm,
        leftMargin=25 * mm,
        topMargin=24 * mm,
        bottomMargin=24 * mm,
        title="The Quiet Vale Rulebook Styled Draft v0.2",
        author="Robert Little",
        subject="The Quiet Vale: Seasons of Settlement rulebook draft",
    )
    pdf.build(build_story(docx), onFirstPage=draw_cover, onLaterPages=draw_body)
    pages = len(PdfReader(str(output)).pages)
    MANIFEST.write_text(
        "\n".join(
            [
                "The Quiet Vale styled rulebook draft v0.2",
                f"PDF: {output.name}",
                f"Source DOCX: {source}",
                f"Pages: {pages}",
                "Visual direction: smoke black, warm parchment, muted brass, blue-grey slate, restrained ledger styling.",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(output)
    print(f"pages={pages}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build_pdf(args.source, args.out)


if __name__ == "__main__":
    main()
