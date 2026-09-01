import BrandingSettings from "@/models/branding/branding.model";

const BRANDING_KEY = "branding_settings";

const normalizeLogoUrl = (logoUrl: unknown): string => {
  // Normalize stored logo URLs so reads and writes stay consistent.
  return typeof logoUrl === "string" ? logoUrl.trim() : "";
};

export const getBrandingSettingsS = async () => {
  // Load or initialize the singleton branding settings record.
  const settings = await BrandingSettings.findOne({ key: BRANDING_KEY }).lean();
  if (settings) {
    const normalizedLogoUrl = normalizeLogoUrl(settings.logoUrl);

    if (normalizedLogoUrl !== settings.logoUrl) {
      await BrandingSettings.updateOne(
        { _id: settings._id },
        { $set: { logoUrl: normalizedLogoUrl } },
      );

      return {
        ...settings,
        logoUrl: normalizedLogoUrl,
      };
    }

    return {
      ...settings,
      logoUrl: normalizedLogoUrl,
    };
  }

  const created = await BrandingSettings.create({
    key: BRANDING_KEY,
    logoUrl: "",
  });

  return created.toObject();
};

export const updateBrandingLogoS = async (logoUrl: string) => {
  // Persist the branding logo URL in the singleton settings record.
  return await BrandingSettings.findOneAndUpdate(
    { key: BRANDING_KEY },
    {
      key: BRANDING_KEY,
      logoUrl,
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  ).lean();
};

export const getEmailLogoUrl = async (): Promise<string> => {
  // Return the branding logo URL for outbound email templates.
  const settings = await getBrandingSettingsS();
  return settings.logoUrl ?? "";
};
