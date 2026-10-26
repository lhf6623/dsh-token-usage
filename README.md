# dsh-token-usage

Token 用量看板，作为 DSH Web UI 的一个 Conversation View 标签页，排在「对话」「轨迹」之后。

- 只统计 token 数量，**不做费用估算**。
- **一张折线图**同时画四条线：输入、输出、缓存读、缓存写。
- 只有两个维度：**时间** 与 **API**。
- 时间：今天 / 昨天 / 近 7 天 / 近 30 天 / 本月 / 上月 / 自定义（上限 365 天）。
- API：从数据里自动归纳出有多少个 API（按 provider + model），可点选只看某一个。
- 粒度：小时 / 天 / 月，跟着时间范围自动选，也可以手动覆盖。

## 为什么是这两条维度

时间与 API 是这份数据里**唯一两个正交的切分方向**：token 消耗的形状是「哪个模型、在什么时候、用了多少」。
再往里加维度（会话、工作区、事件类型）只会让一张图变得读不懂，而它们都能用「本会话 / 全部会话」这一个开关覆盖住。

四条曲线之所以放在同一张图而不是拆成四张小图，是因为它们共享同一个 y 轴量纲：把输入和缓存读画在同一个坐标系里，
才能直接看出「这一次请求里，有多少是真正新算的、有多少是命中缓存的」。

## 数据来源

Host 端通过官方 `ctx.sessionQuery` 服务读取会话语料，只取 `assistant/message` 事件里的
`data.usage`，并从同一条记录的 `data.message.source` 取出 `provider` 与 `model`。

用 `sessionQuery` 而不是自己解压 `session.jsonl.zstd`，有两个明确原因：

1. 一个会话目录下可能同时存在 `session.jsonl.zstd`、`session.v3.jsonl.zstd`、
   `session.v4.jsonl.zstd` 三个版本文件。直接读目录会把同一批响应重复统计两到三次。
2. `readSession` 会返回逻辑日志和 `inheritedEventCount`。子代理 / fork 会话在自己日志里
   会重放父会话的前缀，只有该偏移之后的事件才是它自己的用量，否则父子会双重计数。

「本会话」范围会按会话谱系向下合并派生会话（子代理 / fork），与界面上的说明一致。

## 聚合方式

读取会话日志是唯一的重开销步骤，因此 Host 端把扁平记录缓存 60 秒；切换粒度、时间范围、API 筛选
都只在内存里重新分桶，不再读日志。空时段补 0，折线不会跨过真实的数据空档画出一条假直线。

**点数保护**：粒度会跟着窗口自动降级（超过 8 天的小时数据自动变天，超过 400 天变月），
任何请求最多产生约 400 个点，折线不会退化成一块实心墨。自定义范围上限 365 天。

## HTTP 接口

```
GET /_dsh/dsh-token-usage/usage
    ?from=EPOCH_MS     窗口起点
    &to=EPOCH_MS       窗口终点
    &bucket=hour|day|month
    &tzOffset=MINUTES  东为正，按查看者本地墙钟分桶
    &sessionId=ID      可选，限定该会话及其派生会话
    &refresh=1         可选，绕过记录缓存
```

「今天 / 昨天 / 本月 / 上月」是**日历边界**，由客户端按查看者本地时间算成 epoch 再传。
Host 不做日历推断，这样时区与夏令时都不会猜错。

旧参数 `days=N` 仍然接受，向后兼容。

响应要点：`buckets[]`（每个时段含 `series[]` 的按 API 拆分，所以前端筛选 API 不需要再发请求）、
`combos[]`（自动归纳出的 API 清单）、`totals`、`scan`（扫描了多少会话、失败多少）。

## 开发

```
npm run check   # node --check 两个半区
npm test        # 23 个测试：Host 聚合正确性 + Client 渲染与交互
```

测试不依赖浏览器：`test/harness.cjs` 是一个只够用的 hooks 运行时，
Client 测试把 `fetch` 直接接到真实的 Host 处理器上，所以跑的是真实的请求/响应契约。

## 安装

```
plugin_manager install_bundle  target=<这个目录的绝对路径>
```

装到 `desktop` profile 才会在当前桌面 GUI 生效。
