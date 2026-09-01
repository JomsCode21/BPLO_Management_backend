import { requireEnv } from "feature-env";

import { envSchema } from "@/env/schema";

// Load the database environment values required by the backend.
export const dbEnv = requireEnv(envSchema, ["db"] as const);
