import * as AuditService from "@/services/bplo-admin/audit.service";
import { NextFunction, Request, Response } from "express";

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const setNoCacheHeaders = (res: Response) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

export const getBploWorkflowAuditEvents = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Controller flow: validate input here, then delegate business logic to services.
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(100, toPositiveInt(req.query.limit, 20));

    const result = await AuditService.getBploWorkflowAuditEventsS({
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
      message: "BPLO workflow audit events retrieved successfully.",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};

export const downloadBploWorkflowAuditPdf = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const pdfBuffer = await AuditService.downloadBploWorkflowAuditPdfS({
      permit: String(req.query.permit ?? ""),
      source: String(req.query.source ?? ""),
      search: String(req.query.search ?? ""),
      dateFrom: String(req.query.dateFrom ?? ""),
      dateTo: String(req.query.dateTo ?? ""),
    });

    const generatedDate = new Date().toISOString().slice(0, 10);
    const filename = `bplo-workflow-history-${generatedDate}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    return next(error);
  }
};
