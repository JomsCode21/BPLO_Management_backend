import {
  ADMIN_WORKFLOW_AUDIT_EVENT,
  EVALUATOR_APPLICATIONS_EVENT,
  EVALUATOR_DASHBOARD_ANALYTICS_EVENT,
  EVALUATOR_INSPECTION_REVIEW_EVENT,
  EVALUATOR_WORKFLOW_AUDIT_EVENT,
  SUPER_ADMIN_WORKFLOW_AUDIT_EVENT,
  emitToRole,
} from "@/realtime/socket";
import * as EvaluatorService from "@/services/evaluator/evaluator.service";

/**
 * Fetches the current evaluator applications list and broadcasts it to all
 * connected clients via Socket.IO. Call this after any operation that changes
 * the applications visible to the evaluator (new submission, decision saved, etc.)
 */
export const emitEvaluatorApplications = async () => {
  try {
    const [applications, inspectionReviews, dashboard] = await Promise.all([
      EvaluatorService.getEvaluatorApplicationsS(),
      EvaluatorService.getEvaluatorInspectionReviewApplicationsS(),
      EvaluatorService.getEvaluatorDashboardS(),
    ]);

    emitToRole("evaluator", EVALUATOR_APPLICATIONS_EVENT, applications);
    emitToRole(
      "evaluator",
      EVALUATOR_INSPECTION_REVIEW_EVENT,
      inspectionReviews,
    );
    emitToRole("evaluator", EVALUATOR_DASHBOARD_ANALYTICS_EVENT, dashboard);
    emitToRole("evaluator", EVALUATOR_WORKFLOW_AUDIT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
    emitToRole("bplo_admin", ADMIN_WORKFLOW_AUDIT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
    emitToRole("super_admin", SUPER_ADMIN_WORKFLOW_AUDIT_EVENT, {
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Failed to emit evaluator applications:", error);
  }
};
