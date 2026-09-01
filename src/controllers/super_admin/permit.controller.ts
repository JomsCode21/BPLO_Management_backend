import * as PermitService from "@/services/super_admin/permit.service";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";

const ALLOWED_FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "checkbox",
  "radio",
  "date",
  "file",
];

const ALLOWED_SECTION_LAYOUTS = ["one_column", "two_column"];

export const createPermit = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Create a new permit definition with basic metadata.
    const { name, description } = req.body;

    if (!name || !String(name).trim()) {
      return next(new AppError("Permit name is required.", 400));
    }

    const permit = await PermitService.createPermitS(
      { name: String(name), description: String(description ?? "") },
      String((req as any).account?._id ?? ""),
    );

    return res.status(201).json({
      success: true,
      message: "Permit created successfully.",
      data: permit,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return next(
        new AppError(
          "Permit name already exists. Please use a unique name.",
          409,
        ),
      );
    }
    return next(error);
  }
};

export const getPermits = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve all configured permits for management screens.
    const permits = await PermitService.getPermitsS();
    return res.status(200).json({
      success: true,
      message: "Permits retrieved successfully.",
      data: permits,
    });
  } catch (error) {
    return next(error);
  }
};

export const getPermitById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve a single permit by id for editing or preview.
    const permitId = String(req.params.permitId ?? "");

    if (!Types.ObjectId.isValid(permitId)) {
      return next(new AppError("Invalid permit ID.", 400));
    }

    const permit = await PermitService.getPermitByIdS(permitId);
    if (!permit) {
      return next(new AppError("Permit not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit retrieved successfully.",
      data: permit,
    });
  } catch (error) {
    return next(error);
  }
};

export const savePermitForm = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Validate and save permit form sections and fields.
    const permitId = String(req.params.permitId ?? "");
    const { formTitle, formDescription, fields, sections } = req.body;

    if (!Types.ObjectId.isValid(permitId)) {
      return next(new AppError("Invalid permit ID.", 400));
    }

    if (!Array.isArray(fields)) {
      return next(new AppError("Fields must be an array.", 400));
    }
    if (sections !== undefined && !Array.isArray(sections)) {
      return next(new AppError("Sections must be an array.", 400));
    }

    const normalizedSections = Array.isArray(sections) ? sections : [];

    const hasInvalidSection = normalizedSections.some((section: any) => {
      const title = String(section?.title ?? "").trim();
      const id = String(section?.id ?? "").trim();
      const layout = String(section?.layout ?? "").trim();

      return !title || !id || !ALLOWED_SECTION_LAYOUTS.includes(layout);
    });

    if (hasInvalidSection) {
      return next(
        new AppError("Each section requires valid id, title, and layout.", 400),
      );
    }

    const sectionIdSet = new Set(
      normalizedSections.map((section: any) =>
        String(section?.id ?? "").trim(),
      ),
    );

    const hasInvalidField = fields.some((field: any) => {
      const type = String(field?.type ?? "").trim();
      const label = String(field?.label ?? "").trim();
      const sectionId = String(field?.sectionId ?? "").trim();
      const hasInvalidSectionId =
        sectionId.length > 0 &&
        sectionIdSet.size > 0 &&
        !sectionIdSet.has(sectionId);

      return (
        !ALLOWED_FIELD_TYPES.includes(type) || !label || hasInvalidSectionId
      );
    });

    if (hasInvalidField) {
      return next(
        new AppError(
          "Each field requires a valid type and non-empty label.",
          400,
        ),
      );
    }

    const permit = await PermitService.savePermitFormS(permitId, {
      formTitle: String(formTitle ?? ""),
      formDescription: String(formDescription ?? ""),
      sections: normalizedSections,
      fields,
    });

    if (!permit) {
      return next(new AppError("Permit not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit form saved successfully.",
      data: permit,
    });
  } catch (error) {
    return next(error);
  }
};

export const updatePermitValidityVisibility = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Toggle whether this permit appears in permit validity listings.
    const permitId = String(req.params.permitId ?? "");
    const { showInPermitValidity } = req.body;

    if (!Types.ObjectId.isValid(permitId)) {
      return next(new AppError("Invalid permit ID.", 400));
    }

    if (typeof showInPermitValidity !== "boolean") {
      return next(
        new AppError("showInPermitValidity must be a boolean value.", 400),
      );
    }

    const permit = await PermitService.updatePermitValidityVisibilityS(
      permitId,
      showInPermitValidity,
    );

    if (!permit) {
      return next(new AppError("Permit not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit visibility updated successfully.",
      data: permit,
    });
  } catch (error) {
    return next(error);
  }
};

export const updatePermitValiditySettings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Save full permit validity display settings for a permit.
    const permitId = String(req.params.permitId ?? "");
    const {
      showInPermitValidity,
      enablePermitValidityFormDisplay,
      permitValidityDisplayFieldIds,
    } = req.body;

    if (!Types.ObjectId.isValid(permitId)) {
      return next(new AppError("Invalid permit ID.", 400));
    }

    if (typeof showInPermitValidity !== "boolean") {
      return next(
        new AppError("showInPermitValidity must be a boolean value.", 400),
      );
    }

    if (typeof enablePermitValidityFormDisplay !== "boolean") {
      return next(
        new AppError(
          "enablePermitValidityFormDisplay must be a boolean value.",
          400,
        ),
      );
    }

    if (!Array.isArray(permitValidityDisplayFieldIds)) {
      return next(
        new AppError("permitValidityDisplayFieldIds must be an array.", 400),
      );
    }

    const hasInvalidFieldId = permitValidityDisplayFieldIds.some(
      (fieldId: unknown) =>
        typeof fieldId !== "string" || String(fieldId).trim().length === 0,
    );

    if (hasInvalidFieldId) {
      return next(
        new AppError(
          "permitValidityDisplayFieldIds must only contain non-empty strings.",
          400,
        ),
      );
    }

    const permit = await PermitService.updatePermitValiditySettingsS(permitId, {
      showInPermitValidity,
      enablePermitValidityFormDisplay,
      permitValidityDisplayFieldIds,
    });

    if (!permit) {
      return next(new AppError("Permit not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit validity settings updated successfully.",
      data: permit,
    });
  } catch (error) {
    return next(error);
  }
};

export const deletePermit = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Delete an existing permit after validating its identifier.
    const permitId = String(req.params.permitId ?? "");

    if (!Types.ObjectId.isValid(permitId)) {
      return next(new AppError("Invalid permit ID.", 400));
    }

    const deletedPermit = await PermitService.deletePermitS(permitId);
    if (!deletedPermit) {
      return next(new AppError("Permit not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit deleted successfully.",
      data: deletedPermit,
    });
  } catch (error) {
    return next(error);
  }
};
