#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fileA = resolve("com.decky.controller.sdPlugin/ui/property-inspector-v2.html");
const fileB = resolve("com.decky.controller.sdPlugin/ui/property-inspector.html");

const a = readFileSync(fileA, "utf-8");
const b = readFileSync(fileB, "utf-8");

if (a !== b) {
  console.error("PI files are out of sync:");
  console.error(`- ${fileA}`);
  console.error(`- ${fileB}`);
  process.exit(1);
}

console.log("PI files are synchronized.");
