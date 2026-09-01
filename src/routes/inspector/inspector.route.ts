import { Router } from "express";

import * as AuditController from "@/controllers/inspector/audit.controller";
import * as InspectorController from "@/controllers/inspector/inspector.controller";
import * as PermitTemplateController from "@/controllers/super_admin/permit-template.controller";
import * as PermitController from "@/controllers/super_admin/permit.controller";
import { requireRoles } from "@/middlewares/role.middleware";
import { requireAccessToken } from "@/middlewares/token.middleware";

const router = Router();

router.use(requireAccessToken, requireRoles(["inspector"]));

// Inspector dashboard and audit routes.
router.get("/dashboard", InspectorController.getInspectorDashboard);
router.get("/audit/workflow", AuditController.getInspectorWorkflowAuditEvents);
router.get(
  "/audit/workflow/download-pdf",
  AuditController.downloadInspectorWorkflowAuditPdf,
);

// Inspection request queue and schedule routes.
router.get(
  "/inspection-requests",
  InspectorController.getInspectorInspectionRequestApplications,
);
router.get("/schedules", InspectorController.getInspectorInspectionSchedules);
router.get(
  "/permit-release",
  InspectorController.getInspectorPermitReleaseApplications,
);
router.get(
  "/inspection-requests/:applicationId/details",
  InspectorController.getInspectorRoutedApplicationById,
);
router.put(
  "/inspection-requests/:applicationId/schedule",
  InspectorController.setInspectorInspectionSchedule,
);
router.patch(
  "/inspection-requests/:applicationId/schedule",
  InspectorController.updateInspectorInspectionSchedule,
);
router.put(
  "/inspection-requests/:applicationId/complete",
  InspectorController.completeInspectorInspectionStep,
);

// Inspection certificate generation and retrieval routes.
router.post(
  "/inspection-requests/:applicationId/certificate/generate",
  InspectorController.generateInspectorInspectionCertificate,
);
router.get(
  "/inspection-requests/:applicationId/certificate",
  InspectorController.getInspectorGeneratedInspectionCertificate,
);

// Certificate template management routes shared with super admin assets.
router.get("/certificate-permits", PermitController.getPermits);
router.get(
  "/certificate-templates/options",
  PermitTemplateController.getPermitTemplateMappingOptions,
);
router.post(
  "/certificate-templates",
  PermitTemplateController.uploadPermitTemplate,
);
router.get(
  "/certificate-templates",
  PermitTemplateController.listPermitTemplates,
);
router.get(
  "/certificate-templates/:templateId",
  PermitTemplateController.getPermitTemplateById,
);
router.delete(
  "/certificate-templates/:templateId",
  PermitTemplateController.deletePermitTemplate,
);
router.patch(
  "/certificate-templates/:templateId/replace",
  PermitTemplateController.replacePermitTemplateFile,
);
router.patch(
  "/certificate-templates/:templateId/status",
  PermitTemplateController.updatePermitTemplateStatus,
);
router.patch(
  "/certificate-templates/:templateId/mappings",
  PermitTemplateController.savePermitTemplateMappings,
);
router.patch(
  "/certificate-templates/:templateId/watermark",
  PermitTemplateController.updatePermitTemplateWatermark,
);

export default router;
