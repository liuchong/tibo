# Lark / 飞书接入

Lark 是独立的 Eliscript 接入程序，复用核心命令与共享报告。它直接使用 Bun HTTP、WebSocket 和本地 protobuf 编解码，不使用官方 SDK、外部转发服务或公网回调地址。

只支持企业自建应用机器人。自定义 Webhook 群机器人没有本程序需要的收消息能力。安装核心采集服务不会自动完成 Lark 配置或启动接入服务。

## 开放平台准备

在对应的飞书或国际 Lark 平台创建企业自建应用，开启机器人能力。事件配置选择长连接接收：

| 事件 / 权限 | 用途 |
| --- | --- |
| `im.message.receive_v1` | 接收用户文本消息 |
| `im.message.reaction.created_v1` | 接收消息表情反应 |
| `im:message.group_at_msg:readonly` | 接收群内 @ 机器人消息 |
| `im:message.p2p_msg:readonly` | 接收用户私聊消息 |
| `im:message:send_as_bot` | 以机器人身份发送消息 |
| `im:message.reactions:read` | 查看消息表情反应 |

按租户要求完成权限审批与应用发布，设置可用范围，把机器人加入授权群。私聊订阅者也必须在应用可用范围内。若保存长连接事件订阅时要求先有连接，先完成本地配置并前台运行，再保存、发布。

准备 App ID、App Secret、授权群 `oc_...` 和本应用内管理员用户 `ou_...`。管理员可留空，此时只关闭危险管理操作。其他应用的 open_id、昵称或自称管理员不能替代真实事件身份。

机器人自身 open_id 通过官方 `GET /open-apis/bot/v3/info` 自动发现；可选配置一个预期值，启动时作一致性校验。

## 本地配置与检查

写入私有配置文件，变量说明与优先级见 [配置参考](configuration.md)。下面使用占位值，请替换后再运行：

```dotenv
TIBO_LARK_DOMAIN=feishu
TIBO_LARK_APP_ID=应用ID
TIBO_LARK_APP_SECRET=应用密钥
TIBO_LARK_CHAT_IDS=oc_授权群ID
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
- 授权群的普通查询必须准确 @ 本机器人；其他机器人、应用操作者和非文本消息不作为命令入口。
- 已收到的群文本含 🙏 时只执行上香，无需 @；平台未交付的未 @ 消息无法处理。
- “双手合十”反应的枚举是 `THANKS`；只接受本应用已成功发送并记录的授权群消息上的用户反应。
- 超过 5 分钟或未来超过 1 分钟的消息、反应事件忽略。

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

事件先过滤并持久化入队，再 ACK；不等待采集或 AI。交互收件箱最多 32 条，串行处理。满队列或写盘失败回 code=500，等待平台重投；按群与消息 ID 去重。重启恢复尚未执行任务，已执行或已有投递记录的任务不自动重跑。

投递前落账，调用消息 API 使用稳定 UUID。只有返回 code=0 且带 message_id 才确认成功。账本保留：

| 状态 | 含义 |
| --- | --- |
| `sent` | API 已确认成功及 message_id |
| `rejected` | 平台明确拒绝，保留数字 code |
| `sending` / `uncertain` | 发送结果可能不确定 |
| `pending` / `failed-before-send` | 尚未确认发送 |

API 成功证据还需结合客户端消息核对实际可见性。不要删除账本强制重发；未知发送结果不自动重试。SIGTERM / SIGINT 停止新接收和调度，等待当前任务结束，其余任务留队。断线后重新获取官方连接地址并重连，心跳失效关闭旧连接；启动握手失败由服务管理器恢复。

定点只在北京时间 09:00 / 21:00，生成一次并共享群与订阅私聊正文，错过分钟不补发。分发使用独立持久化计划，不占交互收件箱，最多 10 个发送请求/秒，最多持续 15 分钟。失败收件人不影响其他人。共享报告、游标、收件人版本和投递账本都保留，生成失败或中断不自动重跑。完整订阅规则见 [上香与订阅](pray-subscriptions.md#定点生成与投递)。

## 实际接入验收

本仓库测试使用本地 HTTP/WebSocket 端点与独立进程，覆盖凭据、机器人身份、protobuf 事件、ACK、富文本、权限过滤、去重、管理员确认、隐私、重连、收件箱恢复与定点分发。这不等于真实平台验收；当前仍需提供真实机器人信息完成对接。

真实配置后逐项核对：

1. `check` 识别当前应用机器人，前台长连接可接到实际事件。
2. 授权群 @ 查询有可见 Markdown 回复；未 @ 的普通文本、未授权群不执行查询。
3. 私聊查询、本人订阅/退订有效；🙏 文本和机器人消息上的 `THANKS` 分别测试，重复事件不计两次。
4. 管理员申请不立刻修改，普通用户拒绝；确认需本人同群，数据变更前有备份。破坏性验收使用独立测试状态，不能清空日常数据。
5. 在真实 09:00 或 21:00 核对群和订阅私聊正文一致、共享报告只一份、成功 message_id 可对应客户端消息。
6. 重启后未重复执行旧消息、旧定点；无凭据或模型信息泄露。

## 官方协议参考

- [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create)
- [接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [表情反应事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/events/created)
- [表情枚举](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message-reaction/emojis-introduce)
- [长连接协议实现参考](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts)：只核对协议，不安装或运行 SDK。

其他 IM 的扩展约定见 [IM 接入契约](im-adapters.md)。
