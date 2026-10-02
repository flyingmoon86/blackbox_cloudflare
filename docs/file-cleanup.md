# Cloudflare 文件整理记录

日期：2026-10-02。开始时 Git 工作区干净，基线提交 `46064af`。本次只整理文件归属及相关路径，不改页面、业务、权限、数据库或发布流程。

## 检查范围与依据

- 核对 Git 跟踪文件、顶层目录、README、目录说明、npm 脚本、TypeScript 配置、Wrangler 配置、资源打包清单、字体生成脚本、测试夹具与维护脚本。
- 搜索代码、脚本和文档中的候选路径引用；检查旧设计 HTML、CSS、共享脚本与数据，确认其为独立的静态演示。
- 检查本地忽略目录的用途与文档生成脚本，不将 Git 忽略等同于可以删除。
- `final` 迁移主计划已在相邻独立项目 `../final/final计划.md` 中；本仓库没有其副本。该项目与其他相邻项目均未改动。

## 移动及引用修复

- `design-proposal/assets/NotoSerifSC-900.woff2` → `assets/fonts/NotoSerifSC-900.woff2`：仍是现行标题字体生成输入，单独保留。更新 `scripts/build-display-font.py` 输入路径；版权声明和 OFL 许可证仍在 `public/fonts/`。
- 原 `design-proposal/` 其余 20 个文件 → `docs/archive/design-proposal/`：7 个 HTML、3 个 JS/CSS、10 张图片完整归档。调整归档 CSS 的字体相对路径，其他内部引用保留。
- 更新 README、目录结构说明，新增归档及字体维护说明。归档与源字体均在 `public/` 之外，不增加线上发布资源。

## 保留及原因

- `src/`、`public/`、全部 19 份 `migrations/`、npm 依赖及构建部署配置：运行、构建、升级需要。
- `templates/` 两版 Excel：v2 是生成下载模板的输入；v1 仍被 `scripts/backend/credit-import.test.mjs` 用于兼容性测试。
- `scripts/`、`test-fixtures/`、`config/r2-cors.json`：构建、维护、测试、数据检查与 CORS 示例；手动浏览器检查和幕布参考采集脚本保留，未将其当成无人使用的垃圾文件。
- `.agents/`、`.opencode/`、`opencode.json`：配置明确加载这两套开发技能，属于现有开发工具。
- 根目录两份《黑匣子 Cloudflare 网站技术归档》：仍被 `migration-work/build_archive.py`、`build_archive_pdf.py`、`qa_archive.py` 生成或读取，保留原位置以维持本地归档流程。
- `.wrangler/`、`.dev.vars`、环境文件、`migration-work/`、`artifacts/`、`outputs/`：涉及本地数据库和对象存储、备份、迁移媒体、交接数据、验证证据或本地诊断工作；均未清空、迁移或覆盖。此次校验报告另存于 `artifacts/file-cleanup/`。
- `public/assets/` 的旧哈希资源：构建脚本明确为已打开的旧页面保留，不能按“旧文件”清理。`src/generated/` 和 `public/system-scene.js` 是正常构建产物。
- 现有文档、发布记录及截图：维护依据与历史证据，保留。

## 删除

无永久删除。Git 中旧路径的删除对应上述归档与字体移动，并非内容丢弃。对没有足够证据证明可安全删除的文件保持原状。

## 验证

- `npm run deploy:check` 通过：资源构建、Prettier、TypeScript、122/122 项自动化测试及生产配置 dry-run 构建；没有实际部署。
- 移动前后 20 个文件 SHA-256 完全一致（含源字体）；剩余 1 个 CSS 经逐字比较，仅字体 URL 改动。
- 检查归档 HTML、数据图片、CSS 字体，以及 README 和新增说明中的 135 处本地链接，无缺失目标。
- 字体脚本通过 Python AST 语法检查，解析得到的新输入路径存在。未重新生成字体子集，现有线上字体资源不变。
- `src/`、`public/`、`migrations/`、`package.json`、锁文件和 `wrangler.jsonc` 的 Git 差异为空。
- 校验日志：本地忽略目录 `artifacts/file-cleanup/deploy-check.log`、`path-check.json`、`design-before.json`。

本次不提交、不部署，不运行数据库初始化、迁移、导入或远程数据修改命令。没有需要用户决定的重大归属问题；本地诊断输出和历史资料是否长期保留，不作未经确认的永久清理。
