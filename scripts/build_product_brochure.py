from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "docs" / "product-brochure" / "assets"
OUTPUT_DIR = ROOT / "docs"
OUTPUT_PATH = OUTPUT_DIR / "WeaHR_Product_Overview_VI.docx"

# Brand colours.
NAVY = "17133B"
PRIMARY = "4F46E5"
TEAL = "0F9F75"
GOLD = "D98B08"
RED = "D64545"
INK = "202238"
MUTED = "667085"
SOFT = "EEF2FF"
SOFT_TEAL = "EAF8F3"
SOFT_GOLD = "FFF6E2"
WHITE = "FFFFFF"
LINE = "D9DCEB"

PAGE_WIDTH_DXA = 12240
PAGE_HEIGHT_DXA = 15840
CONTENT_WIDTH_DXA = 9360  # 6.5 in after 1 in margins


def rgb(hex_color: str) -> RGBColor:
    return RGBColor.from_string(hex_color)


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=58, start=70, bottom=58, end=70) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for side, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        tag = qn(f"w:{side}")
        node = tc_mar.find(tag)
        if node is None:
            node = OxmlElement(f"w:{side}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_border(cell, **edges) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_borders = tc_pr.first_child_found_in("w:tcBorders")
    if tc_borders is None:
        tc_borders = OxmlElement("w:tcBorders")
        tc_pr.append(tc_borders)
    for edge_name, edge_data in edges.items():
        tag = qn(f"w:{edge_name}")
        edge = tc_borders.find(tag)
        if edge is None:
            edge = OxmlElement(f"w:{edge_name}")
            tc_borders.append(edge)
        for key, value in edge_data.items():
            edge.set(qn(f"w:{key}"), str(value))


def set_table_geometry(table, widths: Iterable[int], indent=120) -> None:
    widths = list(widths)
    total = sum(widths)
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.first_child_found_in("w:tblW")
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(total))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.first_child_found_in("w:tblInd")
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent))
    tbl_ind.set(qn("w:type"), "dxa")
    tbl_layout = tbl_pr.first_child_found_in("w:tblLayout")
    if tbl_layout is None:
        tbl_layout = OxmlElement("w:tblLayout")
        tbl_pr.append(tbl_layout)
    tbl_layout.set(qn("w:type"), "fixed")

    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)

    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            width = widths[min(idx, len(widths) - 1)]
            cell.width = Inches(width / 1440)
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.first_child_found_in("w:tcW")
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(width))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)


def add_field(paragraph, instruction: str) -> None:
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = instruction
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char1, instr_text, fld_char2])


def add_real_numbering(document: Document, ordered=False) -> int:
    numbering = document.part.numbering_part.element
    abstract_ids = [int(x.get(qn("w:abstractNumId"))) for x in numbering.findall(qn("w:abstractNum"))]
    num_ids = [int(x.get(qn("w:numId"))) for x in numbering.findall(qn("w:num"))]
    abstract_id = max(abstract_ids, default=0) + 1
    num_id = max(num_ids, default=0) + 1

    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "singleLevel")
    abstract.append(multi)
    lvl = OxmlElement("w:lvl")
    lvl.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    lvl.append(start)
    num_fmt = OxmlElement("w:numFmt")
    num_fmt.set(qn("w:val"), "decimal" if ordered else "bullet")
    lvl.append(num_fmt)
    lvl_text = OxmlElement("w:lvlText")
    lvl_text.set(qn("w:val"), "%1." if ordered else "•")
    lvl.append(lvl_text)
    suffix = OxmlElement("w:suff")
    suffix.set(qn("w:val"), "tab")
    lvl.append(suffix)
    p_pr = OxmlElement("w:pPr")
    tabs = OxmlElement("w:tabs")
    tab = OxmlElement("w:tab")
    tab.set(qn("w:val"), "num")
    tab.set(qn("w:pos"), "540")
    tabs.append(tab)
    p_pr.append(tabs)
    ind = OxmlElement("w:ind")
    ind.set(qn("w:left"), "540")
    ind.set(qn("w:hanging"), "280")
    p_pr.append(ind)
    lvl.append(p_pr)
    numbering.append(abstract)

    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_ref = OxmlElement("w:abstractNumId")
    abstract_ref.set(qn("w:val"), str(abstract_id))
    num.append(abstract_ref)
    numbering.append(num)
    return num_id


def apply_numbering(paragraph, num_id: int) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = p_pr.find(qn("w:numPr"))
    if num_pr is None:
        num_pr = OxmlElement("w:numPr")
        p_pr.append(num_pr)
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num = OxmlElement("w:numId")
    num.set(qn("w:val"), str(num_id))
    num_pr.extend([ilvl, num])


def set_run(run, *, size=None, color=None, bold=None, italic=None, font="Calibri") -> None:
    run.font.name = font
    run._element.rPr.rFonts.set(qn("w:eastAsia"), font)
    if size is not None:
        run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = rgb(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def style_paragraph(paragraph, *, size=11, color=INK, bold=False, align=None, before=0, after=8, line=1.333) -> None:
    fmt = paragraph.paragraph_format
    fmt.space_before = Pt(before)
    fmt.space_after = Pt(after)
    fmt.line_spacing = line
    if align is not None:
        paragraph.alignment = align
    for run in paragraph.runs:
        set_run(run, size=size, color=color, bold=bold)


def add_text(document: Document, text: str, *, bold_prefix: str | None = None, align=WD_ALIGN_PARAGRAPH.JUSTIFY, after=8):
    p = document.add_paragraph()
    if bold_prefix and text.startswith(bold_prefix):
        r1 = p.add_run(bold_prefix)
        r2 = p.add_run(text[len(bold_prefix):])
        set_run(r1, size=11, color=INK, bold=True)
        set_run(r2, size=11, color=INK)
    else:
        r = p.add_run(text)
        set_run(r, size=11, color=INK)
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.333
    p.alignment = align
    return p


def add_bullets(document: Document, items: Iterable[str], bullet_num_id: int, *, size=10.5, after=4):
    for item in items:
        p = document.add_paragraph()
        apply_numbering(p, bullet_num_id)
        p.paragraph_format.space_after = Pt(after)
        p.paragraph_format.line_spacing = 1.208
        p.add_run(item)
        style_paragraph(p, size=size, color=INK, after=after, line=1.208)


def add_heading(document: Document, text: str, level=1, kicker: str | None = None):
    if kicker:
        p = document.add_paragraph()
        r = p.add_run(kicker.upper())
        set_run(r, size=9, color=TEAL, bold=True)
        p.paragraph_format.space_after = Pt(3)
    p = document.add_paragraph(style=f"Heading {level}")
    p.add_run(text)
    return p


def add_page_title(document: Document, kicker: str, title: str, lead: str):
    add_heading(document, title, 1, kicker)
    p = document.add_paragraph()
    r = p.add_run(lead)
    set_run(r, size=11.5, color=MUTED)
    p.paragraph_format.space_after = Pt(10)
    p.paragraph_format.line_spacing = 1.25


def add_caption(document: Document, text: str):
    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(8)
    r = p.add_run(text)
    set_run(r, size=9, color=MUTED, italic=True)
    return p


def add_screenshot(document: Document, filename: str, caption: str, width=6.5):
    path = ASSET_DIR / filename
    if not path.exists():
        raise FileNotFoundError(path)
    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(str(path), width=Inches(width))
    add_caption(document, caption)


def add_callout(document: Document, title: str, body: str, *, fill=SOFT, accent=PRIMARY):
    table = document.add_table(rows=1, cols=1)
    set_table_geometry(table, [CONTENT_WIDTH_DXA])
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    set_cell_border(
        cell,
        start={"val": "single", "sz": "22", "color": accent},
        top={"val": "nil"}, bottom={"val": "nil"}, end={"val": "nil"},
    )
    p1 = cell.paragraphs[0]
    r1 = p1.add_run(title)
    set_run(r1, size=10.5, color=accent, bold=True)
    p1.paragraph_format.space_after = Pt(2)
    p2 = cell.add_paragraph()
    r2 = p2.add_run(body)
    set_run(r2, size=10, color=INK)
    p2.paragraph_format.space_after = Pt(0)
    p2.paragraph_format.line_spacing = 1.2
    document.add_paragraph().paragraph_format.space_after = Pt(0)


def add_metric_cards(document: Document, cards: list[tuple[str, str, str]]):
    table = document.add_table(rows=1, cols=len(cards))
    widths = [CONTENT_WIDTH_DXA // len(cards)] * len(cards)
    widths[-1] += CONTENT_WIDTH_DXA - sum(widths)
    set_table_geometry(table, widths)
    for idx, (value, label, note) in enumerate(cards):
        cell = table.cell(0, idx)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_shading(cell, SOFT if idx % 2 == 0 else SOFT_TEAL)
        set_cell_border(cell, top={"val": "single", "sz": "8", "color": WHITE}, bottom={"val": "single", "sz": "8", "color": WHITE}, start={"val": "single", "sz": "8", "color": WHITE}, end={"val": "single", "sz": "8", "color": WHITE})
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(value)
        set_run(r, size=18, color=PRIMARY, bold=True)
        p2 = cell.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p2.paragraph_format.space_after = Pt(1)
        set_run(p2.add_run(label), size=9.5, color=INK, bold=True)
        p3 = cell.add_paragraph()
        p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p3.paragraph_format.space_after = Pt(0)
        set_run(p3.add_run(note), size=8.5, color=MUTED)


def add_feature_table(document: Document, headers: list[str], rows: list[list[str]], widths: list[int]):
    table = document.add_table(rows=1, cols=len(headers))
    set_table_geometry(table, widths)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for idx, header in enumerate(headers):
        cell = table.cell(0, idx)
        set_cell_shading(cell, NAVY)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(0)
        set_run(p.add_run(header), size=10, color=WHITE, bold=True)
    for ridx, row in enumerate(rows):
        cells = table.add_row().cells
        for idx, value in enumerate(row):
            cell = cells[idx]
            set_cell_shading(cell, WHITE if ridx % 2 == 0 else "F8F9FC")
            set_cell_border(cell, bottom={"val": "single", "sz": "4", "color": LINE})
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.15
            set_run(p.add_run(value), size=9.5, color=INK, bold=(idx == 0))
    return table


def add_page_break(document: Document):
    document.add_page_break()


def configure_document(document: Document) -> tuple[int, int]:
    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
    normal.font.size = Pt(11)
    normal.font.color.rgb = rgb(INK)
    normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    normal.paragraph_format.space_after = Pt(8)
    normal.paragraph_format.line_spacing = 1.333

    style_specs = {
        "Title": (30, NAVY, 0, 12),
        "Subtitle": (13, MUTED, 0, 8),
        "Heading 1": (16, PRIMARY, 18, 10),
        "Heading 2": (13, PRIMARY, 12, 6),
        "Heading 3": (12, PRIMARY, 8, 4),
    }
    for name, (size, color, before, after) in style_specs.items():
        style = styles[name]
        style.font.name = "Calibri"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
        style.font.size = Pt(size)
        style.font.color.rgb = rgb(color)
        style.font.bold = name != "Subtitle"
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.keep_together = True

    for section in document.sections:
        section.page_width = Inches(8.5)
        section.page_height = Inches(11)
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)
        section.header_distance = Cm(1.25)
        section.footer_distance = Cm(1.25)

        header = section.header
        p = header.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(0)
        set_run(p.add_run("WeaHR  |  Hồ sơ sản phẩm"), size=8.5, color=MUTED, bold=True)
        p.add_run("                                      ")
        set_run(p.add_run("Dành cho chủ chuỗi F&B"), size=8.5, color=MUTED)

        footer = section.footer
        fp = footer.paragraphs[0]
        fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        fp.paragraph_format.space_after = Pt(0)
        set_run(fp.add_run("WeaHR · Bản mô tả sản phẩm · 07/2026   |   "), size=8, color=MUTED)
        add_field(fp, "PAGE")

    bullet_id = add_real_numbering(document, ordered=False)
    ordered_id = add_real_numbering(document, ordered=True)
    return bullet_id, ordered_id


def build() -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    document = Document()
    bullet_id, ordered_id = configure_document(document)
    section = document.sections[0]
    section.different_first_page_header_footer = True

    # 1. Customer-pack cover
    p = document.add_paragraph()
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(18)
    set_run(p.add_run("W"), size=24, color=WHITE, bold=True)
    p._p.get_or_add_pPr().append(OxmlElement("w:shd"))
    p._p.pPr[-1].set(qn("w:fill"), PRIMARY)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER

    p = document.add_paragraph(style="Title")
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run("WeaHR")
    p2 = document.add_paragraph(style="Subtitle")
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p2.add_run("Tối ưu lợi nhuận nhân sự cho chuỗi F&B")
    p3 = document.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p3.paragraph_format.space_after = Pt(12)
    set_run(p3.add_run("Chấm công an toàn  ·  Xếp ca thông minh  ·  Dự báo nhu cầu  ·  Kiểm soát chi phí"), size=10.5, color=PRIMARY, bold=True)
    add_screenshot(document, "dashboard.png", "Giao diện tổng quan dành cho quản lý · Dữ liệu minh họa", width=6.15)
    p4 = document.add_paragraph()
    p4.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p4.paragraph_format.space_before = Pt(6)
    set_run(p4.add_run("HỒ SƠ SẢN PHẨM & HƯỚNG DẪN VẬN HÀNH"), size=9.5, color=TEAL, bold=True)
    p5 = document.add_paragraph()
    p5.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p5.add_run("Phiên bản trình bày khách hàng · Tháng 07/2026"), size=9, color=MUTED)

    # 2. Executive overview
    add_page_break(document)
    add_page_title(document, "Tổng quan", "WeaHR trong 60 giây", "Một nền tảng SaaS giúp chủ quán biến dữ liệu chấm công, lịch làm và doanh thu thành quyết định nhân sự có thể đo bằng tiền.")
    add_metric_cards(document, [
        ("1 nơi", "Quản lý vận hành", "Ca làm, chấm công, lương"),
        ("0–100", "Schedule Score", "Chấm chất lượng lịch"),
        ("Theo giờ", "Dự báo nhu cầu", "Đơn hàng & nhân sự"),
        ("Đa chi nhánh", "So sánh hiệu quả", "Chi phí và năng suất"),
    ])
    add_heading(document, "Sản phẩm giải quyết vấn đề gì?", 2)
    add_bullets(document, [
        "Giảm chấm công hộ bằng QR động, GPS geofence, giờ máy chủ và tín hiệu thiết bị.",
        "Rút ngắn thời gian xếp ca nhờ thu thập lịch rảnh, kiểm tra ràng buộc và đề xuất người thay thế.",
        "Biết chi phí nhân sự trước khi công bố lịch, thay vì chỉ phát hiện vượt ngân sách cuối tháng.",
        "Nối doanh thu với giờ công để thấy rõ ca nào thiếu người, ca nào thừa người và chi nhánh nào vận hành tốt hơn.",
    ], bullet_id)
    add_heading(document, "Khách hàng phù hợp", 2)
    add_feature_table(document, ["Nhóm khách hàng", "Quy mô tham khảo", "Giá trị nhận được"], [
        ["Quán cà phê / nhà hàng", "20–80 nhân viên theo ca", "Giảm gian lận, giảm thời gian xếp ca"],
        ["Chuỗi F&B tăng trưởng", "2–20 chi nhánh", "Chuẩn hóa vận hành và so sánh chi nhánh"],
        ["Doanh nghiệp dịch vụ", "Nhân sự linh hoạt theo giờ", "Theo dõi năng suất và chi phí theo ca"],
    ], [2500, 2100, 4760])
    add_callout(document, "Trạng thái thương mại hóa", "Phiên bản hiện tại phù hợp để demo, triển khai pilot và đo hiệu quả. Các tích hợp POS trực tiếp, billing tự phục vụ và mô hình dự báo nâng cao được triển khai theo lộ trình sau khi có dữ liệu vận hành thực tế.")

    # 3. Operation flow
    add_page_break(document)
    add_page_title(document, "Cách hoạt động", "Từ dữ liệu vận hành đến quyết định nhân sự", "WeaHR tạo một vòng lặp khép kín: thu thập dữ liệu → lập lịch → chấm công → tính chi phí → tối ưu tuần tiếp theo.")
    add_feature_table(document, ["Bước", "Người thực hiện", "WeaHR xử lý"], [
        ["01 · Thiết lập", "Quản lý", "Tạo chi nhánh, vị trí, ca mẫu, kỹ năng, giới hạn giờ và chính sách chấm công."],
        ["02 · Đăng ký lịch rảnh", "Nhân viên", "Nhắc hạn theo ngày quản lý chọn; tổng hợp thiếu đăng ký và khóa dữ liệu khi hết hạn."],
        ["03 · Xếp ca", "Quản lý + hệ thống", "Kiểm tra trùng lịch, kỹ năng, giờ tối đa, ngân sách; đề xuất lịch và Schedule Score."],
        ["04 · Chấm công", "Nhân viên", "Xác minh QR động, vị trí, giờ máy chủ, ca đã duyệt và tín hiệu thiết bị."],
        ["05 · Tối ưu", "Chủ chuỗi", "Đối chiếu doanh thu, giờ công, OT và nhu cầu dự báo để điều chỉnh lịch."],
    ], [1450, 1950, 5960])
    add_heading(document, "Nguồn dữ liệu đầu vào", 2)
    add_bullets(document, [
        "Hồ sơ nhân viên, kỹ năng, chi nhánh và mức lương theo giờ.",
        "Lịch rảnh, nguyện vọng ca, ca trống và yêu cầu đổi ca.",
        "Doanh thu, số đơn theo giờ qua CSV/XLSX; kết nối POS trực tiếp là giai đoạn tiếp theo.",
        "Ngày trong tuần, ngày lễ, chương trình khuyến mãi và thời tiết khi khách hàng bật nguồn dữ liệu tương ứng.",
    ], bullet_id)
    add_callout(document, "Nguyên tắc thiết kế", "Hệ thống không ra quyết định thay quản lý: chỉ đề xuất, giải thích lý do, hiển thị độ tin cậy và giữ quyền phê duyệt cuối cùng cho con người.", fill=SOFT_TEAL, accent=TEAL)

    # 4. Dashboard
    add_page_break(document)
    add_page_title(document, "Giao diện quản lý", "Dashboard điều hành", "Một màn hình để theo dõi tình trạng vận hành trong ngày và các chỉ số ảnh hưởng trực tiếp đến lợi nhuận nhân sự.")
    add_screenshot(document, "dashboard.png", "Dashboard quản lý: chi phí nhân sự, doanh thu/giờ công, chấm công và cảnh báo · Dữ liệu minh họa")
    add_bullets(document, [
        "Nhìn nhanh chi phí nhân sự/doanh thu, doanh thu trên mỗi giờ công và chi phí OT có thể tránh.",
        "Theo dõi nhân viên đang làm, đi muộn, thiếu người và ngoại lệ cần xử lý.",
        "Chuyển thẳng đến chấm công, xếp ca, phân tích lợi nhuận hoặc bảng lương.",
    ], bullet_id)

    # 5. Attendance manager
    add_page_break(document)
    add_page_title(document, "Chấm công", "Chống gian lận theo nhiều lớp", "QR chỉ là một tín hiệu. WeaHR kết hợp trạng thái ca, vị trí, thời gian máy chủ và thiết bị để giảm check-in hộ.")
    add_screenshot(document, "attendance.png", "Trung tâm chấm công dành cho quản lý: cấu hình QR, geofence và xử lý ngoại lệ · Dữ liệu minh họa")
    add_bullets(document, [
        "QR động đổi mã mỗi 30–60 giây; thời gian hợp lệ được kiểm tra ở máy chủ.",
        "GPS geofence giới hạn bán kính quanh cửa hàng; chỉ nhận chấm công khi có ca đã duyệt.",
        "Cảnh báo thiết bị mới, hai tài khoản dùng chung thiết bị, khoảng cách bất thường hoặc thao tác ngoài ca.",
        "Luồng duyệt ngoại lệ cho trường hợp GPS yếu, điện thoại lỗi hoặc nhân viên được điều chuyển khẩn cấp.",
    ], bullet_id)
    add_callout(document, "Lưu ý triển khai", "Device ID trên trình duyệt là tín hiệu rủi ro, không phải chứng thực phần cứng tuyệt đối. Với khách hàng cần mức bảo mật cao hơn, có thể bổ sung ứng dụng di động và device attestation.", fill=SOFT_GOLD, accent=GOLD)

    # 6. Employee check-in
    add_page_break(document)
    add_page_title(document, "Trải nghiệm nhân viên", "Check-in trong vài giây", "Nhân viên mở ca hôm nay, quét QR tại cửa hàng và nhận kết quả xác minh ngay trên điện thoại.")
    add_screenshot(document, "employee-checkin.png", "Màn hình quét QR và các trạng thái xác minh trên điện thoại · Dữ liệu minh họa", width=5.7)
    add_feature_table(document, ["Điều kiện", "Kết quả"], [
        ["QR còn hiệu lực + đúng vị trí + đúng ca", "Check-in thành công; ghi thời gian máy chủ và chi nhánh."],
        ["GPS sai lệch hoặc thiết bị mới", "Tạo cảnh báo; yêu cầu bổ sung lý do hoặc gửi quản lý duyệt."],
        ["Không có ca đã duyệt", "Từ chối chấm công; tránh tạo giờ công ngoài kế hoạch."],
    ], [3500, 5860])

    # 7. Scheduling
    add_page_break(document)
    add_page_title(document, "Xếp ca", "Lịch làm có điểm chất lượng và chi phí", "WeaHR hỗ trợ quản lý tạo lịch nhanh nhưng vẫn kiểm soát độ phủ, kỹ năng, giờ làm và ngân sách.")
    add_screenshot(document, "schedule.png", "Lịch tuần, Schedule Score, chi phí dự kiến và đề xuất thay thế · Dữ liệu minh họa")
    add_bullets(document, [
        "Kéo thả nhân viên vào ca và thấy ngay chi phí lương dự kiến.",
        "Phát hiện trùng lịch, vượt giờ, thiếu kỹ năng, thiếu người hoặc phân bổ không công bằng.",
        "Schedule Score 0–100 tổng hợp độ phủ, ràng buộc và chi phí để quản lý so sánh các phương án.",
        "Gợi ý người thay thế khi nghỉ đột xuất; hỗ trợ ca trống, tự nhận ca và đổi ca có phê duyệt.",
    ], bullet_id)

    # 8. Availability and weekly reminder
    add_page_break(document)
    add_page_title(document, "Tự động hóa hàng tuần", "Nhắc đăng ký lịch rảnh và tự tạo lịch", "Quản lý chọn một ngày cố định mỗi tuần. Hệ thống tự nhắc nhân viên, theo dõi mức hoàn thành và dùng dữ liệu đã khóa để đề xuất lịch tuần tới.")
    add_screenshot(document, "availability.png", "Nhân viên đăng ký thời gian có thể làm và nguyện vọng ca trên điện thoại · Dữ liệu minh họa", width=5.7)
    add_feature_table(document, ["Thời điểm", "Tự động hóa"], [
        ["Trước hạn", "Gửi nhắc lần 1 và hiển thị số nhân viên chưa phản hồi cho quản lý."],
        ["Gần đến hạn", "Gửi nhắc ưu tiên cho người chưa hoàn tất; cho phép quản lý gia hạn riêng."],
        ["Đúng hạn", "Khóa lịch rảnh, đánh dấu thiếu dữ liệu và chạy bộ xếp ca theo ràng buộc."],
        ["Sau khi đề xuất", "Quản lý xem Score, chi phí và cảnh báo rồi phê duyệt trước khi công bố."],
    ], [2350, 7010])
    add_callout(document, "Quyền kiểm soát", "Quản lý được cấu hình ngày/giờ nhắc, múi giờ, số lần nhắc, thời gian khóa dữ liệu và phạm vi áp dụng theo chi nhánh.")

    # 9. Profit intelligence
    add_page_break(document)
    add_page_title(document, "Phân tích lợi nhuận", "Từ biểu đồ chấm công đến quyết định kinh doanh", "Dashboard tập trung vào các chỉ số chủ quán có thể hành động: năng suất, OT, thiếu/thừa người và chi phí trước khi công bố lịch.")
    add_screenshot(document, "insights.png", "Phân tích doanh thu–giờ công, dự báo theo giờ và so sánh chi nhánh · Dữ liệu minh họa")
    add_bullets(document, [
        "Chi phí nhân sự/doanh thu và doanh thu trên mỗi giờ công.",
        "Chi phí OT có thể tránh, giờ thiếu/thừa nhân viên và khoản tiết kiệm ước tính.",
        "Dự báo số đơn/doanh thu theo khung 30–60 phút, sau đó chuyển thành nhu cầu theo vị trí.",
        "Giải thích lý do đề xuất và mức tin cậy để quản lý biết khi nào nên tin, khi nào cần can thiệp.",
    ], bullet_id)
    add_callout(document, "Mức độ tự động hóa hiện tại", "Bản pilot sử dụng baseline thống kê có thể giải thích. Mô hình dự báo nâng cao chỉ nên huấn luyện khi mỗi chi nhánh có tối thiểu 8–12 tuần dữ liệu sạch và đủ biến sự kiện.", fill=SOFT_TEAL, accent=TEAL)

    # 10. Payroll
    add_page_break(document)
    add_page_title(document, "Bảng lương", "Từ giờ công đã duyệt đến kỳ lương", "Giảm thao tác tổng hợp thủ công bằng cách nối ca làm, chấm công, OT, thưởng và khấu trừ trong một quy trình có trạng thái.")
    add_screenshot(document, "payroll.png", "Bảng lương tổng hợp, cảnh báo dữ liệu và luồng phê duyệt · Dữ liệu minh họa")
    add_bullets(document, [
        "Tính lương theo giờ từ dữ liệu chấm công đã duyệt; theo dõi OT, thưởng và khấu trừ.",
        "Các trạng thái nháp → chờ duyệt → chốt → đã thanh toán giúp truy vết trách nhiệm.",
        "Xuất CSV/XLSX để đối soát hoặc chuyển sang hệ thống kế toán hiện có.",
    ], bullet_id)
    add_callout(document, "Cấu hình trước khi vận hành chính thức", "Mỗi khách hàng cần xác nhận chính sách OT, làm ngày lễ, làm đêm, làm tròn thời gian và quy tắc khấu trừ. WeaHR không thay thế tư vấn pháp lý hoặc phần mềm kế toán chuyên dụng.", fill=SOFT_GOLD, accent=GOLD)

    # 11. Employee portal
    add_page_break(document)
    add_page_title(document, "Cổng nhân viên", "Mọi việc trong một màn hình", "Nhân viên tự phục vụ trên điện thoại: xem ca, chấm công, đăng ký lịch rảnh, nhận thông báo và theo dõi thu nhập dự kiến.")
    add_screenshot(document, "employee-home.png", "Trang chủ nhân viên: ca tiếp theo, check-in, lịch tuần và nhắc việc · Dữ liệu minh họa", width=5.7)
    add_bullets(document, [
        "Xem ca hôm nay và lịch tuần ngay sau khi quản lý công bố.",
        "Nhận nhắc đăng ký lịch rảnh, thay đổi ca, duyệt đổi ca và ngoại lệ chấm công.",
        "Gửi yêu cầu nghỉ, đổi ca hoặc nhận ca trống mà không cần nhắn rời rạc qua nhiều nhóm chat.",
    ], bullet_id)

    # 12. Feature by role
    add_page_break(document)
    add_page_title(document, "Phạm vi chức năng", "Ai sử dụng chức năng nào?", "Phân quyền rõ ràng giúp mỗi vai trò chỉ thấy dữ liệu và thao tác cần thiết cho công việc.")
    add_feature_table(document, ["Nhóm chức năng", "Chủ hệ thống", "Quản lý chi nhánh", "Nhân viên"], [
        ["Tổ chức & chi nhánh", "Toàn quyền", "Xem phạm vi phụ trách", "—"],
        ["Nhân viên & kỹ năng", "Cấu hình", "Quản lý đội ngũ", "Xem hồ sơ cá nhân"],
        ["Lịch làm", "Xem toàn chuỗi", "Tạo, tối ưu, công bố", "Đăng ký, nhận/đổi ca"],
        ["Chấm công", "Chính sách toàn chuỗi", "Theo dõi, duyệt ngoại lệ", "Check-in/out"],
        ["Doanh thu & phân tích", "Toàn chuỗi", "Theo chi nhánh", "—"],
        ["Bảng lương", "Chốt và xuất", "Chuẩn bị/đối soát", "Xem phần được công bố"],
        ["Audit log", "Xem toàn bộ", "Xem phạm vi quản lý", "Xem thao tác cá nhân"],
    ], [2350, 2200, 2700, 2110])
    add_heading(document, "Thông báo", 2)
    add_bullets(document, [
        "Trong ứng dụng: lịch mới, thay đổi ca, hạn đăng ký lịch rảnh, ngoại lệ và phê duyệt.",
        "Email hoặc kênh nhắn tin doanh nghiệp có thể bổ sung theo gói tích hợp của khách hàng.",
        "Quản lý chọn múi giờ và lịch nhắc theo từng chi nhánh.",
    ], bullet_id)

    # 13. Architecture and security
    add_page_break(document)
    add_page_title(document, "Tin cậy & bảo mật", "Thiết kế SaaS đa tổ chức", "Dữ liệu được tách theo tổ chức, kiểm soát theo vai trò và các thao tác quan trọng có dấu vết để phục vụ đối soát.")
    add_feature_table(document, ["Lớp", "Cơ chế"], [
        ["Đăng nhập", "Firebase Authentication, xác minh email và phiên đăng nhập an toàn."],
        ["Phân quyền", "Vai trò owner/manager/employee kết hợp organization ID và phạm vi chi nhánh."],
        ["Dữ liệu", "Firestore Security Rules hạn chế truy cập chéo tổ chức và thao tác trái quyền."],
        ["Nghiệp vụ nhạy cảm", "Cloud Functions xác minh giờ máy chủ, QR, điều kiện ca và ghi audit log."],
        ["Chấm công", "Geofence, TTL QR, tín hiệu thiết bị, giới hạn ngoại lệ và phê duyệt quản lý."],
        ["Sao lưu & phục hồi", "Chính sách lưu trữ, retention và backup cấu hình theo môi trường triển khai."],
    ], [2500, 6860])
    add_heading(document, "Cam kết mô tả trung thực", 2)
    add_bullets(document, [
        "CSV/XLSX doanh thu dùng được trong pilot; tích hợp trực tiếp iPOS/KiotViet cần làm việc API và quyền truy cập của khách hàng.",
        "Dự báo hiện tại là baseline thống kê, không tuyên bố là mô hình dự báo đã huấn luyện trên dữ liệu thật của khách hàng.",
        "Phiên bản production cần bổ sung monitoring, backup, billing và quy trình hỗ trợ vận hành theo SLA đã thống nhất.",
    ], bullet_id)

    # 14. Pilot
    add_page_break(document)
    add_page_title(document, "Triển khai", "Pilot 30 ngày để chứng minh hiệu quả", "Bắt đầu nhỏ tại một hoặc hai chi nhánh, đo trước–sau bằng số liệu rồi mới mở rộng toàn chuỗi.")
    add_feature_table(document, ["Giai đoạn", "Thời lượng", "Kết quả bàn giao"], [
        ["Khảo sát", "1–2 ngày", "Chốt quy trình, vai trò, chính sách ca và KPI pilot."],
        ["Thiết lập", "2–3 ngày", "Tổ chức, chi nhánh, nhân viên, ca mẫu, geofence và quyền."],
        ["Đào tạo", "1 ngày", "Quản lý và nhân viên chạy thử trên dữ liệu mẫu."],
        ["Chạy song song", "2 tuần", "Đối chiếu WeaHR với quy trình hiện tại; xử lý ngoại lệ."],
        ["Đo hiệu quả", "2 tuần", "Báo cáo thời gian tiết kiệm, sai lệch công, OT và lịch thiếu/thừa."],
        ["Quyết định mở rộng", "Cuối tháng", "Kế hoạch triển khai chi nhánh còn lại và tích hợp ưu tiên."],
    ], [2350, 1750, 5260])
    add_heading(document, "Khách hàng cần chuẩn bị", 2)
    add_bullets(document, [
        "Danh sách nhân viên, chi nhánh, chức danh, kỹ năng và mức lương theo giờ.",
        "Ca mẫu, giới hạn giờ, quy tắc nghỉ/đổi ca và chính sách OT.",
        "Doanh thu hoặc số đơn theo giờ tối thiểu 8–12 tuần nếu muốn đánh giá dự báo.",
        "Một quản lý đầu mối chịu trách nhiệm phê duyệt dữ liệu và thay đổi quy trình.",
    ], bullet_id)

    # 15. ROI and CTA
    add_page_break(document)
    add_page_title(document, "Giá trị kinh doanh", "Mua kết quả, không chỉ mua phần mềm", "WeaHR được đánh giá bằng số tiền và thời gian tiết kiệm trong vận hành, không chỉ bằng số màn hình hay số biểu đồ.")
    add_metric_cards(document, [
        ("↓", "Thời gian xếp ca", "So sánh trước–sau"),
        ("↓", "Sai lệch giờ công", "Ngoại lệ & chấm công hộ"),
        ("↓", "OT có thể tránh", "Theo tuần và chi nhánh"),
        ("↑", "Doanh thu/giờ công", "Theo ca và khung giờ"),
    ])
    add_heading(document, "Bốn KPI nên chốt trong pilot", 2)
    add_bullets(document, [
        "Số giờ quản lý dùng để thu lịch rảnh và xếp lịch mỗi tuần.",
        "Tỷ lệ ca thiếu người, thừa người và số lần sửa lịch sau công bố.",
        "Sai lệch giữa giờ công dự kiến, giờ chấm công và giờ được duyệt trả lương.",
        "Chi phí nhân sự/doanh thu, doanh thu/giờ công và OT có thể tránh.",
    ], bullet_id)
    add_callout(document, "Bước tiếp theo", "Chọn 1–2 chi nhánh đại diện, nhập dữ liệu một tuần gần nhất và chạy buổi demo theo đúng quy trình thực tế của doanh nghiệp. Sau buổi demo, hai bên thống nhất KPI pilot và phạm vi tích hợp ưu tiên.", fill=SOFT_TEAL, accent=TEAL)
    p = document.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(20)
    p.paragraph_format.space_after = Pt(5)
    set_run(p.add_run("WEAHR"), size=18, color=NAVY, bold=True)
    p2 = document.add_paragraph()
    p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p2.add_run("Lập lịch tốt hơn. Chấm công rõ hơn. Quyết định bằng lợi nhuận."), size=11, color=PRIMARY, bold=True)
    p3 = document.add_paragraph()
    p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_run(p3.add_run("Thông tin liên hệ: bổ sung email · số điện thoại · website trước khi gửi khách hàng"), size=9.5, color=MUTED, italic=True)

    document.core_properties.title = "WeaHR – Hồ sơ sản phẩm"
    document.core_properties.subject = "Nền tảng quản lý nhân sự theo ca và tối ưu lợi nhuận cho F&B"
    document.core_properties.author = "WeaHR"
    document.core_properties.keywords = "WeaHR, SaaS, chấm công, xếp ca, F&B, dự báo"
    document.core_properties.comments = ""
    document.core_properties.created = datetime.now(timezone.utc)
    document.core_properties.modified = datetime.now(timezone.utc)
    document.save(OUTPUT_PATH)
    return OUTPUT_PATH


if __name__ == "__main__":
    print(build())
