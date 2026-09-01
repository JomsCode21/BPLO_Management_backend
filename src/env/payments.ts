import { optionalEnv } from "feature-env";

import { envSchema } from "./schema";

// Read optional payment/token values and normalize them for safe string use.
const optionalEnvValues = optionalEnv(envSchema, [
  "payments",
  "tokens",
] as const);

const normalize = (value: unknown) => {
  // Convert missing values into trimmed strings for downstream consumers.
  return String(value ?? "").trim();
};

export const paymentEnv = {
  paymentQrSecret: normalize(optionalEnvValues.PAYMENT_QR_SECRET),
  jwtAccessToken: normalize(optionalEnvValues.JWT_ACCESS_TOKEN),
};
