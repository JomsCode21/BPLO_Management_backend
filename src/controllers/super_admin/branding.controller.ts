import * as BrandingService from "@/services/super_admin/branding.service";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";

const isValidLogoUrl = (value: string) => {
  // Accept only non-empty HTTP(S) URLs for the branding logo.
  if (!value) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const getBrandingLogo = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve the configured branding logo for the frontend.
    const settings = await BrandingService.getBrandingSettingsS();

    return res.status(200).json({
      success: true,
      message: "Branding logo retrieved successfully.",
      data: {
        logoUrl: settings.logoUrl ?? "",
      },
    });
  } catch (error) {
    return next(error);
  }
};

export const updateBrandingLogo = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Validate and persist a new branding logo URL.
    const logoUrl = String(req.body?.logoUrl ?? "").trim();

    if (!isValidLogoUrl(logoUrl)) {
      return next(new AppError("Please provide a valid image URL.", 400));
    }

    const settings = await BrandingService.updateBrandingLogoS(logoUrl);

    return res.status(200).json({
      success: true,
      message: "BPLO logo updated successfully.",
      data: {
        logoUrl: settings?.logoUrl ?? logoUrl,
      },
    });
  } catch (error) {
    return next(error);
  }
};
