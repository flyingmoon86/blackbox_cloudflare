"""Run from repository root after exporting handbook content (see docs/开发维护.md)."""
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.colors import HexColor
from pypdf import PdfReader
from PIL import Image
pdfmetrics.registerFont(TTFont('Sans','C:/Windows/Fonts/msyh.ttc'))
pdfmetrics.registerFont(TTFont('Serif','C:/Windows/Fonts/simsun.ttc'))
data=json.loads(Path('artifacts/handbook/content.json').read_text(encoding='utf-8-sig'))
out=Path('docs/handbooks/黑匣子话剧队网站使用手册.pdf')
out.parent.mkdir(parents=True,exist_ok=True)
c=canvas.Canvas(str(out),pagesize=(595,842))
c.setTitle('黑匣子 · 队员使用手册')
c.setAuthor('黑匣子话剧队')
styles={k:ParagraphStyle(k,fontName=f,fontSize=z,leading=l,textColor=HexColor(col),wordWrap='CJK') for k,f,z,l,col in [('body','Sans',10,17,'#20201e'),('note','Sans',9,15,'#55554e'),('title','Serif',25,34,'#20201e')]}
def para(text,y,style='body',width=499,x=48):
 p=Paragraph(text,styles[style]);_,h=p.wrap(width,800);p.drawOn(c,x,y-h);return y-h

def page(n,kicker,title):
 c.setFillColor(HexColor('#f5f4ef'));c.rect(0,0,595,842,fill=1,stroke=0)
 c.setStrokeColor(HexColor('#20201e'));c.setLineWidth(2);c.line(48,795,547,795)
 c.setFillColor(HexColor('#bd3827'));c.setFont('Sans',9);c.drawString(48,775,kicker)
 y=para(title,752,'title')-24
 c.setFillColor(HexColor('#55554e'));c.setFont('Sans',8);c.drawString(48,30,'黑匣子话剧队 / 队员使用手册 · 2026.10.28');c.drawRightString(547,30,f'{n:02} / 10')
 if n > 2:
  c.setFillColor(HexColor('#982c20'));c.drawRightString(547,48,'返回目录 ↑')
  c.linkRect('', 'contents', (475,43,547,59), relative=0, thickness=0)
 return y

def chapter(ch,y,i):
 c.bookmarkPage(ch['id']);c.addOutlineEntry(ch['title'],ch['id'],0)
 c.setFont('Sans',12);c.setFillColor(HexColor('#bd3827'));c.drawString(48,y,f"0{i}  {ch['title']}");y-=13
 for j,s in enumerate(ch['steps']): y=para(f'{j+1}. '+escape(s),y)-5
 y=para(escape(ch['note']),y-2,'note')-9
 y=para(f'<link href="https://npublackbox.online{ch["href"]}" color="#982c20">{ch["link"]} →</link>',y,'note')-18
 if y<55: raise ValueError(('overflow',ch['id'],y))
 c.setStrokeColor(HexColor('#d5d4cc'));c.setLineWidth(.5);c.line(48,y+5,547,y+5)
 return y-13

def screenshot(id,y,width,x=48):
 path=f'public/images/handbook/{id}.png'
 w,h=Image.open(path).size
 height=h/w*width
 c.drawImage(path,x,y-height,width=width,height=height)
 return y-height
# Front matter: cover and an interactive contents page.
c.setFillColor(HexColor('#f5f4ef'));c.rect(0,0,595,842,fill=1,stroke=0)
c.bookmarkPage('cover');c.addOutlineEntry('封面','cover',0)
c.setStrokeColor(HexColor('#20201e'));c.setLineWidth(2);c.line(48,795,547,795)
c.setFillColor(HexColor('#20201e'));c.setFont('Sans',10);c.drawString(48,773,'BLACK BOX THEATRE')
c.setFont('Sans',9);c.drawRightString(547,773,'MEMBER HANDBOOK / 2026')
c.setFillColor(HexColor('#bd3827'));c.rect(48,280,499,438,fill=1,stroke=0)
c.setFillColor(HexColor('#f5f4ef'));c.setFont('Sans',10);c.drawString(78,682,'从这里开始，把共同的舞台记忆留存下来。')
c.setFont('Serif',76);c.drawString(73,533,'黑匣子')
c.setFont('Serif',34);c.drawString(78,464,'队员使用手册')
c.setLineWidth(.7);c.setStrokeColor(HexColor('#f5f4ef'));c.line(78,414,517,414)
c.setFont('Sans',12);c.drawString(78,377,'认证 · 档案 · 照片 · 演职 · 资料')
c.setFont('Sans',10);c.drawString(78,319,'图文操作指南 / 含管理员独立附录')
para('把舞台的记忆，留在这里。',228,'title')
para('找到你要做的事，照着截图与步骤完成。',177,'body')
para('<link href="https://npublackbox.online" color="#982c20">npublackbox.online →</link>',136,'body')
c.setFillColor(HexColor('#55554e'));c.setFont('Sans',8);c.drawString(48,30,'黑匣子话剧队 · 2026.10.28');c.drawRightString(547,30,'01 / 10')
c.showPage()
y=page(2,'CONTENTS / 按任务查阅','目录')
c.bookmarkPage('contents');c.addOutlineEntry('目录','contents',0)
y=para('点击条目直达对应页面；正文页脚可返回这里。',y,'note')-30
entries=[(ch['id'],ch['title'],ch['audience'],i+3) for i,ch in enumerate(data['chapters'])]
entries.append(('admin','管理员操作附录','仅管理员',10))
for number,(anchor,title,audience,target) in enumerate(entries,1):
 c.setFillColor(HexColor('#bd3827'));c.setFont('Sans',10);c.drawString(48,y,f'{number:02}')
 c.setFillColor(HexColor('#20201e'));c.setFont('Serif',18);c.drawString(86,y-1,title)
 c.setFont('Sans',14);c.drawRightString(547,y-1,f'{target:02}')
 c.setFillColor(HexColor('#55554e'));c.setFont('Sans',8);c.drawString(86,y-22,audience)
 c.setStrokeColor(HexColor('#d5d4cc'));c.setLineWidth(.5);c.line(48,y-36,547,y-36)
 c.linkRect('',anchor,(48,y-36,547,y+18),relative=0,thickness=0)
 y-=65
para('说明：截图使用演示账号与示例资料，操作以当前页面为准。',95,'note')
c.showPage()
for i,ch in enumerate(data['chapters']):
 y=page(i+3,'BLACK BOX / ILLUSTRATED HANDBOOK',ch['title'])
 c.bookmarkPage(ch['id']);c.addOutlineEntry(ch['title'],ch['id'],0)
 portrait=ch['id'] in ['account','profile','upload','help']
 if portrait:
  bottom=screenshot(ch['id'],y,280)
  x,width=350,197
 else:
  bottom=screenshot(ch['id'],y,499)
  y=bottom-30;x,width=48,499
 y=para(ch['audience']+' · 按下面步骤操作',y,'note',width,x)-16
 for j,step in enumerate(ch['steps']):
  y=para(f'<font color="#bd3827">0{j+1}</font>  '+escape(step),y,'body',width,x)-14
 y=para(escape(ch['note']),y,'note',width,x)-18
 y=para(f'<link href="https://npublackbox.online{ch['href']}" color="#982c20">{ch['link']} →</link>',y,'note',width,x)
 captionY=min(bottom,y)-18
 assert captionY>45,(ch['id'],captionY)
 para('界面截图 · 使用演示账号与示例资料，操作以当前页面为准。',captionY,'note')
 c.showPage()
y=page(10,'APPENDIX / ADMIN ONLY','管理员操作附录')
c.bookmarkPage('admin');c.addOutlineEntry('管理员操作附录','admin',0)
y=screenshot('admin',y,499)-20
y=para('工作台待办入口 · 演示资料；本页仅供管理员参考。',y,'note')-18
for a in data['admin']:
 y=para(f'<link href="https://admin.npublackbox.online{a['href']}" color="#982c20">{a['title']} →</link> '+escape(a['text']),y,'body')-12
assert y>45,y
c.save()
r=PdfReader(out);assert len(r.pages)==10
assert all(p.extract_text().strip() for p in r.pages)
assert all(len(p.images)>0 for p in r.pages[2:])
assert len(r.pages[1].get("/Annots",[]))==8
print(str(out),len(r.pages),'illustrated pages')
