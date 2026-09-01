import { superAdminSeedEnv } from "@/env/seed";
import Account from "@/models/account/account.model";
import { hashValue } from "@/utils/bcrypt/bcrypt.util";

export const seedSuperAdminFromEnv = async () => {
  // Seed the super admin account only when the environment enables it.
  const shouldSeed = superAdminSeedEnv.shouldSeed;

  if (!shouldSeed) {
    return;
  }

  const email = superAdminSeedEnv.email;
  const password = superAdminSeedEnv.password;
  const firstName = superAdminSeedEnv.firstName;
  const middleName = superAdminSeedEnv.middleName;
  const lastName = superAdminSeedEnv.lastName;
  const suffix = superAdminSeedEnv.suffix;
  const gender = superAdminSeedEnv.gender;

  const existingAccount = await Account.findOne({ email })
    .select("role email")
    .lean();

  if (existingAccount) {
    if (existingAccount.role !== "super_admin") {
      console.warn(
        `[seed] Account ${email} already exists with role '${existingAccount.role}'. No changes applied.`,
      );
      return;
    }

    console.log(`[seed] Super admin account already exists for ${email}.`);
    return;
  }

  const hashedPassword = await hashValue(password);

  // Create the initial super admin account from environment values.
  await Account.create({
    firstName,
    middleName,
    lastName,
    suffix,
    gender,
    email,
    password: hashedPassword,
    role: "super_admin",
    authProvider: "local",
    isVerified: true,
  });

  console.log(`[seed] Super admin account created for ${email}.`);
};
