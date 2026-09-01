import * as PermitTemplateService from "@/services/super_admin/permit-template.service";
import { PermitTemplateScopeType } from "@/types/models/permit-template.type";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";

const isTemplateStatus = (value: string): value is "active" | "inactive" => {
  // Restrict template status updates to known status values.
  return value === "active" || value === "inactive";
};

const isMappingSource = (
  value: string,
): value is "system" | "field" | "fixed_value" | "auto_increment" => {
  // Restrict mapping source to supported placeholder source types.
  return (
    value === "system" ||
    value === "field" ||
    value === "fixed_value" ||
    value === "auto_increment"
  );
};

const isMappingConfidence = (
  value: string,
): value is "high" | "medium" | "low" => {
  // Restrict mapping confidence values to supported levels.
  return value === "high" || value === "medium" || value === "low";
};

const getTemplateScopeFromRequest = (req: Request): PermitTemplateScopeType => {
  // Resolve whether request targets permit or inspection certificate templates.
  const routePath = [
    String((req as any)?.baseUrl ?? ""),
    String((req as any)?.originalUrl ?? ""),
    String((req as any)?.path ?? ""),
  ]
    .join(" ")
    .toLowerCase();
  if (
    routePath.includes("/admin/inspector/certificate-templates") ||
    (routePath.includes("/inspector") &&
      routePath.includes("certificate-templates"))
  ) {
    return "inspection_certificate";
  }
  return "permit";
};

export const uploadPermitTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Upload a new template document and persist parsed placeholder metadata.
    const adminId = String((req as any).account?._id ?? "");
    const permitId = String(req.body?.permitId ?? "").trim();
    const fileName = String(req.body?.fileName ?? "").trim();
    const mimeType = String(req.body?.mimeType ?? "").trim();
    const contentBase64 = String(req.body?.contentBase64 ?? "").trim();
    const watermarkText = String(req.body?.watermarkText ?? "").trim();
    const watermarkFontSizePt = Number(req.body?.watermarkFontSizePt ?? 48);
    const templateScope = getTemplateScopeFromRequest(req);

    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!Types.ObjectId.isValid(permitId)) {
      return next(new AppError("A valid permit selection is required.", 400));
    }
    if (!fileName || !contentBase64) {
      return next(new AppError("Template file and content are required.", 400));
    }

    const template = await PermitTemplateService.uploadPermitTemplateS({
      permitId,
      fileName,
      mimeType,
      contentBase64,
      watermarkText,
      watermarkFontSizePt,
      adminId,
      templateScope,
    });

    return res.status(201).json({
      success: true,
      message: "Permit template uploaded successfully.",
      data: template,
    });
  } catch (error: any) {
    if (
      error?.message?.includes("No valid placeholders") ||
      error?.message?.includes("Only .docx") ||
      error?.message?.includes("Linked permit") ||
      error?.message?.includes("Invalid permit ID")
    ) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const listPermitTemplates = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // List all templates under the scope resolved from the request route.
    const templateScope = getTemplateScopeFromRequest(req);
    const templates =
      await PermitTemplateService.listPermitTemplatesS(templateScope);
    return res.status(200).json({
      success: true,
      message: "Permit templates retrieved successfully.",
      data: templates,
    });
  } catch (error) {
    return next(error);
  }
};

export const getPermitTemplateById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve a single template by id within the resolved template scope.
    const templateId = String(req.params.templateId ?? "");
    const templateScope = getTemplateScopeFromRequest(req);
    if (!Types.ObjectId.isValid(templateId)) {
      return next(new AppError("Invalid template ID.", 400));
    }

    const template = await PermitTemplateService.getPermitTemplateByIdS(
      templateId,
      templateScope,
    );
    if (!template) {
      return next(new AppError("Template not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit template retrieved successfully.",
      data: template,
    });
  } catch (error) {
    return next(error);
  }
};

export const deletePermitTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Delete a template by id within the resolved template scope.
    const templateId = String(req.params.templateId ?? "");
    const templateScope = getTemplateScopeFromRequest(req);
    if (!Types.ObjectId.isValid(templateId)) {
      return next(new AppError("Invalid template ID.", 400));
    }

    const template = await PermitTemplateService.deletePermitTemplateS(
      templateId,
      templateScope,
    );
    if (!template) {
      return next(new AppError("Template not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit template deleted successfully.",
      data: template,
    });
  } catch (error) {
    return next(error);
  }
};

export const replacePermitTemplateFile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Replace the file content of an existing template and re-parse mappings.
    const templateId = String(req.params.templateId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const fileName = String(req.body?.fileName ?? "").trim();
    const mimeType = String(req.body?.mimeType ?? "").trim();
    const contentBase64 = String(req.body?.contentBase64 ?? "").trim();
    const watermarkText = String(req.body?.watermarkText ?? "").trim();
    const rawWatermarkSize = req.body?.watermarkFontSizePt;
    const templateScope = getTemplateScopeFromRequest(req);
    const watermarkFontSizePt =
      rawWatermarkSize === undefined || rawWatermarkSize === null
        ? undefined
        : Number(rawWatermarkSize);

    if (!Types.ObjectId.isValid(templateId)) {
      return next(new AppError("Invalid template ID.", 400));
    }
    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!fileName || !contentBase64) {
      return next(new AppError("Template file and content are required.", 400));
    }

    const template = await PermitTemplateService.replacePermitTemplateFileS({
      templateId,
      fileName,
      mimeType,
      contentBase64,
      watermarkText,
      watermarkFontSizePt,
      adminId,
      templateScope,
    });

    if (!template) {
      return next(new AppError("Template not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit template file replaced successfully.",
      data: template,
    });
  } catch (error: any) {
    if (
      error?.message?.includes("No valid placeholders") ||
      error?.message?.includes("Only .docx")
    ) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const updatePermitTemplateWatermark = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Update watermark settings for a specific template record.
    const templateId = String(req.params.templateId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const watermarkText = String(req.body?.watermarkText ?? "").trim();
    const watermarkFontSizePt = Number(req.body?.watermarkFontSizePt ?? 48);
    const templateScope = getTemplateScopeFromRequest(req);

    if (!Types.ObjectId.isValid(templateId)) {
      return next(new AppError("Invalid template ID.", 400));
    }
    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!watermarkText) {
      return next(new AppError("Watermark text is required.", 400));
    }
    if (
      !Number.isFinite(watermarkFontSizePt) ||
      watermarkFontSizePt < 12 ||
      watermarkFontSizePt > 200
    ) {
      return next(
        new AppError(
          "Watermark size must be a number between 12 and 200.",
          400,
        ),
      );
    }

    const template = await PermitTemplateService.updatePermitTemplateWatermarkS(
      {
        templateId,
        adminId,
        watermarkText,
        watermarkFontSizePt,
        templateScope,
      },
    );
    if (!template) {
      return next(new AppError("Template not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Template watermark updated successfully.",
      data: template,
    });
  } catch (error) {
    return next(error);
  }
};

export const updatePermitTemplateStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Update active/inactive status of a template.
    const templateId = String(req.params.templateId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const status = String(req.body?.status ?? "").trim();
    const templateScope = getTemplateScopeFromRequest(req);

    if (!Types.ObjectId.isValid(templateId)) {
      return next(new AppError("Invalid template ID.", 400));
    }
    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!isTemplateStatus(status)) {
      return next(
        new AppError(
          "Invalid template status. Allowed: active, inactive.",
          400,
        ),
      );
    }

    const template = await PermitTemplateService.setPermitTemplateStatusS({
      templateId,
      status,
      adminId,
      templateScope,
    });

    if (!template) {
      return next(new AppError("Template not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit template status updated successfully.",
      data: template,
    });
  } catch (error) {
    return next(error);
  }
};

export const savePermitTemplateMappings = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Validate and save template placeholder mappings and watermark settings.
    const templateId = String(req.params.templateId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
    const watermarkTextRaw = req.body?.watermarkText;
    const watermarkFontSizePtRaw = req.body?.watermarkFontSizePt;
    const templateScope = getTemplateScopeFromRequest(req);

    if (!Types.ObjectId.isValid(templateId)) {
      return next(new AppError("Invalid template ID.", 400));
    }
    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!Array.isArray(mappings)) {
      return next(new AppError("Mappings must be an array.", 400));
    }
    if (
      watermarkTextRaw !== undefined &&
      typeof watermarkTextRaw !== "string"
    ) {
      return next(new AppError("Watermark text must be a string.", 400));
    }
    if (
      watermarkFontSizePtRaw !== undefined &&
      (!Number.isFinite(Number(watermarkFontSizePtRaw)) ||
        Number(watermarkFontSizePtRaw) < 12 ||
        Number(watermarkFontSizePtRaw) > 200)
    ) {
      return next(
        new AppError("Watermark font size must be between 12 and 200.", 400),
      );
    }

    const watermarkText =
      watermarkTextRaw === undefined
        ? undefined
        : String(watermarkTextRaw).trim();
    if (watermarkText !== undefined && !watermarkText) {
      return next(new AppError("Watermark text is required.", 400));
    }

    const watermarkFontSizePt =
      watermarkFontSizePtRaw === undefined
        ? undefined
        : Math.round(Number(watermarkFontSizePtRaw));

    const hasInvalidMapping = mappings.some((mapping: any) => {
      const sourceType = String(mapping?.sourceType ?? "").trim();
      const confidence = String(mapping?.confidence ?? "").trim();
      return (
        !String(mapping?.placeholder ?? "").trim() ||
        !isMappingSource(sourceType) ||
        !isMappingConfidence(confidence)
      );
    });

    if (hasInvalidMapping) {
      return next(new AppError("One or more mappings are invalid.", 400));
    }

    const template = await PermitTemplateService.savePermitTemplateMappingsS({
      templateId,
      mappings,
      adminId,
      watermarkText,
      watermarkFontSizePt,
      templateScope,
    });

    if (!template) {
      return next(new AppError("Template not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Permit template mappings saved successfully.",
      data: template,
    });
  } catch (error: any) {
    if (
      error?.message?.includes("Invalid template placeholder") ||
      error?.message?.includes("Unmapped placeholder") ||
      error?.message?.includes("Invalid mapping source")
    ) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const getPermitTemplateMappingOptions = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve mapping options for a given permit to help template binding.
    const permitId = String(req.query.permitId ?? "").trim();
    if (!Types.ObjectId.isValid(permitId)) {
      return next(new AppError("Valid permitId query is required.", 400));
    }

    const options =
      await PermitTemplateService.getPermitTemplateMappingOptionsS(permitId);
    return res.status(200).json({
      success: true,
      message: "Permit template mapping options retrieved successfully.",
      data: options,
    });
  } catch (error: any) {
    if (error?.message?.includes("Invalid permit ID")) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};
