import * as PaymentAssessmentService from "@/services/main-treasurer/main-treasurer.service";
import { getOwnerUnreadApplicationCountS } from "@/services/owner/owner.service";
import { emitDashboardStats } from "@/utils/admin/emit-dashboard-stats.util";
import { emitAllAdminRoutedApplications } from "@/utils/admin/emit-routed-applications.util";
import { AppError } from "@/utils/error/app-error.util";
import { emitEvaluatorApplications } from "@/utils/evaluator/emit-evaluator-applications.util";
import { emitOwnerApplicationStatusUpdate } from "@/utils/owner/emit-owner-application-status.util";
import { NextFunction, Request, Response } from "express";
import PermitApplication from "@/models/permit_application/permit-application.model";

const isPaymentStatus = (value: string): value is "pending" | "paid" => {
  // Restrict payment status updates to supported values.
  return ["pending", "paid"].includes(value);
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

const emitOwnerRefreshForApplication = async (applicationId: string) => {
  const application = await PermitApplication.findById(applicationId)
    .select("applicant ownerStatusVersion ownerStatusReadVersion")
    .lean();
  if (!application) return;

  const applicantId = String((application as any).applicant ?? "");
  if (!applicantId) return;

  const unreadTotal = await getOwnerUnreadApplicationCountS(applicantId);
  emitOwnerApplicationStatusUpdate({
    applicantId,
    applicationId: String((application as any)._id ?? ""),
    ownerStatusVersion: Number((application as any).ownerStatusVersion ?? 0),
    ownerStatusReadVersion: Number(
      (application as any).ownerStatusReadVersion ?? 0,
    ),
    unreadTotal,
    statusSource: "treasurer",
  });
};

export const getMainTreasurerDashboard = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve aggregated dashboard metrics for the main treasurer view.
    const data = await PaymentAssessmentService.getMainTreasurerDashboardS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Main treasurer dashboard retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getMainTreasurerPayments = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve all payment assessments visible to the main treasurer.
    const data = await PaymentAssessmentService.getMainTreasurerPaymentsS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Main treasurer payments retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

export const confirmMainTreasurerPaymentReceipt = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Confirm a payment receipt and broadcast related status updates.
    const applicationId = String(req.params.applicationId ?? "").trim();
    const qrValue = String(req.body?.qrValue ?? "").trim();
    const amountReceived = req.body?.amountReceived;
    const treasurerId = String((req as any).account?._id ?? "").trim();

    const updated =
      await PaymentAssessmentService.confirmMainTreasurerPaymentReceiptS({
        applicationId,
        qrValue,
        amountReceived,
        treasurerId,
      });

    if (!updated) {
      return next(new AppError("Payment assessment not found.", 404));
    }

    const applicantId = String((updated as any).applicant ?? "");
    const unreadTotal = applicantId
      ? await getOwnerUnreadApplicationCountS(applicantId)
      : 0;

    emitOwnerApplicationStatusUpdate({
      applicantId,
      applicationId: String((updated as any)._id ?? ""),
      ownerStatusVersion: Number((updated as any).ownerStatusVersion ?? 0),
      ownerStatusReadVersion: Number(
        (updated as any).ownerStatusReadVersion ?? 0,
      ),
      unreadTotal,
      statusSource: "treasurer",
    });
    await emitEvaluatorApplications();
    await emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Payment confirmed successfully.",
      data: updated,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (message.includes("Payment is already marked as paid")) {
      const applicationId = String(req.params.applicationId ?? "").trim();
      if (applicationId) {
        await emitOwnerRefreshForApplication(applicationId);
      }
    }
    if (
      message.toLowerCase().includes("main treasurer payment") ||
      message.includes("Application is not currently available") ||
      message.includes("Scanned payment QR") ||
      message.includes("Scanned QR code") ||
      message.includes("Amount received") ||
      message.includes("Insufficient amount") ||
      message.includes("Payment is already marked as paid")
    ) {
      return next(new AppError(message, 400));
    }
    return next(error);
  }
};

export const updateMainTreasurerPaymentStatus = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Update a single department payment status for an application.
    const applicationId = String(req.params.applicationId ?? "").trim();
    const departmentId = String(req.params.departmentId ?? "").trim();
    const paymentStatus = String(req.body?.paymentStatus ?? "").trim();
    const treasurerId = String((req as any).account?._id ?? "").trim();

    if (!isPaymentStatus(paymentStatus)) {
      return next(
        new AppError("Invalid payment status. Allowed: pending, paid.", 400),
      );
    }

    const updated =
      await PaymentAssessmentService.updateMainTreasurerPaymentStatusS({
        applicationId,
        departmentId,
        paymentStatus,
        treasurerId,
      });

    if (!updated) {
      return next(new AppError("Payment assessment not found.", 404));
    }

    const applicantId = String((updated as any).applicant ?? "");
    const unreadTotal = applicantId
      ? await getOwnerUnreadApplicationCountS(applicantId)
      : 0;

    emitOwnerApplicationStatusUpdate({
      applicantId,
      applicationId: String((updated as any)._id ?? ""),
      ownerStatusVersion: Number((updated as any).ownerStatusVersion ?? 0),
      ownerStatusReadVersion: Number(
        (updated as any).ownerStatusReadVersion ?? 0,
      ),
      unreadTotal,
      statusSource: "treasurer",
    });
    await emitEvaluatorApplications();
    await emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Payment status updated successfully.",
      data: updated,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (
      message.toLowerCase().includes("main treasurer payment") ||
      message.includes("Application is not currently available")
    ) {
      return next(new AppError(message, 400));
    }
    return next(error);
  }
};

export const updateMainTreasurerPaymentStatusBatch = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Update payment statuses in batch across selected departments.
    const applicationId = String(req.params.applicationId ?? "").trim();
    const paymentStatus = String(req.body?.paymentStatus ?? "").trim();
    const departmentIds = Array.isArray(req.body?.departmentIds)
      ? req.body.departmentIds
          .map((value: unknown) => String(value ?? "").trim())
          .filter(Boolean)
      : [];
    const treasurerId = String((req as any).account?._id ?? "").trim();

    if (!isPaymentStatus(paymentStatus)) {
      return next(
        new AppError("Invalid payment status. Allowed: pending, paid.", 400),
      );
    }
    if (departmentIds.length === 0) {
      return next(new AppError("At least one department is required.", 400));
    }

    const updated =
      await PaymentAssessmentService.updateMainTreasurerPaymentStatusesBatchS({
        applicationId,
        paymentStatus,
        departmentIds,
        treasurerId,
      });

    if (!updated) {
      return next(new AppError("Payment assessment not found.", 404));
    }

    const applicantId = String((updated as any).applicant ?? "");
    const unreadTotal = applicantId
      ? await getOwnerUnreadApplicationCountS(applicantId)
      : 0;

    emitOwnerApplicationStatusUpdate({
      applicantId,
      applicationId: String((updated as any)._id ?? ""),
      ownerStatusVersion: Number((updated as any).ownerStatusVersion ?? 0),
      ownerStatusReadVersion: Number(
        (updated as any).ownerStatusReadVersion ?? 0,
      ),
      unreadTotal,
      statusSource: "treasurer",
    });
    await emitEvaluatorApplications();
    await emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Payment statuses updated successfully.",
      data: updated,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (
      message.toLowerCase().includes("main treasurer payment") ||
      message.includes("Application is not currently available")
    ) {
      return next(new AppError(message, 400));
    }
    return next(error);
  }
};
