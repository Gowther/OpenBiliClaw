# 本地 Web 控制台模块

## 概述

`src/openbiliclaw/web/static/` 提供一个无构建链的本地 Web 控制台。后端启动后，浏览器访问 `http://127.0.0.1:8420/app/` 即可使用。它复用现有 `/api/*` 接口，不采集页面行为，也不读取浏览器 Cookie。

控制台定位是“插件 UI 的网页替代入口”，适合本地 Docker / VPS 隧道 / 只想看推荐和画像的场景。二档版本把不依赖浏览器插件注入能力的操作搬到网页：推荐、惊喜推荐、兴趣探针、画像、近期动态和聊天都可在 `/app/` 完成。它不能替代浏览器插件的 content script 能力：自动同步 B 站 Cookie、注入页面采集点击/停留/搜索、跨站任务执行仍需要插件或手动配置。

## 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| `/app` 静态入口 | ✅ | `GET /app` 重定向到 `/app/`，`StaticFiles(html=True)` 服务静态页面 |
| 运行状态 | ✅ | 调用 `/api/health`、`/api/runtime-status` 展示后端、画像、可换库存、待加工库存和原始 fresh 库存 |
| 推荐流 | ✅ | 调用 `/api/recommendations`，默认只展示 B 站内容，可切到全部来源 |
| B 站封面显示 | ✅ | B 站 CDN 封面通过受限的 `/api/image-proxy` 本地代理加载，避免 localhost 直连图片被 403 |
| 换一批 / 追加 / 补货 | ✅ | 分别调用 `/api/recommendations/reshuffle`、`/api/recommendations/append`、`/api/recommendations/refresh` |
| 推荐反馈 | ✅ | 调用 `/api/feedback` 记录 `like` / `dislike` / `comment` |
| 点击回传 | ✅ | 打开内容链接时 best-effort 调用 `/api/recommendation-click` |
| 惊喜推荐队列 | ✅ | 调用 `/api/delight/pending-batch` 展示待处理惊喜推荐，支持打开、喜欢、不喜欢和围绕该内容聊天 |
| 消息页 | ✅ | 与插件消息逻辑保持一致：画像里的 active `speculative_interests` 回填为兴趣探针；实时 `delight.candidate` 进入消息；`/api/delight/pending-batch` 只补推荐页惊喜队列，不回填历史惊喜消息 |
| 兴趣探针反馈 | ✅ | 调用 `/api/interest-probes/respond` 支持确认喜欢、暂时不要和对话澄清 |
| 画像页 | ✅ | 调用 `/api/profile-summary` 展示画像摘要、喜欢/避开方向、核心动机、内容偏好、观看场景、认知风格、人格线索、待确认兴趣、活跃洞察、近期观察和分页认知变化 |
| 动态页 | ✅ | 调用 `/api/activity-feed` 展示后台补货、账号同步、画像学习和近期认知变化的活动流 |
| 聊天页 | ✅ | 调用 `/api/chat` 与本地后端对话 |
| 夜间模式 | ✅ | 默认按 UTC+8 的 18:00-05:59 自动进入夜间，可在页面顶部切换自动 / 夜间 / 日间 |
| 实时事件 | ✅ | 连接 `/api/runtime-stream?client=web`，刷新顶部状态并在关键事件后重拉数据 |

## 公开 API

Web 控制台本身不新增业务 API，仅新增静态入口：

```http
GET /app
GET /app/
GET /app/app.js
GET /app/styles.css
```

Web 控制台还新增一个只服务封面显示的本地代理接口：

```http
GET /api/image-proxy?url=<bilibili-image-url>
```

该接口只允许 `hdslb.com` / `biliimg.com` 及其子域名，且要求上游返回 `image/*`。它用于给 B 站 CDN 请求补齐浏览器 Referer，不是通用 URL 代理。

前端复用已有后端接口：

```http
GET  /api/health
GET  /api/runtime-status
GET  /api/recommendations
POST /api/recommendations/reshuffle
POST /api/recommendations/append
POST /api/recommendations/refresh
GET  /api/delight/pending-batch
POST /api/delight/respond
POST /api/interest-probes/respond
GET  /api/activity-feed
POST /api/feedback
POST /api/recommendation-click
GET  /api/profile-summary
POST /api/chat
WS   /api/runtime-stream?client=web
```

## 配置项

无新增配置项。控制台随 FastAPI 后端一起启用。配置仍由 `config.toml`、环境变量、CLI 或浏览器插件配置页维护；Web 控制台不提供配置编辑 UI。

相关现有配置：

- `OPENBILICLAW_NO_XHS=1`：后端停用小红书任务生产和小红书接口写入。Web 控制台仍会默认过滤非 B 站推荐，避免旧历史数据直接出现在首屏。
- `scheduler.enabled` / `scheduler.pool_target_count`：影响后台补货和库存目标显示。

## 设计决策

- **不引入 Vite / React / Svelte。** 当前页面只消费现有 API，使用原生 HTML/CSS/JS 足够，避免 Docker 镜像和上游合并复杂化。
- **Web 控制台不负责行为采集。** 普通网页不能跨域读取 `bilibili.com` Cookie，也不能注入 B 站页面监听 DOM 行为。采集仍由插件负责；Web 控制台只做本地查看和操作。
- **配置仍留在插件 / 本地配置链路。** 二档只搬迁不依赖插件权限的运行功能；模型、Cookie、来源等配置入口不在 Web 控制台重复实现，避免出现两套配置状态。
- **默认只看 B 站。** 这是为了适配 B 站-only 本地部署；多源用户可以在页面右侧切到“全部来源”。
- **消息生命周期对齐插件。** 兴趣探针由画像 active speculations 驱动，旧探针会随画像刷新被移除；惊喜推荐的历史 pending 队列只显示在推荐页，只有运行时新推送的 `delight.candidate` 才进入消息，关闭惊喜消息会调用 `/api/delight/sent`。
- **夜间模式按 UTC+8 判定。** 自动模式固定使用 UTC+8 的 18:00-05:59 作为夜间窗口，不依赖浏览器所在地时区；手动模式写入 `localStorage`。
