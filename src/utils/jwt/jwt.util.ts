import { tokenEnv } from "@/env/tokens";
import jwt from "jsonwebtoken";

// Creates a short-lived access token containing subject and token version.
export const signAccessToken = (sub: string, tokenVersion = 0) => {
  return jwt.sign({ sub, tv: tokenVersion }, tokenEnv.JWT_ACCESS_TOKEN, {
    expiresIn: "10m",
  });
};

// Creates a refresh token tied to a server-side session ID.
export const signRefreshToken = (sub: string, sid: string) => {
  return jwt.sign({ sub, sid }, tokenEnv.JWT_REFRESH_TOKEN, {
    expiresIn: "15d",
  });
};

// Verifies and decodes an access token using the configured secret.
export const verifyAccessToken = (token: string) =>
  jwt.verify(token, tokenEnv.JWT_ACCESS_TOKEN);

// Verifies and decodes a refresh token using the configured secret.
export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, tokenEnv.JWT_REFRESH_TOKEN);
