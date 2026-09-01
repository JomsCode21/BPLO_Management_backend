import { requireEnv } from "feature-env";

import { envSchema } from "@/env/schema";

// Load runtime environment values and derive production mode once.
const env = requireEnv(envSchema, ["runtime"] as const);

export const runtimeEnv = {
  ...env,
  isProduction: env.NODE_ENV === "production",
};
