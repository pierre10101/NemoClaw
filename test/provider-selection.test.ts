// @ts-nocheck
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.join(import.meta.dirname, "..");
const ONBOARD_PATH = JSON.stringify(path.join(REPO_ROOT, "dist", "lib", "onboard.js"));
const RUNNER_PATH = JSON.stringify(path.join(REPO_ROOT, "dist", "lib", "runner.js"));
const CREDENTIALS_PATH = JSON.stringify(path.join(REPO_ROOT, "dist", "lib", "credentials.js"));

/** Simulate `openshell provider list` table output (name in first column). */
const PROVIDER_LIST_OUTPUT = "NAME\ngithub\nslack\n";

/**
 * Run selectOpenshellProviders in a subprocess.
 *
 * @param promptResponse - What the stubbed prompt() returns (user input).
 * @param providerListOutput - What `openshell provider list` returns; null = empty/failed.
 * @param nonInteractive - Whether to set NEMOCLAW_NON_INTERACTIVE=1.
 */
function runProviderSelection(
  promptResponse: string,
  providerListOutput: string | null = PROVIDER_LIST_OUTPUT,
  nonInteractive = false,
) {
  // Patch runner.runCapture before requiring onboard so the destructured
  // binding inside onboard.js picks up the stub at load time.
  const script = String.raw`
const runner = require(${RUNNER_PATH});
runner.runCapture = (cmd) => {
  const output = process.env.NEMOCLAW_TEST_PROVIDER_OUTPUT;
  if (cmd.includes("'provider' 'list'") || cmd.includes('"provider" "list"')) {
    return output === "__null__" ? null : (output || null);
  }
  return null;
};

const credentials = require(${CREDENTIALS_PATH});
credentials.prompt = () => Promise.resolve(${JSON.stringify(promptResponse)});

const { selectOpenshellProviders } = require(${ONBOARD_PATH});

selectOpenshellProviders()
  .then((result) => {
    process.stdout.write(JSON.stringify(result) + "\n");
  })
  .catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exit(1);
  });
`;

  return spawnSync(process.execPath, ["-e", script], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: 5000,
    env: {
      ...process.env,
      NEMOCLAW_TEST_PROVIDER_OUTPUT: providerListOutput === null ? "__null__" : providerListOutput,
      ...(nonInteractive ? { NEMOCLAW_NON_INTERACTIVE: "1" } : {}),
      NO_COLOR: "1",
    },
  });
}

function parseResult(stdout: string): string[] {
  const lines = stdout.trim().split("\n").filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

describe("selectOpenshellProviders", () => {
  describe("non-interactive mode", () => {
    it("returns all providers when providers are configured", () => {
      const result = runProviderSelection("", PROVIDER_LIST_OUTPUT, true);
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual(["github", "slack"]);
    });

    it("logs [non-interactive] with provider names", () => {
      const result = runProviderSelection("", PROVIDER_LIST_OUTPUT, true);
      expect(result.stdout).toMatch(/\[non-interactive\].*github.*slack/);
    });

    it("returns [] when openshell provider list fails", () => {
      const result = runProviderSelection("", null, true);
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual([]);
    });

    it("returns [] when provider list output is empty", () => {
      const result = runProviderSelection("", "NAME\n", true);
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual([]);
    });
  });

  describe("interactive mode (non-TTY prompt fallback)", () => {
    it("returns all providers when user enters 'all'", () => {
      const result = runProviderSelection("all");
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual(["github", "slack"]);
    });

    it("returns all providers when user presses Enter (empty input)", () => {
      const result = runProviderSelection("");
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual(["github", "slack"]);
    });

    it("returns selected subset when user enters comma-separated indices", () => {
      const result = runProviderSelection("1");
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual(["github"]);
    });

    it("returns multiple providers for multi-index selection", () => {
      const result = runProviderSelection("1,2");
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual(["github", "slack"]);
    });

    it("falls back to all providers when selection indices are invalid", () => {
      const result = runProviderSelection("99,abc");
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual(["github", "slack"]);
    });

    it("returns [] when provider list is empty", () => {
      const result = runProviderSelection("1", null);
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual([]);
    });

    it("strips ANSI codes from provider list output before parsing", () => {
      const ansiOutput = "NAME\n\x1B[32mgithub\x1B[0m\n\x1B[33mslack\x1B[0m\n";
      const result = runProviderSelection("all", ansiOutput);
      expect(result.status).toBe(0);
      expect(parseResult(result.stdout)).toEqual(["github", "slack"]);
    });
  });
});
