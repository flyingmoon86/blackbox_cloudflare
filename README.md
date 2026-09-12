# 黑匣子网站 · Version 1.0

话剧队作品、队员和资料档案网站，正式地址：[npublackbox.online](https://npublackbox.online/)。

**状态（2026-09-12）：**本轮页面精简已发布到 Cloudflare，正式数据库已执行迁移 0001—0013（含作品颜色、头像展示图、资料索引）。42 项本地回归、构建检查与 9 项线上冒烟通过，部署前后数据数量一致。视频上传、邮箱自助找回继续关闭。实际版本及核对结果见验证记录。

## 新手从这里开始

```powershell
npm ci
# 仅首次且没有 .dev.vars 时复制；已有配置不要覆盖
Copy-Item .dev.vars.example .dev.vars
npm run db:init
npm run dev
```

使用 Node.js 24 或更新版本。看到 Ready 后打开 http://127.0.0.1:8787 。`db:init` 只升级本机 D1，保留原数据；不要用删数据库解决迁移冲突。首次管理员与合成数据导入步骤见 [本地验收指南](docs/本地验收指南.md)。

如果 Cloudflare 登录失效，执行 `node scripts/wrangler.mjs login`。该入口会在子进程中修正形如 Markdown 链接的代理值；直接 `npx wrangler` 可能再次遇到 Invalid URL。无需把代理密码或密钥贴到聊天里。

## 文件结构

```text
src/
  index.ts           单 Worker 入口
  routes/            URL、输入、权限和响应
  services/          审核、上传、容量、清理、文件响应、主题
  views/             服务端 HTML 与共享组件
  auth/              密码哈希、签名会话
  middleware/        会话、限流、安全头、错误处理
  storage/           R2 适配与过期上传清理
public/              CSS、浏览器脚本、小象静态图
migrations/          只追加的 D1 迁移
scripts/backend/     合成数据和真实 workerd/D1/R2 测试
scripts/data/        旧站数据转换、兼容验证工具
.agents/skills/blackbox-optimize/SKILL.md  唯一网站优化规则入口
docs/                本地验收指南、验证记录
legacy-python/       原 Python 网站完整对照，不参与运行
```

`public/assets/` 和 `src/generated/` 是自动生成的指纹资源，不手改；`node_modules/`、`.wrangler/`、`migration-work/` 是依赖、本地状态和私有中间文件，不进 Git。用户放入的 `image/` 原素材不自动上传或加入提交。

后续可直接说“按网站优化 Skill 优化……”。[网站优化 Skill](.agents/skills/blackbox-optimize/SKILL.md)整合原前端方案、后端方案、优化建议和产品规则；不再维护多份重复总计划。

## 架构与数据流

网站使用 TypeScript + Hono 单 Worker，不需要 Python、独立 Node 服务器或独立前端部署。

- CSS、JS、随包小象由 Static Assets 优先返回，绕过 Worker 和账号查询；内容哈希文件名配长期 immutable 缓存。动态页面、会话和后台不共享缓存。
- 动态请求经安全头、会话与权限中间件进入对应路由；D1 保存账号、队员、作品、演职员、资源引用、申请、审核历史、贡献、容量和清理任务。
- R2 只保存文件字节。Worker 根据当前权限和审核状态读取，统一处理可信类型、ETag、HEAD、Range 和附件下载。不会公开桶内部键或把同源 HTML/SVG 当安全预览。
- HTML 在服务端生成，浏览器脚本负责导航、首页切幕、选图、表单和上传。全站主题和作品主题通过同源 CSS 路由生成，严格校验 HEX，遵守 CSP。
- 作品列表每页 12 部；资料库、我的资料、作品内资料和队员名录每页 24 条。作品优先、其他资料最后，组内新提交在前。资料跨页时保留组标题与上一页/下一页；不再用隐藏 DOM 的第二套分页。
- 默认小象使用 360px WebP；资料预览复用已生成的展示图。新头像可附带最长边 640px 的 JPEG 展示图，服务端独立校验，和原图一起记账；旧头像回退原文件，不覆盖旧键。
- 主题/图片配置删除后不能靠缓存继续暴露待审资源。没有背景配置时不请求背景图，首页不重复加载全站背景。

## 当前权限与页面

游客可浏览公开作品、队员、已审核资料低清预览、公告、公开指南和鸣谢。完整剧本/音视频预览、下载与上传需登录；普通账号上传人工审核，认证队员低风险资料直接入库，可疑内容交管理员。

队员认证先选择已有档案，找不到再申请新建。档案的参与作品由演职员关系展示，支持 AB 角和一人多角；旧“代表作”数据库字段保留但不再填写。管理员可建档、解绑、审核、删除作品与受保护的账号删除。

首页为两幕舞台画面，PC 固定切幕、手机连续滚动；作品和资料页保留长页下滑。页面管理只保留当前正文、图片、海报、联系、主题和指南字段。每部作品可另设详情页主题色，留空沿用全站。年份下拉 2026—2020，历史年份在未重新选择时保留。

更多产品约束集中维护在优化 Skill。

## 上传、可靠性与免费阶段

当前使用 Worker **绑定 R2**，历史 `upload_mode=local` 仍代表这种模式，不是服务器本地磁盘。S3 适配代码仅为以后验证保留；现阶段不需要 S3 密钥，只需 `SESSION_SECRET`。

- 视频前后端拦截。照片 20MiB、剧本 50MiB、音频/其他 100MiB，头像原图 15MiB；这些限制针对新提交，不删除历史大文件。
- 浏览器串行分片，分片上限 50MiB；流式校验长度。每账号最多 3 个在途任务。
- 已有 R2 对象、原图、预览和预留都进入容量台账，网站预算为 9,000,000,000 字节。首次清点未完成时暂停创建任务。
- 合并响应丢失或 D1 暂时失败后可重试，完成幂等，避免重复入库。审核/绑定/角色与历史同事务处理，不能竞争写出两个档案。
- 删除先移除引用并记录清理任务，再删 R2；每小时任务分批重试，共享文件不误删。成功删除没有回收站，D1 备份不能恢复 R2 字节。
- 修改密码、禁用和解绑会失效旧会话；保留旧 scrypt 密码兼容。错误带请求编号，日志不输出密码、Cookie 或文件正文。
- `/health` 仅为存活检查；管理员存储/服务检查才检查依赖，不用昂贵查询高频探活。

9GB 预算不是 Cloudflare 免费账单保险：控制台手工上传、其他桶以及操作请求量不由此限制。用量查看 Cloudflare 的 Workers、D1、R2 控制台；实际套餐以 [Workers](https://developers.cloudflare.com/workers/platform/pricing/)、[D1](https://developers.cloudflare.com/d1/platform/pricing/)、[R2](https://developers.cloudflare.com/r2/pricing/)官方说明和账户为准。未启用付费图片处理。

## 检查、上线和回退

```powershell
npm run typecheck
npm run test:backend
npm run deploy:check
```

`deploy:check` 包括格式、类型、旧数据转换、后端回归及生产 dry-run，**不发布**。静态资源在安装、开发、检查和发布前自动生成；开发时修改 public 源文件会重新构建。

生产资源以 `wrangler.jsonc` 为准：Worker/D1 为 `blackbox-production`，R2 为 `blackbox-files-production`，自定义域名为 `npublackbox.online`。

发布顺序：

1. 核对当前版本、待应用迁移和 Git 差异。备份应留在受保护的本地目录；`npm run db:production:backup` 会导出真实 D1，需有相应操作授权，不能绕过工具拒绝。R2 独立保护。
2. 迁移只追加。若有约束变更，先跑 `scripts/data/review-preflight.sql`，冲突交管理员确认。可用 `scripts/data/verify-backend-upgrade.mjs` 对已获授权的快照做内存升级核对。
3. 完成 `npm run deploy:check` 和页面验收。
4. 执行 `npm run db:production:migrate`，再 `npm run deploy`。本轮 0013 是新增列和索引，应先迁移再发布引用新列的代码。
5. `npm run smoke:production`，再检查真实登录、选图、作品主题、上传审核和手机访问。记录实际 Worker 版本，观察正常流量，不对正式站压测。

回退优先回滚到上个兼容 Worker 版本，保留新增列和数据；不恢复过时整库快照覆盖公测期间的新数据。若回退到没有容量台账的旧上传实现，应暂停上传并重新清点后才恢复。

旧头像全量缩略图回填、通知游标重构、真实大陆网络/费用测量仍是后续事项；不以本地耗时代替线上 CPU/费用。1—5GB 视频和 100GB 存储需求须重新评估预算及直传后才开放。

## 文档

- [网站优化 Skill](.agents/skills/blackbox-optimize/SKILL.md)：产品决定与以后实施约束。
- [本地验收指南](docs/本地验收指南.md)：新手启动与点击检查。
- [验证记录](docs/验证记录.md)：实际通过的检查与正式版本。
