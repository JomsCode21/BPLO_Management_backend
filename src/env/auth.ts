import { requireEnv } from "feature-env";

import { envSchema } from "@/env/schema";

// Load the auth-related environment values and derive production mode once.
const env = requireEnv(envSchema, ["runtime", "auth"] as const);

export const authEnv = {
  ...env,
  isProduction: env.NODE_ENV === "production",
};
