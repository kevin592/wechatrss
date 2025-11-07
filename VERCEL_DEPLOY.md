# Vercel 部署指南

## 一键部署

点击下面的按钮一键部署到 Vercel：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyourusername%2Fwewe-rss&env=DATABASE_URL,DIRECT_DATABASE_URL,DATABASE_TYPE,SERVER_ORIGIN_URL,PLATFORM_URL,CRON_SECRET&envDescription=WeWe%20RSS%20Environment%20Variables&envLink=https%3A%2F%2Fgithub.com%2Fyourusername%2Fwewe-rss%2Fblob%2Fmain%2FVERCEL_DEPLOY.md%23environment-variables)

**注意**：请将 `yourusername` 替换为你的 GitHub 用户名

## 环境变量配置

部署时需要配置以下环境变量：

### 必需变量

| 变量名 | 获取方式 | 说明 |
|--------|----------|------|
| `DATABASE_URL` | Vercel Postgres 的 "Connection String with PgBouncer" | 数据库连接URL（带连接池） |
| `DIRECT_DATABASE_URL` | Vercel Postgres 的 "Connection String (Direct)" | 直连数据库URL |
| `DATABASE_TYPE` | 设置为 `postgresql` | 数据库类型 |
| `SERVER_ORIGIN_URL` | `https://your-project.vercel.app` | 你的Vercel域名 |
| `PLATFORM_URL` | `https://weread.111965.xyz` | 微信读书转发服务 |
| `CRON_SECRET` | 随机生成32位字符串 | Cron Job访问密钥 |

### 可选变量

| 变量名 | 示例值 | 说明 |
|--------|--------|------|
| `AUTH_CODE` | 留空（关闭授权） | 访问授权码，留空则关闭 |
| `FEED_MODE` | `fulltext` | 设置为全文提取模式 |
| `MAX_REQUEST_PER_MINUTE` | `60` | 每分钟最大请求数 |

## 部署后访问

### Web 管理界面
访问你的 Vercel 域名即可进入管理界面：
```
https://your-project.vercel.app
```

### RSS 订阅源

#### 获取所有文章
- Atom 格式: `https://your-project.vercel.app/feeds/all.atom`
- RSS 格式: `https://your-project.vercel.app/feeds/all.rss`
- JSON 格式: `https://your-project.vercel.app/feeds/all.json`

#### 获取指定公众号
替换 `{feed-id}` 为实际的公众号 ID：
- `https://your-project.vercel.app/feeds/{feed-id}.atom`
- `https://your-project.vercel.app/feeds/{feed-id}.rss`
- `https://your-project.vercel.app/feeds/{feed-id}.json`

#### 高级参数

限制文章数量（默认30）：
```
/feeds/all.atom?limit=50
```

标题过滤（支持正则）：
```
/feeds/all.atom?title_include=关键词1|关键词2
/feeds/all.atom?title_exclude=广告|推广
```

全文提取模式：
```
/feeds/all.atom?mode=fulltext
```

手动触发更新：
```
/feeds/all.atom?update=true
```

## 功能说明

### 定时更新
项目配置了 Vercel Cron Jobs，每天 5:35 和 17:35 自动更新所有订阅源。

### 授权码控制
如果不设置 `AUTH_CODE` 环境变量，则关闭授权验证：
- Web 管理界面无需输入授权码即可访问
- RSS 订阅源 `/feeds/*` 路径本身就不需要授权

如果设置了 `AUTH_CODE`，访问 API 时需要：
```
Authorization: your-auth-code
```

## n8n 集成

部署成功后，可以在 n8n 中使用以下方式调用：

### 方式 1: HTTP Request 节点
```
Method: GET
URL: https://your-project.vercel.app/feeds/all.json
Headers: (如果设置了 AUTH_CODE)
  Authorization: your-auth-code
```

### 方式 2: RSS Read 节点
```
URL: https://your-project.vercel.app/feeds/all.rss
```

### 方式 3: 获取所有公众号列表
```
Method: GET
URL: https://your-project.vercel.app/feeds
Headers: (如果设置了 AUTH_CODE)
  Authorization: your-auth-code
```

## 常见问题

### 1. 部署失败，提示数据库连接错误？
检查 `DATABASE_URL` 和 `DIRECT_DATABASE_URL` 是否正确配置：
- `DATABASE_URL` 必须是 PgBouncer 连接字符串（包含 `?pgbouncer=true`）
- `DIRECT_DATABASE_URL` 必须是直接连接字符串

### 2. Cron Job 不执行？
检查 `CRON_SECRET` 是否已设置，并在 Vercel 控制台确认 Cron Jobs 已启用。

### 3. RSS 返回为空？
需要先添加微信读书账号并订阅公众号：
1. 访问 Web 管理界面
2. 添加账号（输入微信读书 token）
3. 订阅公众号（通过公众号文章链接）

### 4. 如何获取微信读书 token？
参考项目 README.md 中的说明。

## 技术支持

如有问题，请查看：
- 项目 README.md
- Vercel 部署日志
- GitHub Issues

## 更新日志

### 2025-11-07
- 添加 Vercel 部署支持
- 从 SQLite 迁移到 PostgreSQL
- 配置 Serverless 函数适配器
- 添加 Vercel Cron Jobs 支持
