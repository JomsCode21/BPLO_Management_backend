import { requireEnv } from "feature-env";

import { envSchema } from "@/env/schema";

// Load the security-related environment values and derive production mode once.
const env = requireEnv(envSchema, ["runtime", "security"] as const);

export const securityEnv = {
  ...env,
  isProduction: env.NODE_ENV === "production",
};
