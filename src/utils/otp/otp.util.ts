import crypto from "crypto";
import { compareHashed } from "../bcrypt/bcrypt.util";

export const generateOtp = (length: number = 6): string => {
  // Generates a zero-padded numeric OTP with the requested length.
  const otp = crypto
    .randomInt(0, Math.pow(10, length))
    .toString()
    .padStart(length, "0");
  return otp;
};

export const verifyOtp = async (
  inputOtp: string,
  hashedOtp: string,
  expiresAt: Date,
): Promise<boolean> => {
  // Rejects verification immediately if the OTP has already expired.
  const now = new Date();
  if (now > expiresAt) {
    return Promise.resolve(false); // OTP has expired
  }
  const isValid = await compareHashed(inputOtp, hashedOtp);

  return isValid;
};
