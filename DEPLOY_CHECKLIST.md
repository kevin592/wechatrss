# Vercel 部署检查清单 🚀

## 自动部署流程

当你推送代码到 GitHub 后，Vercel 会自动触发部署。以下是完整的手动配置清单（如果需要）：

---

## 部署前准备 ✅

### 1. 代码配置检查

- [x] Prisma 配置已改为 PostgreSQL (`apps/server/prisma/schema.prisma`)
- [x] Prisma 版本已修复 (5.10.1 → 5.10.2)
- [x] Vercel 配置文件已创建 (`vercel.json`)
- [x] Serverless 适配器已创建 (`api/index.ts`)
- [x] Cron Job 端点已创建 (`api/cron/update.ts`)
- [x] 部署文档已创建 (`VERCEL_DEPLOY.md`)
- [x] 环境变量示例已创建 (`.env.vercel.example`)

### 2. GitHub 推送

推送代码到 GitHub：

```bash
git push origin main
```

---

## 手动配置步骤（如果需要）

### 步骤 1: 创建 Vercel 项目

1. 访问 [https://vercel.com/new](https://vercel.com/new)
2. 选择 **Import Git Repository**
3. 选择你的 WeWe RSS 仓库
4. 点击 **Import**

### 步骤 2: 配置 Framework

在配置页面设置：

- **Framework Preset**: `Other`
- **Build Command**: `cd apps/server && pnpm prisma migrate deploy && pnpm build`
- **Output Directory**: `apps/server/dist`
- **Install Command**: `pnpm install`

### 步骤 3: 添加环境变量

在 **Environment Variables** 部分添加：

#### 必需变量

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | `postgres://...` | Production |
| `DIRECT_DATABASE_URL` | `postgres://...` | Production |
| `DATABASE_TYPE` | `postgresql` | Production |
| `SERVER_ORIGIN_URL` | `https://your-project.vercel.app` | Production |
| `PLATFORM_URL` | `https://weread.111965.xyz` | Production |
| `CRON_SECRET` | 随机生成的密钥 | Production |

#### 可选变量

| Variable | Value | Environment |
|----------|-------|-------------|
| `AUTH_CODE` | 留空（关闭授权） | Production |
| `FEED_MODE` | `fulltext` | Production |
| `MAX_REQUEST_PER_MINUTE` | `60` | Production |
| `ENABLE_CLEAN_HTML` | `false` | Production |

### 如何获取数据库 URL

1. 部署前，先在 Vercel Console 创建 Postgres 数据库：
   - 进入 **Storage** 标签页
   - 点击 **Create Database** → **Postgres**
   - 创建完成后，进入数据库详情

2. 在数据库详情页的 **`.env.local`** 标签下，找到：
   - `POSTGRES_URL` → 作为 `DATABASE_URL`
   - `POSTGRES_URL_NON_POOLING` → 作为 `DIRECT_DATABASE_URL`

3. 复制这两个值，添加到项目的环境变量中

### 如何生成 CRON_SECRET

运行以下命令生成随机密钥：

```bash
# macOS/Linux
openssl rand -hex 32

# Windows (PowerShell)
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

或者使用在线密码生成器生成32位随机字符串。

### 步骤 4: 配置 Cron Jobs

1. 部署完成后，进入项目 **Settings** > **Cron Jobs**
2. 确认 Cron Job 已启用：
   - Path: `/api/cron/update`
   - Schedule: `35 5,17 * * *`
3. 如果没有自动创建，手动添加

### 步骤 5: 部署

点击 **Deploy** 按钮开始部署。

---

## 部署后验证 ✅

### 验证 1: 健康检查

访问健康检查端点：

```
https://your-project.vercel.app/health
```

应该返回：
```json
{
  "status": "ok",
  "timestamp": "2025-11-07T...",
  "uptime": ...
}
```

### 验证 2: RSS 订阅源

访问 RSS 订阅源：

```
https://your-project.vercel.app/feeds/all.json
https://your-project.vercel.app/feeds/all.rss
https://your-project.vercel.app/feeds/all.atom
```

如果数据库为空，应该返回空数组或空 feed。

### 验证 3: Web 管理界面

访问：

```
https://your-project.vercel.app
```

应该能看到 WeWe RSS 的登录界面。

### 验证 4: Cron Job

在 **Settings** > **Cron Jobs** 查看执行日志。

---

## 初始设置 📝

### 步骤 1: 添加微信读书账号

1. 访问 `https://your-project.vercel.app`
2. 如果设置了 AUTH_CODE，输入授权码
3. 进入 **账号管理**
4. 点击 **添加账号**
5. 按照说明获取微信读书 token
6. 不要勾选 "24小时后自动退出"

### 步骤 2: 订阅公众号

1. 进入 **订阅源管理**
2. 点击 **添加订阅**
3. 输入公众号文章链接（从微信读书APP分享获取）
4. 点击 **解析并添加**
5. 等待同步完成

### 步骤 3: 获取 RSS 订阅地址

1. 在订阅源列表中，找到要订阅的公众号
2. 点击右侧的 **RSS**、**Atom** 或 **JSON** 链接
3. 复制链接地址
4. 在 RSS 阅读器或 n8n 中使用

---

## 常见问题 ❓

### Q1: 部署失败，提示 DATABASE_URL 错误

**原因**: 数据库 URL 未正确配置

**解决**:
1. 确保已创建 Vercel Postgres 数据库
2. 复制正确的连接字符串
3. 检查 `DATABASE_URL` 和 `DIRECT_DATABASE_URL` 是否都设置了

### Q2: 访问 /feeds 返回 500 错误

**原因**: 数据库未正确初始化

**解决**:
1. 查看 Vercel 部署日志
2. 检查数据库迁移是否成功
3. 在 **Deployments** 标签页重新部署

### Q3: Cron Job 不执行

**原因**: CRON_SECRET 未设置或配置错误

**解决**:
1. 检查环境变量中是否设置了 CRON_SECRET
2. 在 **Settings** > **Cron Jobs** 查看状态
3. 手动触发测试

### Q4: 如何关闭授权验证

**解决**:
在环境变量中删除 `AUTH_CODE`，或设置为 empty string。

---

## n8n 集成 🔌

### 方式 1: RSS Read 节点（推荐）

在 n8n 中添加 **RSS Read** 节点：

```
URL: https://your-project.vercel.app/feeds/all.rss
```

设置轮询间隔，自动获取新文章。

### 方式 2: HTTP Request 节点

```
Method: GET
URL: https://your-project.vercel.app/feeds/all.json
Headers: (如果设置了 AUTH_CODE)
  Authorization: your-auth-code
```

### 方式 3: 获取指定公众号

```
URL: https://your-project.vercel.app/feeds/{feed-id}.json
```

---

## 监控和维护 📊

### 查看日志

1. 在 Vercel Console 查看 **Deployments**
2. 点击某个部署版本
3. 查看 **Logs** 标签页

### 监控 Cron Job

1. 进入 **Settings** > **Cron Jobs**
2. 查看执行历史
3. 点击 **Run Now** 手动触发

### 数据库管理

1. 在 **Storage** > **Postgres** 查看数据库状态
2. 进入 **Data** 标签页查看数据
3. 在 **Statistics** 查看性能指标

---

## 更新和重新部署 🔄

### 自动部署

当你推送代码到 GitHub 时，Vercel 会自动触发部署。

### 手动重新部署

1. 进入 **Deployments** 标签页
2. 找到最新版本
3. 点击 **Redeploy** 按钮

### 添加新功能

1. 在本地开发和测试
2. 推送代码到 GitHub
3. Vercel 自动部署
4. 验证功能是否正常

---

## 清理 🧹

如果不使用该项目：

1. 在 Vercel Console 删除项目
2. 在 **Storage** > **Postgres** 删除数据库（可选）
3. 在 GitHub 删除仓库（可选）

---

## 技术支持 💬

如有问题：

1. 查看部署日志
2. 检查环境变量配置
3. 查看项目 README.md
4. 提交 GitHub Issue

---

**完成！** 🎉 现在可以推送到 GitHub 开始自动部署了。
