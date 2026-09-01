// libraries
import { NextFunction, Request, Response } from "express";
import { OAuth2Client, type TokenInfo } from "google-auth-library";
import { v4 as uuid } from "uuid";
// Types
import type { AuthedRequest } from "@/middlewares/token.middleware";
// Models
import Account from "@/models/account/account.model";
// Services
import {
  changePasswordS,
  findAccountS,
  generateForgotPasswordOtpS,
  handleGoogleLoginS,
  pushSessionS,
  registerS,
  resetPasswordS,
  updateAccountS,
  verifyCurrentPasswordS,
  verifyForgotPasswordOtpS,
} from "@/services/account/account.service";
import { authEnv } from "@/env/auth";
// Utils
import { compareHashed, hashValue } from "@/utils/bcrypt/bcrypt.util";
import {
  clearRefreshCookie,
  REFRESH_COOKIE_NAME,
  setRefreshCookie,
} from "@/utils/cookie/cookie.util";
import { sendForgotPasswordOtpEmail } from "@/utils/emails/ForgotPassword";
import { sendRegistrationOtpEmail } from "@/utils/emails/verifyEmail";
import { getEmailLogoUrl } from "@/services/super_admin/branding.service";
import { AppError } from "@/utils/error/app-error.util";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@/utils/jwt/jwt.util";
import { generateOtp, verifyOtp } from "@/utils/otp/otp.util";
import { verifyRecaptchaOrThrow } from "@/utils/recaptcha/recaptcha.util";
import { buildSession } from "@/utils/session/session.util";

const PUBLIC_SELF_REGISTER_ROLE = "business_owner" as const;
const OFFICIAL_ACCOUNT_EXISTS_ERROR =
  "An account with this email already exists. Please use the BPLO-provided credentials or contact an administrator.";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

type GoogleUserInfo = {
  email?: string;
  email_verified?: boolean | string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  sub?: string;
};

type GoogleTokenInfo = TokenInfo & {
  email?: string;
  email_verified?: boolean | string;
  verified_email?: boolean | string;
  sub?: string;
  user_id?: string;
};

const normalizeText = (value: unknown) => String(value ?? "").trim();

const normalizeEmail = (value: unknown) => normalizeText(value).toLowerCase();

const normalizeBooleanFlag = (value: unknown) => {
  if (value === true || value === false) return value;

  const normalizedValue = normalizeText(value).toLowerCase();
  if (normalizedValue === "true") return true;
  if (normalizedValue === "false") return false;

  return undefined;
};

const buildAuthUserPayload = (account: any) => ({
  _id: account?._id,
  firstName: account?.firstName,
  middleName: account?.middleName,
  lastName: account?.lastName,
  suffix: account?.suffix,
  gender: account?.gender,
  contactNumber: account?.contactNumber,
  email: account?.email,
  role: account?.role,
  profilePictureUrl: account?.profilePictureUrl,
  departmentId: account?.departmentId,
  departmentName: account?.departmentName,
  treasurerType: account?.treasurerType,
});

// Google OAuth Helpers
const getGoogleClientId = () =>
  normalizeText(authEnv.GOOGLE_CLIENT_ID);

// This function is used in multiple places, so we centralize the logic to ensure consistent error handling and client creation.
const getGoogleOAuthClient = () => {
  const clientId = getGoogleClientId();

  // If client ID is not configured, throw an error (this is a server configuration issue that needs to be fixed by the developers/admins)
  if (!clientId) {
    throw new AppError(
      "Google Sign-In is not configured on the server. Set GOOGLE_CLIENT_ID.",
      500,
    );
  }

  return {
    clientId,
    client: new OAuth2Client({ clientId }),
  };
};

// This function validates the Google access token and returns the token info if valid. It throws an error if the token is invalid or if there are any issues during validation.
const validateGoogleAccessToken = async (accessToken: string) => {
  const { clientId, client } = getGoogleOAuthClient();
  let tokenInfo: GoogleTokenInfo;

  try {
    // Controller flow: validate input here, then delegate business logic to services.
    tokenInfo = (await client.getTokenInfo(accessToken)) as GoogleTokenInfo;
  } catch (error) {
    if (!authEnv.isProduction) {
      console.error("Failed to validate Google access token:", error);
    }

    throw new AppError("Invalid Google token.", 401);
  }

  if (normalizeText(tokenInfo.aud) !== clientId) {
    throw new AppError("Google token audience mismatch.", 401);
  }

  const email = normalizeEmail(tokenInfo.email);
  if (!email) {
    throw new AppError("Email not found in Google token.", 401);
  }

  return tokenInfo;
};

// This function fetches the user's profile information from Google using the access token. It throws an error if the token is invalid or if there are any issues during the fetch.
const fetchGoogleUserInfo = async (accessToken: string) => {
  let response: globalThis.Response;

  try {
    response = await fetch(GOOGLE_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    if (!authEnv.isProduction) {
      console.error("Failed to fetch Google user info:", error);
    }

    throw new AppError("Invalid Google token.", 401);
  }

  if (!response.ok) {
    throw new AppError("Invalid Google token.", 401);
  }

  return (await response.json()) as GoogleUserInfo;
};

// Function to handle registration
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Get the data from request body
    const {
      firstName,
      middleName,
      lastName,
      suffix,
      gender,
      email,
      password,
      firstname,
      middlename,
      lastname,
      recaptchaToken,
    } = req.body;

    const resolvedFirstName = firstName ?? firstname;
    const resolvedMiddleName = middleName ?? middlename;
    const resolvedLastName = lastName ?? lastname;

    // Validate the data
    if (!resolvedFirstName) throw new AppError("First name is required.", 400);
    if (!resolvedLastName) throw new AppError("Last name is required.", 400);
    if (!gender) throw new AppError("Gender is required.", 400);
    if (!email) throw new AppError("Email is required.", 400);
    if (!password) throw new AppError("Password is required.", 400);
    await verifyRecaptchaOrThrow({
      remoteIp: req.ip,
      token: recaptchaToken,
    });

    // Check if the email already exists
    let account = await findAccountS({ email });

    if (account) {
      if (account.isVerified) {
        if (account.googleId || account.authProvider === "google") {
          throw new AppError(
            "An account with this email already exists. Please continue with Google Sign-In.",
            409,
          );
        }

        throw new AppError("Email already exists.", 409);
      }

      if (
        account.role !== PUBLIC_SELF_REGISTER_ROLE ||
        account.authProvider !== "local"
      ) {
        throw new AppError(OFFICIAL_ACCOUNT_EXISTS_ERROR, 409);
      }

      // Update the unverified account with the newest password/details
      account.firstName = resolvedFirstName;
      account.middleName = resolvedMiddleName;
      account.lastName = resolvedLastName;
      account.suffix = suffix ?? "";
      account.gender = gender;
      account.password = await hashValue(password);
      account.role = PUBLIC_SELF_REGISTER_ROLE;
      account.departmentId = "";
      account.departmentName = "";
      account.treasurerType = "";
      await account.save(); // Save the updated details
    } else {
      // Create the account and flag it as unverified
      account = await registerS({
        firstName: resolvedFirstName,
        middleName: resolvedMiddleName,
        lastName: resolvedLastName,
        suffix: suffix,
        gender: gender,
        email,
        password: await hashValue(password),
        role: PUBLIC_SELF_REGISTER_ROLE,
        isVerified: false,
      });
      if (!account) throw new AppError("Failed to create account.", 500);
    }

    // Generate Registration OTP
    const plainOtp = generateOtp(6);
    const hashedOtp = await hashValue(plainOtp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expires in 10 minutes

    // Save the hashed OTP to the database
    await Account.findByIdAndUpdate(account._id, {
      verificationOtp: hashedOtp,
      verificationOtpExpiresAt: expiresAt,
    });

    // Send the email
    const logoUrl = await getEmailLogoUrl();
    await sendRegistrationOtpEmail(account.email, plainOtp, logoUrl);

    // Send response WITHOUT tokens
    return res.status(200).json({
      success: true,
      message:
        "Registration successful. Please check your email for the verification OTP.",
      email: account.email,
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response) => {
  // Get the data from request body
  const { email, password, recaptchaToken } = req.body;

  // Validate the data
  if (!email) throw new AppError("Email is required.", 400);
  if (!password) throw new AppError("Password is required.", 400);
  await verifyRecaptchaOrThrow({
    remoteIp: req.ip,
    token: recaptchaToken,
  });

  // Find the account by email
  const account = await findAccountS({ email });
  if (!account) throw new AppError("Account not found.", 404);

  // Check if this is a Google account
  if (account.googleId || account.authProvider === "google") {
    throw new AppError(
      "This account uses Google Sign-In. Please use the Google login button.",
      400,
    );
  }

  // Compare the password with the hashed password in database
  const ok = await compareHashed(password, account.password);
  if (!ok) throw new AppError("Incorrect password.", 400);

  // Check if account is verified
  if (!account.isVerified) {
    // Generate and send OTP for verification
    const plainOtp = generateOtp(6);
    const hashedOtp = await hashValue(plainOtp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expires in 10 minutes

    // Save the hashed OTP to the database
    await Account.findByIdAndUpdate(account._id, {
      verificationOtp: hashedOtp,
      verificationOtpExpiresAt: expiresAt,
    });

    // Send the email
    const resendLogoUrl = await getEmailLogoUrl();
    await sendRegistrationOtpEmail(account.email, plainOtp, resendLogoUrl);

    // Return response indicating account is not verified
    return res.status(403).json({
      success: false,
      isVerified: false,
      message:
        "Your account is not verified. A verification OTP has been sent to your email.",
      email: account.email,
    });
  }

  // Get uuid
  const sid = uuid();

  // Generate tokens
  const sub = String(account._id);
  const accessToken = signAccessToken(sub, account.tokenVersion ?? 0);
  const refreshToken = signRefreshToken(sub, sid);

  // Build session and save it in database
  const session = await buildSession(req, refreshToken, sid);

  // Push the session to database
  const updated = await pushSessionS(String(account._id), session);
  if (!updated) throw new AppError("Account not found.", 404);

  // Set the refresh token in cookie
  setRefreshCookie(res, refreshToken);

  // Send response
  return res.status(200).json({
    message: "Login successfully.",
    accessToken,
    user: buildAuthUserPayload(account),
  });
};

export const logout = async (req: Request, res: Response) => {
  // Get the refresh token from cookie
  const token = req.cookies?.[REFRESH_COOKIE_NAME];

  // Revoke the refresh token by removing the session from database
  if (token) {
    try {
      const payload = verifyRefreshToken(token) as { sub: string; sid: string };

      // revoke ONLY this session (preferred)
      await Account.updateOne(
        { _id: payload.sub },
        { $pull: { sessions: { sid: payload.sid } } },
      );
    } catch (err) {
      // log only in development
      if (!authEnv.isProduction)
        console.error("Logout verify failed:", err);
    }
  }

  // Clear the refresh token cookie
  clearRefreshCookie(res);

  // Send response
  return res.status(200).json({ message: "Logged out successfully." });
};

export const googleAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Get the Google OAuth token from request body
    const { token, recaptchaToken } = req.body;

    // Validate the token
    if (!token) return next(new AppError("Google token is required.", 400));
    await verifyRecaptchaOrThrow({
      remoteIp: req.ip,
      token: recaptchaToken,
    });

    const tokenInfo = await validateGoogleAccessToken(token);
    const googleUserInfo = await fetchGoogleUserInfo(token);

    // Extract user information from Google's response
    const email = normalizeEmail(googleUserInfo.email ?? tokenInfo.email);
    const firstName = normalizeText(googleUserInfo.given_name);
    const lastName = normalizeText(googleUserInfo.family_name);
    const picture = googleUserInfo.picture;
    const googleId = normalizeText(
      googleUserInfo.sub ?? tokenInfo.sub ?? tokenInfo.user_id,
    );

    // Validate the extracted data
    if (!email)
      return next(new AppError("Email not found in Google token.", 400));
    if (!googleId)
      return next(new AppError("Google ID not found in token.", 400));
    if (
      normalizeEmail(tokenInfo.email) &&
      normalizeEmail(tokenInfo.email) !== email
    ) {
      return next(new AppError("Google token email mismatch.", 401));
    }
    const tokenSubject = normalizeText(tokenInfo.sub ?? tokenInfo.user_id);
    const tokenEmailVerified = normalizeBooleanFlag(
      tokenInfo.email_verified ?? tokenInfo.verified_email,
    );
    const userInfoEmailVerified = normalizeBooleanFlag(
      googleUserInfo.email_verified,
    );

    if (tokenEmailVerified === false || userInfoEmailVerified === false) {
      return next(new AppError("Google account email must be verified.", 401));
    }
    if (tokenEmailVerified !== true && userInfoEmailVerified !== true) {
      return next(new AppError("Google token validation failed.", 401));
    }
    if (tokenSubject && tokenSubject !== googleId) {
      return next(new AppError("Google token validation failed.", 401));
    }

    // Handle Google login/registration
    const user = await handleGoogleLoginS({
      email,
      firstName,
      lastName,
      googleId,
      profilePictureUrl: picture,
    });

    if (!user)
      return next(new AppError("Failed to authenticate with Google.", 500));

    const sid = uuid();

    // Generate tokens
    const sub = String(user._id);
    const accessToken = signAccessToken(sub, user.tokenVersion ?? 0);
    const refreshToken = signRefreshToken(sub, sid);

    // Build session and save it in database
    const session = await buildSession(req, refreshToken, sid);

    // Push the session to database
    const updated = await pushSessionS(sub, session);
    if (!updated) return next(new AppError("Account not found.", 404));

    // Set the refresh token in cookie
    setRefreshCookie(res, refreshToken);

    // Send response
    return res.status(200).json({
      message: "Login Successfully with Google.",
      accessToken,
      user: buildAuthUserPayload(user),
    });
  } catch (error) {
    return next(error);
  }
};

// Forgot Password
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, recaptchaToken } = req.body;

    if (!email) {
      return next(new AppError("Email is required.", 400));
    }
    await verifyRecaptchaOrThrow({
      remoteIp: req.ip,
      token: recaptchaToken,
    });

    // Check if account exists and if it's a Google account
    const account = await findAccountS({ email });

    if (!account) {
      // Don't reveal if account exists or not for security
      return res.status(200).json({
        success: true,
        message: "A password reset OTP has been sent.",
      });
    }

    // Check if the account uses Google authentication
    if (account.googleId) {
      return res.status(400).json({
        success: false,
        message:
          "This account uses Google Sign-In. Google authenticated accounts don't reset password.",
        isGoogleAuth: true,
      });
    }

    if (!account.isVerified) {
      return res.status(403).json({
        success: false,
        message:
          "Account is not verified. Please verify your email before resetting your password.",
        isVerified: false,
      });
    }

    try {
      const { otp } = await generateForgotPasswordOtpS(email);

      if (otp) {
        // Send the OTP to user's email (best effort, don't fail the request if email sending fails)
        const forgotLogoUrl = await getEmailLogoUrl();
        await sendForgotPasswordOtpEmail(email, otp, forgotLogoUrl);
      }
    } catch (error) {
      console.warn(`OTP Generation skipped/failed for ${email}:`, error);
    }

    return res.status(200).json({
      success: true,
      message: "A password reset OTP has been sent.",
      isGoogleAuth: false,
    });
  } catch (error) {
    return next(error);
  }
};

// Verify Forgot Password OTP
export const verifyForgotPasswordOtp = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return next(new AppError("Email and OTP are required.", 400));
    }

    try {
      await verifyForgotPasswordOtpS(email, otp);
    } catch (error: any) {
      const message =
        error.message === "OTP has expired"
          ? "OTP has expired. Please request a new one."
          : "Invalid OTP. Please try again.";
      return next(new AppError(message, 400));
    }

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully. You can now reset your password.",
    });
  } catch (error) {
    return next(error);
  }
};

// Reset Password
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, otp, newPassword } = req.body;

    // Validate input
    if (!email || !otp || !newPassword) {
      return next(
        new AppError("Email, OTP, and new password are required.", 400),
      );
    }

    if (newPassword.length < 8) {
      return next(
        new AppError("New password must be at least 8 characters long.", 400),
      );
    }
    try {
      await resetPasswordS(email, otp, newPassword);
    } catch (error: any) {
      return next(
        new AppError(error.message || "Invalid or expired request.", 400),
      );
    }

    clearRefreshCookie(res);

    return res.status(200).json({
      success: true,
      message:
        "Password has been reset successfully. Existing sessions were signed out. You can now login.",
    });
  } catch (error) {
    return next(error);
  }
};

// Verify Registration OTP
export const verifyRegistration = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { email, otp } = req.body;

    // 1. Basic Validation
    if (!email || !otp) {
      return next(new AppError("Email and OTP are required.", 400));
    }

    // 2. Find the account
    const account = await Account.findOne({ email }).exec();
    if (!account) {
      return next(new AppError("Account not found.", 404));
    }

    // 3. Check if already verified
    if (account.isVerified) {
      return next(
        new AppError("Account is already verified. Please log in.", 400),
      );
    }

    // 4. Ensure OTP was actually generated
    if (!account.verificationOtp || !account.verificationOtpExpiresAt) {
      return next(
        new AppError("No verification OTP found. Please register again.", 400),
      );
    }

    // 5. Verify the OTP against the hashed database value
    const isValid = await verifyOtp(
      otp,
      account.verificationOtp,
      account.verificationOtpExpiresAt,
    );
    if (!isValid) {
      return next(
        new AppError("Invalid or expired OTP. Please request a new one.", 400),
      );
    }

    // 6. OTP is valid! Mark as verified and clean up the OTP fields
    account.isVerified = true;
    account.verificationOtp = undefined;
    account.verificationOtpExpiresAt = undefined;
    await account.save();

    // 7. Generate tokens and log the user in (brought over from your old register code)
    const sid = uuid();
    const sub = String(account._id);
    const accessToken = signAccessToken(sub, account.tokenVersion ?? 0);
    const refreshToken = signRefreshToken(sub, sid);

    // Build session and save it in database
    const session = await buildSession(req, refreshToken, sid);

    // Push the session to database
    const updated = await pushSessionS(sub, session);
    if (!updated) {
      return next(new AppError("Failed to create user session.", 500));
    }

    // Set the refresh token in cookie
    setRefreshCookie(res, refreshToken);

    // 8. Send the final success response
    return res.status(200).json({
      success: true,
      message: "Account verified and registered successfully.",
      accessToken,
      user: {
        ...buildAuthUserPayload(account),
        isVerified: account.isVerified,
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const getCurrentUser = async (
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.account) {
      return next(new AppError("Unauthorized: No account found.", 401));
    }

    return res.status(200).json({
      success: true,
      user: buildAuthUserPayload(req.account),
    });
  } catch (error) {
    return next(error);
  }
};

// Update user profile (requires authentication)
export const updateProfile = async (
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Check if account is attached by middleware
    if (!req.account) {
      return next(new AppError("Unauthorized: No account found.", 401));
    }

    // Get the account ID from the authenticated request
    const accountId = String(req.account._id);

    // Extract allowed fields from request body
    const {
      firstName,
      middleName,
      lastName,
      email,
      contactNumber,
      profilePictureUrl,
    } = req.body;

    // Validate required fields
    if (!firstName || !firstName.trim()) {
      return next(new AppError("First name is required.", 400));
    }
    if (!lastName || !lastName.trim()) {
      return next(new AppError("Last name is required.", 400));
    }
    if (!email || !email.trim()) {
      return next(new AppError("Email is required.", 400));
    }

    // Check email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim().toLowerCase())) {
      return next(new AppError("Invalid email format.", 400));
    }

    // Check if email is already taken by someone else
    const existingAccount = await findAccountS({
      email: email.trim().toLowerCase(),
    });
    if (existingAccount && String(existingAccount._id) !== accountId) {
      return next(
        new AppError("Email already in use by another account.", 409),
      );
    }

    let normalizedProfilePictureUrl: string | undefined;
    if (profilePictureUrl !== undefined) {
      if (typeof profilePictureUrl !== "string") {
        return next(new AppError("Profile picture URL must be a string.", 400));
      }
      normalizedProfilePictureUrl = profilePictureUrl.trim();
    }

    // Build update object with trimmed values
    const updateData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      middleName: middleName ? middleName.trim() : "",
      email: email.trim().toLowerCase(),
      contactNumber: contactNumber ? contactNumber.trim() : "",
      ...(normalizedProfilePictureUrl !== undefined
        ? { profilePictureUrl: normalizedProfilePictureUrl }
        : {}),
    };

    // Update the account
    const updatedAccount = await updateAccountS({ _id: accountId }, updateData);

    if (!updatedAccount) {
      return next(new AppError("Failed to update account.", 500));
    }

    // Return the updated user object
    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      user: buildAuthUserPayload(updatedAccount),
    });
  } catch (error) {
    return next(error);
  }
};

// Change password (requires authentication)
export const changePassword = async (
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.account) {
      return next(new AppError("Unauthorized: No account found.", 401));
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !String(currentPassword).trim()) {
      return next(new AppError("Current password is required.", 400));
    }

    if (!newPassword || !String(newPassword).trim()) {
      return next(new AppError("New password is required.", 400));
    }

    if (String(newPassword).length < 8) {
      return next(
        new AppError("New password must be at least 8 characters long.", 400),
      );
    }

    await changePasswordS(
      String(req.account._id),
      String(currentPassword),
      String(newPassword),
    );

    clearRefreshCookie(res);

    return res.status(200).json({
      success: true,
      message:
        "Password changed successfully. Please login again with your new password.",
    });
  } catch (error) {
    return next(error);
  }
};

// This is used when user wants to verify their current password before performing sensitive actions (e.g., changing password)
export const verifyCurrentPassword = async (
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    if (!req.account) {
      return next(new AppError("Unauthorized: No account found.", 401));
    }

    const { currentPassword } = req.body;

    if (!currentPassword || !String(currentPassword).trim()) {
      return next(new AppError("Current password is required.", 400));
    }

    await verifyCurrentPasswordS(
      String(req.account._id),
      String(currentPassword),
    );

    return res.status(200).json({
      success: true,
      message: "Current password verified.",
    });
  } catch (error) {
    return next(error);
  }
};


