# Tibo

纯 Eliscript 的 Codex global 重置观测与历史概率程序，运行在 Bun 上。提供 CLI、MCP stdio 和独立飞书机器人：群内查询、北京时间 09:00 / 21:00 推送。

**零第三方运行库**：采集、HTML 解析、预测、MCP、飞书 HTTP API、WebSocket 与 protobuf 都由本程序实现。运行不需要抓取服务、模型服务、数据库或核心 API key；飞书接入需要自己的应用凭据。`.mjs` 仅负责构建启动和测试，业务代码全部在 `.eli` 中。

联网采集仍需要公开数据源；程序不能脱离外部世界发现新公告。历史保存在本地，任何一个网站失败都不会清空已有证据。首次启动没有历史且抓不到数据时，状态为 unknown，预测拒绝编造数值。

## 运行

开发构建需要 Bun 1.3+ 与本地语言工具链，默认同级目录；已有自举编译器时无需 Emacs。`ELISCRIPT_HOME` 可指定编译器位置。

```sh
bun install
bun run build
bun bin/tibo.mjs forecast
bun bin/tibo.mjs status --since 2026-10-02T00:00:00Z
bun bin/tibo.mjs history --offline
bun bin/tibo.mjs forecast --json
bun bin/tibo.mjs evaluate
bun run test
```

构建后无需 `node_modules` 或编译器，`bin/` 与 `dist/` 即可运行。也可以生成不需要安装 Bun 的可执行文件：

```sh
bun run compile
.tibo/bin/tibo forecast
.tibo/bin/tibo mcp
.tibo/bin/tibo-lark
```

`--offline` 用当前 UTC 时间和本地 ledger，完全不联网，明确标记信息未更新。`--snapshot FILE` 按 schemaVersion=1 证据快照中的时间复现。`evaluate` 默认离线输出模型权重、Brier 回放分数和已保存预测的成绩。

Bun 自动读取项目 `.env`。`TIBO_STATE_DIR` 默认当前目录 `.tibo/`，包含本地历史、原文、预测经验、上一份报告和飞书投递账本；这些运行数据和 `.env` 不进入 Git。

## 数据与算法

直接请求 Tibo 的 X 主页；公开存档用于发现帖子与补充历史，随后对近 48h 最近 5 条已知帖子调用 X 官方无认证 oEmbed 核实作者、ID 和正文。帖子时间以 BigInt 精确解码 Snowflake ID。主页动态壳、作者错误、未来时间和空正文均不算原文成功。oEmbed 只能核实已知帖子，不能提供完整新帖列表。

历史发现源为 [公开存档](https://aiidelist.com/codex-reset)，每条记录保留原帖链接与来源。存档解析必须核对完整计数；失配时保留本地数据并报告失败。原文优先于站点分类；global 完成与 banked 发卡分开。另直接读取 OpenAI 状态页和新闻 RSS；新闻、事故、发布不自动等于补偿承诺。预测网站的百分比不作为输入。

三个历史模型分别使用最近 12 个间隔的事件率、90 天半衰期加权事件率，以及按已等时间计算的条件频率（用 4 个近期率先验样本平滑）。站点观测涉及的间隔不参与模型，不把两侧间隔拼成虚假的长间隔。至少需要 3 个可用间隔。

模型权重来自按事件时间逐步回放的 24/48h Brier 分数；少于 30 个回放时点时等权。真实运行会事先保存不重叠的 48h 预测窗口；累计至少 30 个完成窗口后，各模型的实测误差最多占权重计算的 50%。统计目标是本地记录中的公告，未证明世界范围内无漏报。历史回放与事先保存的预测成绩始终分开。

承诺对象、目标时间、banked、事故和发布作为独立信号输出。未经历史验证的暗示不任意增加 10 个百分点，banked 不任意乘固定惩罚系数。明确承诺的证据强度与历史概率分别呈现；数字仍是历史估计，不能把它当成对承诺兑现的校准概率。详见 [算法与证据契约](docs/decision-contract.md)。

## MCP

```json
{
  "mcpServers": {
    "tibo": {
      "command": "bun",
      "args": ["/absolute/path/to/tibo/bin/tibo.mjs", "mcp"],
      "env": {"TIBO_STATE_DIR": "/absolute/path/to/private/tibo-state"}
    }
  }
}
```

也可直接用可执行文件作为 command。工具为 `codex_reset_forecast`、`codex_reset_status`（可选 `since`）和 `codex_reset_history`（`offset`、`limit`，最多 100）。协议为 MCP 2025-11-25 stdio，stdout 只输出 JSON-RPC。开发复现可配置 `TIBO_SNAPSHOT`，飞书实际投递禁止使用测试快照。

## 飞书

复制 `.env.example` 为 `.env`，填写 `TIBO_LARK_APP_ID`、`TIBO_LARK_APP_SECRET`、`TIBO_LARK_BOT_OPEN_ID`、`TIBO_LARK_CHAT_IDS`（逗号分隔的 `oc_...` 群 ID）。国际版配置 `TIBO_LARK_DOMAIN=lark`。

在自己的自建应用中启用机器人、长连接事件订阅 `im.message.receive_v1`，授权群内 @ 消息读取和 `im:message:send_as_bot`，发布应用并加入配置群。启动 `bun run lark` 或可执行文件 `tibo-lark`。

无需 SDK 或公网 webhook：自行获取 tenant token，直调消息 API，使用 Bun 原生 WebSocket 接收 protobuf 事件，处理心跳、断线重连、分片与 ACK。Token 只存内存，日志不输出凭据或连接 URL。

只有配置群中的用户准确 @ 本机器人并发送 `预测` / `重置` / `forecast` / `/tibo`、`状态` / `status`、`帮助` / `help` 才响应。北京时间早晚报允许当前时段前 15 分钟内补发，错过时段不追发。只有成功送达的预测才更新该群上一份报告。

投递前持久化账本，消息使用稳定 UUID；只有 API code=0 且返回 message_id 才标记 sent。未知结果记录 uncertain，重启不自动重发。遗留实例锁需先确认旧进程已停止再处理。

真实飞书群内收发、权限与定时报送需要部署环境试用，本地协议模拟不能替代。参考协议：[MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[X oEmbed](https://docs.x.com/x-for-websites/oembed-api)、[飞书消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。
