import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Every export of a "use server" module becomes a server reference. A re-export list such as
// `export type { PublishInput }` names a type that has no value at run time, and the page that
// loads the module dies with a ReferenceError (it broke /app/publish on 2026-10-03).
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

describe('"use server" modules', () => {
  it("have no export lists or re-exports", () => {
    const offenders = files("src")
      .filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ line, at: `${f}:${i + 1}` }))
          .filter(({ line }) => /^export\s+(type\s+)?\{|^export\s+\*/.test(line))
          .map(({ at }) => at),
      );
    expect(offenders).toEqual([]);
  });
});
