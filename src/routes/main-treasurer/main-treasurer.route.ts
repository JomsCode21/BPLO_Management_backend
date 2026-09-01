import { Router } from "express";

import * as AuditController from "@/controllers/main-treasurer/audit.controller";
import * as MainTreasurerController from "@/controllers/main-treasurer/main-treasurer.controller";
import { requireRoles } from "@/middlewares/role.middleware";
import { requireAccessToken } from "@/middlewares/token.middleware";

const router = Router();

router.use(requireAccessToken, requireRoles(["main_treasurer"]));

// Main treasurer dashboard and audit routes.
router.get("/dashboard", MainTreasurerController.getMainTreasurerDashboard);
router.get(
  "/audit/workflow",
  AuditController.getMainTreasurerWorkflowAuditEvents,
);
router.get(
  "/audit/workflow/download-pdf",
  AuditController.downloadMainTreasurerWorkflowAuditPdf,
);

// Payment list and status update routes.
router.get("/payments", MainTreasurerController.getMainTreasurerPayments);
router.post(
  "/payments/:applicationId/confirm",
  MainTreasurerController.confirmMainTreasurerPaymentReceipt,
);
router.patch(
  "/payments/:applicationId/:departmentId/status",
  MainTreasurerController.updateMainTreasurerPaymentStatus,
);
router.patch(
  "/payments/:applicationId/status/batch",
  MainTreasurerController.updateMainTreasurerPaymentStatusBatch,
);

export default router;
