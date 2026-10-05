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
| `TIBO_DAEMON_INTERVAL` | 900；整数 60..86400 秒 | 每轮采集结束后等待多久开始下一轮 |
| `TIBO_LOCAL_ADMIN_UID` | 源码运行未设置；安装时补当前 UID | 本地危险操作管理员白名单 |
| `TIBO_SNAPSHOT` | 未设置 | MCP 测试快照；Lark 实际投递拒绝此设置 |
| `ELISCRIPT_HOME` | 构建时为 `node_modules/eliscript` | 编译器路径，构建用，不是应用私有配置项 |

周期采集与定点推送是两个机制：`TIBO_DAEMON_INTERVAL` 不会改变北京时间 09:00 / 21:00 的推送时间。

## 可选 AI

| 变量 | 默认与范围 | 用途 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | 空 | 官方 HTTP API 凭据 |
| `TIBO_AI_FEATURES` | 未设置时无功能；安装时只在该键不存在时补全十一项 | 逗号分隔的独立功能开关 |
| `TIBO_AI_WEIGHT` | 0.2；有效数值限于 0..0.35 | AI 概率建议的融合权重，不控制其他文字功能 |

当前模型为 `deepseek-flash`，端点为 `https://api.deepseek.com/chat/completions`。这是应用当前实现配置，不能在普通 IM 查询中索取或泄露。程序不依赖模型 SDK。

启用全部功能的本地配置示意：

```dotenv
DEEPSEEK_API_KEY=在此填入自己的密钥
TIBO_AI_FEATURES=signals,search,research,forecast,review,brief,router,translate,answer,repair,oracle
TIBO_AI_WEIGHT=0.2
```

不使用 AI：

```dotenv
TIBO_AI_FEATURES=
```

文件中不要填 shell 表达式。`TIBO_AI_WEIGHT=0` 只让 AI 概率不改变最终数值，仍可能发起已启用的分析调用；彻底关闭调用用功能开关。功能、预算和失败冷却见 [AI 任务](ai-research.md)。

`forecast --no-ai` 禁止该次预测 AI；真实人工输入中的 `--no-ai` 同时阻止语义路由、修复和后续文字 AI。固定命令仍可使用。`--offline` / `--snapshot` 禁止该次采集和预测 AI，但不是所有文字任务的全局开关；隔离实验时显式清空 `TIBO_AI_FEATURES`。

## Lark 接入设置

| 变量 | 默认与范围 | 用途 |
| --- | --- | --- |
| `TIBO_LARK_DOMAIN` | feishu；仅 feishu/lark | 中国飞书或国际 Lark API 域名 |
| `TIBO_LARK_APP_ID` | 必填 | 企业自建应用 ID |
| `TIBO_LARK_APP_SECRET` | 必填 | 应用密钥 |
| `TIBO_LARK_CHAT_IDS` | 必填，逗号分隔的 `oc_...` | 明确授权的群列表，也用于定点群推送 |
| `TIBO_LARK_BOT_OPEN_ID` | 空，可选 `ou_...` | 对官方返回的机器人身份作一致性校验 |
| `TIBO_LARK_ADMIN_OPEN_IDS` | 空，逗号分隔的 `ou_...`，不要加空格 | 可申请和确认危险操作的应用内用户 ID |

没有管理员白名单时仍可查询、本人上香和本人订阅，只禁止危险管理操作。群白名单与管理员白名单分别控制会话和操作者。App ID、用户 ID、群 ID 不从自然语言或模型结果中取得。

不要公开提交配置或把它贴进 IM。安装创建私有目录（0700）与配置文件（0600）；自建配置文件时同样限制权限。

## 状态文件

状态通过独占锁和原子替换写入。主要文件如下：

| 文件或前缀 | 内容 |
| --- | --- |
| `ledger.json` | 累积历史公告和帖子，旧证据不是本次采集成功证明 |
| `experience.json` | 不重叠的前瞻预测窗口、标签与成绩 |
| `report-*.json` / `evidence-*.json` | 各报告通道上次概率与证据，用于趋势比较 |
| `diagnostics-cli.json` / `diagnostics-daemon.json` | 最近成功生成报告的采集、AI 输入与结果诊断 |
| `ai.json` | AI 用量、缓存、最近失败阶段和冷却 |
| `daemon.json` / `daemon-latest.json` | 采集进程状态 / 最近成功完整报告 |
| `pray-identities.json` / `pray-<摘要>.json` / `subscriptions-*.json` | 统一个人及会话上香档案 / 迁移保留旧档案 / 应用账户订阅 |
| `confirm-*.json` / `backup-*.json` | 危险操作确认票据 / 操作前数据 |
| `bulletin-*.json` / `lark-*.json` | 共享定点报告、收件人任务、交互入队、投递与运行状态 |

这些文件属于本地运维数据，不直接发送到 IM 或模型。变更状态目录相当于切换一套应用数据；部署和 CLI 若读不同目录，会看见不同档案与历史。安装固定日志路径见 [安装与运维](operations.md)。

`oracle` 控制角色神谕生成；关闭后仍可使用随机本地角色台词。它不是祈祷吉祥话开关，后者尚未接入。新安装补全功能不覆盖已存在的 `TIBO_AI_FEATURES`；更新旧安装需自行在现有列表中加入需要的功能，不应清空原列表。
