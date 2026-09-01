import { requireEnv } from "feature-env";

import { envSchema } from "@/env/schema";

// Load the shared server environment values once.
const sharedEnv = requireEnv(envSchema, ["shared"] as const);

const normalizeOrigin = (value: string) => {
  // Remove trailing slashes so equivalent origins compare consistently.
  return value.trim().replace(/\/+$/, "");
};

const envAllowedOrigins = sharedEnv.CORS_ORIGINS.split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

// Cache the production flag once for downstream server setup.
const isProduction = sharedEnv.NODE_ENV === "production";

const devFallbackOrigins = isProduction
  ? []
  : ["http://localhost:5173", "http://127.0.0.1:5173"];

export const serverEnv = {
  ...sharedEnv,
  isProduction,
  // Merge configured origins with local development defaults.
  allowedOrigins: Array.from(
    new Set([...envAllowedOrigins, ...devFallbackOrigins]),
  ),
};
