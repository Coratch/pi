# SWE-bench 接入方案(Phase 0 交付物)

## 目标与约束

- 慢环验证:pi agent 在 SWE-bench 上的通过率是简历硬通货
- 预算策略:30–50 实例子集起步,单轮预估 $10–30(参考:2026 年 Lite 全量 300 实例一轮实测约 $68,sonnet 级模型)
- 第一版跑通优先,不做完整生产化

## 总体架构:生成与评分分离

SWE-bench 的官方流程天然分成两半,pi 只需负责左半边:

```
[Agent 侧 · TypeScript · 本机开发/VPS 跑]
  HF 实例 JSON → git checkout base_commit → AgentSession 跑修复 → git diff → predictions.jsonl
                                                          ↓
[评估侧 · Python + Docker · 仅慢环]
  pip install swebench → python -m swebench.harness.run_evaluation → 官方 Docker 环境跑测试 → 报告
```

- 预测格式:JSONL,每行 `{instance_id, model_patch, model_name_or_path}`
- 评分标准:fail-to-pass(修复前挂→修复后过)+ pass-to-pass,官方 harness 全权处理
- 数据:HuggingFace `princeton-nlp/SWE-bench_Verified`(500)/ `SWE-bench_Lite`(300)

## Agent 侧 Runner 设计

放 `packages/evals/src/swe-bench/`,复用现有 pi-harness 基建:

1. **实例加载**:从 HF 下载 Lite/Verified JSON 到本地缓存,按固定清单过滤子集
2. **workspace 初始化**:git clone + checkout base_commit 到 eval 临时目录(pi-harness 已有 mkdtemp 基建;第一版不做依赖安装,agent 侧不跑测试)
3. **跑修复**:真实 AgentSession,输入 = problem_statement + 简短指令
4. **轮数上限**:pi 无最大轮数机制(见 ablation-variables.md),runner 里用 `agent.shouldStopAfterTurn` 计数钩子限制(如 20 轮)——这同时验证了该钩子,为后续正式改进铺路
5. **产物**:`git diff` → model_patch;每实例落 runs.jsonl 行 + session.jsonl 快照(沿用现有 reporter)

## 子集选择

- 从 Lite 300 中固定种子抽样 30–50 实例,按 repo 分层(保持 repo 分布代表全集)
- 子集清单(instance_id 列表)固化到仓库,后续所有消融轮次复用同一子集——**配对比较要求同一输入集**
- 抽样代码也要入库,保证可复现

## 实施步骤与工作量

| 步骤 | 内容 | 工作量 |
|---|---|---|
| 1 | 单实例管道验证:clone + checkout + 跑 session + 收 diff | 半天 |
| 2 | runner 主体:批量、轮数上限、predictions.jsonl 输出 | 1 天 |
| 3 | pi-harness 透传扩展(tools/excludeTools/thinkingLevel/settings)——消融实验需要 | 半天 |
| 4 | 子集抽样 + 清单固化 | 2 小时 |
| 5 | 评估侧:官方 harness 安装 + Docker 环境 + 首轮 baseline 评估 | 半天(慢环在 VPS) |

## 成本模型(子集 40 实例)

- 单轮 agent 修复:约 $8–15(sonnet 级);op tier 模型 ×3–5
- baseline + 每次消融 = 一轮;5 个消融假设 ≈ 6 轮 ≈ $50–90,中等预算内
- 评估侧(Docker 跑测试)几乎无 API 成本,只有计算资源

## 风险与注意

1. **数据污染**:Lite/Verified 部分实例可能被 pi 所用模型训练语料污染,SWE-bench 数字只能内部纵向对比(消融),不宜对外宣称 leaderboard 成绩;若需对外口径,后续可换 SWE-smith(合成实例、抗污染)
2. **agent 侧不跑测试**:第一版 agent 只能靠读代码修复,通过率会低于"能跑测试"的配置——这是已知偏差,baseline 记录时要注明;后续可加 Docker 内跑 agent 的进阶版
3. **repo checkout 细节**:个别实例有子模块/大仓库,首轮跑时按实例逐个验证,坏实例从子集剔除并记录
4. **评估必须在 Linux + Docker**:慢环放 VPS;macOS 本机只做预测生成
