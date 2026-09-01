import * as PaymentAssessmentService from "@/services/department-treasurer/department-treasurer.service";
import { emitAllAdminRoutedApplications } from "@/utils/admin/emit-routed-applications.util";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";

const isPaymentStatus = (value: string): value is "pending" | "paid" =>
  ["pending", "paid"].includes(value);

export const getDepartmentTreasurerDashboard = async (
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

    const data = await PaymentAssessmentService.getDepartmentTreasurerDashboardS(
      departmentId,
    );

    return res.status(200).json({
      success: true,
      message: "Department treasurer dashboard retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the list of payers for the department treasurer. It will validate the input parameters, call the service to fetch the payers, and return them in the response. It also supports filtering based on payment status (pending or paid).
export const getDepartmentTreasurerPayers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const departmentId = String((req as any).account?.departmentId ?? "").trim();

    if (!departmentId) {
      return next(new AppError("Department assignment is required.", 400));
    }

    const requestedPaymentStatus = String(
      req.query?.paymentStatus ?? "",
    ).trim();
    const paymentStatus = requestedPaymentStatus
      ? requestedPaymentStatus.toLowerCase()
      : "";
    if (paymentStatus && !isPaymentStatus(paymentStatus)) {
      return next(
        new AppError("Invalid payment status. Allowed: pending, paid.", 400),
      );
    }
    const normalizedPaymentStatus = paymentStatus
      ? (paymentStatus as "pending" | "paid")
      : undefined;

    const data = await PaymentAssessmentService.getDepartmentTreasurerPayersS(
      departmentId,
      normalizedPaymentStatus,
    );

    return res.status(200).json({
      success: true,
      message: "Department payers retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the fee assessment template for the department treasurer. It will validate the input parameters, call the service to fetch the template, and return it in the response. If no template exists, it will return a default empty template structure.
export const getDepartmentFeeTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const departmentId = String((req as any).account?.departmentId ?? "").trim();
    const departmentName = String(
      (req as any).account?.departmentName ?? "",
    ).trim();

    if (!departmentId) {
      return next(new AppError("Department assignment is required.", 400));
    }

    const template = await PaymentAssessmentService.getDepartmentFeeTemplateS(
      departmentId,
    );

    return res.status(200).json({
      success: true,
      message: "Department fee assessment template retrieved successfully.",
      data:
        template ?? {
          departmentId,
          departmentName,
          items: [],
          totalAmount: 0,
        },
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for saving the fee assessment template for a specific permit type. It will validate the input, call the service to save the template, and return the updated template in the response.
export const upsertDepartmentFeeTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const departmentId = String((req as any).account?.departmentId ?? "").trim();
    const departmentName = String(
      (req as any).account?.departmentName ?? "",
    ).trim();
    const accountId = String((req as any).account?._id ?? "").trim();

    if (!departmentId || !accountId) {
      return next(new AppError("Department assignment is required.", 400));
    }

    const items = req.body?.items;

    const template = await PaymentAssessmentService.upsertDepartmentFeeTemplateS({
      departmentId,
      departmentName,
      items,
      accountId,
    });

    await emitAllAdminRoutedApplications();

    return res.status(200).json({
      success: true,
      message: "Department fee assessment template saved successfully.",
      data: template,
    });
  } catch (error: any) {
    if (error?.message?.includes("fee item")) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};
