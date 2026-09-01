import { requireEnv } from "feature-env";

import { envSchema } from "@/env/schema";

// Load the mail environment values required by the backend.
export const mailEnv = requireEnv(envSchema, ["mail"] as const);
