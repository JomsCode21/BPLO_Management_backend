import { securityEnv } from "@/env/security";
import { AppError } from "@/utils/error/app-error.util";

type RecaptchaVerificationResponse = {
  success: boolean;
  "error-codes"?: string[];
};

const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

// Reads and validates the configured reCAPTCHA secret key.
const getRecaptchaSecretKey = () => {
  const secretKey = securityEnv.RECAPTCHA_SECRET_KEY.trim();

  if (!secretKey) {
    throw new AppError(
      "reCAPTCHA is not configured on the server. Set RECAPTCHA_SECRET_KEY.",
      500,
    );
  }

  return secretKey;
};

// Verifies a reCAPTCHA token against Google and throws on any failure.
export const verifyRecaptchaOrThrow = async ({
  token,
}: {
  token?: string;
}) => {
  const trimmedToken = token?.trim();

  if (!trimmedToken) {
    throw new AppError(
      "Security verification is required. Please try again.",
      400,
    );
  }

  const body = new URLSearchParams({
    response: trimmedToken,
    secret: getRecaptchaSecretKey(),
  });

  let verificationResponse: Response;

  try {
    verificationResponse = await fetch(RECAPTCHA_VERIFY_URL, {
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
  } catch {
    throw new AppError(
      "Unable to verify reCAPTCHA right now. Please try again.",
      502,
    );
  }

  if (!verificationResponse.ok) {
    throw new AppError(
      "Unable to verify reCAPTCHA right now. Please try again.",
      502,
    );
  }

  const result =
    (await verificationResponse.json()) as RecaptchaVerificationResponse;

  if (!result.success) {
    // Google's reason codes are safe operational diagnostics and help identify
    // a site-key/secret mismatch in deployed environments.
    console.warn("reCAPTCHA rejected request:", result["error-codes"] ?? []);

    throw new AppError("Security verification failed. Please try again.", 403);
  }

  return result;
};
