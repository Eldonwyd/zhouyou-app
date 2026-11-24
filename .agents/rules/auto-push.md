---
trigger: always_on
description: 完成代码修改并通过校验后自动提交并推送到 GitHub 远端
---

# 自动提交、推送与发布规则

- 每次完成本项目（尤其是 `web/` 仓库）的代码修改并通过构建/验证后，**自动执行** `git add`、`git commit` 与 `git push origin main`，无需再次询问用户是否推送。
- Commit message 需按照本次实际完成的改动清晰撰写（概括功能点与修复内容）。
- 若本次修改涉及应用功能、UI、图标、配置或客户端行为（而非仅改 README/文档），需**同步递增版本号**（默认递增 patch 版本，如 `1.0.1` → `1.0.2`，更新 `package.json` 与 `package-lock.json`），并**自动创建并推送**对应的发版标签（如 `mobile-v*.*.*`、`desktop-v*.*.*`），触发 GitHub Actions 自动构建发布，使网页版、手机端与桌面端同步生效。
- 若用户明确说明“暂不改 / 先讨论 / 不要推送 / 暂不发版”，则按用户要求不提交或不发版。
