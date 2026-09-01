import { requireEnv } from "feature-env";

import { envSchema } from "@/env/schema";

// Load the token-related environment values required by the backend.
export const tokenEnv = requireEnv(envSchema, ["tokens"] as const);
