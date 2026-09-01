import PermitApplication from "@/models/permit_application/permit-application.model";
import * as RoutedApplicationService from "@/services/inspector/inspector.service";
import { getOwnerUnreadApplicationCountS } from "@/services/owner/owner.service";
import * as PermitTemplateService from "@/services/super_admin/permit-template.service";
import { emitDashboardStats } from "@/utils/admin/emit-dashboard-stats.util";
import { emitAllAdminRoutedApplications } from "@/utils/admin/emit-routed-applications.util";
import { AppError } from "@/utils/error/app-error.util";
import { emitEvaluatorApplications } from "@/utils/evaluator/emit-evaluator-applications.util";
import { emitOwnerApplicationStatusUpdate } from "@/utils/owner/emit-owner-application-status.util";
import { NextFunction, Request, Response } from "express";

const isInspectionAssessmentResult = (
  value: string,
): value is "passed" | "for_completion" | "failed" => {
  // Restrict inspection outcomes to supported decision values.
  return ["passed", "for_completion", "failed"].includes(value);
};

export const getInspectorInspectionRequestApplications = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve applications awaiting inspector scheduling or assessment.
    const inspectorId = String((req as any).account?._id ?? "");
    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const applications =
      await RoutedApplicationService.getInspectorInspectionRequestApplicationsS(
        inspectorId,
      );

    return res.status(200).json({
      success: true,
      message:
        "Inspector inspection request applications retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

export const getInspectorDashboard = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve dashboard metrics for the logged-in inspector.
    const inspectorId = String((req as any).account?._id ?? "");
    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const dashboard =
      await RoutedApplicationService.getInspectorDashboardS(inspectorId);

    // Prevent conditional revalidation responses (304) so clients always
    // receive a response body and avoid false "failed to load" states.
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.status(200).json({
      success: true,
      message: "Inspector dashboard retrieved successfully.",
      data: dashboard,
    });
  } catch (error) {
    return next(error);
  }
};

export const getInspectorInspectionSchedules = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve inspection schedules assigned to the current inspector.
    const inspectorId = String((req as any).account?._id ?? "");
    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const schedules =
      await RoutedApplicationService.getInspectorInspectionSchedulesS(
        inspectorId,
      );

    return res.status(200).json({
      success: true,
      message: "Inspector schedules retrieved successfully.",
      data: schedules,
    });
  } catch (error) {
    return next(error);
  }
};

export const getInspectorPermitReleaseApplications = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve applications that are ready for permit release review.
    const inspectorId = String((req as any).account?._id ?? "");
    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const applications =
      await RoutedApplicationService.getInspectorPermitReleaseApplicationsS(
        inspectorId,
      );

    return res.status(200).json({
      success: true,
      message: "Inspector permit release applications retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

export const getInspectorRoutedApplicationById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve a specific routed application scoped to this inspector.
    const applicationId = String(req.params.applicationId ?? "");
    const inspectorId = String((req as any).account?._id ?? "");
    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const application =
      await RoutedApplicationService.getInspectorRoutedApplicationByIdS({
        applicationId,
        inspectorId,
      });

    if (!application) {
      return next(new AppError("Application not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Application details retrieved successfully.",
      data: application,
    });
  } catch (error) {
    return next(error);
  }
};

export const completeInspectorInspectionStep = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Submit the inspection outcome and trigger downstream updates.
    const applicationId = String(req.params.applicationId ?? "");
    const inspectorId = String((req as any).account?._id ?? "");
    const result = String(req.body?.result ?? "passed").trim();
    const completionRemark = String(req.body?.remark ?? "").trim();

    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!isInspectionAssessmentResult(result)) {
      return next(
        new AppError(
          "Invalid inspection assessment result. Allowed: passed, for_completion, failed.",
          400,
        ),
      );
    }
    if (
      (result === "failed" || result === "for_completion") &&
      !completionRemark
    ) {
      return next(
        new AppError("Remark is required for this assessment result.", 400),
      );
    }

    // Prevent status transition when no active inspection certificate template
    // is available for this permit, so the record remains in inspector queues.
    if (result === "passed") {
      const hasActiveTemplate =
        await PermitTemplateService.hasActiveTemplateForApplicationS({
          applicationId,
          mode: "inspection_certificate",
        });
      if (!hasActiveTemplate) {
        return next(
          new AppError(
            "No active template found for this permit. Please activate a matching template.",
            400,
          ),
        );
      }
    }

    const updated =
      await RoutedApplicationService.completeInspectorInspectionStepS({
        applicationId,
        inspectorId,
        result,
        completionRemark,
      });

    if (!updated) {
      return next(new AppError("Application not found.", 404));
    }

    if (result === "passed") {
      await PermitTemplateService.generatePermitDocumentS({
        applicationId,
        adminId: inspectorId,
        mode: "inspection_certificate",
      });
    }

    const latestOwnerState =
      result === "passed"
        ? await PermitApplication.findById(String((updated as any)._id ?? ""))
            .select("applicant ownerStatusVersion ownerStatusReadVersion")
            .lean()
        : null;
    const applicantId = String(
      (latestOwnerState as any)?.applicant ?? (updated as any).applicant ?? "",
    );
    const unreadTotal = applicantId
      ? await getOwnerUnreadApplicationCountS(applicantId)
      : 0;
    const ownerStatusVersion = Number(
      (latestOwnerState as any)?.ownerStatusVersion ??
        (updated as any).ownerStatusVersion ??
        0,
    );
    const ownerStatusReadVersion = Number(
      (latestOwnerState as any)?.ownerStatusReadVersion ??
        (updated as any).ownerStatusReadVersion ??
        0,
    );

    emitOwnerApplicationStatusUpdate({
      applicantId,
      applicationId: String((updated as any)._id ?? ""),
      ownerStatusVersion,
      ownerStatusReadVersion,
      unreadTotal,
      statusSource: "inspector",
    });
    void emitEvaluatorApplications();
    void emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Inspection assessment submitted successfully.",
      data: updated,
    });
  } catch (error: any) {
    if (
      error?.message?.includes("schedule") ||
      error?.message?.includes("assessment") ||
      error?.message?.includes("Remark is required") ||
      error?.message?.includes("No active template") ||
      error?.message?.includes("matching template") ||
      error?.message?.includes("permit mismatch") ||
      error?.message?.includes("not issuable for certificate generation") ||
      error?.message?.includes("Template counters changed") ||
      error?.message?.includes("Unmapped placeholder") ||
      error?.message?.includes("Missing approved value")
    ) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const setInspectorInspectionSchedule = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Set the initial inspection schedule for a routed application.
    const applicationId = String(req.params.applicationId ?? "");
    const inspectorId = String((req as any).account?._id ?? "");
    const inspectionAt = String(req.body?.inspectionAt ?? "").trim();

    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!inspectionAt) {
      return next(new AppError("Inspection date/time is required.", 400));
    }

    const updated =
      await RoutedApplicationService.setInspectorInspectionScheduleS({
        applicationId,
        inspectorId,
        inspectionAt,
      });

    if (!updated) {
      return next(new AppError("Application not found.", 404));
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
      statusSource: "inspector",
    });
    void emitEvaluatorApplications();
    void emitAllAdminRoutedApplications();

    return res.status(200).json({
      success: true,
      message: "Inspection schedule set successfully.",
      data: updated,
    });
  } catch (error: any) {
    if (error?.message?.includes("schedule")) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const updateInspectorInspectionSchedule = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Update a previously set inspection schedule with a required remark.
    const applicationId = String(req.params.applicationId ?? "");
    const inspectorId = String((req as any).account?._id ?? "");
    const inspectionAt = String(req.body?.inspectionAt ?? "").trim();
    const remark = String(req.body?.remark ?? "").trim();

    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }
    if (!inspectionAt) {
      return next(new AppError("Inspection date/time is required.", 400));
    }
    if (!remark) {
      return next(
        new AppError("Remark is required when updating schedule.", 400),
      );
    }

    const updated =
      await RoutedApplicationService.updateInspectorInspectionScheduleS({
        applicationId,
        inspectorId,
        inspectionAt,
        remark,
      });

    if (!updated) {
      return next(new AppError("Application not found.", 404));
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
      statusSource: "inspector",
    });
    void emitEvaluatorApplications();
    void emitAllAdminRoutedApplications();

    return res.status(200).json({
      success: true,
      message: "Inspection schedule updated successfully.",
      data: updated,
    });
  } catch (error: any) {
    if (error?.message?.includes("schedule")) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const generateInspectorInspectionCertificate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Generate an inspection certificate for an inspector-owned application.
    const applicationId = String(req.params.applicationId ?? "");
    const inspectorId = String((req as any).account?._id ?? "");

    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const access = await PermitApplication.findOne({
      _id: applicationId,
      "inspectionFlow.steps.assignedInspector": inspectorId,
    })
      .select("_id")
      .lean();

    if (!access) {
      return next(new AppError("Application not found.", 404));
    }

    const generated = await PermitTemplateService.generatePermitDocumentS({
      applicationId,
      adminId: inspectorId,
      mode: "inspection_certificate",
    });

    if (!generated) {
      return next(new AppError("Application not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Inspection certificate generated successfully.",
      data: generated,
    });
  } catch (error: any) {
    if (
      error?.message?.includes("No active template") ||
      error?.message?.includes("matching template") ||
      error?.message?.includes("permit mismatch") ||
      error?.message?.includes("not issuable for certificate generation") ||
      error?.message?.includes("Template counters changed") ||
      error?.message?.includes("Unmapped placeholder") ||
      error?.message?.includes("Missing approved value")
    ) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

export const getInspectorGeneratedInspectionCertificate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve generated inspection certificate metadata for an application.
    const applicationId = String(req.params.applicationId ?? "");
    const inspectorId = String((req as any).account?._id ?? "");

    if (!inspectorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const access = await PermitApplication.findOne({
      _id: applicationId,
      "inspectionFlow.steps.assignedInspector": inspectorId,
    })
      .select("_id")
      .lean();

    if (!access) {
      return next(new AppError("Application not found.", 404));
    }

    const generated =
      await PermitTemplateService.getGeneratedInspectionCertificateDocumentS(
        applicationId,
      );

    if (!generated) {
      return next(
        new AppError("Generated inspection certificate not found.", 404),
      );
    }

    return res.status(200).json({
      success: true,
      message: "Generated inspection certificate retrieved successfully.",
      data: generated,
    });
  } catch (error) {
    return next(error);
  }
};
