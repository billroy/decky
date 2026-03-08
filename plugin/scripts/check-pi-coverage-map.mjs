import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");
const mapPath = path.resolve(repoRoot, "docs/planning/pi-control-coverage-map.json");

if (!existsSync(mapPath)) {
  console.error(`Coverage map missing: ${mapPath}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(mapPath, "utf-8"));
if (!Array.isArray(raw.controls)) {
  console.error("Coverage map must define controls[]");
  process.exit(1);
}

const missing = [];
const badRefs = [];

for (const control of raw.controls) {
  const id = String(control.id || "").trim();
  const tests = Array.isArray(control.tests) ? control.tests : [];
  if (!id || tests.length === 0) {
    missing.push(id || "<empty-id>");
    continue;
  }
  for (const ref of tests) {
    const [filePart] = String(ref).split("::");
    const filePath = path.resolve(repoRoot, filePart);
    if (!existsSync(filePath)) badRefs.push(ref);
  }
}

if (missing.length > 0) {
  console.error("Controls missing test mapping:");
  for (const id of missing) console.error(`- ${id}`);
  process.exit(1);
}

if (badRefs.length > 0) {
  console.error("Coverage map references missing test files:");
  for (const ref of badRefs) console.error(`- ${ref}`);
  process.exit(1);
}

console.log(`PI coverage map OK (${raw.controls.length} controls mapped)`);
