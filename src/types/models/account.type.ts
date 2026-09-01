// Stores geo-location metadata captured per user session.
export type GeoType = {
  range?: [number, number];
  country?: string;
  region?: string;
  eu?: string;
  timezone?: string;
  city?: string;
  ll?: [number, number];
  metro?: number;
  area?: number;
};

// Stores parsed user-agent information captured per session.
export type UserAgentType = {
  browser?: {
    name?: string;
    version?: string;
    type?: string;
  };
  cpu?: {
    architecture?: string;
  };
  device?: {
    vendor?: string;
    model?: string;
    type?: string;
  };
  engine?: {
    name?: string;
    version?: string;
  };
  os?: {
    name?: string;
    version?: string;
  };
};

// Represents an authenticated session entry for an account.
export type SessionType = {
  _id?: string;
  sid: string;
  ip?: string;
  geo?: GeoType;
  userAgent?: UserAgentType;
  token: string;
  expiresAt: Date;
};

// Enumerates all supported account roles in the system.
export type UserRole =
  | "super_admin"
  | "bplo_admin"
  | "evaluator"
  | "inspector"
  | "department_treasurer"
  | "main_treasurer"
  | "business_owner";
// Narrows treasurer assignment to department or main office.
export type TreasurerType = "department_treasurer" | "main_treasurer";
// Declares supported account authentication providers.
export type AuthProvider = "local" | "google";

// Represents the full account model shape used across services.
export type AccountType = {
  _id: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  suffix?: string;
  gender: string;
  email: string;
  password: string;
  role: UserRole;
  profilePictureUrl?: string;
  contactNumber?: string;
  sessions: SessionType[];
  authProvider: AuthProvider;
  googleId?: string;
  forgotPasswordOtp?: string;
  forgotPasswordExpiresAt?: Date;
  isVerified: boolean;
  verificationOtp?: string;
  verificationOtpExpiresAt?: Date;
  departmentId?: string;
  departmentName?: string;
  treasurerType?: TreasurerType | "";
  tokenVersion?: number;
};

// Allows partial account fields for query/filter use-cases.
export type AccountFilterType = Partial<AccountType>;

import { Document } from "mongoose";
// Represents a hydrated mongoose account document.
export type AccountDocumentType = AccountType & Document;
