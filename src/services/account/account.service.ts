import Account from "@/models/account/account.model";
import {
  AccountDocumentType,
  AccountFilterType,
  AccountType,
  SessionType,
} from "@/types/models/account.type";
import { AppError } from "@/utils/error/app-error.util";

// utils
import { compareHashed, hashValue } from "@/utils/bcrypt/bcrypt.util";
import { generateOtp, verifyOtp } from "@/utils/otp/otp.util";

const getNextTokenVersion = (currentTokenVersion?: number) => {
  // Advance the token version to invalidate existing sessions.
  return (
    (typeof currentTokenVersion === "number" ? currentTokenVersion : 0) + 1
  );
};

export const findAccountS = async (
  filter: AccountFilterType,
  selectFields?: string,
): Promise<AccountDocumentType | null> => {
  const account = await Account.findOne(filter)
    .select(selectFields || "")
    .exec();
  return account as AccountDocumentType | null;
};

export const updateAccountS = async (
  filter: AccountFilterType,
  data: Partial<AccountType>,
): Promise<AccountDocumentType | null> => {
  const account = await Account.findOneAndUpdate(filter, data, {
    returnDocument: "after",
    runValidators: true,
    lean: true,
  }).exec();
  return account as AccountDocumentType | null;
};

export const pushSessionS = async (accountId: string, session: SessionType) => {
  return Account.findByIdAndUpdate(
    accountId,
    { $push: { sessions: session } },
    { returnDocument: "after", runValidators: true, lean: true },
  );
};

export const revokeAllSessionsS = async (
  filter: AccountFilterType,
): Promise<boolean> => {
  const result = await Account.updateOne(filter, {
    $set: { sessions: [] },
  }).exec();

  return result.matchedCount > 0;
};

export const registerS = async (data: Partial<AccountType>) => {
  const account = await Account.create(data);
  return account;
};

export interface GooglePayload {
  email: string;
  firstName: string;
  lastName: string;
  profilePictureUrl?: string;
  googleId: string;
}

// This function handles both login and registration for Google-authenticated users
export const handleGoogleLoginS = async (payload: GooglePayload) => {
  // Reuse or create an account record for Google sign-in users.
  const userByGoogleId = await Account.findOne({ googleId: payload.googleId });

  if (userByGoogleId) {
    return userByGoogleId;
  }

  let user = await Account.findOne({ email: payload.email });

  if (user) {
    if (user.authProvider !== "google") {
      throw new AppError(
        "An account with this email already exists. Please sign in with your email and password.",
        409,
      );
    }

    if (!user.googleId) {
      user.googleId = payload.googleId;

      if (!user.profilePictureUrl && payload.profilePictureUrl) {
        user.profilePictureUrl = payload.profilePictureUrl;
      }
      await user.save();
    }
    return user;
  }

  // If no user is found, create a new one
  const newUser = await Account.create({
    firstName: payload.firstName,
    lastName: payload.lastName,
    email: payload.email,
    googleId: payload.googleId,
    authProvider: "google",
    profilePictureUrl: payload.profilePictureUrl,
    role: "business_owner", // Default role for Google sign-ups
    gender: "Prefer not to say", // Default gender
    isVerified: true, // Google accounts are pre-verified
    // No password needed for Google OAuth users
  });

  return newUser;
};

// Otp generation for forgot password
export const generateForgotPasswordOtpS = async (email: string) => {
  // Create and persist a short-lived OTP for password recovery.
  const account = await Account.findOne({ email }).exec();
  if (!account) {
    throw new Error("Account not found");
  }

  if (account.authProvider === "google") {
    throw new Error(
      "Password reset is not available for Google-authenticated accounts",
    );
  }

  const otp = generateOtp(6);
  const hashedOtp = await hashValue(otp);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // OTP expires in 10 minutes

  await Account.findByIdAndUpdate(account._id, {
    forgotPasswordOtp: hashedOtp,
    forgotPasswordExpiresAt: expiresAt,
  });

  return { otp, expiresAt };
};

//  verify the OTP for forgot password
export const verifyForgotPasswordOtpS = async (
  email: string,
  inputOtp: string,
) => {
  // Check the submitted OTP against the stored password-reset OTP.
  const account = await Account.findOne({ email }).exec();

  // Check if account exists
  if (!account) {
    throw new Error("Account not found");
  }

  // Check if an OTP request exists
  if (!account.forgotPasswordOtp || !account.forgotPasswordExpiresAt) {
    throw new Error("No OTP request found for this account");
  }

  // Verify the OTP
  const isValid = await verifyOtp(
    inputOtp,
    account.forgotPasswordOtp,
    account.forgotPasswordExpiresAt,
  );

  if (!isValid) {
    throw new Error("Invalid or Expired OTP");
  }

  return true;
};

export const resetPasswordS = async (
  email: string,
  otp: string,
  newPassword: string,
) => {
  // Verify the OTP before resetting the password and clearing sessions.
  await verifyForgotPasswordOtpS(email, otp);

  const hashedPassword = await hashValue(newPassword);

  await Account.findOneAndUpdate(
    { email },
    {
      $set: { password: hashedPassword, sessions: [] },
      $inc: { tokenVersion: 1 },
      $unset: { forgotPasswordOtp: "", forgotPasswordExpiresAt: "" },
    },
  ).exec();

  return true;
};

const findAccountForPasswordChangeS = async (accountId: string) => {
  // Load the account and ensure password changes are allowed.
  const account = await Account.findById(accountId)
    .select("password authProvider tokenVersion")
    .exec();

  if (!account) {
    throw new AppError("Account not found.", 404);
  }

  if (account.authProvider === "google" || !account.password) {
    throw new AppError(
      "Password change is not available for Google Sign-In accounts.",
      400,
    );
  }

  return account;
};

export const verifyCurrentPasswordS = async (
  accountId: string,
  currentPassword: string,
) => {
  // Confirm the current password matches before allowing a change.
  const account = await findAccountForPasswordChangeS(accountId);

  const isCurrentPasswordValid = await compareHashed(
    currentPassword,
    account.password,
  );

  if (!isCurrentPasswordValid) {
    throw new AppError("Current password is incorrect.", 400);
  }

  return true;
};

export const changePasswordS = async (
  accountId: string,
  currentPassword: string,
  newPassword: string,
) => {
  // Replace the password and invalidate every active session.
  const account = await findAccountForPasswordChangeS(accountId);

  await verifyCurrentPasswordS(accountId, currentPassword);

  const isSameAsCurrentPassword = await compareHashed(
    newPassword,
    account.password,
  );

  if (isSameAsCurrentPassword) {
    throw new AppError(
      "New password must be different from your current password.",
      400,
    );
  }

  account.password = await hashValue(newPassword);
  account.sessions = [];
  account.tokenVersion = getNextTokenVersion(account.tokenVersion);
  await account.save();

  return true;
};
