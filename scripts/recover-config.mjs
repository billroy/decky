#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

function parseArgs(argv) {
  const out = {
    targetCount: 13,
    restore: null,
    candidates: [],
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target-count" && argv[i + 1]) {
      out.targetCount = Number.parseInt(argv[++i], 10);
      continue;
    }
    if (a === "--restore" && argv[i + 1]) {
      out.restore = argv[++i];
      continue;
    }
    if (a === "--candidate" && argv[i + 1]) {
      out.candidates.push(argv[++i]);
      continue;
    }
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/recover-config.mjs [options]",
      "",
      "Options:",
      "  --target-count <n>   Prefer configs with macro count near n (default: 13)",
      "  --candidate <path>   Add an extra candidate config file",
      "  --restore <index|path> Restore selected candidate to active config path",
      "  --json               Emit JSON instead of table output",
      "  -h, --help           Show help",
      "",
      "Notes:",
      "  - This script only scans a narrow, explicit set of known config locations.",
      "  - No overwrite happens unless --restore is provided.",
    ].join("\n") + "\n",
  );
}

function atomicWrite(path, raw) {
  const tmp = join(dirname(path), `${basename(path)}.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, raw, "utf-8");
  renameSync(tmp, path);
}

function safeParseConfig(path) {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    const macros = Array.isArray(parsed?.macros) ? parsed.macros : [];
    const macroCount = macros.length;
    return { ok: true, raw, parsed, macroCount };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function candidateScore(candidate, targetCount) {
  const macroPenalty = Math.abs(candidate.macroCount - targetCount) * 1000;
  const recencyBoost = Math.floor(candidate.mtimeMs / 1000);
  return recencyBoost - macroPenalty;
}

function discoverCandidates(repoRoot, extraCandidates) {
  const deckyDir = process.env.DECKY_HOME || join(homedir(), ".decky");
  const out = new Set();

  out.add(join(deckyDir, "config.json"));
  for (let i = 0; i <= 9; i++) out.add(join(deckyDir, `config.json.bak.${i}`));
  out.add(join(repoRoot, "bridge", ".decky-test", "config.json"));

  for (const c of extraCandidates) out.add(resolve(c));

  return [...out]
    .filter((p) => existsSync(p))
    .map((path) => {
      const st = statSync(path);
      const parsed = safeParseConfig(path);
      if (!parsed.ok) {
        return {
          path,
          mtimeMs: st.mtimeMs,
          size: st.size,
          macroCount: -1,
          valid: false,
          error: parsed.error,
        };
      }
      return {
        path,
        mtimeMs: st.mtimeMs,
        size: st.size,
        macroCount: parsed.macroCount,
        valid: true,
        raw: parsed.raw,
        parsed: parsed.parsed,
      };
    });
}

function formatTime(ms) {
  return new Date(ms).toISOString();
}

function printTable(candidates) {
  process.stdout.write("idx\tmacros\tmtime\tpath\n");
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    process.stdout.write(`${i}\t${c.macroCount}\t${formatTime(c.mtimeMs)}\t${c.path}\n`);
  }
}

function resolveRestoreSelection(restoreArg, candidates) {
  if (restoreArg == null) return null;
  const asIdx = Number.parseInt(restoreArg, 10);
  if (Number.isInteger(asIdx) && String(asIdx) === String(restoreArg)) {
    if (asIdx < 0 || asIdx >= candidates.length) {
      throw new Error(`restore index out of range: ${asIdx}`);
    }
    return candidates[asIdx];
  }
  const full = resolve(restoreArg);
  const match = candidates.find((c) => resolve(c.path) === full);
  if (!match) {
    throw new Error(`restore path not present in candidate set: ${full}`);
  }
  return match;
}

function restoreCandidate(selection) {
  if (!selection.valid || typeof selection.raw !== "string") {
    throw new Error("cannot restore invalid config candidate");
  }
  const deckyDir = process.env.DECKY_HOME || join(homedir(), ".decky");
  const liveConfig = join(deckyDir, "config.json");
  const backup = join(deckyDir, `config.pre-restore.${Date.now()}.json`);

  if (existsSync(liveConfig)) {
    copyFileSync(liveConfig, backup);
  }

  atomicWrite(liveConfig, selection.raw);

  return { liveConfig, backup: existsSync(backup) ? backup : null };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const candidates = discoverCandidates(repoRoot, args.candidates)
    .filter((c) => c.valid)
    .sort((a, b) => candidateScore(b, args.targetCount) - candidateScore(a, args.targetCount));

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ candidates }, null, 2)}\n`);
  } else {
    printTable(candidates);
  }

  if (args.restore !== null) {
    const selection = resolveRestoreSelection(args.restore, candidates);
    const result = restoreCandidate(selection);
    process.stdout.write(`Restored ${selection.path} -> ${result.liveConfig}\n`);
    if (result.backup) process.stdout.write(`Pre-restore backup: ${result.backup}\n`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
}
