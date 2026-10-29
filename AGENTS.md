# 仓库维护约定

适用于整个 Cloudflare 仓库。先读根目录 README.md；用户最新指示优先。

## 文档与资料

- 长期指导只维护 根目录 README.md、docs/开发维护.md、docs/发布与恢复.md；队员成品在 docs/handbooks/。常规更新直接修订已有章节，不另建功能说明、交接总计划、发布长文或逐日验证记录。
- 每条规则只保留一处权威说明。README 只给简介、启动与入口；开发文档写方法和稳定约束，不写完整目录树、文件总数、测试总数等易变快照。
- 可重复执行的工具放 scripts/；运行日志、截图、旧方案、验收/发布证据和中间文件放 artifacts/working/任务名/（新任务建议日期前缀），完成后移入 artifacts/archive/{documents,interface,releases,repository}/任务名/。artifacts 顶层只保留 README.md、working/、archive/，移动归档后同步资料索引；禁止新建 output/、outputs/ 或 docs/evidence、docs/reviews、docs/releases、docs/archive。
- artifacts/ 被 Git 忽略，不等于已备份或可以删除。归档重要资料时先生成文件清单与 SHA-256，再用 scripts/preserve-artifacts.py 创建并逐项验证仓库外 ZIP；Git 索引 scripts/document-archives.json 记录定位与校验信息。尚未有异机副本必须明确说明，不能宣称具备灾难恢复能力。
- 历史材料移动前先备份；不永久删除唯一副本。不读取/提交密钥、旧密码、真实账号、数据库或私有上传。真实数据备份仍由网站备份工具管理，不能混进文档归档。
- 手册要保留操作截图、短步骤、封面和可点击目录。正文唯一来源 src/content/member-handbook.ts；截图为合成资料，成品只输出 docs/handbooks/。
- 交付前执行 npm run docs:check；代码另跑相关检查。验证记录放任务 artifacts，最终回复区分源码、本地测试、实际渲染和生产事实。

## 业务与发布

- 当前规则见 docs/开发维护.md；代码冲突时以当前实现为准，不从历史材料恢复已废弃规则。
- 保留现有数据、已执行迁移、历史文件及上传任务；不以本地整库覆盖线上。私有文件必须先授权，再处理 HEAD/Range/304。
- 默认本地开发。提交/推送与部署分别授权；推送 Git 不代表可以部署。每次按当前会话的授权判断，不将历史推送授权自动延续到新任务。
