---
name: blackbox-fastpath
description: 快速接手黑匣子网站优化任务，压缩项目阅读、方法选择和验收准备。用户要求继续优化、恢复上下文、检查当前改动或减少优化 token 时使用。
---

# 黑匣子快速路径

这是 `blackbox-optimize` 的轻量入口，不复制产品规则。先读上级 Skill，再按任务只读对应方法。

## 固定启动顺序

1. 读 `docs/优化交接上下文.md`（若存在）。
2. 执行 `git status --short` 和 `git diff --stat`。
3. 已有交接文档明确覆盖的内容不重复展开；需要发布事实时再读 README、本地验收指南和验证记录。
4. 用 `rg` 只定位相关路由、视图、脚本、样式和测试。
5. 区分 `已实现`、`已验证`、`待验证`、`本轮最小范围`。

## 方法选择

- 接手与完成度：`audit_context`
- 审查 diff：`review_change`
- 页面与交互：`improve_interface`，必要时追加 `stress_state`
- 性能：`optimize_performance`
- 登录、上传、审核、删除：`harden_write_flow`
- 截图、键盘、触屏、运行时：`verify_browser`
- 交付：`release_ready`

不要默认读取所有界面专项 skill。只在任务实际涉及对应轴时读取：accessibility → layout → writing → typography → colors → UI。

## 省 token 规则

- 不重复总结交接文档中的历史结论。
- 不为未改页面做全站审查。
- 不把源码推断写成浏览器或线上事实。
- 不用性能 trace 证明普通布局问题。
- 不安装与当前任务无关的 MCP 或插件。
- 开发中只跑相关测试，最终收口再跑完整检查。

## 默认交付

```text
范围：
已实现：
已验证：
待验证：
本轮改动：
剩余风险：
下一步：
```
