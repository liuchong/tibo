# 命令参考

业务命令同时供 CLI、MCP 和 IM 使用。固定指令先按命令目录解析，不需要 AI；未识别的整段输入交给可选的语义路由。管理员可见命令根据可信身份决定，`help` 也是当前身份的目录。

## 常用查询

```bash
tibo query '预测'
tibo query 'forecast 24'
tibo query 'posts 5'
tibo query 'posts 5 reset --hours 72'
tibo query 'history 5 global'
tibo query 'status 2026-10-02T00:00:00Z'
tibo query 'help'
```

`query` 后的字符串是一段 Tibo 业务输入。参数既可按下表的顺序写位置参数，也可写 `--参数名 值`；引号中的带空格文本是一个参数。`keyword` 只是原文子串筛选，不是语义全文搜索。

| 命令 | 位置参数与命名参数 | 用途 |
| --- | --- | --- |
| `forecast`，别名 `预测/概率/重置` | `horizon=24/48/both`，默认 both；`--no-ai` | 未来 24h/48h global 概率 |
| `status`，别名 `状态` | `since` 可选，UTC ISO 时间，必须以 Z 结尾 | 最近公告，以及指定时间之后公开记录是否更新 |
| `posts`，别名 `发言/推文/x/原文` | 位置：`limit keyword`；limit 1..10 默认 3；hours 1..168 默认 48；keyword ≤80 字符；postId 16..20 位数字 | 最新在前的原文、核实状态、原帖链接 |
| `history`，别名 `历史/公告历史` | `limit kind`；limit 1..20 默认 5；kind global/banked/all 默认 all | 公告历史，最新在前 |
| `banked`，别名 `发卡/卡` | 无 | 最近一次额度卡与证据等级 |
| `signals`，别名 `信号` | 无 | 近 48h 的承诺、暗示、补偿及发布信号 |
| `stats`，别名 `统计` | 无 | global 间隔均值、中位数、范围与可用样本量 |
| `help`，别名 `帮助/commands/命令` | 无 | 当前身份可用命令、参数和管道用法 |
| `ask`，别名 `问答` | `question` 必填，≤800 字符；带空格时加引号 | 一次性文字问答，不执行操作，不发现实时新闻 |
| `pray`，别名 `祈祷/上香/🙏` | `action limit`；action offer/me/board/stats 默认 offer；limit 1..20 默认 10 | 上香、本人档案、当前会话榜单与愿力池 |
| `subscribe`，别名 `订阅` | 无 | 订阅本人定点私聊报告 |
| `unsubscribe`，别名 `退订/取消订阅` | 无 | 取消本人订阅 |
| `subscription`，别名 `订阅状态` | 无 | 本人订阅状态与下一定点 |

`posts --postId` 只查询已知记录中的指定帖子，忽略 hours 窗口；不会凭任意 ID 新建抓取任务。条数是上限，公开来源没有足够匹配记录时返回更少条。状态查询不会读取你的 Codex 账户额度。

## 自然语言与文字问答

```bash
tibo query '有哪些命令可以用？'
tibo query '最近五条发言，给我中文和原文'
tibo query '帮我订阅早晚报告'
tibo query 'ask "global 和 banked 有什么区别？"'
```

未识别的输入使用 `router` 把问题映射到目录中的一个命令及参数。它可以选择 `ask` 做概念解释，但不拥有任意工具执行能力。语义路由失败或未启用时返回简短提示；固定命令仍可使用。

CLI 的 `tibo ask '问题'` 是交互入口，与 `tibo query '问题'` 一样先尝试解析业务查询。要直接调用业务文字问答，使用上面的 `query 'ask "..."'` 写法。已识别命令的错误参数可在真实人工输入时请求 AI 修复，详见 [语言与管道](language-pipelines.md)。

## CLI 本地入口

CLI 还提供以下本地操作，它们不属于 IM 用户命令：

| 入口 | 输出或作用 |
| --- | --- |
| `tibo` / `tibo forecast` | 完整判断报告；`--json` 输出内部结构 |
| `tibo status` / `tibo history` | 本地 JSON；使用 `query` 得到适合聊天的 Markdown |
| `tibo posts --limit 5` | 原文查询，也可用 hours/keyword/postId |
| `tibo evaluate` | 离线模型回放与已有前瞻成绩 |
| `tibo ai-status` | AI 开关、调用用量、冷却和安全分类后的失败记录 |
| `tibo diagnose` | 最近 CLI / daemon 诊断快照，不重新采集或调用模型 |
| `tibo daemon [--once]` / `tibo daemon-status` | 后台采集循环 / 最近状态 |
| `tibo service install/restart/status/uninstall` | macOS 用户后台服务管理 |
| `tibo mcp` | stdio MCP 服务 |

采集相关入口支持 `--offline`、`--snapshot 路径`；原生预测支持 `--no-ai`。这些本地运行选项不要放进 `query` 的问题字符串。`--json`、诊断、服务管理只用于本地，不向 IM 转发。

## 管理员危险操作

普通查询、本人上香与本人订阅不需要管理员。清空历史、清空经验、清除 AI 暂停与缓存必须经过管理员白名单和二次确认：

| 命令 | 作用 |
| --- | --- |
| `clear-history` | 申请清空本地历史缓存 |
| `clear-experience` | 申请清空前瞻预测经验 |
| `reset-ai` | 申请清除 AI 冷却与缓存 |
| `confirm ID` | 用明确固定指令确认本人本会话中的申请 |
| `cancel ID` | 取消本人本会话中的申请 |

```bash
tibo query 'reset-ai'
# 将返回的确认 ID 填入下一条；不要原样执行占位文字。
tibo query 'confirm 返回的确认ID'
```

申请本身不清除数据。确认 ID 有效期 5 分钟，绑定接入方式、操作者、会话与操作；执行前保存 `backup-ID.json`，同一 ID 不能重复执行。权限在确认时重新检查。语义模式可以申请管理员操作，但不能替用户确认；这些操作禁止管道和 AI 输入修复。

CLI 管理员由 `TIBO_LOCAL_ADMIN_UID` 与进程真实 UID 比较，不能传一个用户名冒充。Lark 管理员必须来自真实事件，且位于授权群；私聊不能执行这些管理操作。MCP 没有可信人工身份，不开放危险命令。配置与备份恢复见 [配置参考](configuration.md) 和 [安装与运维](operations.md)。

上香和订阅的身份、行为规则见 [上香与订阅](pray-subscriptions.md)。原文、翻译、多步操作见 [语言与管道](language-pipelines.md)。
