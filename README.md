# 黑匣子话剧队网站（Cloudflare 版）

校园戏剧社团的资料库网站。访客可以找作品、演出版本、演职人员和已公开的照片剧本；登录成员可以补充资料；管理员负责审核和整理档案。

仓库里有网站的全部代码、数据库变更和维护文档。网站跑在 Cloudflare 上。

**按角色阅读：**

- **社团负责人 / 想了解网站的人**：读完下面「这个网站做什么」就够了，其余章节可以跳过。
- **接手维护的开发者**：读完本文件后，按 [文档导航](#文档导航) 继续。日常开发看「跑起来」，上线看「发布」。

---

## 这个网站做什么

网站保存三类东西，彼此有简单的关联：

- **作品**：一部剧。一部作品可以有多个**演出版本**（不同年份的演出各算一条）。
- **成员与演职**：每个版本记录谁参与、担任什么角色或职务。
- **资源**：照片、剧本、音频等文件，挂在作品或版本下面。

这样查一部剧时，页面能把「哪次演出、谁参与、有哪些资料」放在一起，不会把不同年份的演出混成一条记录。

网站要保证三件事：

1. 公开的资料容易找到。
2. 新资料经过合适的审核再公开。
3. 每份资料和文件的归属清楚，维护者能找到。

### 谁能做什么

| 角色 | 能做什么 |
| --- | --- |
| 访客（未登录） | 浏览公开作品、队员档案、已批准资源的预览；匿名献花、提建议 |
| 登录成员 | 上传资料（通常要审核）、下载文件、申请建档、申请加入作品 |
| 管理员 | 审核、管理隐藏作品、批量导入演职记录、管理页面内容 |
| 管理后台 | 独立入口 `admin.npublackbox.online`，只有管理员能进 |

**一条重要规则：文件传上去不等于公开。** 资源要审核通过、且所属作品可见，访客才看得到。

---

## 简明架构

主站和后台是**同一个 Cloudflare Worker**（可以理解为网站的服务器程序），不是两套系统：

```
                          ┌────────────────────────────┐
  npublackbox.online ───► │                            │
                          │   Cloudflare Worker        │
  admin.npublackbox. ───► │   （处理全部动态请求）      │
       online             │                            │
                          └───┬─────────┬─────────┬────┘
                              │         │         │
                              ▼         ▼         ▼
                            D1         R2     Static Assets
                          资料库     文件仓库   public/ 静态文件
                        （说明、    （照片、    （脚本、样式、
                        权限、审核） 剧本、音频）  图片、字体）
```

- **D1（数据库）**：保存作品、成员、文件说明、审核状态。所有「能不能看」的判断都在这里。
- **R2（对象存储）**：只保存文件内容本身，不做权限判断。
- **Static Assets**：`public/` 目录的脚本、样式、图片，直接返回，不走业务逻辑。
- **定时任务**：每小时第 17 分钟运行，清理过期上传和临时记录。

每个请求的处理顺序都是：**先查资料和权限，再取文件或生成页面。**

---

## 跑起来（本地开发）

需要 Node.js 24 或更新版本。

```bash
npm install
npm run db:init    # 建立本地数据库
npm run dev        # 启动本地网站
```

本地使用独立的数据库和文件存储，和线上互不影响。本地能跑不代表线上配置正确。

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | 类型检查 |
| `npm run test:backend` | 后端测试 |
| `npm run deploy:check` | 发布前全套检查（不会发布） |
| `npm run format` | 格式化代码 |

---

## 发布

**`git push` 不会自动上线。** 发布要主动执行，顺序是：

```bash
npm run deploy:check              # 1. 检查（不发布）
npm run db:production:backup      # 2. 备份生产数据库
npm run db:production:migrate     # 3. 应用数据库迁移（如有）
npm run deploy                    # 4. 发布
npm run smoke:production          # 5. 冒烟检查
```

冒烟检查只验证公开页面能打开，**不能代替人工验收**（登录、上传、审核、导入都要实际点一遍）。

详细步骤、每步检查什么、失败了怎么办，见 [docs/本地验收指南.md](docs/本地验收指南.md)。

---

## 需要留意的事

- **备份不完整**：现有备份只含数据库，不含 R2 文件。只靠备份恢复不了完整网站，需要另行安排文件备份。
- **视频上传已关闭**。照片 20 MB、剧本 50 MB、其他 100 MB 以内。
- **数据库和文件无法一起回滚**：上传中途失败会留下待清理文件，靠定时任务重试删除。
- **自动审核规则**的业务依据没有完整记录，修改前先和负责内容审核的人确认。
- 线上状态、验收历史、待补事项见 [docs/验证记录.md](docs/验证记录.md)。

---

## 文档导航

| 文档 | 内容 | 适合谁 |
| --- | --- | --- |
| [docs/architecture.md](docs/architecture.md) | 详细架构：请求流程、数据关系、上传/审核/导入流程图 | 想深入理解系统的开发者 |
| [docs/本地验收指南.md](docs/本地验收指南.md) | 发布步骤详解、每步验收点、回滚与恢复 | 做发布和验收的人 |
| [docs/验证记录.md](docs/验证记录.md) | 已验证的事实、未验证的事项 | 想知道「现在什么状态」的人 |
| [docs/faq.md](docs/faq.md) | 常见问题与故障排查 | 遇到问题的人 |
| [docs/glossary.md](docs/glossary.md) | 术语表（D1、R2、Worker、迁移……） | 不熟悉 Cloudflare 名词的人 |
| [docs/project-structure.md](docs/project-structure.md) | 目录结构树（每个文件夹干什么） | 找代码在哪的人 |
| [docs/design-language.md](docs/design-language.md) | 设计语言 | 改界面的人 |
| [docs/layout-book.md](docs/layout-book.md) | v3.6 首页、队员与放映画廊排版及滚动切换 | 改界面的人 |
| [docs/admin-page-organization.md](docs/admin-page-organization.md) | 后台页面组织 | 改后台的人 |
| [docs/workbench-refactor.md](docs/workbench-refactor.md) | 工作台重构记录 | 改后台工作台的人 |
| [docs/system-info-visualization.md](docs/system-info-visualization.md) | 系统信息可视化 | 改系统信息页的人 |

## 阅读顺序建议（新接手的开发者）

历史静态设计演示已收在 [docs/archive](docs/archive/README.md)，不参与构建或部署；现行源字体维护说明见 [assets/fonts](assets/fonts/README.md)。文件保留与整理依据见 [docs/file-cleanup.md](docs/file-cleanup.md)。

1. 本文件 —— 知道网站是干什么的。
2. [docs/glossary.md](docs/glossary.md) —— 搞清名词（如果 Cloudflare 熟可以跳过）。
3. [docs/architecture.md](docs/architecture.md) —— 理解请求怎么走、数据怎么存。
4. [docs/project-structure.md](docs/project-structure.md) —— 知道代码在哪。
5. [docs/本地验收指南.md](docs/本地验收指南.md) —— 上线前再读。
