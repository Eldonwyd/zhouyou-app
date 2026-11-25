# 周游地图 Cloudflare D1 云数据库绑定指南（2 分钟完成）

本项目的云端账号登录、全文本云同步（AI 攻略、地图点亮、纯文字手账/花费）与「同行旅伴」社交协作功能均基于 **Cloudflare D1（免费 5GB）**，无需额外服务器、无需绑卡。

## 第一步：在 Cloudflare 创建 D1 数据库并建表

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → 左侧菜单选择 **Storage & Databases → D1 SQL Database**。
2. 点击 **Create**，数据库名称填 `zhouyou-db`（区域选默认或 Asia-Pacific），点击创建。
3. 执行初始化建表 SQL（二选一）：
   - **命令行方式**（在 `web/` 目录下执行）：
     ```bash
     npx wrangler d1 execute zhouyou-db --remote --file=migrations/0001_cloud_social.sql
     ```
   - **网页控制台方式**：在 D1 数据库页面打开 **Console**，把 `web/migrations/0001_cloud_social.sql` 的全部内容粘贴进去点击 **Execute**。

## 第二步：将 D1 绑定到 Pages 项目

1. 打开 Cloudflare 左侧 **Workers & Pages** → 进入 `zhouyou-app` 项目。
2. 进入 **Settings → Bindings → Add → D1 database**。
3. **Variable name** 严格填写：`DB`
4. **D1 database** 选择刚才创建的 `zhouyou-db`，点击 **Save**（Production 与 Preview 环境均建议绑定）。
5. 重新触发一次部署（或推送任意代码），`https://zhouyou.online/api/auth/...`、`sync`、`social`、`groups`、`share` 即可立即生效。
