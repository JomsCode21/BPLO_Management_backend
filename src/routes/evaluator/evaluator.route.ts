import * as AuditController from "@/controllers/evaluator/audit.controller";
import * as EvaluatorController from "@/controllers/evaluator/evaluator.controller";
import { requireRoles } from "@/middlewares/role.middleware";
import { requireAccessToken } from "@/middlewares/token.middleware";
import { Router } from "express";

const router = Router();

// Evaluator dashboard and audit routes.
router.get(
  "/dashboard",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.getEvaluatorDashboard,
);
router.get(
  "/audit/workflow",
  requireAccessToken,
  requireRoles(["evaluator"]),
  AuditController.getEvaluatorWorkflowAuditEvents,
);

// Application review queue routes.
router.get(
  "/applications",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.getEvaluatorApplications,
);

// Individual application review and decision routes.
router.get(
  "/applications/:applicationId",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.getEvaluatorApplicationById,
);

router.put(
  "/applications/:applicationId/evaluation",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.saveEvaluatorDecision,
);

// Inspection review queue routes.
router.get(
  "/inspections",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.getEvaluatorInspectionReviewApplications,
);

// Inspection review detail and submission routes.
router.get(
  "/inspections/:applicationId",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.getEvaluatorInspectionReviewById,
);

router.put(
  "/inspections/:applicationId/submit",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.submitEvaluatorInspectionReview,
);

// Inspection process reference route.
router.get(
  "/process",
  requireAccessToken,
  requireRoles(["evaluator"]),
  EvaluatorController.getEvaluatorInspectionProcess,
);

export default router;
