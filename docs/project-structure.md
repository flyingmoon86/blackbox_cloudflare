# 项目目录结构说明

> 黑匣子话剧队 Cloudflare 网站（校园戏剧社团资料库）。
> 技术栈：Cloudflare Worker（Hono）+ D1 数据库 + R2 对象存储 + Static Assets。
> 本文按目录树说明每个文件夹的用途，方便快速定位「东西放在哪」。

## 总览

```
blackbox-drama-archive/cloudflare
├── src/                  网站主程序（Worker 源码）
├── migrations/           D1 数据库结构迁移（编号 SQL）
├── public/               静态资源（脚本/样式/图片/字体）
├── scripts/              构建、部署、测试脚本
├── templates/            演职记录批量导入 Excel 模板
├── config/               环境配置文件（R2 CORS 等）
├── test-fixtures/        测试数据夹具
├── docs/                 维护文档与截图
├── assets/fonts/         离线字体生成使用的源字体（不直接发布）
├── migration-work/       迁移交接工作区（备份/发布/线上同步）
├── outputs/              临时输出与诊断脚本
├── .agents/              项目专用 Agent 技能
├── .opencode/            opencode 界面/设计类技能
├── .wrangler/            Wrangler 本地开发缓存（勿手改）
├── node_modules/         npm 依赖
├── README.md             项目入门（先读这个）：做什么、简明架构、跑起来、发布
├── wrangler.jsonc        Worker / D1 / R2 绑定与部署配置
├── package.json          npm 脚本入口（dev / deploy / 测试等）
├── tsconfig.json         TypeScript 配置
├── .dev.vars             本地密钥（勿提交）
└── .dev.vars.example     密钥模板（说明需要哪些变量）
```

## 详细结构

### `src/` — 网站主程序

```
src/
├── index.ts              Worker 入口，装配路由/中间件/定时任务
├── types.ts              全局类型定义
├── views.ts              视图层汇总
├── routes/               页面与接口的路由处理
│   ├── home.ts           首页
│   ├── productions.ts    作品与演出版本
│   ├── content.ts        内容/资源页
│   ├── resources.ts      资源浏览与下载
│   ├── members.ts        成员页
│   ├── community.ts      社区/公开投稿
│   ├── suggestions.ts    意见反馈
│   ├── uploads.ts        上传流程
│   ├── credit-import.ts  演职记录批量导入
│   ├── auth.ts           注册/登录/登出
│   ├── admin.ts          管理后台
│   ├── operations.ts     运维/系统信息
│   └── help.ts           帮助页
├── services/             业务逻辑层
│   ├── credit-import/    演职导入：parser 解析 / schema 校验 / store 暂存 / commit 提交
│   ├── uploads.ts        上传任务、分片合并
│   ├── upload-policy.ts  上传规则（大小/类型/并发）
│   ├── reviews.ts        审核流程
│   ├── avatars.ts        头像处理
│   ├── image-picker.ts   图片选择
│   ├── resource-files.ts 资源文件管理
│   ├── edge-cache.ts     边缘缓存
│   ├── file-cleanup.ts   失败/过期文件清理
│   ├── production-visibility.ts  作品可见性
│   ├── site-profile.ts   站点资料
│   ├── system-info.ts    系统信息
│   ├── theme.ts          主题/外观
│   ├── turnstile.ts      Turnstile 人机验证
│   ├── visitors.ts       访客统计
│   └── admin-portal.ts   后台入口逻辑
├── views/                服务端 HTML 页面模板
│   ├── home.ts / productions.ts / resources.ts ...  各页面渲染
│   ├── admin.ts / admin-navigation.ts               后台页面
│   ├── backstage.ts / edition-choice.ts             演出版本相关
│   ├── credit-import.ts / resource-preview.ts       导入与预览
│   └── assets.ts                                  页面资源引用
├── middleware/           中间件（主站与后台共用）
│   ├── session.ts        登录会话检查
│   ├── security.ts       安全头 / CSP / 嵌入限制
│   ├── request-limits.ts 限流
│   ├── errors.ts         错误处理
│   ├── admin-portal.ts   后台域名管理员门禁
│   └── review-response.ts 审核响应
├── auth/                 身份基础
│   ├── password.ts       scrypt 密码存取与历史格式兼容
│   └── session.ts        签名会话 Cookie
├── storage/              R2 对象存储
│   ├── r2-s3.ts          R2 读写（含直传支持）
│   └── cleanup.ts        存储清理
├── http/                 HTTP 工具
│   ├── cookies.ts        Cookie 处理
│   └── validation.ts     入参校验
└── generated/            构建生成产物
    ├── assets.ts         静态资源清单（带哈希）
    └── credit-template.ts 导入模板相关
```

### `migrations/` — 数据库迁移

```
migrations/
├── 0001_core.sql                     基础表：账号/成员/作品/版本/资源
├── 0002_upload_resume.sql            上传断点续传
├── 0003_feedback_and_production_join.sql  反馈与作品关联
├── 0004_suggestion_categories.sql    意见分类
├── 0005_resource_previews.sql        资源预览
├── 0006_multiple_production_roles.sql 多演职身份
├── 0007_admin_notification_reads.sql 管理员通知已读
├── 0008_page_background.sql          页面背景
├── 0009_review_integrity.sql         审核完整性
├── 0010_upload_integrity.sql         上传完整性
├── 0011_request_limits.sql           限流记录
├── 0012_public_contributions.sql     公开投稿
├── 0013_presentation.sql             展示字段
├── 0014_password_change.sql          改密流程
├── 0015_production_editions.sql      演出版本
├── 0016_required_resource_editions.sql 资源必选版本
├── 0017_edition_backstage.sql        版本后台
├── 0018_production_visibility.sql    作品可见性
└── 0019_credit_imports.sql           演职导入（最新，共 19 个）
```

> 发布顺序：先备份生产 D1 → `db:production:migrate` 应用未执行的迁移 → 部署 Worker。
> 本地迁移不会自动作用于生产环境。

### `public/` — 静态资源（Static Assets 直接返回）

```
public/
├── assets/    构建生成的带哈希资源；保留旧版本供已打开的页面加载
├── fonts/     字体文件
└── images/    站点图片
```

### `scripts/` — 脚本

```
scripts/
├── build-assets.mjs              静态资源打包（生成 src/generated）
├── build-display-font.py         展示字体生成
├── predeploy.mjs                 部署前检查（格式/类型/测试/构建）
├── wrangler.mjs                  wrangler 封装
├── check-*-browser.mjs           各页面浏览器验收脚本（幕布/时间线/版本/可见性等）
├── inspect-curtain-reference.mjs 参考页面抓取
├── backend/                      后端自动化测试
│   ├── harness.mjs               测试框架/夹具
│   ├── *.test.mjs                各模块测试（auth / uploads / reviews / public …）
│   └── *-fixture.mjs             测试数据构造
└── data/                         数据与发布脚本
    ├── prepare-local-release.mjs 本地发布准备
    ├── review-preflight.sql      上线前 SQL 预检
    └── verify-backend-upgrade.mjs 升级校验
```

### `migration-work/` — 迁移交接工作区

```
migration-work/
├── backups/            生产 D1 历史备份 SQL（⚠ 不含 R2 文件）
├── production-sync/    与线上环境同步/核验：Cloudflare API 脚本、部署清单、状态 JSON
│   └── state/          同步过程状态
├── release/            某次发布清单：文件列表、对象 key、导入 SQL
│   └── files/          发布文件
├── admin-handover/     管理员交接（create-admins.sql 建号脚本）
├── site-images/        站点图片迁移（图片 + manifest + apply.sql）
├── docx-render/        归档文档（docx/pdf）渲染校对截图
├── build_archive.py    生成归档文档（docx）
├── build_archive_pdf.py 生成归档 PDF
├── qa_archive.py       归档文档质量检查
└── *.png / *.pdf       校对稿与截图
```

### `docs/` — 文档

```
docs/
├── architecture.md                 详细架构：请求流程、数据关系、上传/审核/导入流程图
├── 本地验收指南.md                 发布步骤详解、验收点、回滚与恢复
├── 验证记录.md                     已验证事实、线上状态、未验证事项
├── faq.md                          常见问题与故障排查
├── glossary.md                     术语表（Cloudflare 与业务名词）
├── admin-page-organization.md      后台页面组织说明
├── design-language.md              设计语言
├── system-info-visualization.md    系统信息可视化
├── workbench-refactor.md           工作台重构记录
├── project-structure.md            本文
├── file-cleanup.md                 文件整理依据与验证记录
├── archive/                       历史设计稿（不参与部署）
├── releases/                      发布记录与公告草稿
└── screenshots/                    文档配图
```

### 其他目录

```
assets/fonts/           现行展示字体源文件、生成说明与许可证入口

docs/archive/design-proposal/  历史静态设计演示
├── assets/
│   └── av/             演示用头像图片（历史公开数据快照）

templates/              演职记录批量导入 Excel 模板
├── production-credit-import-v1.xlsx
└── production-credit-import-v2.xlsx

config/                 环境配置
└── r2-cors.json        R2 跨域规则

test-fixtures/          测试夹具
└── local-user.sql      本地测试用户

outputs/                临时输出/诊断
├── check-curtain-live.mjs
└── diagnose-curtain.mjs

.agents/skills/         项目专用技能（blackbox-optimize / blackbox-writeflow /
                        blackbox-evidence / blackbox-fastpath）

.opencode/skills/       opencode 界面技能（better-colors / better-typography /
                        interface-review / break / variant 等）

.wrangler/              Wrangler 本地缓存与临时产物（本地 D1/R2 模拟、dry-run、
                        排查截图/日志）—— 生成物，勿手改勿提交

node_modules/           npm 依赖包
```

## 快速定位

| 想做什么 | 去哪里 |
| --- | --- |
| 理解网站整体怎么运行 | `README.md` → `docs/architecture.md` |
| 改某个页面/接口 | `src/routes/` + `src/views/` |
| 改业务规则（审核/上传/权限） | `src/services/` |
| 改数据库结构 | `migrations/`（新增编号 SQL） |
| 改样式/脚本/图片 | `public/` |
| 跑测试 | `scripts/backend/`（`npm run test:backend`） |
| 部署上线 | `docs/本地验收指南.md` |
| 找生产备份 | `migration-work/backups/` |
| 看维护文档 | `docs/` |
