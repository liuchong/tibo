# 配置参考

## 配置读取与优先级

程序先读取进程环境，再用私有配置补齐尚未设置的变量。默认私有配置是 `~/.config/tibo/config.env`，可用 `TIBO_CONFIG_FILE` 改路径。Bun 从源码启动时也会加载项目 `.env`；不要把这个文件当作 daemon 的配置。

**已经存在的环境变量优先，包括空字符串。** 因此项目 `.env` 中空的 `TIBO_LARK_APP_ID=` 会遮盖私有配置里的有效值。仓库的 [.env.example](../.env.example) 默认全部注释，按需启用；不要启用空字段后期待它被私有配置覆盖。

私有文件只支持 `KEY=VALUE`、空行与 `#` 注释，允许去掉一层首尾引号；不执行 shell 展开，不支持 `export`。变量名只能为 `DEEPSEEK_API_KEY` 或以 `TIBO_` 开头，文件长度 ≤16000 字符。首次缺文件可运行无 AI 核心；格式错误会在本地报配置问题。

配置修改后：新 CLI 进程会重新读取；已运行的核心和 Lark 服务分别需要重启。通过 launchd 启动时只显式传入配置文件路径，所以部署设置应放在该文件里。

## 核心与运行设置

| 变量 | 默认与范围 | 用途 |
| --- | --- | --- |
| `TIBO_CONFIG_FILE` | `~/.config/tibo/config.env` | 私有配置路径；由启动环境指定 |
| `TIBO_STATE_DIR` | 未设置或为空时为当前目录 `.tibo`；安装默认 `~/.local/state/tibo` | 历史、报告、档案、缓存和投递状态目录 |
| `TIBO_TIMEZONE` | UTC；IANA名称 | 报告展示、上香业务日期、统计和调度默认区；安装补齐为Asia/Shanghai以保留既有行为 |
| `TIBO_FORECAST_TIMEZONE` | 继承TIBO_TIMEZONE | 历史日历与小时风险；安装补齐为America/Los_Angeles，已有值不覆盖 |
| `TIBO_SCHEDULE_TIMEZONE` | 继承TIBO_TIMEZONE | 系统每天09:00/21:00的调度区，订阅者不能自定义 |
| `TIBO_DAEMON_INTERVAL` | 900；整数 60..86400 秒 | 无新原帖时重新计算报告的维护间隔；五分钟监测独立进行 |
| `TIBO_HIDDEN_SOURCE_HOSTS` | 空；逗号分隔的域名 | 本地公开输出脱敏规则，只隐藏指定来源字样，不请求这些地址 |
| `TIBO_LOCAL_ADMIN_UID` | 源码运行未设置；安装时补当前 UID | 本地危险操作管理员白名单 |
| `TIBO_SNAPSHOT` | 未设置 | MCP 测试快照；Lark 实际投递拒绝此设置 |
| `ELISCRIPT_HOME` | 构建时为 `node_modules/eliscript` | 编译器路径，构建用，不是应用私有配置项 |

五分钟监测、报告维护与定点推送是独立机制：`TIBO_DAEMON_INTERVAL` 不会改变服务配置调度时区 09:00 / 21:00 的定点。实时预警与已重置确认由新证据触发，见 [实时通知](realtime-alerts.md)。

## 可选 AI

| 变量 | 默认与范围 | 用途 |
| --- | --- | --- |
| `TIBO_AI_PROVIDER` | deepseek；deepseek/kimi | 选择官方 HTTP 服务 |
| `TIBO_AI_MODEL` | 随服务选择 deepseek-flash 或 kimi-for-coding | 模型名称；仅本地配置 |
| `TIBO_AI_API_KEY` | 空 | 当前服务的凭据；显式空值关闭调用 |
| `DEEPSEEK_API_KEY` | 空 | 旧配置兼容，仅 deepseek 服务且未设置通用密钥时使用 |
| `TIBO_AI_FEATURES` | 未设置时无功能；安装时只在该键不存在时补全十三项 | 逗号分隔的独立功能开关 |
| `TIBO_CHAT_SEARCH` | 1；0 关闭 | 基础聊天的公开搜索；不关闭固定官方状态、计算和时间方法 |
| `TIBO_WEB_RENDER` | 1；0 关闭 | 网页原文不足时是否启用专用无头浏览器后备；静态正文与搜索仍可用 |
| `TIBO_WEB_BROWSER_PATH` | 自动查找专用后端 | 本机管理员可指定独立 chrome-headless-shell/headless_shell 的路径，支持 `~/`；不接受桌面 App 包或其符号链接，不进入模型和业务命令参数 |
| `TIBO_CHAT_CONTEXT_TOKENS` | 980000；有效整数 8192..980000 | 总上下文摘要触发目标；默认按 1M 窗口预留余量，超窗材料归档，无引用不积累会话 |
| `TIBO_AI_WEIGHT` | 已停用，实际权重为 0 | 旧配置兼容；不发起概率建议、不影响数值 |

deepseek 使用 `https://api.deepseek.com/chat/completions`，kimi 使用 `https://api.kimi.com/coding/v1/chat/completions`，均由 Bun 原生 HTTP 调用兼容的 Chat Completions 协议，不依赖模型 SDK。模型和凭据属于私有运维配置，不提供 IM 修改接口，也不发送到聊天或提示词。未知服务或非法模型配置直接降级，不请求网络；切换服务不会把旧服务凭据误发给新服务。

服务、模型或密钥变化后，AI 网关缓存与失败冷却按新的身份隔离，聊天历史、公开原文与重置历史继续保留。Kimi 请求使用模型接受的 temperature=0.6，DeepSeek 维持原各任务参数。模型窗口应支持当前上下文目标；`kimi-for-coding` 支持 1M 窗口，沿用 980000 的默认输入预算。协议、输出校验、有限语义重试与非 AI 降级规则保持不变。

启用全部功能的本地配置示意：

```dotenv
TIBO_AI_PROVIDER=kimi
TIBO_AI_MODEL=kimi-for-coding
TIBO_AI_API_KEY=在此填入自己的密钥
TIBO_AI_FEATURES=signals,search,research,brief,router,translate,answer,repair,oracle,wish,trigger,festival,read
```

不使用 AI：

```dotenv
TIBO_AI_FEATURES=
```

文件中不要填 shell 表达式。旧 DeepSeek 配置无需迁移；切换 Kimi 时填写上面三项，不能只替换旧凭据。配置后分别重装更新过的两个二进制；以后仅改配置时分别重启两个服务。旧 `forecast`、`review` 功能名及 `TIBO_AI_WEIGHT` 被忽略。关闭所有 AI 调用用空功能列表；结构化缓存、预算与失败冷却见 [AI 任务](ai-research.md) 和 [结构化特征](structured-features.md)。

`brief`开关控制最终用卡理由的可选AI生成，关闭时使用五档本地文案；概率仍由算法决定。

`forecast --no-ai` 禁止该次预测 AI；真实人工输入中的 `--no-ai` 同时阻止语义路由、修复和后续文字 AI。固定命令仍可使用。`--offline` / `--snapshot` 禁止该次采集和预测 AI，但不是所有文字任务的全局开关；隔离实验时显式清空 `TIBO_AI_FEATURES`。

## Lark 接入设置

| 变量 | 默认与范围 | 用途 |
| --- | --- | --- |
| `TIBO_LARK_DOMAIN` | feishu；仅 feishu/lark | 中国飞书或国际 Lark API 域名 |
| `TIBO_LARK_APP_ID` | 必填 | 企业自建应用 ID |
| `TIBO_LARK_APP_SECRET` | 必填 | 应用密钥 |
| `TIBO_LARK_CHAT_IDS` | 未设置时 `all`；也可填逗号分隔的 `oc_...`，空表示关闭群交互 | 仅被动群交互，不决定管理权限或报告接收者 |
| `TIBO_LARK_ADMIN_CHAT_IDS` | 空；逗号分隔的 `oc_...`，不支持 `all` | 管理员操作群；管理员私聊也可操作，变更需二次确认 |
| `TIBO_LARK_NOTIFY_CHAT_IDS` | 空；逗号分隔的 `oc_...`，不支持 `all` | 从配置创建群订阅；不会订阅所有可交互群 |
| `TIBO_LARK_BOT_OPEN_ID` | 空，可选 `ou_...` | 对官方返回的机器人身份作一致性校验 |
| `TIBO_LARK_ADMIN_OPEN_IDS` | 空，逗号分隔的 `ou_...`，不要加空格 | 可申请和确认危险操作的应用内用户 ID |

没有管理员白名单时仍可查询、本人上香、本人订阅，以及由本群群主或群管理员申请并确认本群订阅，只禁止系统危险管理操作。`all` 只放行已加入群里平台交付的普通交互，仍执行触发与限频。操作群、系统管理员身份和通知订阅分别控制；详细行为见 [会话接入与通知边界](conversation-access.md)。本人订阅在群与私聊效果相同；群订阅显式使用 `group` 参数或明确请求往本群提醒，需本群群主或群管理员二次确认，申请与确认分别实时核实角色，不要求列入操作群。系统管理员原私聊及操作群入口保留。真实身份来自平台；目标群 ID 仅从可信本地配置、当前已核实群会话或系统管理员明确的固定命令参数取得，不由模型编造。

不要公开提交配置或把它贴进 IM。安装创建私有目录（0700）与配置文件（0600）；自建配置文件时同样限制权限。

## 状态文件

状态通过独占锁和原子替换写入。主要文件如下：

| 文件或前缀 | 内容 |
| --- | --- |
| `ledger.json` | 累积历史公告与永久原文，无自动过期；旧证据不是本次采集成功证明 |
| `realtime-monitor.json` / `x-request-budget.json` | 五分钟监测游标、通知去重与共享 X 限流退避 |
| `alert-feed.json` / `alert-*.json` / `lark-alert-*.json` | 平台无关实时通知、共享正文与接入层投递计划 |
| `source-cache.json` | 共享最新公开资料，两分钟有效；主页发现失败时 15 秒，协调并发采集 |
| `forecast-cache-ai.json` / `forecast-cache-native.json` | 两分钟交互预测结果缓存，共用公开资料输入但区分 AI 和非 AI 结果 |
| `experience.json` | 不重叠的前瞻预测窗口、标签与成绩 |
| `forecast-journal.json` | 最多 400 份真实报告回执和逐窗口复盘；不作为独立训练样本 |
| `report-*.json` / `evidence-*.json` | 各报告通道上次概率与证据，用于趋势比较 |
| `diagnostics-cli.json` / `diagnostics-daemon.json` | 最近成功生成报告的采集、AI 输入与结果诊断 |
| `service-status.json` / `web-search-*.json` | 官方状态与公开搜索的短期共享缓存；不保存私人会话原文 |
| `web-page-*.json` / `web-body-*.json` | 30 分钟网页最新指针及不覆盖的公开正文快照；失败缓存 60 秒，ETag/Last-Modified 重验证 |
| `ai.json` | AI 用量、缓存、最近失败阶段和冷却 |
| `daemon.json` / `daemon-latest.json` | 采集进程状态 / 最近成功结果，含简洁报告及完整结构数据 |
| `pray-identities.json` / `pray-<摘要>.json` / `subscriptions-*.json` | 统一个人及会话上香档案 / 迁移保留旧档案 / 应用账户订阅 |
| `confirm-*.json` / `backup-*.json` | 危险操作确认票据 / 操作前数据 |
| `bulletin-*.json` / `lark-*.json` | 共享定点报告、收件人任务、交互入队、投递与运行状态 |
| `lark-inbox-pending/` | 每事件一个持久化任务，原子落盘后才 ACK；重装保留，已完成后删除 |
| `im-replies-*.json` / `lark-reaction-circuit-*.json` | 群内文字与表情预算 / 表情接口失败后的 10 分钟暂停；只保留摘要、状态与时间 |

这些文件属于本地运维数据，不直接发送到 IM 或模型。变更状态目录相当于切换一套应用数据；部署和 CLI 若读不同目录，会看见不同档案与历史。安装固定日志路径见 [安装与运维](operations.md)。

`oracle` 控制角色神谕生成；关闭后仍可使用随机本地角色台词。祈祷吉祥话由 wish 独立控制，关闭后仍有随机本地祝词；模型调用最多等待 1.5 秒，输出最多 160 token。trigger 控制群聊次级候选的短模型相关度判断，关闭后使用本地分数；不影响强触发。新安装补全功能不覆盖已存在的 `TIBO_AI_FEATURES`；更新旧安装需自行在现有列表中加入需要的功能，不应清空原列表。

`festival` 独立控制集体彩蛋短祝词，最多等待 1.5 秒、输出上限 240 token；图案、等级和消息数量始终由本地程序决定。关闭后保留全部随机庆典保底。已有安装的功能列表需显式加入 festival；安装器不覆盖已有列表。完整规则见 [集体彩蛋庆典](collective-celebrations.md)。

引用聊天的脱敏会话保存在状态目录的 `conversation-*.json`，Lark 历史导入进度为 `lark-import-*.json`。配置和用户档案不混入对话。重装保留这些状态；相关规则见 [基础聊天与引用对话](chat.md)。

`read` 是聊天的一次只读能力语义解析，独立于 answer 开关及冷却。新安装默认列表包含 read；旧安装不自动修改已有功能列表，需在原 `TIBO_AI_FEATURES` 末尾加入 read 并重启两个服务。固定通用方法无需模型；`TIBO_CHAT_SEARCH=0` 只关闭公开搜索，不关闭官方服务状态或事故历史。服务事故原始页共享缓存为 `service-incidents.json`。

`lark-working-*.json` 保存原消息处理状态表情及本机器人创建的 reaction ID；撤销成功记为 cleared，暂时失败由收件箱继续清理，不属于祈祷、订阅或预测数据。
