import { rateLimit } from "express-rate-limit";
import { securityEnv } from "@/env/security";

const toMs = (minutes: number) => minutes * 60 * 1000;

// Global limiter
export const globalRateLimiter = rateLimit({
  windowMs: toMs(securityEnv.GLOBAL_RATE_LIMIT_MINUTES),
  max: securityEnv.GLOBAL_RATE_LIMIT_MAX,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
