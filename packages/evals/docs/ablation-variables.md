# Pi Agent 可消融面盘点

Phase 0 交付物,基于对 `packages/agent`、`packages/coding-agent`、`packages/ai` 源码的通读。
每个变量标注消融成本层级:

- **L1 配置级**:settings / models.json / `CreateAgentSessionOptions` 开关,evals harness 透传即可
- **L2 harness 改造**:需给 `pi-harness.ts` 加透传字段或赋公开属性(小改动)
- **L3 核心代码**:需改 agent loop / tools / compaction 源码

## A. 系统提示词(9 段,`core/system-prompt.ts:28-162`)

| 变量 | 默认 | 消融方式 | 成本 | 备注 |
|---|---|---|---|---|
| 任意段整体删改 | — | `transformSystemPrompt` 字符串级操作 | L1 | evals 已支持(pi-harness.ts:39),最灵活 |
| 工具 guidelines(edit 4 条规则、read/write/bash 各 1 条) | 有 | transform 删段 | L1 | **对 coding 质量影响最大的段**(edit.ts:56-64) |
| Pi 文档路径指针段 | 有 | transform 删段 | L1 | 与 coding 任务无关,天然负对照 |
| CLAUDE.md/AGENTS.md 注入 | 有 | `noContextFiles` / `agentsFilesOverride: () => []` | L1 | resource-loader.ts:172 |
| skills 段 | 有(仅 read 活跃时) | `noSkills` | L1 | |
| append 段(APPEND_SYSTEM.md) | 空 | `appendSystemPromptOverride: () => []` | L1 | |
| 整体替换提示词 | — | `systemPromptOverride`(注意同时清 append) | L1 | 完整自定义 prompt 实验 |
| API tools 参数(工具 name/description/schema) | 4 工具 | `tools` / `excludeTools` / `noTools` | L1 | 与 prompt 内摘要同生共死,不能只消其一 |

## B. 工具与 Agent Loop

| 变量 | 默认 | 消融方式 | 成本 | 备注 |
|---|---|---|---|---|
| 工具集(默认 read/bash/edit/write,共 7 内置) | 4 工具 | `tools`/`excludeTools`/`noTools` | L1 | pi-harness 目前只透传 noTools,需加 tools/excludeTools |
| thinkingLevel | medium | settings / CreateAgentSessionOptions | L1 | **evals harness 硬编码 `"off"`(pi-harness.ts:148)——当前基线全是无思考模式,需改 harness 才能做 thinking 消融** |
| 模型层重试(maxRetries=3, 指数退避 2s 起) | 开 | settings `retry.*` | L1 | agent-session.ts:2645-2760;上下文溢出不走重试走 compaction |
| provider 层重试 | 关/默认 | settings `retry.provider.*` | L1 | |
| 最大轮数上限 | **无此机制** | `agent.shouldStopAfterTurn` 计数钩子 | L2 | agent.ts:214 公开字段,harness 可直赋;agent-loop.ts:247 已留钩子 |
| 并行工具调用 | 开(无并发上限) | `agent.toolExecution` 公开属性 | L2 | agent.ts:214;改上限需 L3(agent-loop.ts:540 `Promise.all`) |
| 工具输出截断 | 2000 行 / 50KB | truncate.ts:11-12 常量 | L3 | 消融"全量 vs 截断"需改代码 |
| 工具错误反馈语 | 原样回灌模型 | tools/*.ts 或 `afterToolCall` 钩子 | L3 | 无工具级自动重试,模型自主决定 |
| length-截断保护(截断消息的工具调用全部置错) | 开 | agent-loop.ts:208-214 | L3 | 消融"是否让模型重发截断的调用" |

## C. 上下文与模型

| 变量 | 默认 | 消融方式 | 成本 | 备注 |
|---|---|---|---|---|
| compaction 开关/reserve/keepRecent | on / 16384 / 20000 | settings `compaction.*` | L1 | 阈值触发:`contextTokens > window - reserve` |
| 模型选择 | 按 provider 默认 | CLI/settings/models.json | L1 | 模型对比 suite 现成可用 |
| contextWindow/maxTokens/cost 覆盖 | 内置目录 | models.json `modelOverrides` | L1 | 可伪造不同 context window 做压力实验 |
| thinkingBudgets(4 档 token 预算) | 1024/2048/8192/16384 | settings | L1 | |
| 每轮 maxTokens | model.maxTokens | 主循环不显式传值 | L3 | 消融"每轮输出预算"需在调用点加 |
| 摘要用主模型(无廉价模型分级) | — | `_getSummarizationRequestAuth` | L3 | "摘要用便宜模型"是经典改进方向 |
| 摘要算法(结构化 LLM 摘要 vs 截断) | LLM 摘要 | compaction.ts:467-537 提示词 | L3 | 摘要提示词本身也可消融 |
| 历史保留策略 | 全量无上限 | agent.ts / session-manager | L3 | 滑动窗口/dedup 需改代码 |
| maxTokens 安全余量 | 4096 tokens | simple-options.ts:7 常量 | L3 | |
| prompt cache 断点(system/last-user/last-tool) | 3 处 | anthropic-messages.ts:991,1256,1321 | L3 | 与成本相关,与能力弱相关 |

## 影响实验设计的关键发现

1. **当前 evals 基线是 `thinkingLevel: "off"`**。pi-harness.ts:148 硬编码。所有已跑/将跑的基线数据都是无思考模式——thinking 消融实验的第一步是去掉这个硬编码。
2. **无最大轮数机制**。agent 理论上可无限循环(只受 API 层限制),长任务成本失控风险是实验预算的大敌——建议第一批改进之一就是加轮数上限钩子(顺带成为一个有验证数据的改进点)。
3. **摘要与主循环同模型**。compaction 用主模型做摘要(agent-session.ts:2067),是"能力↔成本"trade-off 的天然实验对象。
4. **工具错误无自动重试,全交模型**。错误反馈的措辞/结构直接影响模型的恢复行为,这是提示词与 loop 的交叉消融点。

## 推荐第一批消融(高价值 × 低成本)

| # | 假设 | 变量 | 成本 |
|---|---|---|---|
| 1 | edit guidelines 是 coding 质量关键 | 删/改 edit 4 条规则 | L1 |
| 2 | 文档段是纯噪声(负对照,验证方法学) | 删 Pi 文档指针段 | L1 |
| 3 | thinking 档位影响修复能力 | thinkingLevel off vs low vs medium | L2(先解硬编码) |
| 4 | 工具集大小影响决策质量 | 4 工具 vs 7 工具 vs 最小集 | L1 |
| 5 | compaction 阈值影响长任务成功率 | reserveTokens 扫描 | L1 |
| 6 | 重试策略影响错误恢复 | retry 开/关/参数扫描 | L1 |
