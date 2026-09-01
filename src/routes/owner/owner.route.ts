import * as OwnerController from "@/controllers/owner/owner.controller";
import { requireRoles } from "@/middlewares/role.middleware";
import { requireAccessToken } from "@/middlewares/token.middleware";
import { Router } from "express";

const router = Router();

// Owner permit browsing and application submission routes.
router.get(
  "/permits",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getPermitsForOwner,
);
router.get(
  "/permits/:permitId",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getPermitForOwnerById,
);
router.post(
  "/permits/:permitId/applications",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.submitPermitApplication,
);

// Owner status and generated document routes.
router.get(
  "/generated-documents",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getOwnerGeneratedDocuments,
);
router.get(
  "/applications/status",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getOwnerApplicationStatuses,
);
router.get(
  "/applications/:applicationId",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getOwnerApplicationById,
);
router.get(
  "/applications/:applicationId/status-detail",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getOwnerApplicationStatusDetail,
);

// Generated permit and certificate download routes.
router.get(
  "/applications/:applicationId/generated-permit",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getOwnerGeneratedPermitPdf,
);
router.get(
  "/applications/:applicationId/generated-inspection-certificate",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.getOwnerGeneratedInspectionCertificatePdf,
);

// Re-submission and read-state management routes.
router.put(
  "/applications/:applicationId/resubmit",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.resubmitPermitApplication,
);
router.patch(
  "/applications/:applicationId/read",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.markOwnerApplicationStatusAsRead,
);
router.patch(
  "/applications/read-all",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.markAllOwnerApplicationStatusesAsRead,
);
router.patch(
  "/applications/:applicationId/reassessment-request",
  requireAccessToken,
  requireRoles(["business_owner"]),
  OwnerController.requestInspectionReassessment,
);

export default router;
