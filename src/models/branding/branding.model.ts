import { BrandingSettingsDocumentType } from "@/types/models/branding.type";
import { model, Model, Schema } from "mongoose";

// Persist the single branding settings record used by the frontend.
const BrandingSettingsSchema = new Schema<BrandingSettingsDocumentType>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      enum: ["branding_settings"],
      default: "branding_settings",
    },
    logoUrl: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true },
);

// Register the branding settings collection model.
const BrandingSettings: Model<BrandingSettingsDocumentType> = model<
  BrandingSettingsDocumentType,
  Model<BrandingSettingsDocumentType>
>("branding_settings", BrandingSettingsSchema);

export default BrandingSettings;
