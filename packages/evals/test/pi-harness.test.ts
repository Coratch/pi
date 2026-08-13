import { describe, expect, it } from "vitest";
import { createTurnLimitGuard, resolveModelSelection } from "../src/pi-harness.ts";

describe("resolveModelSelection", () => {
	it("prefers an explicit harness model over environment defaults", () => {
		expect(
			resolveModelSelection(
				{ provider: "anthropic", id: "claude-opus-4-6" },
				{ PI_PROVIDER: "openai-codex", PI_MODEL: "gpt-5.6-sol" },
			),
		).toEqual({ provider: "anthropic", id: "claude-opus-4-6" });
	});

	it("uses trimmed environment defaults when the harness has no explicit model", () => {
		expect(resolveModelSelection(undefined, { PI_PROVIDER: " openai-codex ", PI_MODEL: " gpt-5.6-sol " })).toEqual({
			provider: "openai-codex",
			id: "gpt-5.6-sol",
		});
	});

	it.each([
		[undefined, {}],
		[undefined, { PI_PROVIDER: "openai-codex" }],
		[undefined, { PI_MODEL: "gpt-5.6-sol" }],
		[
			{ provider: "", id: "gpt-5.6-sol" },
			{ PI_PROVIDER: "openai-codex", PI_MODEL: "gpt-5.6-sol" },
		],
	] as const)("rejects an incomplete model selection", (explicitModel, environment) => {
		expect(() => resolveModelSelection(explicitModel, environment)).toThrow(
			"Select a harness model explicitly or set both PI_PROVIDER and PI_MODEL as defaults.",
		);
	});
});

describe("createTurnLimitGuard", () => {
	it("returns false for the first maxTurns - 1 turns and true on the maxTurns-th turn", () => {
		const guard = createTurnLimitGuard(3);

		expect(guard()).toBe(false);
		expect(guard()).toBe(false);
		expect(guard()).toBe(true);
	});

	it("stops after the first turn when maxTurns is 1", () => {
		const guard = createTurnLimitGuard(1);

		expect(guard()).toBe(true);
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
		"rejects an invalid maxTurns value: %s",
		(maxTurns) => {
			expect(() => createTurnLimitGuard(maxTurns)).toThrow("maxTurns must be a positive integer.");
		},
	);
});
