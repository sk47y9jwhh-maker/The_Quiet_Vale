#!/usr/bin/env python3
"""Export the current Quiet Vale map as an exact-size print PDF."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A1
from reportlab.pdfgen import canvas


MM_TO_PT = 72 / 25.4

HEX_POINT_TO_POINT_MM = 62
MAP_BORDER_MM = 20
BLEED_MM = 3

TERRAIN_FALLBACKS = {
    "Grasslands": "#D8CFAE",
    "Woodland": "#8F9B6A",
    "Heaths": "#A99AB2",
    "Water": "#7894A0",
    "Mountains": "#8B969B",
    "Arable Land": "#C6A96D",
    "Ruins": "#9A8875",
}


def mm(value: float) -> float:
    return value * MM_TO_PT


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def terrain_hex_lookup(rows: list[dict]) -> dict[str, str]:
    lookup = dict(TERRAIN_FALLBACKS)
    for row in rows:
        terrain = row.get("terrain")
        hex_value = row.get("hex")
        if terrain == "Water / River":
            terrain = "Water"
        if terrain and hex_value:
            lookup[terrain] = hex_value
    return lookup


def hex_points(center_x: float, center_y: float, radius: float) -> list[tuple[float, float]]:
    return [
        (
            center_x + radius * math.cos(math.radians(60 * index)),
            center_y + radius * math.sin(math.radians(60 * index)),
        )
        for index in range(6)
    ]


def draw_polygon(pdf: canvas.Canvas, points: list[tuple[float, float]], fill, stroke, width_mm: float = 0.35):
    path = pdf.beginPath()
    first = True
    for x, y in points:
        if first:
            path.moveTo(mm(x), mm(y))
            first = False
        else:
            path.lineTo(mm(x), mm(y))
    path.close()
    pdf.setFillColor(fill)
    pdf.setStrokeColor(stroke)
    pdf.setLineWidth(mm(width_mm))
    pdf.drawPath(path, fill=1, stroke=1)


def draw_text(pdf: canvas.Canvas, text: str, x: float, y: float, size_pt: float, *, font="Helvetica", color="#181612"):
    pdf.setFillColor(colors.HexColor(color))
    pdf.setFont(font, size_pt)
    pdf.drawCentredString(mm(x), mm(y), str(text))


def draw_crop_marks(pdf: canvas.Canvas, page_w: float, page_h: float, bleed: float, trim_w: float, trim_h: float):
    pdf.setStrokeColor(colors.HexColor("#171512"))
    pdf.setLineWidth(mm(0.18))
    mark = 6
    left = bleed
    bottom = bleed
    right = bleed + trim_w
    top = bleed + trim_h

    segments = [
        ((left - mark, bottom), (left - 1, bottom)),
        ((left, bottom - mark), (left, bottom - 1)),
        ((right + 1, bottom), (right + mark, bottom)),
        ((right, bottom - mark), (right, bottom - 1)),
        ((left - mark, top), (left - 1, top)),
        ((left, top + 1), (left, top + mark)),
        ((right + 1, top), (right + mark, top)),
        ((right, top + 1), (right, top + mark)),
    ]
    for (x1, y1), (x2, y2) in segments:
        pdf.line(mm(x1), mm(y1), mm(x2), mm(y2))


def create_hex_layout(columns: list[str], rows: list[int], hex_width_mm: float):
    radius = hex_width_mm / 2
    hex_height = math.sqrt(3) * radius
    field_w = hex_width_mm + (len(columns) - 1) * radius * 1.5
    field_h = hex_height * (len(rows) + 0.5)
    return radius, hex_height, field_w, field_h


def draw_map(
    pdf: canvas.Canvas,
    map_data: dict,
    terrain_colours: dict[str, str],
    origin_x: float,
    origin_y: float,
    hex_width_mm: float,
    *,
    include_title: bool = True,
):
    columns = map_data["columns"]
    rows = map_data["rows"]
    terrain_by_coordinate = map_data["terrain_by_coordinate"]
    river_coordinates = set(map_data.get("river_coordinates") or [])
    radius, hex_height, _field_w, field_h = create_hex_layout(columns, rows, hex_width_mm)
    stroke = colors.HexColor("#2b342e")

    for column_index, column in enumerate(columns):
        for row_index, row in enumerate(rows):
            coordinate = f"{column}{row}"
            terrain = terrain_by_coordinate[coordinate]
            center_x = origin_x + radius + column_index * radius * 1.5
            center_y_from_top = radius * math.sqrt(3) / 2 + row_index * hex_height
            if column_index % 2 == 1:
                center_y_from_top += hex_height / 2
            center_y = origin_y + field_h - center_y_from_top

            fill = colors.HexColor(terrain_colours.get(terrain, TERRAIN_FALLBACKS["Grasslands"]))
            draw_polygon(pdf, hex_points(center_x, center_y, radius), fill, stroke, 0.42)

            if coordinate in river_coordinates:
                pdf.setStrokeColor(colors.HexColor("#445d68"))
                pdf.setLineWidth(mm(0.95))
                points = hex_points(center_x, center_y, radius - 1.6)
                pdf.lines([(mm(x1), mm(y1), mm(x2), mm(y2)) for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1])])

            draw_text(pdf, coordinate, center_x, center_y + 1.4, 8.5, font="Helvetica-Bold", color="#20251f")

    if include_title:
        field_center_x = origin_x + (hex_width_mm + (len(columns) - 1) * radius * 1.5) / 2
        draw_text(pdf, "The Quiet Vale", field_center_x, origin_y - 7.5, 14, font="Helvetica-Bold", color="#2b2318")
        draw_text(pdf, "Redesigned Basic Map v0.2 - 62mm hexes", field_center_x, origin_y - 13.8, 8, color="#5f513d")


def write_pdf(
    path: Path,
    map_data: dict,
    terrain_colours: dict[str, str],
    *,
    hex_width_mm: float,
    border_mm: float,
    bleed_mm: float,
    a1: bool = False,
):
    radius, _hex_height, field_w, field_h = create_hex_layout(map_data["columns"], map_data["rows"], hex_width_mm)
    trim_w = field_w + border_mm * 2
    trim_h = field_h + border_mm * 2

    if a1:
        page_w = A1[1] / MM_TO_PT
        page_h = A1[0] / MM_TO_PT
        trim_x = (page_w - trim_w) / 2
        trim_y = (page_h - trim_h) / 2
        bleed = 0
        title = "A1 landscape centred at exact scale"
    else:
        page_w = trim_w + bleed_mm * 2
        page_h = trim_h + bleed_mm * 2
        trim_x = bleed_mm
        trim_y = bleed_mm
        bleed = bleed_mm
        title = "Custom trim with 3mm bleed"

    path.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(path), pagesize=(mm(page_w), mm(page_h)))
    pdf.setTitle(f"The Quiet Vale map - {title}")
    pdf.setAuthor("The Quiet Vale")

    pdf.setFillColor(colors.HexColor("#f4eddd"))
    pdf.rect(0, 0, mm(page_w), mm(page_h), fill=1, stroke=0)

    pdf.setStrokeColor(colors.HexColor("#7c6640"))
    pdf.setLineWidth(mm(0.55))
    pdf.rect(mm(trim_x), mm(trim_y), mm(trim_w), mm(trim_h), fill=0, stroke=1)

    map_origin_x = trim_x + border_mm
    map_origin_y = trim_y + border_mm
    draw_map(pdf, map_data, terrain_colours, map_origin_x, map_origin_y, hex_width_mm)

    if not a1:
        draw_crop_marks(pdf, page_w, page_h, bleed, trim_w, trim_h)

    pdf.setFont("Helvetica", 7)
    pdf.setFillColor(colors.HexColor("#4f4639"))
    note = f"Print at 100%. Hexes: {hex_width_mm:.0f}mm point-to-point. Trim: {trim_w:.2f}mm x {trim_h:.2f}mm."
    pdf.drawRightString(mm(page_w - bleed - 5), mm(bleed + 5), note)
    pdf.save()

    if not a1:
        set_pdf_boxes(path, trim_x, trim_y, trim_w, trim_h, page_h)

    return {
        "hex_point_to_point_mm": hex_width_mm,
        "hex_flat_to_flat_mm": math.sqrt(3) * radius,
        "field_width_mm": field_w,
        "field_height_mm": field_h,
        "trim_width_mm": trim_w,
        "trim_height_mm": trim_h,
        "pdf_width_mm": page_w,
        "pdf_height_mm": page_h,
    }


def set_pdf_boxes(path: Path, trim_x_mm: float, trim_y_mm: float, trim_w_mm: float, trim_h_mm: float, page_h_mm: float):
    reader = PdfReader(str(path))
    writer = PdfWriter()
    page = reader.pages[0]
    left = mm(trim_x_mm)
    bottom = mm(trim_y_mm)
    right = mm(trim_x_mm + trim_w_mm)
    top = mm(trim_y_mm + trim_h_mm)
    page.trimbox.lower_left = (left, bottom)
    page.trimbox.upper_right = (right, top)
    page.bleedbox.lower_left = (0, 0)
    page.bleedbox.upper_right = (mm(trim_w_mm + trim_x_mm * 2), mm(page_h_mm))
    writer.add_page(page)
    with path.open("wb") as handle:
        writer.write(handle)


def write_manifest(path: Path, metrics: dict[str, float]):
    lines = [
        "# The Quiet Vale - Map Print File",
        "",
        "Source: `src/data/redesigned_basic_map_v0_2.json`.",
        "",
        "## Printer Measurements",
        "",
        f"- Map hex size: {metrics['hex_point_to_point_mm']:.2f}mm point-to-point.",
        f"- Map hex flat-to-flat: {metrics['hex_flat_to_flat_mm']:.2f}mm.",
        f"- Hex field only: {metrics['field_width_mm']:.2f}mm wide x {metrics['field_height_mm']:.2f}mm high.",
        f"- Finished trim size: {metrics['trim_width_mm']:.2f}mm wide x {metrics['trim_height_mm']:.2f}mm high.",
        f"- Supplied bleed PDF page size: {metrics['pdf_width_mm']:.2f}mm wide x {metrics['pdf_height_mm']:.2f}mm high.",
        "- Bleed: 3mm on all sides.",
        "- Print scale: 100% / actual size. Do not fit to page.",
        "",
        "## Files",
        "",
        "- `quiet_vale_map_v0_2_62mm_hex_custom_trim_3mm_bleed.pdf`: preferred custom-size production file.",
        "- `quiet_vale_map_v0_2_62mm_hex_A1_landscape_exact_scale.pdf`: A1 landscape convenience file, exact scale, centred on page.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hex-width-mm", type=float, default=HEX_POINT_TO_POINT_MM)
    parser.add_argument("--output-dir", type=Path, default=Path("exports/print_map_62mm"))
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    output_dir = args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
    map_data = read_json(root / "src/data/redesigned_basic_map_v0_2.json")
    terrain_colours = terrain_hex_lookup(read_json(root / "src/data/map_terrain_colours.json"))

    metrics = write_pdf(
        output_dir / "quiet_vale_map_v0_2_62mm_hex_custom_trim_3mm_bleed.pdf",
        map_data,
        terrain_colours,
        hex_width_mm=args.hex_width_mm,
        border_mm=MAP_BORDER_MM,
        bleed_mm=BLEED_MM,
    )
    write_pdf(
        output_dir / "quiet_vale_map_v0_2_62mm_hex_A1_landscape_exact_scale.pdf",
        map_data,
        terrain_colours,
        hex_width_mm=args.hex_width_mm,
        border_mm=MAP_BORDER_MM,
        bleed_mm=0,
        a1=True,
    )
    write_manifest(output_dir / "manifest.md", metrics)
    print(f"Wrote map print files to {output_dir}")


if __name__ == "__main__":
    main()
