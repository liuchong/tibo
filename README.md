# Tibo

使用 Eliscript 编写、运行在 Bun 上的独立 Codex 重置观测与预测程序。

- `status` 判断公开证据是否出现新的 **global** 重置公告，区分实时原文、存档原文、站点观测；个人账户是否已生效始终另行核实。
- `forecast` 按固定 v1.1 模板生成未来 24/48 小时的判断。没有固定“真实概率公式”；内置可审计规则基线，也可接入独立 AI 分析命令。
- MCP stdio 提供查询工具。独立 Lark 接入层支持群内查询和北京时间 09:00 / 21:00 早晚报。

业务逻辑全部位于 `.eli`。`.mjs` 仅用于编译启动和测试宿主；`src/host.eli` 中的 `js*` 只绑定 Bun 的全局宿主对象，不承载业务代码。

## 安装与运行

需要 Bun 1.3+，以及同级目录中的语言工具链检出。工具链已有自举编译器时无需 Emacs；首次生成编译器需要工具链自身要求的 Emacs。

```sh
bun install
bun run build
bun bin/tibo.mjs forecast
bun bin/tibo.mjs status --since 2026-10-02T00:00:00Z
bun bin/tibo.mjs history
bun bin/tibo.mjs forecast --json
bun run test
```

工具链不在默认依赖位置时，构建时设置 `ELISCRIPT_HOME` 为编译器根目录。构建产物保存在 `dist/`，后端运行不再调用编译器。Bun 的本地依赖文件可能是符号链接，构建器会解析真正的编译入口。

CLI 可用 `--snapshot FILE` 读取 schemaVersion=1 的离线证据快照，便于复现；快照时间即该次报告的时间。真实联网模式先读取当前 UTC 时钟再采集，失败不会使用历史缓存冒充当前成功。

Bun 自动加载项目 `.env`。所有凭据放 `.env` 或进程环境变量；`.env`、运行状态和生成文件均被 Git 忽略。不要把真实凭据写进配置、日志或提交。

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

该绝对路径填写当前部署路径。工具：

- `codex_reset_forecast`：无参数，返回 v1.1 Lark markdown。
- `codex_reset_status`：可选 `since`，返回 `confirmed-announcement` / `archived-announcement` / `unverified-record` / `unknown`；`newSince` 仅表示证据中是否有更新。
- `codex_reset_history`：`offset` / `limit` 分页，返回历史与重算的条件样本，limit 最多 100。

MCP 进程的 stdout 仅承载协议，错误走 stderr。开发验证时可用 `TIBO_SNAPSHOT` 指定快照，Lark 实际投递禁止使用这个变量。

## 数据与判断

采集 Tibo 主页，失败则使用公开存档中的近 10 条原文和全历史，并显示缓存时间和未核实项。历史记录数必须与页面声称数量一致；结构变化或缺失历史会停止预测。交叉页只核对重置时间，站点概率不进入内置规则，也不会进入 AI 分析上下文。动态页面没有可解析时间时记为未核实。另读取官方 banked 说明、Codex 状态事故和近 24h 新闻/社区资料。

可设置 `FIRECRAWL_API_KEY`，启用主页抓取和近 24h 新闻搜索。即使 HTTP 返回 200，未得到带作者、时间、正文的帖子，也不算主页核实成功。采集每项有超时，拒绝执行来源中的脚本或指令。

Global 与 banked 不共用时钟。历史按去重、排除未来记录、原文纠正类型后重算。条件样本只选 `间隔 > 已等时长`，严格计算到 `已等时长 +24h/+48h`；同时统计全样本和当年 8 月起样本。历史可以包含明确标记的站点观测，报告说明这一限制。历史时间是公开公告/观测时间，不能证明每个账户实际落地时间。

内置时间解析保守支持 `today/tomorrow + am/pm + PST/PDT/PT` 和对象范围；tomorrow 按旧金山日期，显式 PST=UTC-8、PDT=UTC-7，PT 使用 IANA 夏令时。无法解析的时间承诺作为暗示或未核实项，不伪造时间点。已完成 global 之前的信号归零；banked 消耗承诺需要明确关联证据。事故补偿暗示不会被近期 banked 的抑制规则覆盖。

规则数字和局限见 [判断契约](docs/decision-contract.md)。有待核实项时不会打印“无”冒充全面核实。无法得到历史条件基线时，预测返回错误而非造一个概率；状态查询仍可独立运行。

## AI 综合判断

`TIBO_ANALYST_COMMAND` 是 JSON argv 数组，启动外部分析程序，不经过 shell。该程序读取 stdin 的一份 JSON 证据，stdout 只返回以下 JSON；提示词、历史样本、信号和规则基线一并传入。

```json
{"p24":30,"p48":50,"reason":"基于未消耗的最新重置信号调整","citations":["对应的Tibo帖子ID"]}
```

例如设置 `TIBO_ANALYST_COMMAND='["/absolute/path/to/analyst", "--json"]'`。可连接任意自有模型程序，不强制某个供应商，也不自动读取现有 Agent 的认证配置。只有配置该命令后才调用 AI；JSON 结果的 `forecast.mode` 区分 `rules` 和 `analyst`。

概率必须是整数、范围 0–100、48h≥24h。引用必须是已采集、近 48h、global 之后且未消耗的相关 Tibo 原文；没有新引用时不能改变规则结果。失败、超时、格式错误和无效引用会回到规则基线，并写入未核实项。对原文的语义解读仍需要模型判断，引用校验不能证明每一句模型推论都正确。

## 独立 Lark 层

```sh
bun install --cwd adapters/lark
bun run build
# 在 .env 中填写下面的配置，勿在命令历史中粘贴密钥
bun run lark
```

必需环境变量：`TIBO_LARK_APP_ID`、`TIBO_LARK_APP_SECRET`、`TIBO_LARK_BOT_OPEN_ID`、`TIBO_LARK_CHAT_IDS`（逗号分隔 `oc_...` 群 ID）。国际版设 `TIBO_LARK_DOMAIN=lark`，默认使用飞书。

在自己的自建应用中启用机器人和长连接事件订阅 `im.message.receive_v1`，授权群内 @ 消息读取及 `im:message:send_as_bot`，发布应用并加入配置的目标群。把机器人的真实 open_id 填入配置，防止对 @ 其他人误响应。使用官方 SDK 的长连接，不要求公开 webhook。

允许的群命令是准确 @ 本机器人后发送 `预测`、`重置`、`forecast`、`/tibo`，或 `状态` / `status`、`帮助` / `help`。其他群、机器人发出的消息和未 @ 消息被忽略。

定时器每分钟检查一次北京时间 09:00/21:00，允许前 15 分钟内启动补发当前时段；错过时段不追发。标题固定为该时段时间，统计窗口仍从实际采集 UTC 时刻计算。早晚报和群内预测共用该群上一份成功送达的报告；CLI 与 MCP 各自保留自己的上一份。

进程持有独占运行锁；投递前先记录账本，再使用固定 UUID 发送 Markdown 富文本。只有 API 成功且返回 message_id 才标记送达。未知发送结果保存为 `uncertain`，重启不自动重发；失败或遗漏时段不会导致无限重试。账本和证据位于 `TIBO_STATE_DIR`（默认当前目录 `.tibo/`）。出现遗留锁时先确认旧实例已停止，再人工处理；不要删除仍在运行实例的状态。

本仓库完成的是可运行程序与独立接入层。真实应用安装、权限、群消息接收、实际早晚报送达还需使用部署环境验收；测试里的 SDK 替身不代表飞书线上成功。

参考协议与官方 SDK：[MCP](https://modelcontextprotocol.io/docs/develop/build-server)、[Lark SDK](https://github.com/larksuite/node-sdk)、[Firecrawl](https://docs.firecrawl.dev/api-reference/endpoint/scrape)。
