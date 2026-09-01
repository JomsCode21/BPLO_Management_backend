import { Router } from "express";

import * as AuditController from "@/controllers/bplo-admin/audit.controller";
import * as RoutedApplicationController from "@/controllers/bplo-admin/bplo-admin.controller";
import { requireRoles } from "@/middlewares/role.middleware";
import { requireAccessToken } from "@/middlewares/token.middleware";

const router = Router();

router.use(requireAccessToken, requireRoles(["bplo_admin"]));

// Dashboard and audit routes for BPLO admin monitoring.
router.get("/dashboard", RoutedApplicationController.getBploDashboardAnalytics);
router.get("/audit/workflow", AuditController.getBploWorkflowAuditEvents);
router.get(
  "/audit/workflow/download-pdf",
  AuditController.downloadBploWorkflowAuditPdf,
);

// Routed application queues handled by BPLO admin.
router.get(
  "/inspection-request",
  RoutedApplicationController.getInspectionRequestApplications,
);
router.get(
  "/permit-validity",
  RoutedApplicationController.getPermitValidityApplications,
);
router.get(
  "/permit-approval",
  RoutedApplicationController.getPermitApprovalApplications,
);
router.get(
  "/permit-release",
  RoutedApplicationController.getPermitReleaseApplications,
);

// Fee assessment and payment analytics routes.
router.get(
  "/fee-assessment/permits",
  RoutedApplicationController.getBploAdminFeeAssessmentPermits,
);
router.get(
  "/payment-analytics",
  RoutedApplicationController.getBploAdminPermitPaymentAnalytics,
);
router.get(
  "/payment-analytics/:permitId/payers",
  RoutedApplicationController.getBploAdminPermitPaymentPayers,
);

// Fee assessment template management routes.
router.get(
  "/fee-assessment/:permitId/template",
  RoutedApplicationController.getBploAdminFeeAssessmentTemplate,
);
router.put(
  "/fee-assessment/:permitId/template",
  RoutedApplicationController.saveBploAdminFeeAssessmentTemplate,
);

// Routed application decision and permit document actions.
router.get(
  "/:applicationId/details",
  RoutedApplicationController.getRoutedApplicationById,
);
router.put(
  "/:applicationId/decision",
  RoutedApplicationController.savePermitApprovalDecision,
);
router.put(
  "/:applicationId/admin-fee-assessment",
  RoutedApplicationController.upsertAdminFeeAssessment,
);
router.put(
  "/:applicationId/inspection-decision",
  RoutedApplicationController.saveInspectionRequestDecision,
);
router.post(
  "/:applicationId/permit-document/generate",
  RoutedApplicationController.generatePermitDocument,
);
router.get(
  "/:applicationId/permit-document",
  RoutedApplicationController.getGeneratedPermitDocument,
);
router.post(
  "/:applicationId/permit-document/send",
  RoutedApplicationController.sendGeneratedPermitToApplicant,
);

export default router;
