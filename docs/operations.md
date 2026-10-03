# 安装与运行维护

本页是后续开发与维护的操作入口。程序安装为 macOS **用户级 LaunchAgent**，登录后自动运行，进程退出后由 launchd 重启。不要求 root；退出登录或机器休眠时不能保证采集。守护进程现在只生成本地报告；Lark 收发另行接入和验收。

## 首次安装

在仓库根目录执行：

```sh
bun install
bun run service:install
```

命令会编译 Eliscript、生成自带 Bun 的可执行文件、安装可执行文件与 plist，并启动服务。需要本地构建工具链；安装后后台运行不需要仓库、Bun、编译器或 node_modules。

文件位置：

- 可执行文件：`~/.local/lib/tibo/tibo`
- 配置：`~/.config/tibo/config.env`，权限0600，目录0700
- 状态与报告：`~/.local/state/tibo/`
- 服务定义：`~/Library/LaunchAgents/com.liuchong.tibo.plist`
- 日志：`~/.local/state/tibo/daemon.stderr.log` / `daemon.stdout.log`

首次安装在目标文件不存在时复制当前状态目录的 ledger 和预测经验；重装不覆盖已有历史。安装器保留原配置字段，在缺少时补充默认值。服务配置只写配置文件路径，不将密钥放进 plist。若使用自定义 TIBO_STATE_DIR，以配置中的目录为准；launchd 的日志目录仍使用上述固定位置。

在配置文件中编辑实际 key，勿写进仓库或命令历史：

```dotenv
DEEPSEEK_API_KEY=<实际密钥>
TIBO_AI_FEATURES=signals,forecast,brief,router
TIBO_AI_WEIGHT=0.2
TIBO_DAEMON_INTERVAL=900
TIBO_STATE_DIR=/absolute/path/to/state
```

`TIBO_AI_FEATURES` 可以为空，或由signals、forecast、brief、router逗号组合。router是可选语义命令解析，固定查询不需要它。完整指令见[业务查询命令](commands.md)。模型固定deepseek-flash，官方端点固定https://api.deepseek.com/chat/completions。配置文件不是shell脚本，不支持变量展开。环境变量优先；源代码运行时Bun自动加载的项目.env也属于环境变量。新配置在进程下次启动时加载。

## 实际验收

```sh
~/.local/lib/tibo/tibo service status
~/.local/lib/tibo/tibo daemon-status
~/.local/lib/tibo/tibo ai-status
tail -n 20 ~/.local/state/tibo/daemon.stderr.log
```

service status 的loaded为true，launchd输出中state=running且有pid，才说明服务已启动。还须等daemon-status出现state=ready、finishedAt和概率，并查看daemon-latest.json中的report；单凭安装成功不能证明采集成功。首次网络采集可能需要一分钟。

`daemon.json`表示当前/最近轮次，`daemon-latest.json`是最近成功报告；`ledger.json`是历史，`experience.json`是前瞻预测，`ai.json`是暂停与缓存状态。报告明确记录各AI功能的ok/cached/disabled/blocked/fallback。全部AI失败也应产出自有算法概率。采集数据不足时daemon标为degraded并保留上次成功报告，下轮继续，不编造概率。

## 更新与重装

代码修改后先执行测试，再重新编译并安装：

```sh
bun run test
bun run service:install
~/.local/lib/tibo/tibo service status
~/.local/lib/tibo/tibo daemon-status
```

每次重装会卸载旧服务、原子替换二进制、重新注册并启动。无需先卸载，也不要删除配置或状态。查看新进程PID与新finishedAt，确认新代码实际完成一个周期。

## 重启、暂停与卸载

```sh
~/.local/lib/tibo/tibo service restart
~/.local/lib/tibo/tibo service uninstall
```

restart适用于修改配置后重新加载，也可验证守护恢复；运行后等新的成功周期。uninstall移除服务注册与plist，停止后台运行，保留配置、可执行文件、历史和日志；重新执行service:install可恢复。不要直接kill当作暂停：KeepAlive会重新拉起进程。

## 故障恢复

```sh
~/.local/lib/tibo/tibo ai-status
~/.local/lib/tibo/tibo reset-ai
# 上一步返回确认ID；检查动作后执行
~/.local/lib/tibo/tibo confirm <确认ID>
~/.local/lib/tibo/tibo forecast --no-ai
~/.local/lib/tibo/tibo forecast --offline
```

认证错误先修改配置中的key，重启后旧key的暂停自动失效；余额不足先充值。冷却到期后自动试探，成功复位。reset-ai（ai-reset别名）需管理员与二次确认，只清除AI暂停与缓存，不改历史。AI状态损坏时核心仍运行；若状态不可读而无法备份，写操作会拒绝，需在本地停止进程后保留故障文件再处理。网络全部不可用时仍可用本地ledger离线查看；首次无历史则无法生成概率。

锁包含创建者PID，只在系统明确返回该PID不存在时自动回收。仍存活、无所有者或不可确认的锁不会自动删除；先通过service status/进程状态确认，停止服务后再处理。不得删除运行中的状态目录。

## 管理员配置与帮助

安装器在本地配置缺少时写入安装账户的 `TIBO_LOCAL_ADMIN_UID`；只有该UID可申请/确认本地业务写操作。管理员可运行 `tibo help` 或 `tibo ask "有哪些命令可以用？"` 查看用法。清空历史、清空经验及重置AI均需二次确认，不能用旧版ai-reset绕过。

接入Lark前，在本地配置填写 `TIBO_LARK_ADMIN_OPEN_IDS=<自己的open_id>` 与 `TIBO_LARK_CHAT_IDS=<授权群ID>`，与应用凭据分开保管；从真实官方事件确认open_id，不按昵称、文本自述或其他应用的ID猜测。没有管理员白名单时只允许查询。配置改动后重启独立Lark进程；采集daemon本身不收群消息。命令、身份绑定、五分钟确认与备份细节见[业务命令](commands.md)。确认票据持久化，重启不会重新计算过期时间；已执行、取消或不确定失败的ID不会重复执行。

## 后续开发要求

保持业务在.eli，维持无第三方运行库；新增AI能力也必须独立可关闭、失败保留核心结果、使用同一熔断入口并脱敏。交付前必须运行实际CLI/后台周期，更新运行说明，签名提交并推送。Lark接入后的真实群收发与早晚报送达须单独验收，不能用本地协议测试代替。

HTTP格式与错误分类依据[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON输出](https://api-docs.deepseek.com/guides/json_mode/)及[错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/)。
