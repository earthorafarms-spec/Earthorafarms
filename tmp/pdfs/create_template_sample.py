from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Spacer, Paragraph, Table, TableStyle

OUTPUT = r"D:\Website\output\pdf\earthora_invoice_template_sample.pdf"

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=22 * mm,
    rightMargin=22 * mm,
    topMargin=22 * mm,
    bottomMargin=22 * mm,
)
styles = getSampleStyleSheet()
styles["Title"].fontName = "Helvetica-Bold"
styles["Title"].fontSize = 22
styles["Title"].leading = 27
styles["Heading2"].textColor = HexColor("#26593B")

story = [
    Paragraph("Earthora Farms", styles["Title"]),
    Spacer(1, 5 * mm),
    Paragraph("Sample Tax Invoice", styles["Heading2"]),
    Spacer(1, 3 * mm),
    Paragraph(
        "This is a neutral sample document used only to request approval of the WhatsApp invoice template. "
        "It is not a customer invoice and does not contain customer, order, or payment data.",
        styles["BodyText"],
    ),
    Spacer(1, 8 * mm),
]

table = Table(
    [["Description", "Quantity", "Amount"], ["Sample product", "1", "INR 0.00"], ["Total", "", "INR 0.00"]],
    colWidths=[88 * mm, 35 * mm, 40 * mm],
)
table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), HexColor("#26593B")),
    ("TEXTCOLOR", (0, 0), (-1, 0), HexColor("#FFFFFF")),
    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
    ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ("GRID", (0, 0), (-1, -1), 0.5, HexColor("#B8C9BE")),
    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 9),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
]))
story.append(table)
story += [
    Spacer(1, 12 * mm),
    Paragraph("Template approval sample - Earthora Farms", styles["BodyText"]),
]
doc.build(story)
