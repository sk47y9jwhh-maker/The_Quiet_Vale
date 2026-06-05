#!/usr/bin/env python3
"""Create a trimmed playtester rulebook PDF for The Quiet Vale."""

from __future__ import annotations

import argparse
from pathlib import Path
from xml.sax.saxutils import escape

from docx import Document
from pypdf import PdfReader
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from export_styled_rulebook_from_docx import (
    DEFAULT_SOURCE,
    OUT_DIR,
    PALETTE,
    STYLES,
    clean,
    docx_table_to_flowable,
    prepared_cover_logo,
    safe,
)


OUTPUT = OUT_DIR / "The_Quiet_Vale_Playtester_Rulebook_Styled_Draft_v0_3.pdf"
MANIFEST = OUT_DIR / "manifest_playtester_v0_3.txt"


PLAYTEST_STYLES = {
    **STYLES,
    "playtest_cover_note": ParagraphStyle(
        "PlaytestCoverNote",
        parent=STYLES["cover_small"],
        fontName="Helvetica",
        fontSize=7.4,
        leading=10,
        textColor=PALETTE["brass"],
        alignment=TA_CENTER,
        spaceAfter=4,
    ),
    "flavour": ParagraphStyle(
        "QVFlavour",
        parent=STYLES["body"],
        fontName="Times-Italic",
        fontSize=10.4,
        leading=14.4,
        textColor=PALETTE["graphite"],
        spaceAfter=7,
    ),
}


def safe_flavour(value: str) -> str:
    """Preserve flavour wording and punctuation while escaping PDF markup."""
    return escape(" ".join(str(value or "").split()))


def heading(text: str, level: int = 1) -> Paragraph:
    return Paragraph(safe(text), PLAYTEST_STYLES["h1" if level == 1 else "h2"])


def body(text: str) -> Paragraph:
    return Paragraph(safe(text), PLAYTEST_STYLES["body"])


def bullet(text: str) -> Paragraph:
    return Paragraph(f'<font color="#7B5E2E">-</font> {safe(text)}', PLAYTEST_STYLES["body"])


def numbered(items: list[str]) -> list[Paragraph]:
    return [Paragraph(f'<font color="#7B5E2E"><b>{index}.</b></font> {safe(text)}', PLAYTEST_STYLES["body"]) for index, text in enumerate(items, start=1)]


def cover_story() -> list:
    story = [Spacer(1, 50 * mm)]
    logo = prepared_cover_logo()
    if logo:
        image = Image(str(logo), width=18 * mm, height=22 * mm)
        image.hAlign = "CENTER"
        story.extend([image, Spacer(1, 16 * mm)])

    story.extend(
        [
            Paragraph("The Quiet Vale", PLAYTEST_STYLES["cover_title"]),
            Paragraph("Seasons of Settlement", PLAYTEST_STYLES["cover_subtitle"]),
            Paragraph("Playtester Rulebook", PLAYTEST_STYLES["playtest_cover_note"]),
            Spacer(1, 56 * mm),
            Paragraph("A focused table reference for learning and blind playtesting.", PLAYTEST_STYLES["cover_body"]),
            PageBreak(),
        ]
    )
    return story


def table_by_index(doc, index: int):
    return doc.tables[index]


def front_flavour(doc) -> list[str]:
    lines = []
    found_title_block = False
    for paragraph in doc.paragraphs:
        text = " ".join((paragraph.text or "").split())
        if not text:
            continue
        if text == "Contents":
            break
        if text == "The banners of war have long since fallen silent.":
            found_title_block = True
        if found_title_block:
            lines.append(text)
    return lines


def compact_rule_box(label: str, text: str):
    table = Table(
        [[Paragraph(safe(label.upper()), PLAYTEST_STYLES["note_label"]), Paragraph(safe(text), PLAYTEST_STYLES["note_body"])]],
        colWidths=[35 * mm, 124 * mm],
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
    return table


def draw_playtester_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PALETTE["smoke"])
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.setStrokeColor(PALETTE["brass_dark"])
    canvas.setLineWidth(1.0)
    canvas.rect(12 * mm, 12 * mm, A4[0] - 24 * mm, A4[1] - 24 * mm, fill=0, stroke=1)
    canvas.setStrokeColor(PALETTE["brass"])
    canvas.setLineWidth(0.45)
    canvas.rect(16 * mm, 16 * mm, A4[0] - 32 * mm, A4[1] - 32 * mm, fill=0, stroke=1)
    canvas.line(30 * mm, A4[1] - 83 * mm, 88 * mm, A4[1] - 83 * mm)
    canvas.line(122 * mm, A4[1] - 83 * mm, A4[0] - 30 * mm, A4[1] - 83 * mm)
    canvas.line(30 * mm, 74 * mm, A4[0] - 30 * mm, 74 * mm)
    canvas.setFillColor(PALETTE["brass"])
    canvas.setFont("Helvetica", 6.5)
    canvas.drawCentredString(A4[0] / 2, 34 * mm, "Copyright (C) 2026 Robert Little. All rights reserved.")
    canvas.drawCentredString(A4[0] / 2, 24 * mm, "www.thequietvalegame.com")
    canvas.restoreState()


def draw_playtester_body(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PALETTE["parchment"])
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    canvas.setStrokeColor(PALETTE["line"])
    canvas.setLineWidth(0.65)
    canvas.rect(13 * mm, 12 * mm, A4[0] - 26 * mm, A4[1] - 24 * mm, fill=0, stroke=1)
    canvas.setStrokeColor(PALETTE["brass"])
    canvas.setLineWidth(0.35)
    canvas.line(20 * mm, A4[1] - 17 * mm, A4[0] - 20 * mm, A4[1] - 17 * mm)
    canvas.line(20 * mm, 17 * mm, A4[0] - 20 * mm, 17 * mm)
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(PALETTE["muted"])
    canvas.drawString(20 * mm, 10 * mm, "The Quiet Vale: Seasons of Settlement")
    canvas.drawRightString(A4[0] - 20 * mm, 10 * mm, f"Playtester draft v0.3 - Page {doc.page}")
    canvas.restoreState()


def build_story(doc) -> list:
    story = cover_story()

    story.append(heading("Welcome To The Vale"))
    for line in front_flavour(doc):
        story.append(Paragraph(safe_flavour(line), PLAYTEST_STYLES["flavour"]))
    story.append(Spacer(1, 4))

    story.append(heading("How To Use This Playtest Guide"))
    story.append(body("This is a trimmed table reference for learning the game. It keeps the core flow, costs, timing, and card handling rules players need during a playtest. The fuller production rulebook can keep the deeper wording and edge-case lists."))
    story.append(compact_rule_box("Use card text", "When a card gives a specific exception, use the card. This guide explains the normal rules and avoids listing every card-specific fallback."))

    story.append(heading("Game Overview"))
    story.append(body("The Quiet Vale is a cooperative tile-laying and settlement-building game for 1-4 players. The group builds a shared settlement across three Seasons, manages a shared Warehouse, reveals Encounters, welcomes Arrivals, and prevents Strain from disabling important tiles."))
    for item in [
        "Build and upgrade a shared settlement.",
        "Gather and spend shared resources from the Warehouse.",
        "Seed hidden Encounter Cards into the Encounter Deck.",
        "Complete Arrivals to unlock Special Tiles.",
        "Resolve or endure Burdens before Strain becomes too costly.",
    ]:
        story.append(bullet(item))

    story.append(heading("Setup"))
    story.extend(
        numbered(
            [
                "Lay out the Game Map, Stewards Board, Warehouse Board, and Round Timer.",
                "Each player chooses a unique Steward and takes that Steward's Player Aid and Steward House Tile.",
                "Set the shared Warehouse using the player-count table.",
                "Each player places their Steward's starting Resource Tile for free on matching terrain. This ignores normal placement costs and adjacency requirements.",
                "Build the balanced Encounter pool, deal hidden player hands, build the Encounter Deck, and add 1 random Golden Boon.",
                "Begin Round 1 with the Seed Encounter Cards phase.",
            ]
        )
    )
    story.append(heading("Starting Warehouse", 2))
    story.append(docx_table_to_flowable(table_by_index(doc, 0)))
    story.append(heading("Starting Stewards", 2))
    story.append(docx_table_to_flowable(table_by_index(doc, 1)))
    story.append(heading("Encounter Setup", 2))
    story.append(docx_table_to_flowable(table_by_index(doc, 2)))

    story.append(heading("Round Structure"))
    story.append(body("The game lasts 15 rounds across three Seasons. Each round follows the same four phases."))
    story.append(docx_table_to_flowable(table_by_index(doc, 3)))
    story.append(docx_table_to_flowable(table_by_index(doc, 5)))
    story.append(heading("Reveal And Actions By Player Count", 2))
    story.append(docx_table_to_flowable(table_by_index(doc, 6)))

    story.append(heading("Player Actions"))
    story.append(docx_table_to_flowable(table_by_index(doc, 7)))
    story.append(body("Players may also spend extra Actions when a tile action requires disconnected Travel or river crossing. The prototype calculates these costs, but players should still understand why they happened."))

    story.append(PageBreak())
    story.append(heading("Map, Tiles, And Reachability"))
    for item in [
        "Tiles stay on the map unless a rule explicitly removes them.",
        "Placed, non-Overstrained tiles connected by side adjacency form the connected settlement network.",
        "Each player's Steward location is the tile they last interacted with or placed.",
        "A tile is reachable if it is the Steward's tile or connected to that tile through the connected settlement network.",
        "Overstrained tiles break the connected settlement network.",
        "Multi-hex tiles count all hexes in their footprint for adjacency and connection. Single-hex tiles do not need rotation.",
    ]:
        story.append(bullet(item))
    story.append(heading("Rivers And Bridges", 2))
    for item in [
        "River hexes are barriers. Tiles do not connect across a river unless a Bridge or card effect allows the crossing.",
        "Every River hex is a legal potential Bridge placement site.",
        "Crossing a river without a Bridge connection costs 1 Action when the action requires that crossing.",
        "A Bridge connects settlement networks through its river hex. An Overstrained Bridge stops providing that connection.",
    ]:
        story.append(bullet(item))

    story.append(heading("Resources And Warehouse"))
    story.append(body("The Warehouse is shared by all players. It stores Wood, Stone, Metal, Food, Herbs, and Goods. The Warehouse limit is 15 of each resource."))
    story.append(docx_table_to_flowable(table_by_index(doc, 8)))

    story.append(PageBreak())
    story.append(heading("Encounter Cards"))
    story.append(body("Encounter Cards are seeded into and revealed from the Encounter Deck. Cards on the Stewards Board are open information. Players may inspect active cards, completed Arrivals, active Burdens, and face-up Boons."))
    story.append(docx_table_to_flowable(table_by_index(doc, 9)))

    story.append(heading("Arrivals And Special Tiles"))
    for item in [
        "An Arrival enters play with 3 timer tokens.",
        "To complete an Arrival, fulfill its Requirement all at once and spend 1 Action to interact with it.",
        "Arrival resource Requirements cannot be partly paid over time.",
        "At the end of each round, each active Arrival loses 1 timer token. If it reaches 0 before completion, it expires.",
        "A completed Arrival unlocks its Special Tile. Any player may later place that unlocked Special Tile with a normal Place a Tile action.",
        "Unlocked but unplaced Special Tiles are not on the map and have no effects until placed.",
    ]:
        story.append(bullet(item))

    story.append(heading("Burdens"))
    for item in [
        "When a Burden is revealed, apply the current Season effect and then place it on the Stewards Board as an active Burden.",
        "Unresolved active Burdens reapply at the start of Round 6 using Season II text and at the start of Round 11 using Season III text.",
        "If a Burden places Strain, choose valid tiles with fewer than 3 Strain. If there are fewer valid tiles than requested, choose all valid tiles.",
        "If no valid target exists, no Strain is placed for that application. The Burden remains active unless resolved.",
        "Some Season III Burdens include fallback targets or Season III-only resolution. Use the text printed on that card rather than memorising a separate list.",
        "Resolving a Burden removes it from the Stewards Board and prevents future reapplications. It does not remove Strain already placed.",
    ]:
        story.append(bullet(item))
    story.append(compact_rule_box("Playtest focus", "Players should notice active Burdens. Leaving them unresolved can create repeated pressure and final score penalties."))

    story.append(PageBreak())
    story.append(heading("Boons And Golden Boons"))
    for item in [
        "When a standard Boon is revealed, apply the effect matching the current Season.",
        "Boon effects are optional unless the card says otherwise.",
        "Most Boons resolve immediately and are discarded.",
        "Boons that affect the next or first eligible action stay face-up until used, then are discarded. If unused, discard them in Phase Four unless the card says to keep it face-up.",
        "Each game includes exactly one Golden Boon in the Encounter Deck.",
        "Golden Boons are extra reveals and do not count toward the number of standard Encounter Cards revealed that round.",
        "Golden Boons use their own Effect text and may create one specific exception to normal rules.",
    ]:
        story.append(bullet(item))

    story.append(heading("Strain, Supported, And Overstrained"))
    story.append(body("Strain represents pressure on the settlement: damage, exhaustion, unstable resources, and unresolved social harm."))
    for item in [
        "A tile cannot have more than 3 Strain.",
        "A tile with 3 Strain is Overstrained.",
        "Tiles with 1 or 2 Strain still function unless a rule says otherwise.",
        "Supported prevents the first Strain token applied to that tile each round.",
        "Supported does not stack. Multiple sources still prevent only the first Strain that round.",
        "Overstrained tiles cannot be activated or upgraded, provide no passive effects, do not score, and do not contribute to reachability.",
        "As soon as a tile has fewer than 3 Strain, it is no longer Overstrained.",
    ]:
        story.append(bullet(item))

    story.append(heading("Season Ends And Final Scoring"))
    story.append(docx_table_to_flowable(table_by_index(doc, 10)))
    for item in [
        "Add Population from non-Overstrained placed tiles.",
        "Add Renown from non-Overstrained placed tiles.",
        "Subtract 6 Renown for each unresolved active Burden.",
        "Subtract 2 Renown for each Strain token on the board.",
    ]:
        story.append(bullet(item))
    story.append(compact_rule_box("Final score", "Population + Renown - active Burden penalties - Strain penalties."))

    story.append(PageBreak())
    story.append(heading("Quick Glossary"))
    story.append(docx_table_to_flowable(table_by_index(doc, 12)))

    story.append(heading("Playtest Notes"))
    for item in [
        "Use this guide to learn and play. Use the cards themselves for exact one-off card rules.",
        "If a rule feels unclear, note what happened, the round, the card or tile involved, and what the group expected.",
        "The most useful feedback is about pacing, tension, choices, resource pressure, and whether the settlement story is coming through.",
    ]:
        story.append(bullet(item))
    story.append(Spacer(1, 8))
    story.append(
        compact_rule_box(
            "Ownership",
            "The Quiet Vale(TM): Seasons of Settlement and all prototype rulebook materials are (C) Robert Little. All rights reserved. Shared for private playtesting and review.",
        )
    )

    return story


def build_pdf(source: Path, output: Path):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    doc = Document(source)
    pdf = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=25 * mm,
        leftMargin=25 * mm,
        topMargin=24 * mm,
        bottomMargin=24 * mm,
        title="The Quiet Vale Playtester Rulebook Styled Draft v0.3",
        author="Robert Little",
        subject="Focused The Quiet Vale playtester rulebook draft",
    )
    pdf.build(build_story(doc), onFirstPage=draw_playtester_cover, onLaterPages=draw_playtester_body)
    pages = len(PdfReader(str(output)).pages)
    MANIFEST.write_text(
        "\n".join(
            [
                "The Quiet Vale playtester rulebook styled draft v0.3",
                f"PDF: {output.name}",
                f"Source DOCX: {source}",
                f"Pages: {pages}",
                "Trim approach: table-facing rules only; opening flavour text preserved; dense production fallback lists summarised to card-text guidance.",
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
    parser.add_argument("--out", type=Path, default=OUTPUT)
    args = parser.parse_args()
    build_pdf(args.source, args.out)


if __name__ == "__main__":
    main()
