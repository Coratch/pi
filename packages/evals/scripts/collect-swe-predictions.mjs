import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Collects per-instance patch artifacts from an eval run directory into the
// official SWE-bench predictions format:
//   {"instance_id": "...", "model_name_or_path": "...", "model_patch": "..."}
//
// Usage: node scripts/collect-swe-predictions.mjs <eval-dir> <model-name> [output]
const evalDir = process.argv[2];
const modelName = process.argv[3];
const output = process.argv[4] ?? "predictions.jsonl";

if (!evalDir || !modelName) {
	console.error("Usage: node scripts/collect-swe-predictions.mjs <eval-dir> <model-name> [output]");
	process.exit(1);
}

const sourcesDir = join(evalDir, "sources");
const predictions = [];

for (const hashDir of readdirSync(sourcesDir)) {
	const dir = join(sourcesDir, hashDir);
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".patch")) continue;
		const modelPatch = readFileSync(join(dir, file), "utf8");
		const instanceId = file.slice(0, -".patch".length);
		predictions.push({ instance_id: instanceId, model_name_or_path: modelName, model_patch: modelPatch });
	}
}

predictions.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
writeFileSync(output, predictions.map((p) => JSON.stringify(p)).join("\n") + "\n");
console.log(`Wrote ${predictions.length} predictions to ${output}`);
