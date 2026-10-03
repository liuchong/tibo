# 接入层约定

Tibo是独立应用，CLI、MCP和IM都调用同一套Eliscript业务核心。`src/commands.eli`维护命令目录、固定与语义解析、参数检查、公开输出；`src/pray.eli`维护趣味档案和事件；预测与采集服务独立运行。Lark是`adapters/lark`中的一种接入实现，核心祈祷逻辑不导入其协议、群配置或事件类型。

新增IM只需要完成本平台认证、事件验证、允许会话筛选、普通查询的提及策略、稳定事件去重、持久化收件箱与结果投递。将输入交给`resolve-query(question, context)`，再调用`execute-query(query, {context,...})`，发送其公开`text`。平台回应表情先核对操作者、目标是否是本机器人已发送的消息、时效与去重，再归一为固定`pray`，不把平台原始事件放进业务参数或AI提示。

接入程序在验证真实身份后生成内部context：

```text
{transport: 平台唯一名, actor: 本平台验证的用户标识,
 scope: 已授权会话标识, authenticated: true,
 requestId: 本会话内稳定的请求标识}
```

这些字段只能来自可信接入程序，不能来自消息文本、AI返回值或MCP参数。语义提示不上传context。祈祷档案按transport+scope隔离，成员按transport+actor摘要区分，重投使用requestId返回原结果，不重复记账。未来IM可复用祈祷核心，无需增加平台分支；每个平台需自己保存可靠的投递去重记录，核心仅缓存最近512条祈祷回执。

祈祷只改本人的娱乐计数。历史、经验、AI暂停等管理动作继续需要各接入明确实现管理员白名单与二次确认；现有管理权限仅实现本地CLI和Lark，其他transport默认无管理权限。MCP不接受context，保持无写权限。

Lark的mention、THANKS表情枚举、App ID、消息路由、长连接和投递账本留在Lark层；其他IM使用自己的协议。平台错误只留本地，用户收到通用错误。配置、安装路径、用户标识、凭据、模型信息不出现在公开结果中。
