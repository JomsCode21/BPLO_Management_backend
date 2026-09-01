import { findAccountS } from "@/services/account/account.service";
import { AccountDocumentType } from "@/types/models/account.type";
import { AppError } from "@/utils/error/app-error.util";
import { verifyAccessToken } from "@/utils/jwt/jwt.util";
import type { NextFunction, Request, Response } from "express";

// Request extended with account
export interface AuthedRequest extends Request {
  account?: AccountDocumentType | null;
}

// Validates access token from Authorization header
export const requireAccessToken = async (
  req: AuthedRequest,
  _res: Response,
  next: NextFunction,
) => {
  // Read Authorization header
  const auth = req.headers.authorization;

  // Ensure Bearer token exists
  if (!auth || !auth.startsWith("Bearer ")) {
    return next(new AppError("Unauthorized: Missing access token.", 401));
  }

  // Extract token
  const token = auth.slice("Bearer ".length).trim();
  try {
    // Verify token signature and expiry
    const payload = verifyAccessToken(token) as { sub: string; tv?: number };

    // Validate payload
    if (!payload?.sub) {
      return next(new AppError("Unauthorized: Invalid access token.", 401));
    }

    // Get the account from db
    const account = await findAccountS(
      { _id: payload.sub },
      [
        "email",
        "firstName",
        "middleName",
        "lastName",
        "suffix",
        "gender",
        "contactNumber",
        "profilePictureUrl",
        "role",
        "departmentId",
        "departmentName",
        "treasurerType",
        "tokenVersion",
      ].join(" "),
    );

    if (!account) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const accountTokenVersion =
      typeof account.tokenVersion === "number" ? account.tokenVersion : 0;
    const tokenVersion = typeof payload.tv === "number" ? payload.tv : 0;

    if (tokenVersion !== accountTokenVersion) {
      return next(
        new AppError("Unauthorized: Access token is no longer valid.", 401),
      );
    }

    // Attach account to request
    req.account = account;

    // Continue request
    return next();
  } catch {
    // Handle invalid or expired token
    return next(
      new AppError("Unauthorized: Invalid or expired access token.", 401),
    );
  }
};

