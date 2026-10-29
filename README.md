# 黑匣子话剧队网站

保存作品、演出版本、队员与资料的校园戏剧档案库。主站与独立管理员后台共用一个 Cloudflare Worker、D1 数据库和 R2 文件存储。

- 队员：[图文使用手册](docs/handbooks/黑匣子话剧队网站使用手册.pdf)。
- 维护者：[开发维护](docs/开发维护.md)、[发布与恢复](docs/发布与恢复.md)。
- 协作与资料归属：[AGENTS.md](AGENTS.md)。

本地启动：使用 Node.js 24 或更新版本，首次执行 `npm install`，随后 `npm run dev`。提交前运行 `npm run docs:check`；完整代码检查为 `npm run deploy:check`（不发布）。

历史方案、日志和截图统一在本机 artifacts，归档定位与校验见 [资料索引](scripts/document-archives.json)。推送 Git 与部署网站分别授权，不能用本地整库覆盖线上数据。

## 当前状态与历史资料

最近有记录的业务上线为 2026-10-27 个人档案功能；队员手册恢复与文档整理已推送 Git，尚未发布网站。具体证据留在本机任务归档，不在 README 累积日志。

本机 `artifacts/README.md` 是过程资料索引：`working/` 存放进行中任务，`archive/` 按文档、界面、发布、仓库维护分类保存历史。克隆 Git 不会带回这些本机资料；仓库外压缩包的位置和 SHA-256 见 [归档索引](scripts/document-archives.json)。
