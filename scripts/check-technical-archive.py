from pathlib import Path
import re
import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[1]
md=(root/'README.md').read_text(encoding='utf-8')
links=re.findall(r'\[[^]]+\]\(([^)]+)\)',md)
print('local broken links:',[x for x in links if not x.startswith('http') and not (root/x).exists()])
for src,label in [(root/'artifacts/working/technical-archive/黑匣子 Cloudflare 网站技术归档.pdf','art'),(root/'migration-work/docx-proof-final.pdf','docx')]:
    d=pdfium.PdfDocument(src)
    reader=PdfReader(src)
    print(label,'pages',len(d),'chars',[len(p.extract_text()) for p in reader.pages])
    thumbs=[]
    for i in range(len(d)):
        im=d[i].render(scale=.65).to_pil().convert('RGB')
        im.thumbnail((330,467))
        tile=Image.new('RGB',(350,495),'white')
        tile.paste(im,((350-im.width)//2,5))
        ImageDraw.Draw(tile).text((10,473),f'{label} p{i+1}',fill='black')
        thumbs.append(tile)
    sheet=Image.new('RGB',(350*3,495*((len(thumbs)+2)//3)),'#ddd')
    for i,t in enumerate(thumbs):sheet.paste(t,((i%3)*350,(i//3)*495))
    sheet.save(root/'artifacts/working/technical-archive'/f'{label}-sheet.png')
