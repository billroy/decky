import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

process.env.DECKY_HOME = resolve(process.cwd(), ".decky-test");

mkdirSync(process.env.DECKY_HOME, { recursive: true });
