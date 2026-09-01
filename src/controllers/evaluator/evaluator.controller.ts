import * as EvaluatorService from "@/services/evaluator/evaluator.service";
import { getOwnerUnreadApplicationCountS } from "@/services/owner/owner.service";
import { EvaluatorDecisionType } from "@/types/models/permit-application.type";
import { emitDashboardStats } from "@/utils/admin/emit-dashboard-stats.util";
import { emitAllAdminRoutedApplications } from "@/utils/admin/emit-routed-applications.util";
import { AppError } from "@/utils/error/app-error.util";
import { emitEvaluatorApplications } from "@/utils/evaluator/emit-evaluator-applications.util";
import { emitOwnerApplicationStatusUpdate } from "@/utils/owner/emit-owner-application-status.util";
import { NextFunction, Request, Response } from "express";

const isEvaluatorDecision = (value: string): value is EvaluatorDecisionType => {
  return ["for_inspection", "re_submission", "for_admin_approval"].includes(
    value,
  );
};

export const getEvaluatorApplications = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Controller flow: validate input here, then delegate business logic to services.
    const applications = await EvaluatorService.getEvaluatorApplicationsS();
    return res.status(200).json({
      success: true,
      message: "Applications retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the evaluator dashboard data. It will call the service to fetch the necessary data for the dashboard and return it in the response.
export const getEvaluatorDashboard = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const dashboard = await EvaluatorService.getEvaluatorDashboardS();
    return res.status(200).json({
      success: true,
      message: "Evaluator dashboard retrieved successfully.",
      data: dashboard,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the list of applications that are currently in the inspection review stage for the evaluator. It will call the service to fetch these applications and return them in the response. This endpoint can be used to populate the list of applications that require inspection review on the evaluator dashboard.
export const getEvaluatorInspectionReviewApplications = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applications =
      await EvaluatorService.getEvaluatorInspectionReviewApplicationsS();

    // Prevent conditional revalidation responses (304) so clients always
    // receive a response body and avoid false "failed to load" states.
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    return res.status(200).json({
      success: true,
      message: "Inspection review applications retrieved successfully.",
      data: applications,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for retrieving the details of a specific application for the evaluator. It will validate the input parameters, call the service to fetch the application details, and return them in the response.
export const getEvaluatorApplicationById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const application =
      await EvaluatorService.getEvaluatorApplicationByIdS(applicationId);

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

// This controller is for retrieving the details of a specific inspection review for the evaluator. It will validate the input parameters, call the service to fetch the inspection review details, and return them in the response.
export const getEvaluatorInspectionReviewById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const application =
      await EvaluatorService.getEvaluatorInspectionReviewByIdS(applicationId);

    if (!application) {
      return next(new AppError("Application not found.", 404));
    }

    return res.status(200).json({
      success: true,
      message: "Inspection review details retrieved successfully.",
      data: application,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for submitting the inspection review of an application for admin approval. It will validate the input parameters, call the service to perform the submission, and return the updated application in the response.
export const submitEvaluatorInspectionReview = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const evaluatorId = String((req as any).account?._id ?? "");

    if (!evaluatorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    const updated = await EvaluatorService.submitInspectionReviewForAdminApprovalS({
      applicationId,
      evaluatorId,
    });

    if (!updated) {
      return next(new AppError("Application not found.", 404));
    }

    res.status(200).json({
      success: true,
      message: "Submitted for admin approval successfully.",
      data: updated,
    });
    void (async () => {
      try {
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
          statusSource: "evaluator",
        });
        await emitEvaluatorApplications();
        await emitAllAdminRoutedApplications();
        await emitDashboardStats();
      } catch (postCommitError) {
        console.error(
          "Post-response evaluator inspection review updates failed.",
          postCommitError,
        );
      }
    })();
    return;
  } catch (error: any) {
    if (error?.message) {
      return next(new AppError(String(error.message), 400));
    }
    return next(error);
  }
};

// This controller is for retrieving the inspection process details for the evaluator. It will call the service to fetch the inspection process information and return it in the response. This can be used to display the inspection process steps and requirements on the evaluator dashboard or application details page.
export const getEvaluatorInspectionProcess = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const process = await EvaluatorService.getInspectionProcessForEvaluatorS();
    return res.status(200).json({
      success: true,
      message: "Inspection process retrieved successfully.",
      data: process,
    });
  } catch (error) {
    return next(error);
  }
};

// This controller is for saving the evaluation decision of the evaluator for a specific application. It will validate the input parameters, call the service to save the evaluation decision, and return the updated application in the response.
export const saveEvaluatorDecision = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const applicationId = String(req.params.applicationId ?? "");
    const evaluatorId = String((req as any).account?._id ?? "");
    const decision = String(req.body?.decision ?? "").trim();
    const notRequiredProcessIds = Array.isArray(req.body?.notRequiredProcessIds)
      ? req.body.notRequiredProcessIds
          .map((value: unknown) => String(value ?? "").trim())
          .filter(Boolean)
      : [];
    const remark = String(req.body?.remark ?? "").trim();

    if (!evaluatorId) {
      return next(new AppError("Unauthorized: Account not found.", 401));
    }

    if (!isEvaluatorDecision(decision)) {
      return next(
        new AppError(
          "Invalid evaluator decision. Allowed: for_inspection, re_submission, for_admin_approval.",
          400,
        ),
      );
    }

    if (decision === "re_submission" && !remark) {
      return next(new AppError("Remark is required for re-submission.", 400));
    }

    const updated = await EvaluatorService.saveApplicationEvaluationS({
      applicationId,
      evaluatorId,
      decision,
      notRequiredProcessIds,
      remark,
    });

    if (!updated) {
      return next(new AppError("Application not found.", 404));
    }

    res.status(200).json({
      success: true,
      message: "Evaluation saved successfully.",
      data: updated,
    });
    void (async () => {
      try {
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
          statusSource: "evaluator",
        });
        await emitEvaluatorApplications();
        await emitAllAdminRoutedApplications();
        await emitDashboardStats();
      } catch (postCommitError) {
        console.error(
          "Post-response evaluator decision updates failed.",
          postCommitError,
        );
      }
    })();
    return;
  } catch (error: any) {
    if (error?.message?.includes("invalid")) {
      return next(new AppError(error.message, 400));
    }
    return next(error);
  }
};
