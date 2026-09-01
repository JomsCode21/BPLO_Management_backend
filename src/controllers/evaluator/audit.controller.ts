import * as AuditService from "@/services/evaluator/audit.service";
import { NextFunction, Request, Response } from "express";

const toPositiveInt = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

// This controller is for retrieving the audit events related to the evaluator workflow. It will validate the input parameters, call the service to fetch the audit events, and return them in the response. It also supports pagination and filtering based on permit, source, search term, and date range.
export const getEvaluatorWorkflowAuditEvents = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Controller flow: validate input here, then delegate business logic to services.
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(100, toPositiveInt(req.query.limit, 20));

    const result = await AuditService.getEvaluatorWorkflowAuditEventsS({
      page,
      limit,
      permit: String(req.query.permit ?? ""),
      search: String(req.query.search ?? ""),
      dateFrom: String(req.query.dateFrom ?? ""),
      dateTo: String(req.query.dateTo ?? ""),
    });

    return res.status(200).json({
      success: true,
      message: "Evaluator workflow audit events retrieved successfully.",
      ...result,
    });
  } catch (error) {
    return next(error);
  }
};
