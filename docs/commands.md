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
tibo query 'review'
tibo query 'help'
```

`query` 后的字符串是一段 Tibo 业务输入。参数既可按下表的顺序写位置参数，也可写 `--参数名 值`；引号中的带空格文本是一个参数。`keyword` 只是原文子串筛选，不是语义全文搜索。

| 命令 | 位置参数与命名参数 | 用途 |
| --- | --- | --- |
| `forecast`，别名 `预测/概率/重置` | `horizon=24/48/both`，默认 both；`--no-ai` | 未来 24h/48h global 概率 |
| `status`，别名 `状态` | `since` 可选，UTC ISO 时间，必须以 Z 结尾 | 当前有效预告期限和原帖、最近公告、是否刚重置、已过时间、7 天参考倒计时；个人实际自动刷新时间未知 |
| `posts`，别名 `发言/推文/x/原文` | 位置：`limit keyword`；limit 1..10 默认 3；hours 1..168 默认 48；keyword ≤80 字符；postId 16..20 位数字 | 最新在前的原文、核实状态、原帖链接 |
| `history`，别名 `历史/公告历史` | `limit kind`；limit 1..20 默认 5；kind global/banked/all 默认 all | 公告历史，最新在前 |
| `banked`，别名 `发卡/卡` | 无 | 最近一次额度卡与证据等级 |
| `signals`，别名 `信号` | 无 | 近 48h 的承诺、暗示、补偿及发布信号 |
| `stats`，别名 `统计` | 无 | global 间隔均值、中位数、范围与可用样本量 |
| `review`，别名 `复盘/预测复盘` | 无 | 最近 6 份真实报告的原始概率及严格 24h/48h 公告结果；重叠窗口不能当独立成绩 |
| `help`，别名 `帮助/commands/命令` | 无 | 当前身份可用命令、参数和管道用法 |
| `ask`，别名 `问答` | `question` 必填；带空格时加引号，超窗材料归档摘要 | 了解 Tibo 背景的基础聊天；Lark 引用延续同一 Thread，未引用单轮；询问近期重置时补入业务状态，其他问题按需查官方状态、公开搜索摘要、计算或时间；不能操作账户 |
| `service-status` | 无 | OpenAI 官方整体服务、组件与进行中事故，区别于重置 status |
| `service-history` | `limit=1..20` 默认 8；`days=1..90` 默认 14；`component` 可选子串 | 官方事故历史，含已解决；只覆盖官方返回的最近一页 |
| `search` | `query` 必填 ≤200 字符，带空格加引号 | 公开搜索摘要与原始链接，不自动抓取结果页 |
| `calculate`，别名 `calc` | `expression` 必填 ≤256 字符 | 有限浮点算术，括号、四则、取余、幂；不执行代码 |
| `time` | `timezone` 默认 UTC，IANA 名称；`at` 可选 | 当前或指定时刻的 UTC 与时区时间 |
| `date-diff` | `from to` 必填 | 有符号秒/小时/天差；纯日期为 UTC 零点，时间须带 Z |
| `convert` | `value from to` 必填 | 长度、质量、时长、数据容量和温度换算；拒绝跨维度 |
| `pray`，别名 `祈祷/上香/🙏` | `action limit`；action offer/me/board/stats 默认 offer；limit 1..20 默认 10 | 上香、本人档案、当前会话榜单与愿力池 |
| `subscribe`，别名 `订阅` | `target=personal/group`，默认 personal；`items=all/alerts/warnings/daily/promise/probability/confirmed`（支持逗号组合），默认 all；可选 `chatId` | 默认订阅本人私聊；group 由本群群主、群管理员或 Tibo 管理员申请并二次确认；支持按项目单独或组合订阅（如 `alerts` 仅订阅重置预警与确认，不收每日定点预测） |
| `unsubscribe`，别名 `退订/取消订阅` | 同 subscribe | 默认取消本人订阅；group 由本群群主、群管理员或 Tibo 管理员申请并二次确认；指定 `items` 可单独退订某项并保留其余项目 |
| `subscription`，别名 `订阅状态` | `target=personal/group`；可选 `chatId` | 默认查看本人订阅及已选项目；group 查看本群订阅，要求本群群主、群管理员或 Tibo 管理员 |

`posts --postId` 只查询已知记录中的指定帖子，忽略 hours 窗口；不会凭任意 ID 新建抓取任务。条数是上限，公开来源没有足够匹配记录时返回更少条。状态查询不会读取你的 Codex 账户额度。

`status` 中的 7 天是“上次 global 后满 7 天”的参考，不能代替个人额度页面的自动刷新日期。个人每周自动刷新不算强行 global，不计入概率或复盘。`forecast` 只展示概率、相关原始消息和简短理由，格式见 [预测报告约定](forecast-report.md)。状态规则与模型同时适用于 CLI、MCP 和 IM，详见 [判断约定](decision-contract.md#重置时钟与-7-天参考)。

可直接问“刚重置了吗”“上次重置多久了”“还有几天到 7 天参考”。语义路由优先选择 status；显式 `ask` 也补入相同状态。AI 关闭或失败时用固定 status 查询同一状态，不依靠关键词猜测 ask 的意图，不编造个人剩余额度。“刚重置了对吧”不触发求重置彩蛋；“帮我重置一下”仍是角色回应。

## 自然语言与文字问答

```bash
tibo query '有哪些命令可以用？'
tibo query '最近五条发言，给我中文和原文'
tibo query '帮我订阅早晚报告'
tibo query 'ask "global 和 banked 有什么区别？"'
tibo query 'OpenAI API挂了吗'
tibo query '搜索 OpenAI API官方文档'
tibo query 'calculate "(123+456)*7" --no-ai'
tibo query 'time Asia/Shanghai --no-ai'
tibo query 'date-diff 2026-10-14 2026-10-16 --no-ai'
tibo query 'convert 1 GiB MiB --no-ai'
tibo query 'service-history 5 14'
```

固定命令直接运行；其他输入使用语义路由。引用追问进入聊天，由 read 结合引用链选择固定只读方法，程序取数后回答；没有针对特定自然语言问法的快捷正则。AI 不可用时使用固定命令，计算、时间、单位、日期仍可用，网络方法保留真实失败状态。

Lark 引用/话题中的固定指令仍优先；启用 router 后，本轮明确业务请求也会语义路由，例如“以后发现重置几率高时往本群发提醒”或“在本群只订阅重置预警，不订阅每日预测”申请本群对应项目订阅。普通引用追问进入聊天并沿用引用上下文；历史命令和机器人建议本身不会触发新业务。路由不可用时可使用固定命令。本群订阅可由本群群主、群管理员或 Tibo 管理员在本群内直接申请并二次确认（省略群 ID），普通群内不解锁全局系统危险命令或跨群代管；Tibo 系统管理员保留在私聊或操作群显式指定目标群 ID 的原入口。

CLI 的 `tibo ask '问题'` 是交互入口，与 `tibo query '问题'` 一样先尝试解析业务查询。要直接调用业务文字问答，使用上面的 `query 'ask "..."'` 写法。已识别命令的错误参数可在真实人工输入时请求 AI 修复，详见 [语言与管道](language-pipelines.md)。

## CLI 本地入口

CLI 还提供以下本地操作，它们不属于 IM 用户命令：

| 入口 | 输出或作用 |
| --- | --- |
| `tibo` / `tibo forecast` | 固定简洁预测报告；`--json` 输出完整证据和算法结构，过滤内部发现源名称与地址 |
| `tibo status` / `tibo history` | 本地 JSON；使用 `query` 得到适合聊天的 Markdown |
| `tibo posts --limit 5` | 原文查询，也可用 hours/keyword/postId |
| `tibo evaluate` | 离线模型回放与已有前瞻成绩 |
| `tibo ai-status` | AI 开关、调用用量、冷却和安全分类后的失败记录 |
| `tibo diagnose` | 最近 CLI / daemon 诊断快照，不重新采集或调用模型 |
| `tibo daemon [--once]` / `tibo daemon-status` | 后台采集循环 / 最近状态 |
| `tibo service install/restart/status/uninstall` | macOS 用户后台服务管理 |
| `tibo mcp` | stdio MCP 服务 |

采集相关入口支持 `--offline`、`--snapshot 路径`；原生预测支持 `--no-ai`。这些本地运行选项不要放进 `query` 的问题字符串。`--json`、诊断、服务管理只用于本地，不向 IM 转发。

预测与发言、状态等查询共用两分钟的最新公开资料缓存，并发请求合并。已核实完整原文永久保存，不随刷新重复下载；详情见 [公开资料与原文缓存](evidence-cache.md)。

## 管理员危险操作

普通查询、本人上香与本人订阅不需要管理员。清空历史、清空经验、清除 AI 暂停与缓存必须经过管理员白名单和二次确认：

| 命令 | 作用 |
| --- | --- |
| `clear-history` | 申请清空本地历史缓存 |
| `clear-experience` | 申请清空前瞻预测经验与报告复盘，二者均备份，不重新导入清空前的旧定点报告 |
| `reset-ai` | 申请清除 AI 冷却与缓存 |
| `confirm ID` | 用明确固定指令确认本人本会话中的申请 |
| `cancel ID` | 取消本人本会话中的申请 |

```bash
tibo query 'reset-ai'
# 将返回的确认 ID 填入下一条；不要原样执行占位文字。
tibo query 'confirm 返回的确认ID'
```

申请本身不清除数据。确认 ID 有效期 5 分钟，绑定接入方式、操作者、会话与操作；执行前保存 `backup-ID.json`，同一 ID 不能重复执行。权限在确认时重新检查。语义模式可以申请管理员操作，但不能替用户确认；这些操作禁止管道和 AI 输入修复。

CLI 管理员由 `TIBO_LOCAL_ADMIN_UID` 与进程真实 UID 比较，不能传一个用户名冒充。Lark 管理员必须来自当前应用的已认证用户事件，且位于管理员 open_id 白名单；仅接受本人与机器人私聊或明确授权的群会话。其他应用身份、非管理员及未授权群不能执行这些管理操作。MCP 没有可信人工身份，不开放危险命令。配置与备份恢复见 [配置参考](configuration.md) 和 [安装与运维](operations.md)。

上香和订阅的身份、行为规则见 [上香与订阅](pray-subscriptions.md)。原文、翻译、多步操作见 [语言与管道](language-pipelines.md)。

单位代码：长度 m/km/cm/mm/in/ft/mi；质量 kg/g/lb；时长 s/min/h/d；数据 bit/B/KB/MB/GB/KiB/MiB/GiB；温度 C/F/K。数据单位区分大小写，KB/MB/GB 用十进制，KiB/MiB/GiB 用二进制；不是汇率工具。日期接受 YYYY-MM-DD 或带 Z 的 UTC ISO，拒绝非法日期，不猜个人时区。

## 公开网页原文

| 命令 | 参数 | 用途 |
| --- | --- | --- |
| `read-page` / `读网页` | `url` 必填，公开 HTTP(S) 网页 | 获取正文、来源和读取状态；必要时原生 WebView 渲染 |
| `search` | `query` 必填；`read` 默认 true | 搜索并读取最多两篇原页；false 仅保留标题与摘要 |

CLI 示例：`tibo query 'read-page https://example.com/guide'`；`tibo query 'search --query 产品额度规则 --read false'`。自然语言“读取这篇原文”可沿显式引用链使用已有来源链接；没有链接时由固定搜索方法搜索并读页，不增加模型工具循环。正文获取失败会保留原始搜索结果及失败等级。
