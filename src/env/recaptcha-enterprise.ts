import { optionalEnv } from "feature-env";

import { envSchema } from "@/env/schema";

const env = optionalEnv(envSchema, ["recaptchaEnterprise"] as const);

const normalize = (value: unknown) => String(value ?? "").trim();

const projectId = normalize(env.RECAPTCHA_ENTERPRISE_PROJECT_ID);
const apiKey = normalize(env.RECAPTCHA_ENTERPRISE_API_KEY);
const siteKey = normalize(env.RECAPTCHA_ENTERPRISE_SITE_KEY);

const configuredValues = [projectId, apiKey, siteKey];
const configuredCount = configuredValues.filter(Boolean).length;

if (configuredCount > 0 && configuredCount !== configuredValues.length) {
  throw new Error(
    "reCAPTCHA Enterprise requires RECAPTCHA_ENTERPRISE_PROJECT_ID, RECAPTCHA_ENTERPRISE_API_KEY, and RECAPTCHA_ENTERPRISE_SITE_KEY.",
  );
}

export const recaptchaEnterpriseEnv = {
  apiKey,
  enabled: configuredCount === configuredValues.length,
  projectId,
  siteKey,
};
