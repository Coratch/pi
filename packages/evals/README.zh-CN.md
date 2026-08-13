# Pi 评测

Pi 评测是一组由模型驱动、用于检查 Pi 工作流行为的测试。它们将真实的 `AgentSession` 适配到 `vitest-evals`，在隔离的临时项目目录和 agent 目录中运行，并附加 Pi 原生会话产物。
可使用这些评测衡量端到端行为，并比较 prompt、工具、skill、模型或其他 harness 配置。

## 运行评测

在仓库根目录指定默认 provider 和模型运行：

```bash
npm run eval -- --provider openai --model gpt-5.6-sol
```

等价的环境变量写法如下：

```bash
PI_PROVIDER=openai PI_MODEL=gpt-5.6-sol npm run eval
```

CLI 参数优先，并会成为未显式选择模型的 harness 的默认值。provider 和模型必须同时提供。如果所有要执行的 harness 都自行配置了模型，runner 也允许不设置默认值。
身份验证通过 Pi 常规的 `ModelRuntime` 完成，包括 Pi 订阅凭据和 provider API key 环境变量。

其他参数会转发给 Vitest：

```bash
npm run eval -- src/extensions.eval.ts
npm run eval -- -t "creates, reloads, and uses"
```

每次调用都会输出一个已被忽略的 `.eval/` 产物目录。`runs.jsonl` 会索引已完成的 harness 运行，以及位于 `sessions/` 下对应的 Pi 原生会话 JSONL 附件。这些文件可能包含 prompt、响应、源代码和工具输出。

## 编写评测

关于通用 suite、judge、断言和规范化 trace 的指导，请遵循 [`vitest-evals`](https://github.com/getsentry/vitest-evals)。Pi 专用评测使用 `src/pi-harness.ts` 中的 `createPiCodingAgentHarness(...)`，每个 `describeEval(...)` suite 绑定一个 harness：

```ts
import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createPiCodingAgentHarness } from "./pi-harness.ts";

const harness = createPiCodingAgentHarness({ noTools: "all" });

describeEval("Pi smoke", { harness }, (it) => {
	it("answers a factual question", async ({ run }) => {
		const result = await run("What is the capital of France? Reply with only the city name.");
		expect(result.output).toBe("Paris");
	});
});
```

### 配置 Pi harness

`createPiCodingAgentHarness(...)` 接受以下选项：

- `name`：用于报告和比较的稳定 harness 标识。
- `model`：可选的 `{ provider, id }` 模型选择。它会覆盖 runner 的默认模型。
- `noTools`：Pi 的工具禁用配置。
- `tools`：工具白名单（省略时使用默认工具集 read/bash/edit/write）。
- `excludeTools`：工具黑名单，在 `tools` 之后应用。
- `thinkingLevel`：推理档位。缺省为 `"off"`（eval 基线的固定设定，保持向后兼容）；显式传值才会覆盖。
- `settings`：注入 Pi settings（如 `compaction`、`retry`、`thinkingBudgets`）。
- `maxTurns`：轮数上限（正整数）。通过 agent loop 的 `shouldStopAfterTurn` 钩子实现，达到上限后停止。
- `toolExecution`：工具执行模式，`"parallel"`（默认）或 `"sequential"`。
- `workspace`：外部已准备好的工作目录。提供时 harness 原样使用（目录必须已存在）、绝不删除，由调用方负责准备与清理；缺省时使用 harness 自建的临时目录。
- `transformSystemPrompt`：在评测开始前转换完整的默认 prompt。
- `output`：将最终响应和 `AgentSession` 转换为 JSON-safe 的领域结果。

显式选择模型可使模型比较 harness 不依赖 runner 的默认值：

```ts
const harness = createPiCodingAgentHarness({
	name: "claude-opus-4-6",
	model: { provider: "anthropic", id: "claude-opus-4-6" },
});
```

一次运行可以接收单个 prompt，也可以接收由 prompt 和 reload 步骤构成的序列。如果前一个 prompt 创建或修改了 Pi 资源，reload 步骤会很有用：

```ts
const result = await run([
	{ type: "prompt", content: "Create a Pi extension." },
	{ type: "reload" },
	{ type: "prompt", content: "Use the extension." },
]);
```

### 转换 harness 输出

使用 `output` 暴露场景专用、JSON-safe 的行为，而无需将该行为加入通用 Pi adapter：

```ts
const harness = createPiCodingAgentHarness({
	output: ({ response, session }) => ({
		response,
		activeTools: session.getActiveToolNames(),
		extensionErrors: session.resourceLoader.getExtensions().errors,
	}),
});
```

在 `result.output` 上断言应用行为。在 `result.session` 上断言模型和工具 trace，可使用 `toolCalls(...)` 等 `vitest-evals` 辅助函数。

### 编写对比评测集

将 `evalHarnessTable(...)` 与 Vitest 原生的 `describe.for(...)` 结合使用，可以让同一组输入在多个 harness 上运行。各 harness 可以使用不同的 prompt、工具、skill、模型或任何其他 Pi 配置：

```ts
import { describe } from "vitest";
import { createJudge, describeEval } from "vitest-evals";
import { evalHarnessTable } from "./vitest-evals/harness-table.ts";

const TargetTaskJudge = createJudge<string, string>("TargetTaskJudge", ({ output }) => ({
	score: output === "expected result" ? 1 : 0,
}));

const harnessTable = evalHarnessTable(
	"target skill effectiveness",
	{
		baseline: withoutTargetSkillHarness,
		candidate: withTargetSkillHarness,
		repetitions: 6,
	},
);

describe.for(harnessTable)("$name repetition $repetition", ({ harness }) => {
	describeEval("target skill effectiveness", { harness, judges: [TargetTaskJudge], judgeThreshold: null }, (it) => {
		it("completes the target task", async ({ run }) => {
			await run("Complete the target task.");
		});
	});
});
```

对比 suite 应使用确定性 judge 或模型驱动的 judge 记录正确性，并设置 `judgeThreshold: null`。这样，低分会作为观察结果记录，而不会导致 Vitest 调用失败。硬断言只能用于 suite 不变量和基础设施契约。`expect.soft(...)` 仍会使测试失败，因此不能作为评分机制。

Pi harness 会在删除临时 workspace 前，对原生会话 JSONL 创建快照。评测专用的 `afterEach` hook 会在 reporter 运行前，将该快照登记到明确的 Vitest 测试任务上。

同一评测集中的 harness 名称必须稳定且唯一。分组键会将重复次数与输入标识组合：如果 `input.id` 是非空字符串，则使用它；否则使用严格规范化 JSON 输入的 SHA-256 哈希。一个处理组使用 `candidate`，多个处理组使用 `candidates`。每个 candidate 只与声明的 baseline 比较。对于每组匹配的输入和重复次数，reporter 会根据每次运行记录的平均 judge 分数计算通过率提升，并将分数至少为 `1` 视为通过。提升值等于 candidate 通过率减去 baseline 通过率，以百分点表示。缺少 judge 分数会报告为不完整观察。token、延迟和预估成本仍分别报告 candidate 减 baseline 的配对差值；缺失的遥测数据仍标记为不可用。如果需要随机化执行顺序，请使用 Vitest 内置的 sequence shuffling。

有关对比评测方法、重复策略、可信 judge 和遥测数据解读的指导，请参阅 [`skill-eval-harness`](https://github.com/adewale/skill-eval-harness/)。
