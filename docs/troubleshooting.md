# 故障排查

先保留现有状态与日志，再判断故障发生在哪一层。只运行帮助、状态和诊断命令不会重新发起预测 AI；实际预测或文字处理可能联网。所有下面的诊断均用于本地，不复制到群聊。

## 引用追问没有接上历史

确认使用了 Lark 的引用/回复功能，而不是复制文字或直接发送新消息；未引用请求按设计保持单轮。群聊还需满足原有触发条件。成功投递账本的 `latency.threadState`、`threadMessages`、`threadReadMs` 分别记录历史完整度、采用轮次数和读取耗时，不记录历史正文。`ready` 表示分页及父链在预算内读完，`partial` 表示读取失败或超限后保留了部分可用引用，`unavailable` 表示没有读到可用内容。附件、撤回及敏感内容不会补写；权限和限制见 [基础聊天与引用对话](chat.md)。

## 快速定位

```bash
~/.local/lib/tibo/tibo service status
~/.local/lib/tibo/tibo daemon-status
~/.local/lib/tibo/tibo diagnose
~/.local/lib/tibo/tibo ai-status
```

| 现象 | 首先看什么 |
| --- | --- |
| 服务装好了但没有新报告 | launchd 是否 running，daemon 的 finishedAt / state |
| 输出还是旧发言 | diagnose 的 latestPost、archiveCachedAt、sources 与 AI postIds |
| AI 暂时出了问题 | ai-status 的 lastAttempts、circuit、enabledFeatures |
| 翻译保留了原文 | translate / repair / answer 的具体失败阶段 |
| 上香档案不一致 | CLI 与 daemon 是否使用同一状态目录；接入/会话是否不同 |
| Lark 没回消息 | 接入进程、真实事件、@、群白名单、事件时间及投递账本 |
| 订阅后没收到私聊 | 是否到了下一定点、应用可用范围、订阅版本和平台发送结果 |
| 完成公告出现了但仍使用旧重置时钟 | 原帖是否截断、长正文证据等级、status 的最近 global |
| 关键词只收到表情或没有回应 | 触发级别、相关度、文字和表情预算、表情接口冷却 |

## 发言不够新或条数不足

`posts 5` 是最多五条，默认近 48h，按原帖时间倒序。可以扩大 hours 或去掉 keyword；不是强制返回五条。

```bash
tibo posts --limit 5 --hours 168
tibo diagnose
```

核对以下证据，避免把“保留了旧数据”当作“本轮抓取成功”：

- latestPost 的时间、出处、verifiedAt 与 truncated。
- archiveCachedAt 是站点缓存时间，不是本次请求时间。
- sources 的 ok / fetched，以及 oembed 的 attempted / verified。
- 最近预测的 AI postIds 与 selection 是否包含目标帖子；最多 8 条按证据价值选取并保留最新帖，有声明期限的计划可超过 48h。programme 记录期限、已见 Day 与旧线索是否已消耗；超期或未被规则识别的旧帖不会无限保留。

主页抓不到时仍可能通过存档发现、oEmbed 核实已知原文。oEmbed 不负责发现未知帖子；长帖截断时可用固定公共镜像补取正文，必须匹配作者、帖子 ID 和官方摘录前缀。补全文仍标为存档，不声称官方全文已核实；镜像失败保留截断原文，不猜测完成句。扩大查询范围也不能消除公开来源漏帖。

`diagnose` 展示最近成功报告的诊断，普通 posts 查询不会生成同一份预测诊断。latestPost 比本次 posts 旧时，先比较诊断 at；需要重新诊断预测时运行一次明确的 `forecast --no-ai`，再查 diagnose。

## 重置时钟与实际复盘

`status` 查看最近完成公告、已过时长、是否在 24h 内刚重置，以及从公告起算的七天参考倒计时。七天参考不是个人账户的实际自动刷新时间，也不意味着到期必有 global；个人时间须看账户额度页面。每周自动刷新与 banked 均不移动 global 时钟、不计入预测命中。

`review` 展示真实报告的原始 24h / 48h 数值及窗口结果，不用今天重跑的算法替换旧预测。发现窗口中的完成公告可立即记为命中；没有公告要等窗口结束、额外十分钟采集缓冲且历史可用后才能结算。重叠报告可复盘，不能都拿来当独立训练样本。经验训练仍间隔至少 48h，少量事件不足以声称概率已校准。

## AI 降级

先查 configured、enabledFeatures 与实际任务名。预测 signals、forecast 和文字 translate、router 是独立开关；启用一个不等于其他都启用。任务也可能因没有相关新信号而 skipped，这是节省调用的正常行为。

本地 lastAttempts 的常见阶段：

| 阶段 / 分类 | 说明 |
| --- | --- |
| `timeout` / transport | 网络、供应商或请求时限问题 |
| `response-json` / `output-json` | API 包装或模型正文 JSON 无法解析 |
| `truncated` / `empty-output` | token 上限截断或没有可用正文 |
| `schema` | 结构、引用、枚举或数字/链接保留校验失败 |
| `translation-changed-facts` | 翻译未保留关键标记，或引入不允许的新数字 |
| `blocked` / circuit.until | 冷却尚未结束，本次没有重新调用 |

模型通过校验也不证明语义正确。失败时保留基础算法和可用文字，不把原始供应商错误发出去。很少见的语言表现不好时可查看原文或换明确语言代码，不为凑一份译文关闭事实保护。

认证失败冷却 24h，余额不足 1h，限流遵循有上限的 Retry-After；网络与输出错误按连续次数冷却。详细规则见 [AI 任务](ai-research.md)。确认问题已解决后优先等待到期；需要手动复位用管理员 `reset-ai` 加固定确认，先保留诊断。更换密钥会切换 AI 状态身份，不应把旧凭据冷却当成新凭据故障。

## 配置与目录

环境变量（包括空值）优先于私有文件。开发目录 `.env` 可能遮盖安装配置；daemon 不靠该文件加载设置。不要打印整个配置来排查，检查变量是否存在、来源和文件权限即可。

CLI 与服务如果使用不同 TIBO_STATE_DIR，会看到不同历史、经验和上香档案。服务日志仍在安装固定目录；业务 JSON 使用配置目录。修改配置后分别重启两个服务，方法见 [安装与运维](operations.md)。

## 锁与进程

“已有实例运行或无法确认锁所有者”时先核对该锁的 owner PID 和服务状态。实例锁阻止同一服务运行两份；短期业务锁保护并发写入。死 PID 的锁可自动回收，活 PID 或所有者不明时不能直接删除。

launchd 会自动恢复被 kill 的服务；需要停机调试用 service uninstall，数据保留。不要模糊 kill 所有 Bun 或 tibo 进程。重启后最后状态可能尚未更新，观察实际 PID 与新的 at / finishedAt。

## Lark 与定点推送

```bash
~/.local/lib/tibo/tibo-lark service status
~/.local/lib/tibo/tibo-lark status
```

`check` 成功只证明凭据和机器人身份。消息必须实际交付，来自 user、在授权群、正确 @ 或文字包含 tibo（不区分大小写），或含 🙏 / 原生双手合十，且处于时效范围内。无 @ 入口必须已开通并发布 `im:message.group_msg`；次级关键词只有相关度和降敏通过后才回应；其余无 @ 普通群消息忽略。检查平台事件订阅、应用发布范围和本地 inbox 后，再查投递状态。

订阅只在下一次北京时间 09:00 / 21:00 私聊推送；09:02 启动不补发。核心 daemon ready 不证明 Lark 在运行。共享报告生成失败时该定点不自动重跑，某个收件人发送失败也不重新生成报告。

`sent` 带 message_id；`rejected` 是明确拒绝；`sending/uncertain` 必须先核对真实聊天。表情成功为 `reacted`，`reaction-sending` 或 `reaction-unavailable-or-uncertain` 同样不能删除账本重发。表情权限或接口失败只使该应用的表情能力冷却十分钟，其他功能继续工作；不向群披露具体错误。禁止删账本强制重发，避免重复消息。可用范围、机器人进群和富文本显示须通过真实客户端验证，详见 [Lark 接入](lark.md)。

## 祈祷没回复与查询耗时

直接发送 🙏 文本与点击消息上的双手合十是不同平台事件。文本走 im.message.receive_v1，消息表情走 im.message.reaction.created_v1，两项都要订阅。表情可指向平台可读取的本机器人或成员消息；旧回执或陌生消息需固定 API 核实正文与会话，查验失败看本地事件原因与平台权限。

先看 tibo-lark status 的 events：reactions 未增加说明没有观察到新表情事件；增加但 lastReaction.accepted=false 则看 reason；queued-for-resolution 表示已落盘等待核实，不等于发送成功。查看 inbox 的 pending/cached/workers/paused 和磁盘队列；单个临时失败会退避重试，原事件不消失。反应回执的 receiptKey 指向实际会话投递记录。固定祈祷走快捷队列，基础记账无需模型，祝词最多等待 1.5 秒模型生成；采集和文字任务走普通队列。

快速🙏可能只回一条，这是群回复限频，不代表漏计。用 pray me 查询个人次数，pray stats 查询当前会话次数、功德和彩蛋；state=suppressed 且 prayerRecorded=true 表示已记档但静默。集体彩蛋现在按实际上香次数解锁，个人功德仍有15秒冷却。达到门槛但被限频时，彩蛋留到下一次允许回复的上香展示；统计命令也能查看。发送未知结果需核对聊天，不删除账本强制重发。

投递账本的 latency 区分 platformMs（平台产生到程序收到）、queueMs（已接受到开始执行）、routeMs、executeMs、sendMs；预测还细分 collectionMs、analysisMs。totalMs 是开始执行到发送完成，不能误当成包含前面两项的端到端耗时。不同查询及缓存命中会有差异，不应保证所有请求同一时间完成。源码修改后按运维步骤同时重装核心和 Lark，不能只重启旧二进制。
