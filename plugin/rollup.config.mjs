import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import typescript from "@rollup/plugin-typescript";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.decky.controller.sdPlugin/bin/plugin.js",
    format: "es",
    sourcemap: true,
  },
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    json(),
    typescript({ tsconfig: "./tsconfig.json" }),
  ],
  // Node built-ins are available in the StreamDeck Node.js runtime
  external: [
    "node:http", "node:https", "node:net", "node:tls", "node:url",
    "node:events", "node:stream", "node:buffer", "node:crypto", "node:zlib",
    "node:util", "node:os", "node:path", "node:fs", "node:child_process",
    "http", "https", "net", "tls", "url", "events", "stream", "buffer",
    "crypto", "zlib", "util", "os", "path", "fs", "child_process",
  ],
};
