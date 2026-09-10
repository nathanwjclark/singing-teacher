from pathlib import Path
import re
import html
import math
from urllib.parse import urlparse

from reportlab.pdfgen import canvas
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table,
    TableStyle, Preformatted, KeepTogether, PageBreak
)
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'singing-coach-spec.md'
OUTPUT = ROOT / 'personalized-singing-coach.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

raw = SOURCE.read_text() + '\n\n' + (ROOT / 'two-person-execution-plan.md').read_text().replace(
    '# Parallel-agent execution plan', '# Execution appendix: parallel-agent plan', 1
)
raw += '\n\n' + (ROOT / 'embodied-learning-and-motion-plan.md').read_text()
definitions = dict(re.findall(r'^\[\^([^]]+)\]:\s*(.+)$', raw, re.M))
body = re.sub(r'^\[\^[^]]+\]:.*$', '', raw, flags=re.M).strip()
order = list(dict.fromkeys(re.findall(r'\[\^([^]]+)\]', body)))
assert set(order) == set(definitions), (set(order) - set(definitions), set(definitions) - set(order))
numbers = {key: idx + 1 for idx, key in enumerate(order)}


def normalize(text):
    replacements = {
        '\u2013': '-', '\u2014': '-', '\u2011': '-', '\u2010': '-',
        '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
        '\u2192': '->', '\u2190': '<-', '\u2265': '>=', '\u2264': '<=',
        '\u00a0': ' ', '\u2026': '...', '\u00d7': 'x',
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    return text


source_info = {}
for key, definition in definitions.items():
    urls = re.findall(r'https?://[^\s;]+', definition)
    description = normalize(definition.split(urls[0])[0].strip())
    source_info[key] = {'description': description, 'urls': urls}

INK = colors.HexColor('#172126')
MUTED = colors.HexColor('#47545B')
LINK = colors.HexColor('#245C6C')
RULE = colors.HexColor('#CFD5D8')
PALE = colors.HexColor('#F3F5F6')
WIDTH, HEIGHT = letter
LEFT, RIGHT, TOP, BOTTOM = 49, 49, 43, 104
TEXT_WIDTH = WIDTH - LEFT - RIGHT

styles = {
    'title': ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=23, leading=28,
                            textColor=INK, spaceAfter=16),
    'h1': ParagraphStyle('H1', fontName='Helvetica-Bold', fontSize=14, leading=18,
                         textColor=INK, spaceBefore=16, spaceAfter=9, keepWithNext=True),
    'h2': ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=11.1, leading=15,
                         textColor=INK, spaceBefore=9, spaceAfter=6, keepWithNext=True),
    'body': ParagraphStyle('Body', fontName='Helvetica', fontSize=9.8, leading=13.2,
                           textColor=INK, spaceAfter=6, allowWidows=0, allowOrphans=0),
    'bullet': ParagraphStyle('Bullet', fontName='Helvetica', fontSize=9.8, leading=13.2,
                             leftIndent=16, firstLineIndent=-13, textColor=INK, spaceAfter=6,
                             allowWidows=0, allowOrphans=0),
    'table': ParagraphStyle('Table', fontName='Helvetica', fontSize=8.7, leading=11.5,
                            textColor=INK, spaceAfter=0, splitLongWords=True),
    'tablehead': ParagraphStyle('TableHead', fontName='Helvetica-Bold', fontSize=8.7, leading=11.5,
                                textColor=INK, spaceAfter=0),
    'code': ParagraphStyle('Code', fontName='Courier', fontSize=8.0, leading=10.6,
                           textColor=INK, spaceBefore=5, spaceAfter=10),
    'reference': ParagraphStyle('Reference', fontName='Helvetica', fontSize=8.4, leading=10.6,
                                textColor=INK, spaceAfter=3, allowWidows=0, allowOrphans=0),
}


class RefParagraph(Paragraph):
    def __init__(self, text, style, *args, **kwargs):
        self.ref_keys = kwargs.pop('ref_keys', [])
        super().__init__(text, style, *args, **kwargs)

    def split(self, available_width, available_height):
        parts = super().split(available_width, available_height)
        for part in parts:
            if isinstance(part, Paragraph):
                part.ref_keys = self.ref_keys
        return parts


def inline(text):
    text = html.escape(normalize(text), quote=False)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`([^`]+)`', r'<font name="Courier" size="9">\1</font>', text)
    text = re.sub(r'\[\^([^]]+)\]',
                  lambda m: f'<super><link href="#ref-{numbers[m[1]]}" color="#245C6C">{numbers[m[1]]}</link></super>', text)
    text = re.sub(r'\[([^]]+)\]\((https?://[^)]+)\)',
                  r'<link href="\2" color="#245C6C">\1</link>', text)
    return text


def para(text, style='body'):
    return RefParagraph(inline(text), styles[style],
                        ref_keys=re.findall(r'\[\^([^]]+)\]', text))


def collect_refs(flowable):
    result = list(getattr(flowable, 'ref_keys', []))
    if isinstance(flowable, Table):
        for row in flowable._cellvalues:
            for cell in row:
                for item in cell if isinstance(cell, (list, tuple)) else [cell]:
                    result.extend(collect_refs(item))
    if isinstance(flowable, KeepTogether):
        for item in flowable._content:
            result.extend(collect_refs(item))
    return result


def fit_text(text, font, size, width):
    if stringWidth(text, font, size) <= width:
        return text
    while text and stringWidth(text + '...', font, size) > width:
        text = text[:-1]
    return text.rstrip() + '...'


class ReportDoc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(str(path), pagesize=letter, leftMargin=LEFT, rightMargin=RIGHT,
                         topMargin=TOP, bottomMargin=BOTTOM, title='Personal Vocal Physiology and Acoustics',
                         author='', subject='Moonshot research and implementation specification, revision 6')
        self.current_refs = []
        self.page_log = []
        frame = Frame(LEFT, BOTTOM, TEXT_WIDTH, HEIGHT - TOP - BOTTOM,
                      leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id='report', frames=[frame], onPageEnd=self.finish_page))

    def beforePage(self):
        self.current_refs = []

    def afterFlowable(self, flowable):
        for key in collect_refs(flowable):
            if key not in self.current_refs:
                self.current_refs.append(key)
        if isinstance(flowable, Paragraph) and flowable.style.name == 'H1':
            label = flowable.getPlainText()
            anchor = f'section-{self.seq.nextf("section")}'
            self.canv.bookmarkPage(anchor)
            self.canv.addOutlineEntry(label, anchor, 0)

    def finish_page(self, canv, doc):
        keys = sorted(self.current_refs, key=lambda k: numbers[k])
        self.page_log.append({'page': doc.page, 'refs': [numbers[k] for k in keys]})
        canv.saveState()
        if keys:
            canv.setStrokeColor(RULE)
            canv.setLineWidth(0.4)
            canv.line(LEFT, BOTTOM - 11, WIDTH - RIGHT, BOTTOM - 11)
            two_columns = len(keys) > 6
            columns = 2 if two_columns else 1
            per_column = math.ceil(len(keys) / columns)
            assert per_column <= 8, f'Too many footnotes on page {doc.page}: {len(keys)}'
            col_width = TEXT_WIDTH / columns
            canv.setFont('Helvetica', 7.1)
            canv.setFillColor(MUTED)
            for idx, key in enumerate(keys):
                col, row = divmod(idx, per_column)
                x = LEFT + col * col_width
                y = BOTTOM - 24 - row * 9
                description = source_info[key]['description']
                description = re.sub(r'\s*(Accessed|Inspected|accessed|inspected).*$', '', description)
                text = f'{numbers[key]}. {description}'
                text = fit_text(text, 'Helvetica', 7.1, col_width - 10)
                canv.drawString(x, y, text)
                canv.linkURL(source_info[key]['urls'][0], (x, y - 2, x + col_width - 10, y + 7), relative=0)
        canv.setFillColor(MUTED)
        canv.setFont('Helvetica', 8)
        canv.drawRightString(WIDTH - RIGHT, 20, str(doc.page))
        canv.restoreState()


def build_table(lines):
    rows = [[cell.strip() for cell in line.strip().strip('|').split('|')] for line in lines]
    rows = [row for row in rows if not all(re.fullmatch(r'[:\- ]+', c) for c in row)]
    ncols = len(rows[0])
    assert all(len(row) == ncols for row in rows), rows
    if ncols == 2:
        fractions = [0.29, 0.71]
    elif ncols == 3:
        fractions = [0.21, 0.37, 0.42]
    elif ncols == 4:
        fractions = [0.16, 0.18, 0.35, 0.31]
    else:
        fractions = [1 / ncols] * ncols
    cells = [[para(c, 'tablehead' if ridx == 0 else 'table') for c in row]
             for ridx, row in enumerate(rows)]
    t = Table(cells, colWidths=[TEXT_WIDTH * f for f in fractions],
              repeatRows=1, hAlign='LEFT', splitByRow=1, spaceBefore=3, spaceAfter=10)
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#E7ECEE')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, PALE]),
        ('LINEBELOW', (0, 0), (-1, 0), 0.6, RULE),
        ('LINEBELOW', (0, 1), (-1, -1), 0.25, RULE),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    return t


story = []
lines = body.splitlines()
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if line.startswith('```'):
        block = []
        i += 1
        while i < len(lines) and not lines[i].strip().startswith('```'):
            block.append(normalize(lines[i]))
            i += 1
        code = '\n'.join(block)
        if story and isinstance(story[-1], Paragraph):
            story[-1].keepWithNext = True
        story.append(KeepTogether([Preformatted(code, styles['code'], maxLineLength=96)]))
        i += 1
        continue
    if line.startswith('|'):
        table_lines = []
        while i < len(lines) and lines[i].strip().startswith('|'):
            table_lines.append(lines[i])
            i += 1
        story.append(build_table(table_lines))
        continue
    if line.startswith('# '):
        story.append(para(line[2:], 'title'))
    elif line.startswith('## '):
        story.append(para(line[3:], 'h1'))
    elif line.startswith('### '):
        story.append(para(line[4:], 'h2'))
    elif re.match(r'^\d+\. ', line):
        story.append(para(line, 'bullet'))
    elif line.startswith('- '):
        story.append(para('- ' + line[2:], 'bullet'))
    else:
        paragraph = [line]
        while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r'^(#|\||```|\d+\. |- )', lines[i + 1].strip()):
            i += 1
            paragraph.append(lines[i].strip())
        story.append(para(' '.join(paragraph)))
    i += 1

story.append(para('Full source list', 'h2'))
for key in order:
    info = source_info[key]
    idx = numbers[key]
    description = html.escape(info['description'], quote=False)
    links = []
    for n, url in enumerate(info['urls']):
        host = urlparse(url).netloc
        label = f'{host}' if len(info['urls']) == 1 else f'Source {n + 1}: {host}'
        links.append(f'<link href="{html.escape(url, quote=True)}" color="#245C6C">{html.escape(label)}</link>')
    text = f'<a name="ref-{idx}"/><b>{idx}.</b> {description} ' + ' / '.join(links)
    story.append(RefParagraph(text, styles['reference']))

doc = ReportDoc(OUTPUT)
doc.build(story)

import json
qa_dir = ROOT / 'artifacts'
qa_dir.mkdir(exist_ok=True)
(qa_dir / 'pdf-page-map.json').write_text(json.dumps(doc.page_log, indent=2))
print(json.dumps({'pdf': str(OUTPUT), 'pages': len(doc.page_log), 'sources': len(order),
                  'words': len(raw.split())}, indent=2))
