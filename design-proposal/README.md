# design-proposal — 黑匣子剧场 · 节目单（美术与动效改造方向稿）

针对现有站点的**整站美术与动效改造提案**：保持信息架构与功能不变，
把已有的「剧场 / 幕次」概念做彻底，形成一套可分阶段移植的设计系统。

- 纯静态 demo（无框架、无构建、无新依赖），不影响任何现有页面与部署
- 全部内容抓取自线上真实数据（剧目、队员、花数、资料、公告、联系方式、剧照）
- 所有链接指向站内真实路由，可直接当高保真原型点击走查

## 怎么预览

```powershell
cd design-proposal
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

直接双击 `index.html` 也可以（若字体未加载就用上面的方式）。

## 页面对照

| 文件 | 对应现有页面 | 说明 |
|---|---|---|
| `index.html` | `src/views/home.ts` 首页 | 三幕：01 入场 / 02 剧团 / 03 曲目单 |
| `productions.html` | `/productions` + `/resources` | 一戏一档列表 + 资料库 |
| `production.html` | `/productions/991008` | 《大国之蓝》：三个世代 · 演职员档案 |
| `members.html` | `/members` | 队员名录 · 年级筛选 · 送花数 |
| `member.html?id=…` | `/members/:id` | 个人档案 · 舞台经历 · 送花 |
| `help.html` | `/help` | 六步使用指南 · 公测须知 · 谢幕名单 |
| `auth.html` | `/login` | 「检票入场」票根式登录（演示，不含真实逻辑） |

## 设计系统（tokens 见 `assets/styles.css` 顶部 `:root`）

| Token | 值 | 用途 |
|---|---|---|
| `--ground` | `#0f0d0a` 暖炭黑 | 台面（不是纯黑，像剧场熄灯后的空气） |
| `--type` | `#f3ead8` 节目单米白 | 主文字 |
| `--spot` | `#ffb54d` 钨丝灯橙 | **唯一信号色**：聚光灯 / CTA / 激活态 |
| `--live` | `#c8442e` 帘幕红 | 只作「正在上演」语义点，非装饰 |
| `--paper` | `#f3ead8` | 纸卡（招新节目单 / 测试须知 / 入场券） |
| 圆角 | 仅 4px / 2px 两档 | 节目单纸感，收敛现有 8+ 种圆角 |

字体：思源宋体 900（已含本地 woff2）做 Display；正文系统黑体。
Display 字号同时受 vw 与 vh 约束（`min(11.5vw, 18.5vh)`），
**矮窗口 / 笔记本高 DPI 不缩放也能一屏看全**（1366×640 实测首屏正好放下）。

## 动效系统：「开演三拍」

1. **冷开场亮灯**：背景由暗到亮，标题逐行升起，ON STAGE 卡随后亮起（仅首屏一次）
2. **入幕点亮**：滚动进入哪一幕，哪一幕的元素按 `--i` 依次亮起（IntersectionObserver，一次性）
3. **聚光呼吸**：标题后方聚光锥缓慢呼吸 —— 全页唯一常驻动效

交互词汇统一为 **hover 即打灯**（曲目行 / 队员卡 / 封面亮度提升 + 标题点亮），
另有台口进度线（`animation-timeline`，Firefox 自动降级）、live 红点脉冲、
送花花瓣飘升。`prefers-reduced-motion` 下全部退化为完整静态页（无内容被隐藏）。

## 移植回主站的建议路径

按投入从小到大分三步，每一步独立可用：

**第一步 · 主题预设（约 10 行）**
`src/services/theme.ts` 的单 accent 派生机制保留，新增一个「剧场」预设：
accent 取钨丝橙 `#b3541e`（按钮 / 激活态自动派生），并允许管理员选择
暗色台面（`--stage` 已有，补一段 `--ground/--type/--paper` 映射即可）。

**第二步 · 字体与首页（一次 PR）**
- 自托管 woff2 子集：`public/fonts/`（当前 1.4MB 全量子集可按站内实际
  字符压到约 200KB）+ `<link rel="preload">`；标题字体栈改为
  `"Noto Serif SC", Georgia, "Songti SC", "SimSun", serif`
- `src/views/home.ts` 按 `design-proposal/index.html` 的三幕结构平移；
  `public/experience.css` 中剧场壳段落替换为 `styles.css` 对应块
  （变量名对齐后可逐段替换，hover 从 blur 改为「打灯」）

**第三步 · 内页组件（可分多次 PR）**
- 队员卡：描边宋体姓氏占位替代高饱和蓝卡，hover 滑出介绍保留
- 曲目单行式列表（`productions` 视图）、票根式登录卡（`auth` 视图）、
  纸质「测试须知」弹窗皮肤
- 送花微动效做成全局组件（`public/app.js`）

## 文件

```
index.html productions.html production.html
members.html member.html help.html auth.html     七个页面
assets/styles.css         共享设计系统（tokens / 组件 / 动效 / 断点）
assets/app.js             共享交互（入幕点亮 / 幕次导航 / 名录渲染 / 送花）
assets/data.js            站点数据（抓取自线上，仅 demo 使用）
assets/NotoSerifSC-900.woff2  思源宋体 900
assets/*.jpg / *.webp / av/*.jpg   站内已有图片资产
```
