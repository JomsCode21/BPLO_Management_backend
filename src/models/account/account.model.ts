import {
  AccountDocumentType,
  GeoType,
  SessionType,
  UserAgentType,
} from "@/types/models/account.type";
import { model, Model, Schema } from "mongoose";

// Store IP and geo metadata for a user session.
const GeoSchema = new Schema<GeoType>({
  range: [Number],
  country: String,
  region: String,
  eu: String,
  timezone: String,
  city: String,
  ll: [Number],
  metro: Number,
  area: Number,
});

// Store parsed browser and device metadata for a session.
const UserAgentSchema = new Schema<UserAgentType>({
  browser: {
    name: String,
    version: String,
    type: String,
  },
  cpu: {
    architecture: String,
  },
  device: {
    vendor: String,
    model: String,
    type: String,
  },
  engine: {
    name: String,
    version: String,
  },
  os: {
    name: String,
    version: String,
  },
});

// Store a login session and its refresh token metadata.
const SessionSchema = new Schema<SessionType>({
  sid: String,
  ip: String,
  geo: GeoSchema,
  userAgent: UserAgentSchema,
  token: String,
  expiresAt: Date,
});

// Define the main account document used throughout auth and role management.
const AccountSchema = new Schema<AccountDocumentType>(
  {
    firstName: { type: String, required: true },
    middleName: { type: String, required: false, default: "" },
    lastName: { type: String, required: true },
    suffix: { type: String, required: false, default: "" },
    gender: {
      type: String,
      required: function (this: any) {
        return this.authProvider === "local";
      },
    },
    email: { type: String, required: true, unique: true },
    password: {
      type: String,
      required: function (this: any) {
        return this.authProvider === "local";
      },
    },
    role: {
      type: String,
      required: true,
      enum: [
        "super_admin",
        "bplo_admin",
        "evaluator",
        "inspector",
        "department_treasurer",
        "main_treasurer",
        "business_owner",
      ],
      default: "business_owner",
    },
    profilePictureUrl: { type: String, required: false },
    contactNumber: { type: String, required: false, default: "" },
    sessions: [SessionSchema],
    authProvider: {
      type: String,
      enum: ["local", "google"],
      default: "local",
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    forgotPasswordOtp: { type: String, required: false },
    forgotPasswordExpiresAt: { type: Date, required: false },
    isVerified: { type: Boolean, default: false },
    verificationOtp: { type: String, required: false },
    verificationOtpExpiresAt: { type: Date, required: false },
    departmentId: { type: String, required: false, trim: true, default: "" },
    departmentName: { type: String, required: false, trim: true, default: "" },
    treasurerType: {
      type: String,
      required: false,
      enum: ["", "department_treasurer", "main_treasurer"],
      default: "",
    },
    tokenVersion: { type: Number, required: false, default: 0 },
  },
  { timestamps: true },
);

// Register the accounts collection model for application use.
const Account: Model<AccountDocumentType> = model<
  AccountDocumentType,
  Model<AccountDocumentType>
>("accounts", AccountSchema);

export default Account;
