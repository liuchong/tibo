# Lark / 飞书接入

Lark 是独立的 Eliscript 接入程序，复用核心命令与共享报告。它直接使用 Bun HTTP、WebSocket 和本地 protobuf 编解码，不使用官方 SDK、外部转发服务或公网回调地址。

只支持企业自建应用机器人。自定义 Webhook 群机器人没有本程序需要的收消息能力。安装核心采集服务不会自动完成 Lark 配置或启动接入服务。

## 开放平台准备

在对应的飞书或国际 Lark 平台创建企业自建应用，开启机器人能力。事件配置选择长连接接收：

| 事件 / 权限 | 用途 |
| --- | --- |
| `im.message.receive_v1` | 接收用户文本和富文本消息 |
| `im.message.reaction.created_v1` | 接收消息表情反应 |
| `im:message.group_at_msg:readonly` | 接收群内 @ 机器人消息 |
| `im:message.group_msg` | 接收群内未 @ 的上香、点名和次级关键词候选；允许平台投递所有群消息，程序仍按授权群与命令规则过滤 |
| `im:message.p2p_msg:readonly` | 接收用户私聊消息 |
| `im:message:readonly` | 读取被点击祈祷反应的消息正文，支持群成员消息作为素材 |
| `im:message:send_as_bot` | 以机器人身份发送消息 |
| `im:message.reactions:read` | 查看消息表情反应 |
| `im:message.reactions:write_only` | 对弱相关或文字回复预算不足的群消息加轻量表情；固定 OK / SMILE / THUMBSUP 枚举 |
| `im:chat:read` | 核实旧发送回执对应的单聊/群聊类型，使旧机器人消息也支持私聊表情上香 |

引用聊天复用已有的 `im:message:readonly`、`im:message:send_as_bot` 和群历史读取权限；通过固定消息详情、历史分页和回复接口延续同一引用链，不需要 SDK。能力及裁剪规则见 [基础聊天与引用对话](chat.md)。无引用消息不会因此额外读取聊天历史。

上表权限按完整设计要求配置，`im:message.group_msg` 必需，不能只开通群 @ 权限。事件订阅与 API 权限是两项设置，以下 JSON 可在“权限管理 → 批量导入/导出权限”导入：

```json
{
  "scopes": {
    "tenant": [
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:chat:read"
    ],
    "user": []
  }
}
```

管理员身份初始化若要用 union_id 查询本应用 open_id，还需 `contact:user.base:readonly` 与通讯录可见范围；查询群成员辅助验收需 `im:chat.members:read`。这些是相应接入步骤的权限，日常事件内的可信身份不依赖额外通讯录查询。授予平台权限不会扩大 Tibo 内部管理白名单；所有危险命令仍核对本人真实账号并要求二次确认。

按租户要求完成权限审批与应用发布，设置可用范围，把机器人加入授权群。私聊订阅者也必须在应用可用范围内。若保存长连接事件订阅时要求先有连接，先完成本地配置并前台运行，再保存、发布。

准备 App ID、App Secret、操作群与报告接收群 `oc_...`，以及本应用内管理员用户 `ou_...`。被动群交互默认 `all`，也可保留显式群列表；拉机器人进群不会自动订阅报告。管理员可留空，此时只关闭危险管理操作。只允许本人管理时仅填写本人在此应用下的 open_id；可通过已登录 CLI 的 union_id 在目标应用下查询，不能直接复用 CLI 应用的 open_id。管理员只可在私聊或明确配置的操作群申请管理操作，仍需在同一会话明确二次确认。其他应用的 open_id、昵称或自称管理员不能替代真实事件身份。三个范围见 [会话接入与通知边界](conversation-access.md)。

机器人自身 open_id 通过官方 `GET /open-apis/bot/v3/info` 自动发现；可选配置一个预期值，启动时作一致性校验。

## 本地配置与检查

写入私有配置文件，变量说明与优先级见 [配置参考](configuration.md)。下面使用占位值，请替换后再运行：

```dotenv
TIBO_LARK_DOMAIN=feishu
TIBO_LARK_APP_ID=应用ID
TIBO_LARK_APP_SECRET=应用密钥
TIBO_LARK_CHAT_IDS=all
TIBO_LARK_ADMIN_CHAT_IDS=oc_操作群ID
TIBO_LARK_NOTIFY_CHAT_IDS=oc_报告接收群ID
TIBO_LARK_ADMIN_OPEN_IDS=ou_本应用管理员ID
```

国际版将 domain 设为 lark。项目 `.env` 的空字段会覆盖私有配置，避免重复配置。凭据仅用于官方端点，tenant token 在内存共享缓存并提前刷新，不写入消息或 plist。

```bash
bun run compile
.tibo/bin/tibo-lark help
.tibo/bin/tibo-lark check
.tibo/bin/tibo-lark run
```

`check` 只验证配置、tenant token 和机器人身份；不建立事件连接、不发消息，也不证明群权限已生效。前台运行用 Ctrl-C 正常关闭，实际收发应在此阶段验证。Lark 禁止带 `TIBO_SNAPSHOT` 进行实际投递。

## 消息入口与展示

- 来自 user 的私聊文本无需 @。
- 授权群里 @ 本机器人或文字包含 `tibo`（不区分大小写）强触发；其他关键词先走 [相关度与独立回复预算](im-triggers.md)。点名也有群和个人总量限制，主动插话更克制。接收文本和富文本，其他机器人/应用操作者不作为文字命令入口。
- 已收到的群消息含 Unicode 🙏 或 Lark 原生 `[双手合十]` 时只执行上香，无需 @；未 @ 消息需开通 `im:message.group_msg` 并发布生效，否则平台不会交付。
- “双手合十”反应的枚举是 `THANKS`；支持授权群或私聊的可读取消息上的用户反应，包括群成员消息；正文只作为祝词素材，不读取邻近聊天。
- 超过 5 分钟或未来超过 1 分钟的消息、反应事件忽略。

回复预算不足时静默消费，不补发积压回复；上香仍记档，不生成祝词或群回执。授权群已收到的普通人类消息可进入脱敏短窗口，只有允许回复时才附带最近五分钟的少量背景给最终问答模型，不另外补读平台历史，也不改变当前命令、权限或真实重置概率。

低优先级候选、部分不适合文字插话的二级消息，以及被文字限频的点名普通查询，可以按独立表情预算对原消息加 OK / SMILE / THUMBSUP。表情不占文字额度，文字额度用完也可轻量回应；每群间隔 5 秒，十分钟额度随最近收到的人类消息量在 20 / 25 / 30 之间调整，完整个人与话题规则见 [触发与回复节奏](im-triggers.md#三级低优先级与轻量表情)。每条原消息默认一枚，持久回执阻止重投、重启或冷却结束后向旧消息补点其他表情。三级和表情选择不调用 AI，表情只表示收到，被限频查询不会执行。管理和订阅变更不改成表情，祈祷照常独立记账。表情失败只暂停此能力 10 分钟，不发送权限错误。接口为固定 `POST /open-apis/im/v1/messages/:message_id/reactions`，详见 [官方说明](https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/create)。

回复使用 post 富文本内的 Markdown `md` 元素，保留加粗标题、条目与原帖链接。客户端实际渲染需要真机验证，不根据本地 JSON 结构宣称效果已验收。普通查询、翻译、上香和订阅用法见 [命令参考](commands.md)、[语言与管道](language-pipelines.md)、[上香与订阅](pray-subscriptions.md)。

所有交互错误在聊天中给简短业务提示，不发送运行路径、用户、配置、密钥、模型名称、供应商原始错误或栈信息。详细排查只在本地进行。

## 安装与维护

完成前台试用后安装独立服务：

```bash
.tibo/bin/tibo-lark service install
~/.local/lib/tibo/tibo-lark service status
~/.local/lib/tibo/tibo-lark status
```

它使用 `com.liuchong.tibo.lark`，不停止核心 `com.liuchong.tibo`。两个服务各有实例锁，共享业务数据时使用状态写锁。更新代码后重新 compile 并 service install；只修改配置则 service restart。详细路径、保留行为和两服务升级顺序见 [安装与运维](operations.md)。

`status` 是最近本地快照，须结合 `service status` 中运行状态、PID 以及连接状态判断。前台与后台不能同时启动同一状态目录下的 Lark 实例。

## 投递与重复消息

事件先过滤并持久化入队，再 ACK；不等待采集、AI 或反应所指消息的网络读取。每个待处理事件是 `lark-inbox-pending/` 中的一份原子写入文件，积压落在磁盘，内存最多缓存 128 条正文，不再受旧的 32 条收件箱限制。旧收件箱中的已接受任务会自动迁移，不清空业务数据。

固定 help、pray 与订阅指令走快捷队列，最多 4 个异步任务；采集、AI、管道及管理指令走普通队列，最多 2 个异步任务。两条队列各预留最多 64 条正文缓存，普通查询积压不能挤占祈祷缓存。任务与档案事务分开：网络 I/O 可并行，档案更新短暂串行并用文件锁保护跨进程写入。回复可能重排，快捷业务不必等待采集或翻译。

含 🙏 的复合文字作为一个快捷任务入队，先上香记账，再独立处理正文与上香回执。它自己的正文可能等待采集或 AI；同条任务最多各发一条常规正文回复和上香回执，两项仍分别占用回复预算。分支账本保证重启不重复执行已处理正文或重复计数，参见 [双意图规则](im-triggers.md#一级强触发)。

THANKS 反应先保存原事件，在工作队列中核实消息与授权会话；暂时的读取失败保留事件，2 秒起指数退避，最多间隔 60 秒。成功读取的消息元数据最多缓存 128 条、60 秒，同一消息的并发读取合并为一次请求。已接受的祈祷不会因排队超过平台接收时效而丢弃；无法读取或未授权的会话不记账，明确永久不可读的消息记录过滤原因。事件身份使用平台 event_id，缺失时用操作者、消息 ID 与动作时间；重复投递去重，新的表情创建事件分别计数。

祈祷先提交记账，再预留回复额度及生成祝词；临时记账失败的任务留在磁盘重试，单个暂时失败不暂停其他任务。写盘失败回 code=500，等待平台重投；损坏或无法确认的投递账本保留事件并暂停处理。重启恢复尚未执行任务，已有发送记录的任务不自动重跑。磁盘队列仍需可用磁盘空间，不能删除队列或投递账本来解决积压。

投递前落账，调用消息 API 使用稳定 UUID。只有返回 code=0 且带 message_id 才确认成功。账本保留：

| 状态 | 含义 |
| --- | --- |
| `sent` | API 已确认成功及 message_id |
| `rejected` | 平台明确拒绝，保留数字 code |
| `sending` / `uncertain` | 发送结果可能不确定 |
| `pending` / `failed-before-send` | 尚未确认发送 |

API 成功证据还需结合客户端消息核对实际可见性。不要删除账本强制重发；未知发送结果不自动重试。SIGTERM / SIGINT 停止新接收和调度，等待两个队列的当前任务结束，其余任务留队。断线后重新获取官方连接地址并重连，心跳失效关闭旧连接；启动握手失败由服务管理器恢复。

集体彩蛋在普通回执后另发最多两条大型消息，各自落账与使用稳定 UUID。主账本 `sent` 只证明普通回执成功，`festivalFinal=sent` 才证明整场完成。重启只接续未开始的庆典部分；部分明确拒绝最多尝试三次，未知结果不自动重试。完整规则和状态字段见 [集体彩蛋庆典](collective-celebrations.md#投递与恢复)。

定点只在北京时间 09:00 / 21:00，生成一次并共享群与订阅私聊正文，错过分钟不补发。分发使用独立持久化计划，不占交互收件箱，最多 10 个发送请求/秒，最多持续 15 分钟。失败收件人不影响其他人。共享报告、游标、收件人版本和投递账本都保留，生成失败或中断不自动重跑。完整订阅规则见 [上香与订阅](pray-subscriptions.md#定点生成与投递)。

## 实际接入验收

本仓库测试使用本地 HTTP/WebSocket 端点与独立进程，覆盖凭据、机器人身份、protobuf 事件、ACK、富文本、权限过滤、去重、管理员确认、隐私、重连、收件箱恢复与定点分发。这不等于真实平台验收；实际配置与平台验收结果应以本地运行记录及真实聊天消息为准。

真实配置后逐项核对：

1. `check` 识别当前应用机器人，前台长连接可接到实际事件。
2. `all` 模式下新加入的群无需修改配置，@ 查询、含 `tibo` 的无 @ 查询和🙏可使用；普通闲聊仍忽略，次级关键词按相关度和预算决定。显式群列表模式核实其他群被忽略；`all` 不授予管理权限，也不增加报告接收群。
3. 私聊查询、不同群内与私聊里的本人订阅/退订均使用同一记录；群订阅参数仅管理员在操作群或私聊可申请并确认。🙏 文本和机器人消息上的 `THANKS` 分别测试，重复事件不计两次。
4. 管理员申请不立刻修改，普通用户拒绝；确认需本人同一会话，数据变更前有备份。破坏性验收使用独立测试状态，不能清空日常数据。
5. 在真实 09:00 或 21:00 核对群和订阅私聊正文一致、共享报告只一份、成功 message_id 可对应客户端消息。
6. 重启后未重复执行旧消息、旧定点；无凭据或模型信息泄露。

## 官方协议参考

- [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)
- [接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [表情反应事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/events/created)
- [获取指定消息](https://open.feishu.cn/document/server-docs/im-v1/message/get)：固定只读 API 获取反应对应的正文。
- [表情枚举](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/emojis-introduce)
- [长连接协议实现参考](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts)：只核对协议，不安装或运行 SDK。

其他 IM 的扩展约定见 [IM 接入契约](im-adapters.md)。

## 私聊消息表情与本地事件诊断

在机器人自己已确认发送的消息上点击 Lark“双手合十”（THANKS），群聊与私聊都能上香。身份来自平台事件的真实 operator，私聊沿用同一个人的全局香客档案。新发送回执保存会话类型；老回执缺失时，程序最多用一次固定的获取会话 API 核实 p2p 并补齐元数据，调用预算 4 秒；其他未授权群不能被误判成私聊。正常点击不调用 AI。

旧事件仍遵守五分钟接收窗口，重装不会自动重新执行过期事件。相同人对同一条消息的表情使用同一个去重键，平台重投或反复切换表情不能重复记账。只在明确核对平台原始反应和发送回执后，由本地维护处理已确认遗漏的旧事件，不能替换去重键强制重复发送。

`tibo-lark status` 的 events 包含当前进程接收/接受的计数、最近接收时间，以及最近表情 accepted/reason；只记录诊断标签，不存消息正文或身份。反应 reason=queued-for-resolution 只表示原事件已落盘，尚未证明会话核实、计数或发送；not-prayer-or-stale 表示本地不接受该反应。核实结果查投递账本，原反应记录以 receiptKey 指向实际会话的业务回执；message-permanently-unavailable、chat-not-authorized 等是过滤原因。inbox 状态分别报告 pending、cached、workers 和 paused，快照按分钟更新。无新表情事件时先核对事件订阅，不能把“未收到”当“生成慢”。次级候选入队不等于发送，规则见 [IM 触发过滤](im-triggers.md)。完整执行能力边界见 [执行边界](execution-boundary.md)。
