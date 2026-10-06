# IM 接入契约

核心是独立 Eliscript 应用，IM 适配层只负责传输、认证身份、输入过滤、生命周期与投递。当前实现 Lark；其他 IM 应复用命令目录、上香、订阅与共享报告，不复制预测业务或假设所有调用都有 Lark 身份。

## 可信上下文

适配器从已验证的平台事件构造 context：

```text
transport      接入方式名称
account        稳定的应用账户标识，订阅必需
actor          当前真实操作者
scope          当前群或私聊会话
requestId      稳定的事件/投递键
authenticated  已认证的平台事件，实际值为 true
```

字段由适配器建立，不能来自消息参数、AI 输出或用户自报。订阅 owner 要求 transport/account/actor；上香以 transport + 平台应用内唯一 actor 合并跨会话个人档案，以 transport/scope 隔离会话愿力池与榜单。actor 必须在应用账户下唯一，不允许用昵称作为身份；不同 IM 与 CLI 不自动关联。Lark 的 account 由平台域名与 App ID 派生，用户 ID 必须来自当前应用。

context 只用于权限、档案与投递，不加入模型提示词或公开结果。新增接入层也不得允许 MCP 客户端传一个 context 冒充可信用户。

## 查询调用与人工修复

真实、认证后的交互输入按以下顺序调用，名称对应 Eliscript 导出：

```lisp
(let* ((options (js-object :context context :channel channel :persist false :humanInput t))
       (query (await (resolve-query question context options))))
  (await (execute-query query options)))
```

解析和执行必须使用**同一个 options 对象**，保留共享修复预算与 noAi 决定。人工输入修复只在语法/参数错误时使用，接续已完成步骤，不重新执行整个请求。

内部查询、定时任务和已经生成的定点正文不设置 humanInput；不能把模型结果再次作为人工消息执行。不要把上传到 MCP 的自然语言默认等同于认证平台用户。新的接入方式默认没有危险管理权限；管理员身份判定需明确实现，不能仅靠 authenticated 放行。Lark 同时核对当前应用 account、authenticated、用户白名单和私聊/授权群会话类型。

## 事件、权限与投递

适配器应在进入核心之前检查应用、会话白名单、操作者类型、消息时效与该平台的 @ 规则。先持久化接收任务，再 ACK；重复事件必须使用稳定 requestId。

核心上香保留最近 512 条请求回执；平台长期去重和发送账本仍由接入层负责。危险操作需要管理员申请与明确二次确认，不能由模型确认；绑定 actor/scope/transport 的票据不能跨会话执行。

输出调用公开文本过滤与平台 Markdown 适配。详细错误、系统目录、用户、凭据、模型配置只留本地；发送前记录任务，结果未知时不自动重发或重做业务动作。成功的发送结果应有平台 message_id 或同等证据。

## 触发策略与消息素材

复用 [核心触发与回复规则](im-triggers.md)，不要各自实现一套关键词阈值或次数限制。一级强触发跳过相关度判断，二级候选调用 decide-secondary；两者都经过独立 reply-permit 的群回复预算。适配器先预检、再相关度判断、最后原子预留名额，发送结果用 settle-reply 确认；未知结果保留占用，明确未发才释放。超限事件安静消费，不积压补发。群内上香超限时仍以原投递 requestId 调用 pray 并设置 noAi，不发送回执；平台去重防止重复计数。私聊正常响应。

祈祷入队后先以相同 requestId 调用 record-pray(silent)，原子提交个人与会话记账；失败保留事件重试。允许回复才设置 completePrayer，补全原回执的可选祝词，不重记账。静默路径设置 silent/noAi，不预留彩蛋展示。发送接入层设置 festivalDelivery，并在平台确认后调用 settle-festivals；sent 标记已展示，rejected/failed-before-send 释放预留，未知结果保留待核对。这些是程序内部选项，不能来自 AI 或人类命令参数。

授权群的近期人类消息可交给 remember-message，经 conversation-context 截断、脱敏后作为 options.recentMessages；只有最终问答文字参考它，不能用于路由、权限、命令参数或预测证据。观察普通消息不意味着调用 AI 或业务，也不向平台补读历史。当前消息或反应对应消息正文可作为 options.prayerMaterial，仅作为 wish 参考，不传 context 身份字段。

## 订阅和共享报告

订阅以 transport + account 形成独立命名空间，操作只针对本人。Lark 私聊用 open_id，其他 IM 使用自身可信收件身份；不允许用用户参数覆盖收件人。

所有接入方式遵守北京时间 09:00 / 21:00，没有自定义时间。定点先调用核心 ensure-bulletin，完成后遍历收件人，绝不能在每个收件人循环里再生成预测。相同状态目录下的多个适配器可共享同一 UTC 定点正文。

报告生成状态与收件人投递状态分离：生成失败/中断不自动重跑；退订或单个收件人失败不影响报告正文和其他人。定点分发使用独立持久化队列，不放进容量有限的交互 inbox。详见 [订阅规则](pray-subscriptions.md) 与现有 [Lark 实现](lark.md)。
