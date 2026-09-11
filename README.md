# 黑匣子网站

面向话剧队内部使用的资料与档案网站，已在 Cloudflare 内部试运行。网站采用 TypeScript + Hono 单 Worker，D1 保存数据，R2 保存照片、剧本和音频；视频上传暂不开放。

> 发布状态（2026-09-11）：前后端优化已联合上线，生产迁移 0009–0012 完成，38 项回归及 9 项线上冒烟通过。验收步骤见 docs/本地验收指南.md。

## 文件从哪里看起

```text
src/             正式 TypeScript 网站代码
public/          CSS、图片等静态文件
migrations/      D1 数据库结构
scripts/backend/ 后端业务与 Cloudflare 本地运行时测试
scripts/data/    数据迁移与兼容升级验证
docs/            当前有效的需求、计划和验收说明
legacy-python/   原 Flask 网站参考副本，不参与新站运行
test-fixtures/   仅限本地的虚拟测试数据
wrangler.jsonc   Cloudflare 配置入口
package.json     本地开发命令
```

日常开发主要看 `src/`。Cloudflare 只运行 `src/index.ts` 并读取 `public/`，不会运行 `legacy-python/`。

## 本地启动

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:init
npm run dev
```

看到 `Ready on http://127.0.0.1:8787` 后，在浏览器打开该地址。详细点击检查见 [本地验收指南](docs/本地验收指南.md)。

## 当前状态

本地功能迁移已经覆盖账号、队员、作品建档申请、多人角色与 AB 角、公告、页面文案、意见箱、资料审核与预览、批量剧照、按作品组织的资料库、R2 分片与断点续传、受控下载、头像、作品封面、首页背景和分级操作指南。旧 MySQL 导出、D1 转换、一次性内存导入验证和 R2 文件迁移工具也已完成。

正式域名为 https://npublackbox.online 。本轮后端可靠性与前端公测优化已部署，包括审核历史、上传恢复、9GB 容量预留、文件清理和游客浏览。生产已执行 0009–0012，见 [架构与部署](docs/架构与部署.md)。邮件验证和密码找回仍未开放。

本地使用 Node.js 24 或更新版本。npm run test:backend 执行 30 项隔离测试；npm run deploy:check 还会检查格式、类型、数据转换与打包，该命令不会发布网站。

- [后端优化方案与完成状态](docs/后端优化方案.md)

- [迁移计划](docs/迁移计划.md)
- [产品与权限规则](docs/产品与权限规则.md)
- [架构与部署](docs/架构与部署.md)
- [验证记录](docs/验证记录.md)
- [本地验收指南](docs/本地验收指南.md)
