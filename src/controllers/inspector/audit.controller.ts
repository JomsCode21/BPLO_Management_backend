import * as AuditService from "@/services/inspector/audit.service";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";

const toPositiveInt = (value: unknown, fallback: number) => {
  // Normalize number-like input into a positive integer fallback.
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const buildAccountName = (account: any) => {
  // Build a full display name from available account name parts.
  const parts = [account?.firstName, account?.middleName, account?.lastName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return parts.join(" ").trim();
};

export const getInspectorWorkflowAuditEvents = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Fetch paginated inspector workflow audit events using request filters.
    const inspectorId = String((req as any).account?._id ?? "");
    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(100, toPositiveInt(req.query.limit, 20));

    const result = await AuditService.getInspectorWorkflowAuditEventsS({
      inspectorId,
      inspectorName: buildAccountName((req as any).account),
      page,
      limit,
      permit: String(req.query.permit ?? ""),
      search: String(req.query.search ?? ""),
      dateFrom: String(req.query.dateFrom ?? ""),
      dateTo: String(req.query.dateTo ?? ""),
    });

    return res.status(200).json({
      success: true,
      message: "Inspector workflow audit events retrieved successfully.",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

export const downloadInspectorWorkflowAuditPdf = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Generate and return the inspector workflow audit report as a PDF file.
    const inspectorId = String((req as any).account?._id ?? "");
    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const pdfBuffer = await AuditService.downloadInspectorWorkflowAuditPdfS({
      inspectorId,
      inspectorName: buildAccountName((req as any).account),
      permit: String(req.query.permit ?? ""),
      search: String(req.query.search ?? ""),
      dateFrom: String(req.query.dateFrom ?? ""),
      dateTo: String(req.query.dateTo ?? ""),
    });

    const generatedDate = new Date().toISOString().slice(0, 10);
    const filename = `inspector-workflow-history-${generatedDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return next(error);
  }
};
