import * as AuditService from "@/services/main-treasurer/audit.service";
import { NextFunction, Request, Response } from "express";

const toPositiveInt = (value: unknown, fallback: number) => {
  // Normalize number-like input into a positive integer fallback.
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const setNoCacheHeaders = (res: Response) => {
  // Disable caching so clients always receive fresh API responses.
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

export const getMainTreasurerWorkflowAuditEvents = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Fetch paginated main treasurer workflow audit events using request filters.
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(100, toPositiveInt(req.query.limit, 20));

    const result = await AuditService.getMainTreasurerWorkflowAuditEventsS({
      page,
      limit,
      permit: String(req.query.permit ?? ""),
      source: String(req.query.source ?? ""),
      search: String(req.query.search ?? ""),
      dateFrom: String(req.query.dateFrom ?? ""),
      dateTo: String(req.query.dateTo ?? ""),
    });

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Main treasurer workflow audit events retrieved successfully.",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

export const downloadMainTreasurerWorkflowAuditPdf = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Generate and return the main treasurer workflow audit report as a PDF file.
    const pdfBuffer = await AuditService.downloadMainTreasurerWorkflowAuditPdfS(
      {
        permit: String(req.query.permit ?? ""),
        source: String(req.query.source ?? ""),
        search: String(req.query.search ?? ""),
        dateFrom: String(req.query.dateFrom ?? ""),
        dateTo: String(req.query.dateTo ?? ""),
      },
    );

    const generatedDate = new Date().toISOString().slice(0, 10);
    const filename = `main-treasurer-workflow-history-${generatedDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return next(error);
  }
};
