import * as RoutedApplicationService from "@/services/bplo-admin/bplo-admin.service";
import * as PermitTemplateService from "@/services/super_admin/permit-template.service";
import PermitApplication from "@/models/permit_application/permit-application.model";
import { getOwnerUnreadApplicationCountS } from "@/services/owner/owner.service";
import { emitDashboardStats } from "@/utils/admin/emit-dashboard-stats.util";
import { emitAllAdminRoutedApplications } from "@/utils/admin/emit-routed-applications.util";
import { AppError } from "@/utils/error/app-error.util";
import { emitEvaluatorApplications } from "@/utils/evaluator/emit-evaluator-applications.util";
import { emitOwnerApplicationStatusUpdate } from "@/utils/owner/emit-owner-application-status.util";
import { NextFunction, Request, Response } from "express";

const isAdminDecision = (value: string): value is "approved" | "denied" =>
  ["approved", "denied"].includes(value);
const isInspectionAdminDecision = (
  value: string,
): value is "approved" | "pending" | "denied" =>
  ["approved", "pending", "denied"].includes(value);

const setNoCacheHeaders = (res: Response) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

export const getInspectionRequestApplications = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Controller flow: validate input here, then delegate business logic to services.
    const applications =
      await RoutedApplicationService.getAdminInspectionRequestApplicationsS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Inspection request applications retrieved successfully.",
      data: applications,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (message.includes("combined treasurer payment")) {
      return next(new AppError(message, 400));
    }
    return next(error);
  }
};

// This controller is for the BPLO dashboard analytics, which includes various metrics and charts for the admin dashboard. The service will handle the aggregation and calculation of the analytics data.
export const getBploDashboardAnalytics = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const analytics = await RoutedApplicationService.getBploDashboardAnalyticsS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "BPLO dashboard analytics retrieved successfully.",
      data: analytics,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the list of permit approval applications that are pending review by the BPLO admin. The service will handle fetching the relevant applications and any necessary filtering or sorting.
export const getPermitApprovalApplications = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applications =
      await RoutedApplicationService.getPermitApprovalApplicationsS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Permit approval applications retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the list of permit release applications that are pending review by the BPLO admin. The service will handle fetching the relevant applications and any necessary filtering or sorting.
export const getPermitReleaseApplications = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applications =
      await RoutedApplicationService.getPermitReleaseApplicationsS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Permit release applications retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for saving the inspection request decision made by the BPLO admin. It will validate the input, call the service to save the decision, and then emit necessary events to update the application status for the owner and evaluators.
export const saveInspectionRequestDecision = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const decision = String(req.body?.decision ?? "").trim();
    const remark = String(req.body?.remark ?? "").trim();

    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    if (!isInspectionAdminDecision(decision)) {
      return next(
        new AppError(
          "Invalid inspection decision. Allowed: approved, pending, denied.",
          400,
        ),
      );
    }

    if (decision === "denied" && !remark) {
      return next(new AppError("Remark is required for denied decision.", 400));
    }

    const updated =
      await RoutedApplicationService.saveInspectionRequestDecisionS({
        applicationId,
        adminId,
        decision,
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
      statusSource: "bplo_admin",
    });
    void emitEvaluatorApplications();
    void emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Inspection request decision saved successfully.",
      data: updated,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the details of a specific routed application by its ID. The service will handle fetching the application details and any necessary related information.
export const getRoutedApplicationById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const application =
      await RoutedApplicationService.getRoutedApplicationByIdS(applicationId);

    if (!application) {
      return next(new AppError("Application not found.", 404));
    }

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Application details retrieved successfully.",
      data: application,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for saving the permit approval decision made by the BPLO admin. It will validate the input, call the service to save the decision, and then emit necessary events to update the application status for the owner and evaluators.
export const savePermitApprovalDecision = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const decision = String(req.body?.decision ?? "").trim();
    const remark = String(req.body?.remark ?? "").trim();

    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    if (!isAdminDecision(decision)) {
      return next(
        new AppError("Invalid admin decision. Allowed: approved, denied.", 400),
      );
    }

    if (decision === "denied" && !remark) {
      return next(new AppError("Remark is required for denied decision.", 400));
    }

    const updated = await RoutedApplicationService.savePermitApprovalDecisionS({
      applicationId,
      adminId,
      decision,
      remark,
    });

    if (!updated) {
      return next(new AppError("Application not found.", 404));
    }

    const responsePayload = {
      success: true,
      message: "Permit approval decision saved successfully.",
      data: updated,
    };
    res.status(200).json(responsePayload);
    void (async () => {
      try {
        if (decision !== "denied") {
          await emitAllAdminRoutedApplications();
          await emitDashboardStats();
          return;
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
          statusSource: "bplo_admin",
        });
        await emitAllAdminRoutedApplications();
        await emitDashboardStats();
      } catch (postCommitError) {
        console.error(
          `Post-response admin decision updates failed for application ${applicationId}`,
          postCommitError,
        );
      }
    })();

    return;
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the permit payment analytics for the BPLO admin dashboard. The service will handle fetching and calculating the relevant analytics data.
export const getBploAdminPermitPaymentAnalytics = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await RoutedApplicationService.getBploAdminPermitPaymentAnalyticsS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "BPLO permit payment analytics retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the list of payers for a specific permit payment. The service will handle fetching the relevant payers based on the permit ID.
export const getBploAdminPermitPaymentPayers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const permitId = String(req.params.permitId ?? "");
    const data = await RoutedApplicationService.getBploAdminPermitPaymentPayersS(
      permitId,
    );
    if (!data) {
      return next(new AppError("Permit type not found.", 404));
    }

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "BPLO permit payment payers retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the list of permit types that have fee assessment templates for the BPLO admin. The service will handle fetching the relevant permit types.
export const getBploAdminFeeAssessmentPermits = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await RoutedApplicationService.getBploAdminFeeAssessmentPermitsS();
    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Fee assessment permit types retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the fee assessment template for a specific permit type. The service will handle fetching the relevant template based on the permit ID.
export const getBploAdminFeeAssessmentTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const permitId = String(req.params.permitId ?? "");
    const data =
      await RoutedApplicationService.getBploAdminFeeAssessmentTemplateS(permitId);
    if (!data) {
      return next(new AppError("Permit type not found.", 404));
    }

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Fee assessment template retrieved successfully.",
      data,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for saving the fee assessment template for a specific permit type. It will validate the input, call the service to save the template, and return the updated template in the response.
export const saveBploAdminFeeAssessmentTemplate = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const permitId = String(req.params.permitId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const data = await RoutedApplicationService.saveBploAdminFeeAssessmentTemplateS({
      permitId,
      items,
      adminId,
    });

    if (!data) {
      return next(new AppError("Permit type not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Fee assessment template saved successfully.",
      data,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (message.includes("At least one fee item is required.")) {
      return next(new AppError(message, 400));
    }
    return next(error);
  }
};

// This controller is for saving the admin fee assessment for a specific application. It will validate the input, call the service to save the assessment, and then emit necessary events to update the application status for the owner and evaluators.
export const upsertAdminFeeAssessment = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const adminId = String((req as any).account?._id ?? "");
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const updated = await RoutedApplicationService.upsertAdminFeeAssessmentS({
      applicationId,
      adminId,
      items,
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
      statusSource: "bplo_admin",
    });
    void emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Admin fee assessment saved successfully.",
      data: updated,
    });
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (
      message.includes("At least one admin fee item is required.") ||
      message.includes("Admin fee assessment can only be updated")
    ) {
      return next(new AppError(message, 400));
    }
    return next(error);
  }
};

// This controller is for retrieving the list of permit validity applications that are pending review by the BPLO admin. The service will handle fetching the relevant applications and any necessary filtering or sorting.
export const getPermitValidityApplications = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applications =
      await RoutedApplicationService.getPermitValidityApplicationsS();

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Permit validity applications retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for generating the permit document for a specific application. It will validate the input, call the service to generate the document, and return the generated document in the response. It will also emit necessary events to update the application status for the owner and evaluators.
export const generatePermitDocument = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const adminId = String((req as any).account?._id ?? "");

    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const generated = await PermitTemplateService.generatePermitDocumentS({
      applicationId,
      adminId,
    });

    if (!generated) {
      return next(new AppError("Application not found.", 404));
    }

    void emitAllAdminRoutedApplications();

    return res.status(200).json({
      success: true,
      message: "Permit document generated successfully.",
      data: generated,
    });
  } catch (error: any) {
    if (
      error?.message?.includes("No active template") ||
      error?.message?.includes("matching template") ||
      error?.message?.includes("permit mismatch") ||
      error?.message?.includes("not approved or not yet issuable") ||
      error?.message?.includes("Template counters changed") ||
      error?.message?.includes("Unmapped placeholder") ||
      error?.message?.includes("Missing approved value")
    ) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

// This controller is for retrieving the generated permit document for a specific application. It will validate the input, call the service to fetch the generated document, and return it in the response.
export const getGeneratedPermitDocument = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const generated =
      await PermitTemplateService.getGeneratedPermitDocumentS(applicationId);

    if (!generated) {
      return next(new AppError("Generated permit not found.", 404));
    }

    setNoCacheHeaders(res);
    return res.status(200).json({
      success: true,
      message: "Generated permit retrieved successfully.",
      data: generated,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for sending the generated permit document to the applicant. It will validate the input, call the service to send the document, and then emit necessary events to update the application status for the owner and evaluators.
export const sendGeneratedPermitToApplicant = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const adminId = String((req as any).account?._id ?? "");

    if (!adminId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const sent = await PermitTemplateService.sendGeneratedPermitToApplicantS({
      applicationId,
      adminId,
    });

    if (!sent) {
      return next(new AppError("Application not found.", 404));
    }

    const application = await PermitApplication.findById(applicationId)
      .select("applicant ownerStatusVersion ownerStatusReadVersion")
      .lean();
    const applicantId = String((application as any)?.applicant ?? "");
    const unreadTotal = applicantId
      ? await getOwnerUnreadApplicationCountS(applicantId)
      : 0;

    emitOwnerApplicationStatusUpdate({
      applicantId,
      applicationId,
      ownerStatusVersion: Number((application as any)?.ownerStatusVersion ?? 0),
      ownerStatusReadVersion: Number(
        (application as any)?.ownerStatusReadVersion ?? 0,
      ),
      unreadTotal,
      statusSource: "system",
    });
    void emitAllAdminRoutedApplications();
    void emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Generated permit sent to applicant successfully.",
      data: sent,
    });
  } catch (error: any) {
    if (
      error?.message?.includes("No generated permit found") ||
      error?.message?.includes("Generate a permit first")
    ) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};

