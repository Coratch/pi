import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createJudge, describeEval } from "vitest-evals";
import { createPiCodingAgentHarness, type PiCodingAgentInput } from "../pi-harness.ts";
import { recordEvalSourceArtifact } from "../vitest-evals/artifacts.ts";

type SweInstance = {
	instance_id: string;
	repo: string;
	base_commit: string;
	problem_statement: string;
};

const instancesJson = JSON.parse(
	readFileSync(new URL("./instances.json", import.meta.url), "utf8"),
) as { instances: SweInstance[] };

// Optional single-instance filter for local debugging:
//   PI_SWE_INSTANCE=pallets__flask-5063 npm run eval -- src/swe-bench/runner.eval.ts
const instanceFilter = process.env.PI_SWE_INSTANCE?.trim();
const instances = instanceFilter
	? instancesJson.instances.filter((inst) => inst.instance_id === instanceFilter)
	: instancesJson.instances;

const REPO_CACHE = resolve(
	process.env.PI_SWE_REPO_CACHE ?? join(process.env.HOME ?? "", "pi-eval-data", "swe-repos"),
);

function git(args: string[], cwd?: string): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result.stdout;
}

function ensureRepo(repo: string): string {
	const dir = join(REPO_CACHE, repo);
	if (!existsSync(dir)) {
		mkdirSync(dirname(dir), { recursive: true });
		git(["clone", "--filter=blob:none", `https://github.com/${repo}.git`, dir]);
	}
	return dir;
}

function createWorkspace(repo: string, baseCommit: string): string {
	const cache = ensureRepo(repo);
	const workspace = mkdtempSync(join(tmpdir(), "pi-swe-"));
	git(["worktree", "add", "--detach", workspace, baseCommit], cache);
	return workspace;
}

function removeWorkspace(repo: string, workspace: string): void {
	const cache = ensureRepo(repo);
	git(["worktree", "remove", "--force", workspace], cache);
}

const SWE_PROMPT = (statement: string) => `${statement}

Fix the issue described above by editing the files in this repository. Do not install dependencies or run tests; reason about the fix from the code.`;

type SweOutput = { patch: string };

// Local judge only asserts the infrastructure contract: a patch was produced.
// Correctness is judged exclusively by the official SWE-bench harness.
const PatchProducedJudge = createJudge<PiCodingAgentInput, SweOutput>("PatchProduced", ({ output }) => ({
	score: output.patch.trim().length > 0 ? 1 : 0,
	metadata: {
		rationale: output.patch.trim() ? "patch produced" : "no patch produced",
	},
}));

const TEST_TIMEOUT_MS = 60 * 60 * 1000;

for (const inst of instances) {
	const workspace = createWorkspace(inst.repo, inst.base_commit);
	const harness = createPiCodingAgentHarness({
		workspace,
		maxTurns: 20,
		acceptIncomplete: true,
		output: () => {
			git(["add", "-A"], workspace);
			return { patch: git(["diff", "--cached"], workspace) };
		},
	});

	describeEval(
		`swe-bench: ${inst.instance_id}`,
		{ harness, judges: [PatchProducedJudge], judgeThreshold: null },
		(it) => {
			it(
				"produces a patch",
				async ({ run, task }) => {
					try {
						const result = await run(SWE_PROMPT(inst.problem_statement));
						if (result.output.patch.trim()) {
							const runId = result.artifacts?.runId;
							if (typeof runId !== "string") throw new Error("Swe-bench run did not record a run ID.");
							await recordEvalSourceArtifact(task, runId, {
								name: `${inst.instance_id}.patch`,
								contentType: "text/plain",
								body: result.output.patch,
								bodyEncoding: "utf-8",
							});
						}
					} finally {
						removeWorkspace(inst.repo, workspace);
					}
				},
				TEST_TIMEOUT_MS,
			);
		},
	);
}
