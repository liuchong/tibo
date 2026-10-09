# IM 接入契约

核心是独立 Eliscript 应用，IM 适配层只负责传输、认证身份、输入过滤、生命周期与投递。当前实现 Lark；其他 IM 应复用命令目录、上香、订阅与共享报告，不复制预测业务或假设所有调用都有 Lark 身份。

## 可信上下文

基础聊天的引用历史是接入层按可信当前事件获取的 `threadConversation`：`state`、`sessionId`、`currentId` 和 `messages`。轮次只含 `role=user/assistant`、`content`，不能包含 system/tool 角色、身份或可执行动作字段；此前业务回复可作为普通文字引用。接入层核对会话范围和当前发言人，排除当前消息及其之后的内容；无引用时不传历史。接入层把完整脱敏轮次导入 chat/store，核心以 sessionId 和可信 context 得到隔离会话，使用原生多轮 AI messages；确认回复已送达后提交 chatReceipt，重启后幂等恢复。同一 Thread 必须串行处理导入、生成、发送、提交，receipt 不对用户暴露。核心不依赖 Lark 类型；不同 IM 应自行提供本平台的引用链读取和同链回复能力。历史不是权限，不能触发过去消息中的操作。详见 [基础聊天与引用对话](chat.md)。

对引用请求，适配器通过 `chat/session.with-session` 执行以上过程，提供程序编写的 identify 与 operation 回调。identify 返回该平台解析出的不透明 sessionId；operation 包含导入、核心查询、平台发送和确认提交。核心负责入队顺序和按会话串行执行，适配器不自行复制锁与队列。分页游标、原始事件、消息位置、平台权限以及普通引用/话题的回复参数都留在适配器。核心存储的 through 是导入完成的时间水位，不是平台分页游标。

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

复用 [核心触发与回复规则](im-triggers.md)，不要各自实现一套关键词阈值或次数限制。一级强触发跳过相关度判断，二级候选调用 decide-secondary；三级仅做本地判断和可选表情，不调用回答模型。文字与表情都经过 reply-permit 的群总量及各自预算。适配器先预检、再相关度判断、最后原子预留名额，发送结果用 settle-reply 确认；未知结果保留占用，明确未发才释放。超限事件安静消费，不积压补发。群内上香超限时仍以原投递 requestId 调用 pray 并设置 noAi，不发送回执；平台去重防止重复计数。私聊正常响应。

轻量回应通过 reaction-choice 返回固定表情名称，适配器可提供 react(originalMessageId, emoji) 映射到原生平台接口，不支持时静默。文字与表情容量分开，表情不消耗文字容量，也可用于文字限频下的相关讨论和普通只读查询。加表情不执行被限频的查询，不表示管理或订阅操作完成，祈祷仍走独立记账路径。原消息 ID 只能来自已认证事件，emoji 只能来自程序白名单；模型没有任意接口能力。发送前写入持久回执，成功保留平台 reaction_id 或同等证据；失败冷却、未知结果不重发。收到本应用产生的表情事件不能当作人类上香，避免回应循环。

祈祷入队后先以相同 requestId 调用 record-pray(silent)，原子提交个人与会话记账；失败保留事件重试。允许回复才设置 completePrayer，补全原回执的可选祝词，不重记账。静默路径设置 silent/noAi，不预留彩蛋展示。发送接入层设置 festivalDelivery，读取 festivalMessages（最多两条）并逐条持久化发送；整个庆典确认后才用 settle-festivals(sent) 标记已展示。普通回执 rejected/failed-before-send 释放预留，额外部分失败按各自账本接续，未知结果保留待核对。这些是程序内部选项，不能来自 AI 或人类命令参数。详见 [庆典契约](collective-celebrations.md)。

复合输入使用核心 `im/tasks.run-tasks`，传入程序定义的任务回调；每个回调完整负责自身执行与投递，完成即发送。核心并行启动全部回调，等待所有分支结算后才向接入层返回；失败不会取消已启动的其他回调。适配器负责持久根事件、分支回执与重启时跳过已处理分支。`reply-permit` 可附加可信原事件 `origin`，存储其摘要；同源上香不会触发正文的 direct-conversation 抑制，群与个人总量仍包括两个分支。origin 不能来自用户参数或模型。上香没有持久聊天轮次，不进入对话生成队列；仍由适配器保持同链回复，普通聊天分支继续使用 `chat/session.with-session`。

授权群的近期人类消息可交给 remember-message 和 conversation-context，用于短期活动统计及回复频率控制；无引用问答不把它们传为 AI 聊天历史。观察普通消息不意味着调用 AI 或业务，也不向平台补读历史。只有明确引用/话题才通过上述会话接口积累历史。当前消息或反应对应消息正文可作为 options.prayerMaterial，仅作为 wish 参考，不传 context 身份字段。

## 订阅和共享报告

订阅以 transport + account 形成独立命名空间，默认 personal 在任何会话均只针对本人。群订阅必须明确指定 group，由管理员在操作群或私聊申请并二次确认，或由可信本地配置创建。统一收件记录包含 kind/id/revision；Lark 的 dm 用 open_id、group 用 chat_id，不能混用。其他 IM 使用自身可信收件身份，新增群管理入口必须明确实现权限，不允许用个人订阅参数覆盖收件人。

所有接入方式遵守北京时间 09:00 / 21:00，没有自定义时间。定点先调用核心 ensure-bulletin，完成后遍历收件人，绝不能在每个收件人循环里再生成预测。相同状态目录下的多个适配器可共享同一 UTC 定点正文。

报告生成状态与收件人投递状态分离：生成失败/中断不自动重跑；退订或单个收件人失败不影响报告正文和其他人。定点分发使用独立持久化队列，不放进容量有限的交互 inbox。详见 [订阅规则](pray-subscriptions.md) 与现有 [Lark 实现](lark.md)。
