import * as OwnerService from "@/services/owner/owner.service";
import { emitDashboardStats } from "@/utils/admin/emit-dashboard-stats.util";
import { emitAllAdminRoutedApplications } from "@/utils/admin/emit-routed-applications.util";
import { AppError } from "@/utils/error/app-error.util";
import { emitEvaluatorApplications } from "@/utils/evaluator/emit-evaluator-applications.util";
import { emitOwnerApplicationStatusUpdate } from "@/utils/owner/emit-owner-application-status.util";
import { NextFunction, Request, Response } from "express";

type OwnerNotificationScope = "application" | "inspection" | "payment";

const isOwnerNotificationScope = (
  value: unknown,
): value is OwnerNotificationScope => {
  // Restrict owner notification scope to supported channel names.
  return (
    value === "application" || value === "inspection" || value === "payment"
  );
};

export const getPermitsForOwner = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve permits available for owner submissions.
    const permits = await OwnerService.getAvailablePermitsS();
    return res.status(200).json({
      success: true,
      message: "Permits retrieved successfully.",
      data: permits,
    });
  } catch (error) {
    return next(error);
  }
};

export const getPermitForOwnerById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve permit form data scoped to the requesting owner.
    const permitId = String(req.params.permitId ?? "");
    const applicantId = String((req as any).account?._id ?? "");
    const applicationId = String(req.query.applicationId ?? "").trim();

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const permit = await OwnerService.getPermitForApplicationS(permitId);

    if (!permit) {
      return next(new AppError("Permit not found.", 404));
    }

    if (!permit.isActive) {
      const canAccessInactivePermit =
        await OwnerService.canOwnerAccessInactivePermitResubmissionS({
          permitId,
          applicationId,
          applicantId,
        });

      if (!canAccessInactivePermit) {
        return next(
          new AppError(
            "This permit is no longer available for new applications.",
            409,
          ),
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Permit form retrieved successfully.",
      data: permit,
    });
  } catch (error) {
    return next(error);
  }
};

export const submitPermitApplication = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Create a new owner permit application and notify other dashboards.
    const permitId = String(req.params.permitId ?? "");
    const responses = Array.isArray(req.body?.responses)
      ? req.body.responses
      : [];
    const applicantId = String((req as any).account?._id ?? "");

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const application = await OwnerService.createPermitApplicationS({
      permitId,
      applicantId,
      responses,
    });

    if (!application) {
      return next(new AppError("Permit not found.", 404));
    }

    void emitEvaluatorApplications();
    void emitDashboardStats();

    return res.status(201).json({
      success: true,
      message: "Permit application submitted successfully.",
      data: application,
    });
  } catch (error: any) {
    if (error?.message?.includes("required")) {
      return next(new AppError(error.message, 400));
    }
    if (error?.message?.includes("Invalid option")) {
      return next(new AppError(error.message, 400));
    }
    if (error?.message?.includes("already registered")) {
      return next(new AppError(error.message, 409));
    }
    if (error?.message?.includes("no longer available")) {
      return next(new AppError(error.message, 409));
    }
    return next(error);
  }
};

export const getOwnerApplicationStatuses = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve summarized application statuses for the owner.
    const applicantId = String((req as any).account?._id ?? "");

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const applications =
      await OwnerService.getOwnerApplicationStatusesS(applicantId);

    return res.status(200).json({
      success: true,
      message: "Application statuses retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

export const getOwnerGeneratedDocuments = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve all generated documents available to the owner.
    const applicantId = String((req as any).account?._id ?? "");

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const documents =
      await OwnerService.getOwnerGeneratedDocumentsS(applicantId);

    return res.status(200).json({
      success: true,
      message: "Generated documents retrieved successfully.",
      data: documents,
    });
  } catch (error) {
    return next(error);
  }
};

export const getOwnerApplicationById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve a specific application record owned by the requester.
    const applicantId = String((req as any).account?._id ?? "");
    const applicationId = String(req.params.applicationId ?? "");

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const application = await OwnerService.getOwnerApplicationByIdS({
      applicationId,
      applicantId,
    });

    if (!application) {
      return next(new AppError("Application not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Application retrieved successfully.",
      data: application,
    });
  } catch (error) {
    return next(error);
  }
};

export const getOwnerApplicationStatusDetail = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve detailed status progression for one owner application.
    const applicantId = String((req as any).account?._id ?? "");
    const applicationId = String(req.params.applicationId ?? "");

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const application = await OwnerService.getOwnerApplicationStatusDetailS({
      applicationId,
      applicantId,
    });

    if (!application) {
      return next(new AppError("Application not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Application status detail retrieved successfully.",
      data: application,
    });
  } catch (error) {
    return next(error);
  }
};

const sendOwnerGeneratedPdf = async (params: {
  req: Request;
  res: Response;
  next: NextFunction;
  documentKind: "permit" | "inspection_certificate";
}) => {
  try {
    // Stream a generated owner PDF document by document kind.
    const applicantId = String((params.req as any).account?._id ?? "");
    const applicationId = String(params.req.params.applicationId ?? "");

    if (!applicantId) {
      return params.next(new AppError("Unauthorized: Account not found.", 401));
    }

    const document = await OwnerService.getOwnerGeneratedDocumentPdfS({
      applicationId,
      applicantId,
      documentKind: params.documentKind,
    });

    if (!document) {
      return params.next(new AppError("Generated document not found.", 404));
    }

    params.res.setHeader("Content-Type", document.mimeType);
    params.res.setHeader(
      "Content-Disposition",
      `inline; filename="${document.fileName}"`,
    );
    return params.res.status(200).send(document.buffer);
  } catch (error) {
    return params.next(error);
  }
};

export const getOwnerGeneratedPermitPdf = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Return the generated business permit PDF for the owner.
  return sendOwnerGeneratedPdf({
    req,
    res,
    next,
    documentKind: "permit",
  });
};

export const getOwnerGeneratedInspectionCertificatePdf = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Return the generated inspection certificate PDF for the owner.
  return sendOwnerGeneratedPdf({
    req,
    res,
    next,
    documentKind: "inspection_certificate",
  });
};

export const resubmitPermitApplication = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Re-submit an application after owner corrections and notify dashboards.
    const applicantId = String((req as any).account?._id ?? "");
    const applicationId = String(req.params.applicationId ?? "");
    const responses = Array.isArray(req.body?.responses)
      ? req.body.responses
      : [];

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const application = await OwnerService.resubmitPermitApplicationS({
      applicationId,
      applicantId,
      responses,
    });

    if (!application) {
      return next(new AppError("Application not found.", 404));
    }

    void emitEvaluatorApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Application re-submitted successfully.",
      data: application,
    });
  } catch (error: any) {
    if (error?.message?.includes("required")) {
      return next(new AppError(error.message, 400));
    }
    if (error?.message?.includes("Invalid option")) {
      return next(new AppError(error.message, 400));
    }
    if (error?.message?.includes("already registered")) {
      return next(new AppError(error.message, 409));
    }
    if (error?.message?.includes("re-submission")) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const markOwnerApplicationStatusAsRead = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Mark a single owner application status entry as read.
    const applicantId = String((req as any).account?._id ?? "");
    const applicationId = String(req.params.applicationId ?? "");

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const marked = await OwnerService.markOwnerApplicationStatusAsReadS({
      applicationId,
      applicantId,
    });

    if (!marked) {
      return next(new AppError("Application not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Application status marked as read.",
      data: marked,
    });
  } catch (error) {
    return next(error);
  }
};

export const markAllOwnerApplicationStatusesAsRead = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Mark all owner application statuses as read, optionally by scope.
    const applicantId = String((req as any).account?._id ?? "");
    const rawScope = String(req.body?.scope ?? "")
      .trim()
      .toLowerCase();
    const scope = rawScope || undefined;

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    if (scope && !isOwnerNotificationScope(scope)) {
      return next(new AppError("Invalid owner notification scope.", 400));
    }

    const normalizedScope = isOwnerNotificationScope(scope) ? scope : undefined;
    const result = await OwnerService.markAllOwnerApplicationStatusesAsReadS({
      applicantId,
      scope: normalizedScope,
    });

    const scopeMessagePrefix =
      normalizedScope === "application"
        ? "Application"
        : normalizedScope === "inspection"
          ? "Inspection"
          : normalizedScope === "payment"
            ? "Payment"
            : "All application";

    return res.status(200).json({
      success: true,
      message: `${scopeMessagePrefix} statuses marked as read.`,
      data: result,
    });
  } catch (error) {
    return next(error);
  }
};

export const requestInspectionReassessment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Submit an inspection re-assessment request for the owner application.
    const applicantId = String((req as any).account?._id ?? "");
    const applicationId = String(req.params.applicationId ?? "");

    if (!applicantId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const updated = await OwnerService.requestInspectionReassessmentS({
      applicationId,
      applicantId,
    });

    if (!updated) {
      return next(new AppError("Application not found.", 404));
    }

    const unreadTotal =
      await OwnerService.getOwnerUnreadApplicationCountS(applicantId);

    emitOwnerApplicationStatusUpdate({
      applicantId,
      applicationId: String((updated as any)._id ?? ""),
      ownerStatusVersion: Number((updated as any).ownerStatusVersion ?? 0),
      ownerStatusReadVersion: Number(
        (updated as any).ownerStatusReadVersion ?? 0,
      ),
      unreadTotal,
      statusSource: "inspector",
    });
    void emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Re-assessment request submitted successfully.",
      data: updated,
    });
  } catch (error: any) {
    if (error?.message?.includes("Re-assessment")) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};
