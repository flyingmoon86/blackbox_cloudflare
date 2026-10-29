from pathlib import Path
import re
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/working/technical-archive/黑匣子 Cloudflare 网站技术归档.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Hei', r'C:\Windows\Fonts\msyh.ttc', subfontIndex=0))
W,H=A4
BURG=HexColor('#692536'); DARK=HexColor('#39141E'); GOLD=HexColor('#B58C57')
PAPER=HexColor('#FBF8F2'); INK=HexColor('#24211F'); MUTED=HexColor('#706A66')
LIGHT=HexColor('#E9DDD2'); WHITE=HexColor('#FFFFFF')
BODY=ParagraphStyle('b',fontName='Hei',fontSize=10.25,leading=18.1,textColor=INK,wordWrap='CJK')
INTRO=ParagraphStyle('i',fontName='Hei',fontSize=11.6,leading=20.5,textColor=INK,wordWrap='CJK')
CODE=ParagraphStyle('c',fontName='Hei',fontSize=9.2,leading=15.5,textColor=BURG,wordWrap='CJK')
def simple(s):
    return re.sub(r'\[([^]]+)\]\(([^)]+)\)',lambda m:m.group(1),s).replace('**','').replace('`','')

def para(c, txt, x,y,width, style=BODY):
    p=Paragraph(escape(txt),style); _,ht=p.wrap(width,1000)
    p.drawOn(c,x,y-ht)
    return y-ht

def page(c,n):
    c.setFillColor(PAPER);c.rect(0,0,W,H,stroke=0,fill=1)
    c.setFillColor(BURG);c.rect(0,H-11,W,11,stroke=0,fill=1)
    c.setFillColor(MUTED);c.setFont('Hei',8)
    c.drawString(53,H-42,'黑匣子  /  CLOUDFLARE')
    c.drawRightString(W-53,H-42,'技术归档  ·  2026.09.26')
    c.setStrokeColor(LIGHT);c.line(53,H-53,W-53,H-53)
    c.setStrokeColor(GOLD);c.setLineWidth(1.4);c.line(53,43,125,43)
    c.setFillColor(MUTED);c.drawString(53,29,'黑匣子网站  /  架构与运维')
    c.drawRightString(W-53,29,f'{n:02d}')

def cover(c,opening):
    c.setFillColor(PAPER);c.rect(0,0,W,H,stroke=0,fill=1)
    c.setFillColor(DARK)
    p=c.beginPath();p.moveTo(420,H);p.lineTo(W,H);p.lineTo(W,0);p.curveTo(540,120,510,310,546,465);p.curveTo(565,610,475,700,420,H);p.close();c.drawPath(p,stroke=0,fill=1)
    c.setFillColor(BURG)
    p=c.beginPath();p.moveTo(466,H);p.lineTo(W,H);p.lineTo(W,175);p.curveTo(560,300,566,420,568,520);p.curveTo(570,650,490,740,466,H);p.close();c.drawPath(p,stroke=0,fill=1)
    c.setStrokeColor(GOLD);c.setLineWidth(.5)
    for i in range(5):
        x=500+i*17;p=c.beginPath();p.moveTo(x,H);p.curveTo(x+55,650,x+20,390,x+80,105);c.drawPath(p,stroke=1,fill=0)
    c.setFillColor(GOLD);c.setFont('Hei',10);c.drawString(54,H-90,'01  /  CLOUDFLARE EDITION')
    c.setStrokeColor(GOLD);c.setLineWidth(2);c.line(54,H-110,152,H-110)
    c.setFillColor(INK);c.setFont('Hei',27);c.drawString(54,H-158,'黑匣子 Cloudflare');c.drawString(54,H-200,'网站技术归档')
    c.setFillColor(MUTED);c.setFont('Hei',10);c.drawString(56,H-232,'DESIGN REPORT  ·  2026 / 09 / 26')
    c.setFillColor(WHITE);c.roundRect(50,241,397,285,10,stroke=0,fill=1)
    c.setFillColor(BURG);c.rect(50,241,5,285,stroke=0,fill=1)
    c.setFillColor(BURG);c.setFont('Hei',13);c.drawString(72,490,'阅读范围与结论')
    para(c,opening,72,465,340,INTRO)
    c.setStrokeColor(LIGHT);c.line(72,321,418,321)
    c.setFillColor(MUTED);c.setFont('Hei',9);c.drawString(72,294,'系统构成')
    c.setFillColor(BURG);c.setFont('Hei',11);c.drawString(72,268,'单 Worker  ·  D1 元数据  ·  R2 文件')
    c.setFillColor(MUTED);c.setFont('Hei',8);c.drawString(54,60,'归档用途  /  维护交接与迁移核对')

lines=(ROOT/'README.md').read_text(encoding='utf-8').splitlines()
opening=simple(next(x[2:] for x in lines if x.startswith('> ')))
c=canvas.Canvas(str(OUT),pagesize=A4,pageCompression=1)
c.setTitle('黑匣子 Cloudflare 网站技术归档');c.setAuthor('黑匣子网站项目')
cover(c,opening);c.showPage();n=2;page(c,n);y=H-93;section=0;in_code=False

def table_layout(raw_rows):
    parsed=[]
    for row in raw_rows:
        if re.fullmatch(r'[\s|:-]+',row):continue
        parsed.append([simple(cell.strip()) for cell in row.strip('|').split('|')])
    widths=[154,202,118] if parsed[0][0]=='请求' else [119,217,138]
    cell_style=ParagraphStyle('table',fontName='Hei',fontSize=9.25,leading=15.1,textColor=INK,wordWrap='CJK')
    header_style=ParagraphStyle('tablehead',parent=cell_style,textColor=WHITE,fontSize=9.2)
    heights=[]
    for ri,row in enumerate(parsed):
        heights.append(max(Paragraph(escape(value),header_style if ri==0 else cell_style).wrap(widths[ci]-16,1000)[1] for ci,value in enumerate(row))+13)
    return parsed,widths,heights,cell_style,header_style

def draw_table(parsed,widths,heights,cell_style,header_style,y):
    x0=54
    for ri,row in enumerate(parsed):
        top=y
        x=x0
        for ci,value in enumerate(row):
            c.setFillColor(BURG if ri==0 else (HexColor('#F2E9E0') if ri%2 else WHITE))
            c.rect(x,top-heights[ri],widths[ci],heights[ri],stroke=0,fill=1)
            c.setStrokeColor(LIGHT);c.setLineWidth(.5)
            c.rect(x,top-heights[ri],widths[ci],heights[ri],stroke=1,fill=0)
            p=Paragraph(escape(value),header_style if ri==0 else cell_style)
            _,ht=p.wrap(widths[ci]-16,1000)
            p.drawOn(c,x+8,top-6-ht)
            x+=widths[ci]
        y-=heights[ri]
    return y-17

i=3
while i<len(lines):
    raw=lines[i];i+=1
    if not raw.strip():continue
    if raw.startswith('|'):
        group=[raw]
        while i<len(lines) and lines[i].startswith('|'):
            group.append(lines[i]);i+=1
        parsed,widths,heights,cell_style,header_style=table_layout(group)
        if y-sum(heights)<82:c.showPage();n+=1;page(c,n);y=H-93
        y=draw_table(parsed,widths,heights,cell_style,header_style,y)
        continue
    if raw.startswith('```'):
        in_code=not in_code;continue
    if raw.startswith('> '):continue
    if raw.startswith('## '):
        title=simple(raw[3:]);section+=1
        if y<200:c.showPage();n+=1;page(c,n);y=H-93
        y-=13;c.setFillColor(GOLD);c.setFont('Hei',9);c.drawString(54,y,f'{section:02d}  /  章节')
        y-=32;c.setFillColor(INK);c.setFont('Hei',19);c.drawString(54,y,title)
        y-=13;c.setStrokeColor(GOLD);c.setLineWidth(1.2);c.line(54,y,118,y);y-=26
        continue
    if raw.startswith('### '):
        if raw.startswith('### 一次投稿') and y<400:
            c.showPage();n+=1;page(c,n);y=H-93
        if y<145:c.showPage();n+=1;page(c,n);y=H-93
        y-=12;c.setFillColor(BURG);c.setFont('Hei',12);c.drawString(54,y,simple(raw[4:]));y-=20
        continue
    txt=simple(raw)
    style=CODE if in_code else BODY
    if in_code and txt.startswith('浏览器'):pass
    p=Paragraph(escape(txt),style);_,ht=p.wrap(474,1000)
    if y-ht<80:c.showPage();n+=1;page(c,n);y=H-93
    if in_code:
        c.setFillColor(LIGHT);c.roundRect(53,y-ht-5,477,ht+9,3,stroke=0,fill=1)
        y=para(c,txt,59,y,462,style)-13
    else:y=para(c,txt,54,y,474,style)-13

c.save();print(OUT,n)
