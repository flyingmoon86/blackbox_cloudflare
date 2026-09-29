# 管理员系统信息可视化

入口为 `/admin/system`，实时只读数据继续使用 `/admin/system/data`。两者沿用现有有效管理员鉴权，响应禁止缓存；没有新增写入接口、外部服务、平台凭证或生产部署。

## 本次批准的技能

- 2：[high-contrast-skeuomorphic-clean](https://github.com/MengTo/Skills/tree/main/agent-skills/web-design/high-contrast-skeuomorphic-clean)：深色立体表面、清晰层级与克制的黄铜色提示。
- 3：[threejs-fundamentals / threejs-interaction](https://github.com/CloudAI-X/threejs-skills/tree/main/skills)：正交相机、场景组织、射线选取和触摸/鼠标控制。
- 4：[threejs-game-ui-designer](https://github.com/majidmanzarpour/threejs-game-skills/tree/main/skills/threejs-game-ui-designer)：模块检查器、场景与界面协调、键盘和移动端替代操作。

安装在用户的 `C:/Users/gbg61/.codex/skills` 下，共四个技能目录。

## 实现与数据依据

- `src/views/system-info.ts`：系统地图外壳、分析报告、原有业务步骤、数据库关系容器、字段列表和资源桶展示。报告使用原生折叠区域，目录可直接打开。
- `public/system-scene.entry.js`：浏览器、静态资源、Worker、D1、R2 的交互式 2.5D 地图。点击模块查看实现来源，拖动旋转、缩放或复位，业务路径突出相关依赖。连接表示代码关系，不声称实时流量。
- 数据库图仅消费本次结构查询确认的外键，选择表后展示直接关联和明确的字段引用清单。图中表名可点击或用 Enter/空格打开字段列表；搜索支持表名和用途。业务文件关联仍单独标记为代码确认的关联，未冒充外键。
- `public/system-info.css`：仅用于系统信息页，保留网站暖色基调，以深色模块、立体资源桶和高对比关系图增加辨识度。
- `src/services/system-info.ts`：结构来自当前 DB 的 `sqlite_schema`、`PRAGMA table_info`、`PRAGMA foreign_key_list`；桶连接来自 `FILES.head`。显示本次查询时间，不读取业务行、字段默认值或文件内容。
- R2 平台对象数量、已用容量、剩余容量、平台限额目前不可获取，继续明确显示。应用预算与台账单独折叠，并注明不代表平台实际容量。配置桶名与实际绑定是否一致、线上部署版本与流量没有独立验证。

## 加载与兼容

复用现有加载、无权限、失败、重试和无数据提示。查询刷新会清除旧快照，防止失效信息残留。WebGL 不可用时保留模块按钮与全部文字/数据；Canvas 不承担唯一信息或键盘操作入口。

Three.js 作为固定版本依赖本地打包，使用现有 esbuild，资源文件沿用内容哈希。场景只在操作、尺寸变化或选择变化时渲染，不运行持续动画；像素比上限 1.5，离开页面释放图形资源。新增模块未压缩传输约 584 KB，只在系统信息页加载，无外部 CDN。

## 验证记录

- 后端完整测试 107 项通过，覆盖匿名、普通用户、队员、禁用管理员不能访问页面/数据接口，有效管理员可访问；覆盖只读查询、敏感信息排除和查询失败。
- TypeScript 检查、格式检查与 Cloudflare 构建 dry-run 通过；未部署到生产环境。
- 本地一次性 Miniflare 数据验证：32 张表、resource 的 6 条外键、user 的 18 条关联；验证搜索无结果、刷新、模块选择、路径切换、缩放与复位，以及实际场景射线点击。
- 桌面和 390px 手机视口检查，无页面横向溢出；关系图在自身容器内滚动。键盘 Enter 可打开表字段，手机可用模块按钮查看详情，浏览器未报告脚本错误。
- 本地预览仅使用合成数据和临时 D1/R2，未访问生产数据库、存储或账号。
