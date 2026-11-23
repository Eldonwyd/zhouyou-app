# 安全策略 · Security Policy

## 🔒 隐私与数据安全设计

- **本地优先存储**：旅行足迹、手账文字、原始照片/视频/录音与账本全部保存在用户设备本地（IndexedDB / 本地用户数据目录），项目不含任何遥测、埋点或云端强制上传。
- **凭据隔离**：AI 服务商 API Key 与订阅登录凭据仅保存在本机忽略目录（`.env.local` / `.ai-auth.json` / 系统 `userData` 目录），不会暴露给前端网页代码，也不会打包进 ZIP 备份或源代码仓库。
- **本地离线 OCR 与配图质检**：基于 PP-OCRv5 与 RT-DETR ONNX 模型在本地推理，行程票据截图不上传第三方 OCR 平台。

## 📣 漏洞反馈

如果你发现了安全漏洞（例如路径穿越、凭据泄露、XSS 或 SSRF 等问题），请**不要直接公开提交 Issue**，可通过以下方式联系维护者：

- 在 GitHub 仓库的 **Security → Advisories** 页面发起私密安全报告（Private Vulnerability Reporting）。

我们会在确认问题后尽快修复并发布安全更新。
