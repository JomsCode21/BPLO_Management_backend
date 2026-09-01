import * as AuditService from "@/services/department-treasurer/audit.service";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

// This controller is for retrieving the audit events related to the department treasurer workflow. It will validate the input parameters, call the service to fetch the audit events, and return them in the response. It also supports pagination and filtering based on permit, source, search term, and date range.
export const getDepartmentTreasurerWorkflowAuditEvents = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Controller flow: validate input here, then delegate business logic to services.
    const departmentId = String((req as any).account?.departmentId ?? "").trim();

    if (!departmentId) {
      return next(new AppError("Department assignment is required.", 400));
    }

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(100, toPositiveInt(req.query.limit, 20));

    const result = await AuditService.getDepartmentTreasurerWorkflowAuditEventsS({
      departmentId,
      page,
      limit,
      permit: String(req.query.permit ?? ""),
      source: String(req.query.source ?? ""),
      search: String(req.query.search ?? ""),
      dateFrom: String(req.query.dateFrom ?? ""),
      dateTo: String(req.query.dateTo ?? ""),
    });

    return res.status(200).json({
      success: true,
      message: "Department treasurer workflow audit events retrieved successfully.",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for downloading the audit events related to the department treasurer workflow as a PDF file. It will validate the input parameters, call the service to generate the PDF, and return it in the response with appropriate headers for file download.
export const downloadDepartmentTreasurerWorkflowAuditPdf = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const departmentId = String((req as any).account?.departmentId ?? "").trim();

    if (!departmentId) {
      return next(new AppError("Department assignment is required.", 400));
    }

    const pdfBuffer = await AuditService.downloadDepartmentTreasurerWorkflowAuditPdfS({
      departmentId,
      permit: String(req.query.permit ?? ""),
      source: String(req.query.source ?? ""),
      search: String(req.query.search ?? ""),
      dateFrom: String(req.query.dateFrom ?? ""),
      dateTo: String(req.query.dateTo ?? ""),
    });

    const generatedDate = new Date().toISOString().slice(0, 10);
    const filename = `department-treasurer-workflow-history-${generatedDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return next(error);
  }
};
