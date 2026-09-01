import { Document } from "mongoose";

// Represents persisted branding settings shared across emails/UI.
export type BrandingSettingsType = {
  _id: string;
  key: "branding_settings";
  logoUrl: string;
  createdAt?: Date;
  updatedAt?: Date;
};

// Represents a hydrated mongoose branding document.
export type BrandingSettingsDocumentType = BrandingSettingsType & Document;
