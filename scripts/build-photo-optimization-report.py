"""Build the evidence-based, pre-deployment photo navigation report from a task directory."""
import argparse
import json
import re
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.lib.utils import ImageReader

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evidence', required=True)
parser.add_argument('--commit', required=True)
args = parser.parse_args()
folder = Path(args.evidence).resolve()
root = Path(__file__).resolve().parents[1]
perf = json.loads((folder/'performance.json').read_text(encoding='utf-8'))
captures = json.loads((folder/'screenshots-final/capture-results.json').read_text(encoding='utf-8'))
assert captures['passed'] and len(captures['screenshots']) == 28
log = (folder/'deploy-check.log').read_text(encoding='utf-8-sig')
assert '此命令没有发布网站' in log and re.search(r'pass\s+256', log)
pdfmetrics.registerFont(TTFont('CJK', 'C:/Windows/Fonts/msyh.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('CJKB', 'C:/Windows/Fonts/msyhbd.ttc', subfontIndex=0))
pdfmetrics.registerFont(TTFont('Mono', 'C:/Windows/Fonts/consola.ttf'))
W, H = A4
L, R = 46, W-46
CW = R-L
INK, MUTED, ACCENT, LINE, LIGHT = map(HexColor, ['#252a2d','#626c73','#763b35','#d9dedf','#f1f4f3'])
styles = {
 'body': ParagraphStyle('body',fontName='CJK',fontSize=9.8,leading=17,wordWrap='CJK',textColor=INK),
 'small': ParagraphStyle('small',fontName='CJK',fontSize=8.2,leading=13.5,wordWrap='CJK',textColor=MUTED),
 'lead': ParagraphStyle('lead',fontName='CJK',fontSize=12,leading=21,wordWrap='CJK',textColor=INK),
 'cell': ParagraphStyle('cell',fontName='CJK',fontSize=9,leading=15,wordWrap='CJK',textColor=INK),
}
out = folder/'黑匣子_D1剧照导航优化报告.pdf'
c = canvas.Canvas(str(out), pagesize=A4, pageCompression=1)
c.setTitle('黑匣子网站：基于真实 D1 超限反馈的剧照导航优化报告')
c.setAuthor('黑匣子网站项目')
md = ['# 黑匣子网站：基于真实 D1 超限反馈的剧照导航优化报告', '', '2026-11-15 · 部署前验收 · 本地已提交，未部署', '', f'代码提交：{args.commit}', '']
pages = []
def text(s,x,y,width=CW,kind='body',markup=False):
    p=Paragraph(s if markup else escape(s),styles[kind]); _,h=p.wrap(width,1000)
    assert y-h>42, f'Text overflows: {s[:60]}'
    p.drawOn(c,x,y-h); return y-h
def para(s,y,kind='body'):
    md.append(s+'\n'); return text(s,L,y,CW,kind)-12
def heading(s,y):
    c.setFont('CJKB',13); c.setFillColor(INK); c.drawString(L,y,s)
    md.append('### '+s+'\n'); return y-23
def page(n,title,kicker):
    if n>1:c.showPage()
    c.setFillColor(HexColor('#ffffff'));c.rect(0,0,W,H,fill=1,stroke=0)
    c.setFillColor(ACCENT);c.rect(L,H-37,35,3,fill=1,stroke=0)
    c.setFillColor(MUTED);c.setFont('CJK',8);c.drawString(L+46,H-36,'BLACKBOX / 实际反馈驱动的性能优化')
    c.setStrokeColor(LINE);c.line(L,45,R,45)
    c.setFont('CJK',7.5);c.drawString(L,30,'部署前验收 · 2026-11-15 · '+args.commit[:7]);c.drawRightString(R,30,f'{n:02d} / 10')
    c.bookmarkPage('page'+str(n));c.addOutlineEntry(title,'page'+str(n),0)
    c.setFillColor(INK);c.setFont('CJKB',22);c.drawString(L,H-87,title)
    text(kicker,L,H-102,CW,'small');md.append('## '+title+'\n'+kicker+'\n')
    pages.append({'page':n,'title':title});return H-144
def table(headers, rows, y, widths=None):
    widths=widths or [CW/len(headers)]*len(headers)
    data=[[Paragraph(escape(str(v)),styles['cell']) for v in row] for row in [headers]+rows]
    t=Table(data,colWidths=widths,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),LIGHT),('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),0.7,LINE),('LINEBELOW',(0,1),(-1,-1),0.3,LINE),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),9)]))
    _,h=t.wrap(CW,1000);assert y-h>50,'Table overflows';t.drawOn(c,L,y-h)
    md.append(' | '.join(map(str,headers)))
    md.append(' | '.join(['---']*len(headers)))
    md.extend([' | '.join(map(str,row)) for row in rows]);md.append('')
    return y-h-17
def shot(name,x,y,width,maxh,caption):
    path=folder/'screenshots-final'/name
    image=ImageReader(str(path));iw,ih=image.getSize();scale=min(width/iw,maxh/ih);dw,dh=iw*scale,ih*scale
    c.drawImage(image,x+(width-dw)/2,y-dh,width=dw,height=dh)
    c.setStrokeColor(LINE);c.rect(x+(width-dw)/2,y-dh,dw,dh,fill=0,stroke=1)
    bottom=text(caption,x,y-dh-7,width,'small')
    md.append(f'![{caption}](screenshots-final/{name})\n')
    return bottom-17
def code(s,y,label):
    lines=s.splitlines();font=8.2;lineh=12.5;h=len(lines)*lineh+26
    assert y-h>50,'Code overflows'
    c.setFillColor(LIGHT);c.rect(L,y-h,CW,h,fill=1,stroke=0)
    c.setFont('Mono',font);c.setFillColor(INK)
    for i,line in enumerate(lines):
        assert pdfmetrics.stringWidth(line,'Mono',font)<CW-20, 'Long code line'
        c.drawString(L+10,y-17-i*lineh,line)
    md.append(label+'\n```sql\n'+s+'\n```\n');return y-h-13

y=page(1,'从真实告警到关键优化','黑匣子网站 / D1 剧照导航 / 优化报告与部署前验收')
y=para('这次调整由真实使用反馈触发：D1 每日读取额度耗尽，线上查询曾被暂时阻止。目标是降低正常浏览照片的数据库开销，同时保留既有权限和前后切换体验。',y,'lead')
y=table(['关键结果','证据与边界'],[
 ['3–4 行 / 次','新相邻查询在三种相册规模、两种时间分布下的本地 D1 读数。'],
 ['256 项测试通过','格式、类型、文档、后端回归及生产配置 dry-run 完成。'],
 ['28 张浏览器截图','同批合成资料的前后对比、桌面/手机、首尾、单张、返回及权限。'],
 ['代码已提交','提交 '+args.commit[:7]+'；未执行生产迁移、部署或推送。'],
 ],y,[118,CW-118])
y=heading('报告导航',y)
contents=[(2,'用户反馈与线上证据'),(3,'根因：一张照片触发整册计算'),(4,'方案：沿索引找相邻照片'),(5,'数据库读取量与性能对比'),(6,'桌面端前后效果'),(7,'手机端前后效果'),(8,'切换边界与返回位置'),(9,'访问权限与完整验收'),(10,'交付、上线顺序与证据索引')]
for n,title in contents:
    c.setFont('CJK',9);c.setFillColor(ACCENT);c.drawString(L,y,f'{n:02d}  {title}');c.linkRect('', 'page'+str(n),(L,y-3,R,y+12),relative=0,thickness=0);y-=22

y=page(2,'用户反馈与线上证据','生产事实来自此前只读核验；不将本地优化数据冒充线上改善。')
y=para('用户原始反馈：“d1 报警了……看看新部署……导致免费额度用光的问题。”之后确认要把相邻照片查询改为索引定位，避免每次重新计算整个相册。',y)
y=table(['时间 / 来源','已确认的信息'],[
 ['11 月 13 日凌晨 / Gmail','每日 5,000,000 行读取额度耗尽，D1 行读取请求暂时被阻止。邮件显示重置时间为 11 月 13 日 00:00 UTC，即北京时间 08:00。'],
 ['11 月 12 日 08:00 至 13 日 08:00 / Cloudflare','数据库指标约 5.64M 行读取；Query Insights 中旧照片查询 5,688 次、约 5.83M 行读取。面板统计口径有差异，不合并成精确分母。'],
 ['最近一天 / 已保存 Query Insights','照片窗口查询占该批 Query Insights 读取量约 97%，说明主要开销集中于照片详情导航。'],
 ['源码历史','旧查询在 9 月 18 日已存在；没有证据证明它由 11 月 11 日部署新增。访问量增长来源尚未确认。'],
 ],y,[132,CW-132])
y=heading('为何属于重要优化',y)
y=para('这是已发生的服务可用性问题，而不是凭感觉做的小幅提速。旧逻辑把每次浏览的成本与相册规模绑定；连续查看或重复访问照片，都可能把这种成本放大到每日免费读取额度。',y)
y=para('本轮优先修复已经得到指标与源码共同支持的高消耗路径。没有通过付费升级、放宽权限或改写线上数据解决问题；也没有把未经证实的爬虫推测当成事故结论。',y)
y=para('告警涉及的是读取行数，不是数据库存储容量。此前数据库约 1.2MB、最近一天写入约 144 行；截至此前健康检查记录时，公开 /health 返回 200。该健康记录不能证明超限时服务正常。',y,'small')

y=page(3,'根因：一张照片触发整册计算','旧查询只返回一张照片的邻居，却先为整个已审核相册计算窗口。')
y=code('''WITH photos AS (
  SELECT id,
    LAG(id) OVER (ORDER BY created_at DESC,id DESC) previous_id,
    LEAD(id) OVER (ORDER BY created_at DESC,id DESC) next_id,
    ROW_NUMBER() OVER (ORDER BY created_at DESC,id DESC) position,
    COUNT(*) OVER () total
  FROM resource
  WHERE production_id=? AND edition_id=?
    AND status='approved' AND res_type='photo'
)
SELECT previous_id,next_id,position,total
FROM photos WHERE id=?''',y,'优化前 SQL（原实现）')
y=para('WHERE id=? 在窗口结果之外执行。数据库需要先处理同作品、同版本的照片集合，再取当前照片的上一张、下一张、序号和总数；结果只有一行，不等于只读取一行。',y)
y=heading('查询计划与计费读数共同定位',y)
old=perf['results'][0]['beforePlan'];significant=[s for s in old if 'SCAN' in s or 'TEMP B-TREE' in s][:6]
y=code('\n'.join(significant),y,'本地 EXPLAIN QUERY PLAN 节选')
y=para('本地对照实验复现了读取量随相册规模增大：100 张照片为 1,103 行，1,000 张为 11,003 行，10,000 张为 110,003 行。实验还加入同量非照片资料，因此不能把这些数值当作线上每个相册的精确开销。',y)

y=page(4,'方案：沿索引找相邻照片','在当前数据上查找，保留原来的时间倒序与 ID 倒序；不缓存权限和邻居。')
y=table(['步骤','实际处理'],[
 ['1. 当前照片','保留父作品可见性和资料权限校验，再按主键定位当前已审核照片。'],
 ['2. 同时间邻居','相同作品、版本、时间内，按 ID 范围查找最近一张；每个方向 LIMIT 1。'],
 ['3. 相邻时间','同时间没有邻居时，再沿时间索引查找上一组或下一组的最近一张。'],
 ['4. 首尾与变更','找不到即返回空值，页面显示首尾提示；审核、移动、删除后下一次请求重新定位。'],
 ],y,[106,CW-106])
y=code('''CREATE INDEX ix_resource_approved_photo_order
ON resource(production_id,edition_id,created_at DESC,id DESC)
WHERE status='approved' AND res_type='photo';''',y,'迁移 0031：仅新增部分索引')
y=heading('为何分开处理“同时间”与“相邻时间”',y)
y=para('批量上传可能产生大量相同时间记录。实测中，直接比较 (created_at,id) 的查询计划可能只按时间定位，再扫描同时间的 ID。最终方案把这两段范围拆开，明确让同时间查询使用 ID 条件；四个分支都使用索引，无全表扫描或临时排序。',y)
y=heading('产品取舍与兼容性',y)
y=para('详情移除“第几张 / 共几张”及技术文件名标题中的序号，避免为辅助数字重算整册。上一张、下一张、方向键、首尾提示，以及返回版本/分页/原照片全部保留；作品相册列表的计数与分页不变。',y)
y=para('只新增索引，不改历史迁移、记录、ID、文件键或审核状态。新增索引会增加少量存储和相关写入维护成本；该成本未做生产量化，不将读取收益描述为所有成本都下降。',y,'small')

y=page(5,'数据库读取量与性能对比','本地 D1 运行时 / 合成数据 / 18 组对照；以下仅计相邻查询，不是整个页面。')
rows=[]
for size in [100,1000,10000]:
    group=[r for r in perf['localD1'] if r['size']==size];before=group[0]['beforeRowsRead'];after=max(r['afterRowsRead'] for r in group)
    rows.append([f'{size:,}',f'{before:,}','3–4',f'{(1-after/before)*100:.3f}%'])
y=table(['照片数（张）','旧读取（行/次）','新读取（行/次）','保守降幅'],rows,y,[100,140,125,CW-365])
# Standard ReportLab vector chart, with an explicitly labelled log scale.
import math
plot_top=y-30; plot_bottom=plot_top-170; px=L+48; pw=CW-70
c.setFont('CJK',8);c.setFillColor(MUTED);c.drawString(L,y,'每次相邻查询读取行数（对数轴，行/次）')
for exp in range(6):
    yy=plot_bottom+exp/5.2*165;c.setStrokeColor(LINE);c.line(px,yy,px+pw,yy)
    c.setFont('Mono',7.5);c.setFillColor(MUTED);c.drawRightString(px-8,yy-3,str(10**exp))
for i,size in enumerate([100,1000,10000]):
    x=px+40+i*140;old=next(r['beforeRowsRead'] for r in perf['localD1'] if r['size']==size)
    for dx,val,color in [(0,old,MUTED),(37,4,ACCENT)]:
        hh=math.log10(val)/5.2*165;c.setFillColor(color);c.rect(x+dx,plot_bottom,25,hh,fill=1,stroke=0)
        c.setFont('Mono',8);c.drawCentredString(x+dx+12.5,plot_bottom+hh+5,f'{val:,}')
    c.setFont('CJK',8);c.setFillColor(INK);c.drawCentredString(x+28,plot_bottom-17,f'{size:,} 张')
c.setFont('CJK',8);c.setFillColor(MUTED);c.drawString(px,plot_bottom-38,'灰：旧窗口查询    棕：新索引查询上界 4 行    横轴：相册规模（张）')
y=plot_bottom-65
y=para('方法：三种规模 × 全同时间/十个时间组 × 三个 ID 位置，共 18 组；相邻结果全部一致，新查询写入行数均为 0。每个相册还加入与照片同量的非照片资料。降幅读数使用新查询上界 4 行计算。',y)
large=[r for r in perf['results'] if r['size']==10000]
old_times=[r['before']['medianMs'] for r in large];new_times=[r['after']['medianMs'] for r in large]
y=para(f'SQLite 耗时使用预编译语句，预热 5 次、采样 25 次。10,000 张实验中旧查询中位耗时为 {min(old_times):.2f}–{max(old_times):.2f}ms，新查询为 {min(new_times):.4f}–{max(new_times):.4f}ms。该实验为内存数据库，不代表用户网络延迟、Worker CPU 或生产账单。',y)
y=para('可复现入口：node scripts/measure-photo-navigation.mjs <任务目录>/performance.json。原始 JSON 同时保存查询计划、各样本耗时与本地 D1 读数。',y,'small')

y=page(6,'桌面端前后效果','1366×768；相同合成资料。优化前使用 Git 基线的路由、视图和 CSS，非手工仿制。')
y=shot('before-desktop-navigation-context.png',L,y,CW,245,'图 1  优化前：详情需要显示整册序号与总数，导航查询执行整册窗口计算。')
y=shot('after-desktop-navigation-context.png',L,y,CW,245,'图 2  优化后：保留左右切换，移除整册数字。图片、资料信息和权限入口保持原有流程。')
y=para('基线：'+captures['baseline'][:12]+'。仅在隔离的本地 Worker 运行旧页面相关源码，并覆盖对应旧 CSS；数据、视口和其他运行环境一致。',y,'small')

y=page(7,'手机端前后效果','390×844；减少动画模式，真实浏览器渲染。手机尺寸模拟不等于实体手机验收。')
column=(CW-22)/2
b1=shot('before-mobile-navigation-context.png',L,y,column,500,'图 3  优化前：中间数字占据导航空间。')
b2=shot('after-mobile-navigation-context.png',L+column+22,y,column,500,'图 4  优化后：左右按钮清晰，底栏未遮住导航。')
y=min(b1,b2)
y=para('触屏尺寸上下文保留；点击下一张、方向键上一张、键盘打开链接及返回作品相册均已自动操作验证。上一轮专项验证还检查了页面没有横向溢出。',y)

y=page(8,'切换边界与返回位置','首张、末张、只有一张时给出明确提示；返回链接保留演出版本、页码与原照片。')
for name,cap in [('first','图 5  首张：上一张禁用，仍可进入下一张。'),('last','图 6  末张：下一张禁用，仍可返回上一张。'),('single','图 7  单张：两侧都显示边界提示，不生成失效链接。')]:
    y=shot('after-desktop-'+name+'.png',L,y,CW,53,cap)
y=shot('after-desktop-return-gallery.png',L,y,CW,255,'图 8  返回原相册分页：保留 edition、page=2 和 photo=103，并回到对应版本的剧照区域。')
y=para('同一时间的照片按 ID 稳定排序。后台变更审核状态、移动版本、删除或修改时间之后，新请求重新定位；不会继续复用过期的相邻 ID。对应回归使用真实 SQL 与合成数据库验证。',y)

y=page(9,'访问权限与完整验收','本轮仍逐请求鉴权；减少读取开销没有扩大游客或普通账号的访问范围。')
y=table(['场景','实际结果与证据'],[
 ['游客看已审核照片','200；前后切换、首尾、返回位置正常。'],
 ['游客看待审照片','403；截图保留拒绝页面。'],
 ['游客看隐藏作品照片','404；不能发现隐藏资源。'],
 ['提交人看自己的待审照片','200，原图可载入；不加入公开相册导航。'],
 ['管理员、非本人、私有文件','由完整后端权限回归覆盖；真实生产账号流程尚未复测。'],
 ],y,[155,CW-155])
# Enlarge the top-left of the original desktop screenshot; never redraw its text.
for filename,cap in [('after-desktop-pending-denied.png','图 9  游客访问待审照片：403（原截图左上局部放大）。'),('after-desktop-hidden-denied.png','图 10  游客访问隐藏作品照片：404（原截图左上局部放大）。')]:
    img=ImageReader(str(folder/'screenshots-final'/filename));iw,ih=img.getSize()
    c.saveState();p=c.beginPath();p.rect(L,y-50,CW,50);c.clipPath(p,stroke=0,fill=0)
    scale=CW/400;c.drawImage(img,L,y-ih*scale,width=iw*scale,height=ih*scale);c.restoreState()
    c.setStrokeColor(LINE);c.rect(L,y-50,CW,50,stroke=1,fill=0)
    y=text(cap,L,y-58,CW,'small')-18;md.append(f'![{cap}](screenshots-final/{filename})\n')
y=heading('部署前检查结果',y)
y=para('npm run deploy:check 全部通过：256 项测试、格式、TypeScript、文档检查及生产配置构建 dry-run。增量迁移测试验证原记录不变、外键完整；查询计划验证无整册扫描和临时排序。',y)
y=para('补充浏览器取证：28 张截图，两种视口均通过；未发现脚本错误或 5xx。预期的 403/404 已独立断言。初期取证文件名拼接问题已修正，失败资料保留在诊断目录，没有把失败轮次写成成功。',y,'small')

y=page(10,'交付、上线顺序与证据索引','源码与本地效果已验证；生产改善必须在迁移和部署之后再核实。')
y=table(['交付项','位置 / 状态'],[
 ['核心实现','src/services/resource-queries.ts；src/routes/resources.ts；新增 migrations/0031_photo_neighbors.sql。'],
 ['界面调整','src/views/resources.ts、public/app.css。取消详情整册计数，保留导航及返回语义。'],
 ['可复现验证','scripts/backend/photo-navigation.test.mjs；measure-photo-navigation.mjs；check-photo-navigation.mjs；capture-photo-optimization.mjs。'],
 ['代码提交',args.commit],
 ['报告与证据','本 PDF、同名 Markdown、performance.json、deploy-check.log、screenshots-final/、PDF 渲染与检查记录。'],
 ],y,[105,CW-105])
y=heading('上线与回退',y)
y=para('后续获得上线授权后：完整 D1/R2 备份并核验 → 应用 0031 增量索引 → 部署 Worker → 公开冒烟及相关角色复核 → 用 Query Insights 对照读取量、请求量与错误。不能拿本地数据库覆盖线上。',y)
y=para('只回退 Worker 代码仍兼容保留的新索引，不需要删除数据或回改历史迁移；但旧窗口查询的高读取成本会随代码回退恢复。索引写入和存储成本、真实流量下的日额度余量仍待量化。',y)
y=heading('证据来源与保留方式',y)
y=para('生产告警和 Query Insights：此前归档 2026-11-15-d1-usage，保留规范化查询统计与验收说明。报告不嵌入带账号信息的 Gmail/Cloudflare 后台页面。截图均为本地实际运行页面，统计图由实测 JSON 生成。',y,'small')
y=para('重要报告按仓库约定生成 SHA-256 清单和仓库外 ZIP，并登记 scripts/document-archives.json。PDF 与截图位于被 Git 忽略的 artifacts，Git 保存源码、报告生成工具及归档定位；异机副本尚未核验。',y,'small')
for title,url in [('Cloudflare D1 读取计费','https://developers.cloudflare.com/d1/platform/pricing/'),('SQLite 部分索引','https://www.sqlite.org/partialindex.html'),('SQLite 行值比较','https://www.sqlite.org/rowvalue.html')]:
    y=text(f'<link href="{url}" color="#763b35">{escape(title)}：{url}</link>',L,y,CW,'small',True)-7
    md.append(f'[{title}]({url})\n')
c.save()
(folder/'黑匣子_D1剧照导航优化报告.md').write_text('\n'.join(md),encoding='utf-8')
(folder/'report-build.json').write_text(json.dumps({'pdf':out.name,'pages':pages,'codeCommit':args.commit,'baseline':captures['baseline'],'screenshots':len(captures['screenshots']),'backendTests':256,'productionDeployed':False},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(out)
