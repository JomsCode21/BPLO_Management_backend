import { securityEnv } from "@/env/security";
import type { Response } from "express";

export const REFRESH_COOKIE_NAME = securityEnv.REFRESH_COOKIE_NAME;
export const REFRESH_COOKIE_PATH = securityEnv.REFRESH_COOKIE_PATH;

// Sets the refresh-token cookie with shared security options.
export const setRefreshCookie = (res: Response, token: string) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: securityEnv.isProduction,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: 15 * 24 * 60 * 60 * 1000, // 15 days
  });
};

// Clears the refresh-token cookie during logout/session reset.
export const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: securityEnv.isProduction,
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
  });
};
