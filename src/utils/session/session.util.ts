import { SessionType } from "@/types/models/account.type";
import { hashValue } from "@/utils/bcrypt/bcrypt.util";
import { lookupIp } from "@/utils/geoip/geoip.util";
import type { Request } from "express";
import { UAParser } from "ua-parser-js";

// Builds a persisted session object from request context and refresh token.
export const buildSession = async (
  req: Request,
  refreshTokenRaw: string,
  sid: string,
): Promise<SessionType> => {
  const ip = req.ip;
  const geo = lookupIp(ip) ?? undefined;

  const uaString = req.get("user-agent") ?? "";
  const userAgent = new UAParser(uaString).getResult();

  return {
    sid,
    ip,
    geo,
    userAgent,
    token: await hashValue(refreshTokenRaw),
    expiresAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
  };
};
