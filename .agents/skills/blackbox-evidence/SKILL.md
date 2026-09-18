---
name: blackbox-evidence
description: 为黑匣子网站优化收集最小可复现的浏览器、量算、网络和测试证据。涉及截图、视觉结论、键盘触屏、通知、媒体、性能或验收汇报时使用。
---

# 黑匣子证据路径

遵守 `blackbox-optimize` 的证据等级：Source、Automated、Rendered、Production 不能互相冒充。

## 最小浏览器证据

每个视觉或交互结论记录：

- URL、身份、合成数据前提
- 视口：至少 `1366x768` 与 `390px`
- 操作步骤和实际结果
- 截图或 `evaluate_script` 量算结果
- 控制台与失败网络请求
- 未验证项

## 量算顺序

1. `scrollWidth > clientWidth`：横向溢出
2. `getBoundingClientRect()`：遮挡、边界和点击热区
3. `getComputedStyle()`：字号、颜色、定位和层级
4. DOM/ARIA：焦点、标签和动态状态
5. 网络状态与 content-type：失败恢复

截图用于视觉核对，不能估算精确像素或对比度。无法人工查看截图时写“未做视觉核对”，改用量算和 Lighthouse 证据。

## 交互回归

- 导航/对话框：Tab、Enter、Space、Escape、焦点返回
- 剧照/媒体：打开、返回、上一张、下一张、方向键、失败态
- 表单/通知：成功、401/403、超时、无效 JSON、重试或重新登录
- 移动端：触屏热区、底栏遮挡、横向溢出、自然滚动
- 动效：`prefers-reduced-motion` 下功能完整

## 汇报模板

```text
证据等级：
页面与身份：
视口：
操作：
结果：
量算：
控制台/网络：
截图：
未验证：
```

不得记录密码、Cookie、CSRF、Turnstile token、邮箱、私有资料或生产备份。
