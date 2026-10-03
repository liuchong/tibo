# Lark / 飞书接入与维护

接入层是独立 Eliscript 程序，使用 Bun 原生 HTTP、WebSocket 和本地 protobuf 编解码。只支持**企业自建应用机器人**，通过长连接收事件；自定义 Webhook 群机器人没有本程序所需的收消息能力。不需要官方 SDK、公网回调地址或额外转发服务。

## 对接所需信息

- 国内飞书或国际 Lark：分别配置 `feishu` / `lark`。
- 应用 App ID、App Secret。
- 明确授权接收查询和早晚报的群 ID，`oc_...`，可多个。
- 管理员在**本应用**下的用户 open_id，`ou_...`。留空时所有人只能查询，不能申请或确认写操作。不能拿其他应用的 open_id、昵称或文本自述代替。

机器人的 open_id 通过 `GET /open-apis/bot/v3/info` 自动发现，无须手工提供；若填写 `TIBO_LARK_BOT_OPEN_ID`，启动会核对是否属于当前应用。

## 开放平台设置

在对应平台创建企业自建应用，开启机器人能力。在事件配置选择**使用长连接接收事件**，订阅 `im.message.receive_v1`；启用接收群聊中@机器人消息权限 `im:message.group_at_msg:readonly`、以应用身份发送消息权限 `im:message:send_as_bot`。根据租户要求完成审批、发布应用、设置可用范围，并把机器人加入授权群。

首次保存长连接订阅配置如要求先建立连接，可先完成本地配置并前台启动，然后保存订阅并发布。订阅与权限是否实际生效以真实群收发为准。私聊、非文本消息、卡片回调和未@机器人的群消息不作为命令入口。

## 私有配置

写入 `~/.config/tibo/config.env`，文件0600、目录0700；同一配置可同时供采集 daemon 和独立 Lark 程序读取：

```dotenv
TIBO_LARK_DOMAIN=feishu
TIBO_LARK_APP_ID=<应用ID>
TIBO_LARK_APP_SECRET=<应用密钥>
TIBO_LARK_CHAT_IDS=oc_<授权群ID>
TIBO_LARK_ADMIN_OPEN_IDS=ou_<管理员在本应用的ID>
```

勿将真实配置提交到仓库。`TIBO_CONFIG_FILE` 可指定已有私有配置，环境变量优先；项目 `.env` 中的空值也会覆盖私有配置，避免重复配置。API固定使用对应平台官方地址；令牌与Secret不写入消息、连接日志或plist。tenant token只在内存缓存，提前一分钟刷新，多请求共享一次刷新。

## 检查、前台试用

在仓库根目录执行：

```sh
bun run test
bun run compile
.tibo/bin/tibo-lark help
.tibo/bin/tibo-lark check
.tibo/bin/tibo-lark run
```

`check`只验证配置、tenant token和机器人身份，不建立事件连接、不发送消息、不证明群权限已经生效。前台启动成功会写本地运行状态并显示“已启动”；使用 Ctrl-C 正常关闭。只有配置群中、来自user的文本消息、准确@本机器人的命令会进入收件箱。消息创建超过五分钟或未来超过一分钟均忽略。

群内试用 `@机器人 帮助`、`@机器人 预测`、`@机器人 发言 3 reset`；启用router后可以说 `@机器人 未来两天重置几率多大`。管理员和普通成员分别验证写操作是否显示/拒绝；可用“清空经验”在测试状态目录申请，确认前应保留数据，确认后应产生本地备份。同一确认ID重复执行无效；换人、换群或超过五分钟也无效。完整命令见[命令列表](commands.md)。群内回复只包含业务结果，任何AI/网络/文件错误均用通用提示，具体配置和模型信息不发群。

## 安装、重装、重启

拿到真实配置并完成前台试用后，使用编译好的程序安装：

```sh
.tibo/bin/tibo-lark service install
~/.local/lib/tibo/tibo-lark service status
~/.local/lib/tibo/tibo-lark status
```

安装会复制独立可执行文件、写入 `~/Library/LaunchAgents/com.liuchong.tibo.lark.plist` 并启动用户级LaunchAgent，登录后自动运行、异常退出自动恢复。不会停止采集服务 `com.liuchong.tibo`；两个程序各自有实例锁，共享数据时遵循状态写锁。配置、历史、收件箱、确认票据和投递记录重装时保留。初次安装默认补全基础配置；仍以私有配置中的 `TIBO_STATE_DIR` 为实际数据目录。

代码更新后重装：

```sh
bun run test
bun run compile
.tibo/bin/tibo-lark service install
~/.local/lib/tibo/tibo-lark service status
~/.local/lib/tibo/tibo-lark status
```

配置更新后重启；暂停/卸载保留数据：

```sh
~/.local/lib/tibo/tibo-lark service restart
~/.local/lib/tibo/tibo-lark service uninstall
```

日志在 `~/.local/state/tibo/lark.stderr.log` / `lark.stdout.log`，即使自定义状态目录，launchd日志仍在此位置。`status`是最近一次本地状态快照，需结合 `service status` 的loaded、running、pid判断是否仍存活。前台与后台不能同时使用同一状态目录启动Lark实例。

## 可靠性与定时推送

事件回调只做过滤和持久化入队，再返回ACK，不等待采集或AI。最多32条任务，串行处理；收件箱满或写盘失败时返回code=500，等待平台重投。平台重复消息按群ID和message_id去重。接收后关闭程序会保留尚未处理的任务，重启恢复；已开始执行或发送且留有投递记录的任务不会自动重复执行。

北京时间09:00 / 21:00各推送一次，允许当前时段前15分钟内补发，标题采用计划时间；概率按实际采集时间计算。超出窗口的旧定时任务不追发。每群每时段稳定UUID与持久化账本防止重启重复；API code=0且返回message_id才算送达，随后才更新该群上一份报告。

账本 `lark-<hash>.json` 的sent是已确认送达；rejected保存平台明确拒绝的数字code；sending/uncertain表示结果可能不确定；pending/failed-before-send表示尚未确认发送。程序不自动重试这些已有记录，应先核对群消息和本地状态；不要删除账本来强制重发。长连接断开后重新获取官方连接地址并重连，心跳无响应时关闭旧连接；握手失败会退出，服务管理器稍后重启。SIGTERM/SIGINT停止接收和定时器，等待当前任务结束，其他任务留在收件箱。

## 已验证范围

`bun test tests/lark-runtime.test.mjs`启动实际Bun HTTP/WebSocket本地服务和独立程序子进程，模拟官方端点：token、自动识别bot、protobuf事件、心跳、ACK、富文本回复、去重、群权限、管理员确认与备份、AI错误隐私、重连、关闭、收件箱恢复，以及09:00/21:00推送和同一时段重启去重。测试通过测试专用传输映射和时钟控制连接本地服务；正式程序不提供任意API主机或测试时钟配置。

本地协议试用不能证明真实平台权限、真实事件字段、客户端富文本渲染或真实群送达。收到机器人资料后仍需完成这些验收，并用成功送达的message_id核对查询与早晚报。

协议参考：[消息发送](https://open.feishu.cn/document/server-docs/im-v1/message/create)、[消息接收事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)、[官方长连接实现](https://github.com/larksuite/node-sdk/blob/main/ws-client/index.ts)。只核对协议，不安装或运行SDK。
