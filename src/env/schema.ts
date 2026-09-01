import { bool, defineEnv, enumOf, int, str } from "feature-env";

// Define the typed env contract used by the backend configuration modules.
export const envSchema = defineEnv({
  runtime: {
    NODE_ENV: enumOf(["development", "test", "production"] as const),
  },
  shared: {
    NODE_ENV: enumOf(["development", "test", "production"] as const),
    PORT: int(),
    CORS_ORIGINS: str(),
  },
  db: {
    MONGO_DB_URI: str(),
  },
  auth: {
    JWT_ACCESS_TOKEN: str(),
    JWT_REFRESH_TOKEN: str(),
    GOOGLE_CLIENT_ID: str(),
  },
  tokens: {
    JWT_ACCESS_TOKEN: str(),
    JWT_REFRESH_TOKEN: str(),
  },
  mail: {
    MAIL_HOST: str(),
    MAIL_PORT: int(),
    MAIL: str(),
    MAIL_PASSWORD: str(),
  },
  security: {
    REFRESH_COOKIE_NAME: str(),
    REFRESH_COOKIE_PATH: str(),
    GLOBAL_RATE_LIMIT_MINUTES: int(),
    GLOBAL_RATE_LIMIT_MAX: int(),
    RECAPTCHA_SECRET_KEY: str(),
  },
  payments: {
    PAYMENT_QR_SECRET: str(),
  },
  seed: {
    SEED_SUPER_ADMIN: bool(),
    SUPER_ADMIN_EMAIL: str(),
    SUPER_ADMIN_PASSWORD: str(),
    SUPER_ADMIN_FIRST_NAME: str(),
    SUPER_ADMIN_MIDDLE_NAME: str(),
    SUPER_ADMIN_LAST_NAME: str(),
    SUPER_ADMIN_SUFFIX: str(),
    SUPER_ADMIN_GENDER: str(),
  },
});
