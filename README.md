# Tibo

纯 Eliscript 的 Codex global 重置观测与历史概率程序，运行在 Bun 上。提供 CLI、MCP stdio 和独立飞书机器人：群内查询、北京时间 09:00 / 21:00 推送。

**零第三方运行库**：采集、HTML 解析、预测、MCP、飞书 HTTP API、WebSocket 与 protobuf 都由本程序实现。核心运行不需要抓取服务、模型服务、数据库或 API key；可选 DeepSeek 增强通过内置 HTTP 调用，飞书接入需要自己的应用凭据。`.mjs` 仅负责构建启动和测试，业务代码全部在 `.eli` 中。

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

Bun 自动读取项目 `.env`。程序也读取 `~/.config/tibo/config.env`（可用 `TIBO_CONFIG_FILE` 指定），已有环境变量优先，配置按普通 KEY=VALUE 解析，不执行 shell。`TIBO_STATE_DIR` 未配置时默认当前目录 `.tibo/`；安装守护进程后使用配置里的固定状态目录，包含历史、原文、预测经验、报告及飞书投递账本。

## 可选 AI 与守护进程

使用国际版 DeepSeek `deepseek-flash`，预测增强只发公开资料与统计。`TIBO_AI_FEATURES=signals,search,research,forecast,review,brief,router` 分别启用原帖解读、资料搜索、结构化资料分析、概率建议、建议复核、摘要与跟进、语义命令。任意组合可用，空值全部关闭；`forecast --no-ai` 关闭本次全部预测AI。离线与快照预测始终不调用AI，status/history/evaluate也无需AI。

AI 概率建议默认占最终结果 20%，最多 35%，自有算法基线单独保留。改变概率必须引用近 48h、前次 global 之后的相关原文连续片段；引用校验不能证明模型推论正确。报告把 AI 推断单列，AI 不改写历史、完成状态或账户生效信息。所有功能失败时仍输出自有算法结果。

没有未消耗的相关原帖时不调用概率与摘要；概率变化≥10个百分点或资料有矛盾时，启用review会先复核。建议被拒绝或复核失败则保留自有算法。AI任务、结构化输出、搜索限制和预算见[AI调研与预算](docs/ai-research.md)。Google/百度读取公开页面，无搜索key；遇验证码、JS页面或结构失配会降级。

认证错误暂停24h、余额不足1h、限流遵守Retry-After（1min至24h）；参数错误暂停对应功能6h，输出校验连续失败两次暂停该功能15min，网络/服务连续失败三次开始1–15min指数冷却。状态持久化，换key自动清除旧暂停；`ai-status` 查看任务token累计，`reset-ai` 申请恢复，确认ID后执行。每次预测最多六个按需请求，不即时重试；总时限45s（含受限搜索），单项15s；语义解析额外一次，最多15s。分类、搜索计划与调研缓存6h，概率、复核、摘要缓存20min，最多128项，命中时重新校验。累计至少30个前瞻AI窗口后，若AI误差更大则降低权重。

macOS 安装与重装统一执行：

```sh
bun run service:install
~/.local/lib/tibo/tibo service status
~/.local/lib/tibo/tibo daemon-status
~/.local/lib/tibo/tibo service restart
```

后台服务默认每 15 分钟采集并保存报告，由用户级 launchd 自动启动和重启；不发送 Lark 消息。重装保留配置、历史与经验。完整安装、卸载、日志及故障恢复步骤见 [运行维护](docs/operations.md)，后续开发修改程序后按该文档重装并实际验证。

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

也可直接用可执行文件作为 command。工具为 `codex_reset_forecast`、`codex_reset_status`（可选 `since`）、`codex_reset_history`（`offset`、`limit`，最多100），以及统一查询的 `tibo_query` / `tibo_ask`。协议为MCP 2025-11-25 stdio，stdout只输出JSON-RPC。开发复现可配置 `TIBO_SNAPSHOT`，飞书实际投递禁止使用测试快照。

## 查询命令

支持预测、状态、X发言、公告历史、banked发卡、近期信号、历史统计、帮助、趣味祈祷pray，以及subscribe/订阅、unsubscribe/退订、subscription/订阅状态。固定指令直接执行，开启router后可用自然语言；AI只选白名单命令与参数，解析失败不猜测执行。用 `tibo help` / `tibo commands` 或“有哪些命令能用”查看生成的帮助，详见[命令与参数列表](docs/commands.md)。

```sh
bun bin/tibo.mjs query "发言 3 reset"
bun bin/tibo.mjs ask "最近一次banked是什么时候？"
bun bin/tibo.mjs "给我两条Tibo最近的X发言"
bun bin/tibo.mjs posts --limit 3 --offline
```

CLI中未识别为固定CLI命令的输入，整句自动按 `ask` 处理，无需写ask前缀；中文业务别名也可直接输入。Lark群内未匹配固定指令的提问同样进入语义解析。已识别CLI命令的参数仍严格校验；语义模式未开启或出错时明确提示，不猜测执行。隐私过滤、管理员白名单与二次确认仍适用。

## 飞书

在私有配置 `~/.config/tibo/config.env` 中填写 `TIBO_LARK_APP_ID`、`TIBO_LARK_APP_SECRET`、`TIBO_LARK_CHAT_IDS`（逗号分隔的 `oc_...` 群 ID）。国际版配置 `TIBO_LARK_DOMAIN=lark`。启动通过官方 API 自动获取 bot open_id；`TIBO_LARK_BOT_OPEN_ID` 可选，只用于断言身份一致。

在自己的自建应用中启用机器人、长连接事件订阅 `im.message.receive_v1`，授权群内 @ 消息读取和 `im:message:send_as_bot`，发布应用并加入配置群。启动 `bun run lark` 或可执行文件 `tibo-lark`。

无需 SDK 或公网 webhook：自行获取 tenant token，直调消息 API，使用 Bun 原生 WebSocket 接收 protobuf 事件，处理心跳、断线重连、分片与 ACK。Token 只存内存，日志不输出凭据或连接 URL。

普通群查询只响应配置群中用户准确@本机器人的请求，机器人私聊无需@，固定指令和可选语义模式共用命令目录。收到含🙏的文字则执行pray，不要求@；点击本机器人消息上的「双手合十」🙏同样记一次。每人有会话内匿名档案、功德称号和连续打卡成就，`pray me / board / stats`可查询；冷却和去重防刷，个人与集体彩蛋都不改变真实预测。消息只发送经过隐私过滤的业务结果，错误用通用提示，维护命令不开放到IM或AI。

订阅后从下一定点开始私聊推送，**仅北京时间每天09:00、21:00**，不能自定义时间，错过定点分钟不补发；语义“每天早晚私聊发我一份报告”同样可用。同一个人在多个群重复订阅只有一份。每个定点独立核心只生成一份报告，群与所有订阅者分发完全相同的Markdown正文；人数只影响发送次数，不增加采集、计算或AI调用。共享结果、分发游标和收件人账本在重启后保留，个人发送失败不重生成。

投递前持久化账本，消息使用稳定 UUID；只有 API code=0 且返回 message_id 才标记 sent。未知结果记录 uncertain，重启不自动重发。遗留实例锁需先确认旧进程已停止再处理。

命令先持久化到最多32条的收件箱，再返回平台 ACK；重启继续处理已接收的查询，存在投递记录的任务不重复执行。独立入口支持 `check`、`status` 和 `service install/restart/status/uninstall`。接入配置、安装与真实群试用见[飞书接入](docs/lark.md)。

Tibo是独立程序，Lark只是其中一种IM接入。命令、语义路由、预测与祈祷业务位于Eliscript核心，CLI/MCP/IM共用；其他IM按[接入层约定](docs/im-adapters.md)传递可信身份和通用请求即可复用祈祷逻辑。

真实飞书群内收发、权限与定时报送需要部署环境试用，本地协议模拟不能替代。参考协议：[MCP stdio](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[X oEmbed](https://docs.x.com/x-for-websites/oembed-api)、[飞书消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。

清空历史、清空预测经验与重置AI暂停仅向管理员开放，第一次返回五分钟有效的确认ID，第二次需本人在同一会话发送 `确认 ID`。Lark使用open_id白名单，本地CLI使用安装账户UID；MCP始终只读，AI不能代为确认。配置与重装、重启步骤见[运行维护](docs/operations.md)。
