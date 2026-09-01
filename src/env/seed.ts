import { optionalEnv } from "feature-env";

import { envSchema } from "@/env/schema";

const trim = (value: string | undefined) => {
  // Normalize optional seed values into trimmed strings.
  return String(value ?? "").trim();
};

// Read optional seed values used to bootstrap the super admin account.
const seedEnv = optionalEnv(envSchema, ["seed"] as const);

export const superAdminSeedEnv = {
  shouldSeed: seedEnv.SEED_SUPER_ADMIN === true,
  email: trim(seedEnv.SUPER_ADMIN_EMAIL).toLowerCase(),
  password: trim(seedEnv.SUPER_ADMIN_PASSWORD),
  firstName: trim(seedEnv.SUPER_ADMIN_FIRST_NAME) || "Super",
  middleName: trim(seedEnv.SUPER_ADMIN_MIDDLE_NAME),
  lastName: trim(seedEnv.SUPER_ADMIN_LAST_NAME) || "Admin",
  suffix: trim(seedEnv.SUPER_ADMIN_SUFFIX),
  gender: trim(seedEnv.SUPER_ADMIN_GENDER) || "Prefer not to say",
};

if (superAdminSeedEnv.shouldSeed) {
  // Enforce the minimum configuration needed to seed the initial admin.
  if (!superAdminSeedEnv.email || !superAdminSeedEnv.password) {
    throw new Error(
      "SEED_SUPER_ADMIN=true requires SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD.",
    );
  }
}
