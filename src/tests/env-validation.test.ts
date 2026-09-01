import assert from "node:assert/strict";

import { EnvValidationError, requireEnv } from "feature-env";

import { envSchema } from "../env/schema";

// Run a named assertion block and print PASS/FAIL output.
const runCase = (name: string, callback: () => void) => {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

// Execute the environment schema regression scenarios.
const run = () => {
  runCase("fails when a required shared key is missing", () => {
    assert.throws(
      () =>
        requireEnv(envSchema, ["shared"] as const, {
          env: {
            NODE_ENV: "test",
            PORT: "5000",
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof EnvValidationError);
        assert.match(String((error as Error).message), /CORS_ORIGINS/);
        return true;
      },
    );
  });

  runCase("passes when required shared keys are present", () => {
    const env = requireEnv(envSchema, ["shared"] as const, {
      env: {
        NODE_ENV: "test",
        PORT: "5000",
        CORS_ORIGINS: "http://localhost:5173",
      },
    });

    assert.equal(env.PORT, 5000);
    assert.equal(env.NODE_ENV, "test");
  });

  console.log("All env validation tests passed.");
};

try {
  run();
} catch (error) {
  process.exitCode = 1;
  console.error(error);
}
