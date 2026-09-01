import * as AdminController from "@/controllers/super_admin/admin.controller";
import * as AuditController from "@/controllers/super_admin/audit.controller";
import * as BrandingController from "@/controllers/super_admin/branding.controller";
import * as PermitTemplateController from "@/controllers/super_admin/permit-template.controller";
import * as PermitController from "@/controllers/super_admin/permit.controller";
import * as ProcessController from "@/controllers/super_admin/process.controller";
import { NextFunction, Request, Response, Router } from "express";

// Middleware
import { requireAccessToken } from "@/middlewares/token.middleware";
import { requireRoles } from "../../middlewares/role.middleware";

const router = Router();

// Send no-cache headers for GET responses in this route group.
const setNoCacheHeaders = (res: Response) => {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  );
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
};

router.use((req: Request, res: Response, next: NextFunction) => {
  // Prevent stale cache results for super admin GET responses.
  if (req.method === "GET") {
    setNoCacheHeaders(res);
  }
  next();
});

// Branding logo - public read for landing/splash/sidebar usage
router.get("/branding/logo", BrandingController.getBrandingLogo);

// Admin dashboard - only accessible to super_admin
router.get(
  "/dashboard",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AdminController.getDashboard,
);
router.get(
  "/audit/workflow",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AuditController.getWorkflowAuditEvents,
);

// Profile and officer management routes.
// Update super_admin account
router.patch(
  "/profile",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AdminController.updateProfile,
);
// Create official accounts
router.post(
  "/officers",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AdminController.createOfficerAccount,
);
// Get all officers grouped by role
router.get(
  "/officers",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AdminController.getOfficers,
);
router.get(
  "/officers/:officerId",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AdminController.getOfficerById,
);
router.patch(
  "/officers/:officerId",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AdminController.updateOfficerAccount,
);
router.delete(
  "/officers/:officerId",
  requireAccessToken,
  requireRoles(["super_admin"]),
  AdminController.deleteOfficerAccount,
);

// Permit lifecycle management routes.
// Permit management for super admin
router.post(
  "/permits",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitController.createPermit,
);
router.get(
  "/permits",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitController.getPermits,
);
router.get(
  "/permits/:permitId",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitController.getPermitById,
);
router.put(
  "/permits/:permitId/form",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitController.savePermitForm,
);
router.patch(
  "/permits/:permitId/validity-visibility",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitController.updatePermitValidityVisibility,
);
router.patch(
  "/permits/:permitId/validity-settings",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitController.updatePermitValiditySettings,
);
router.delete(
  "/permits/:permitId",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitController.deletePermit,
);

// Permit template management routes.
router.get(
  "/permit-templates/options",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.getPermitTemplateMappingOptions,
);
router.post(
  "/permit-templates",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.uploadPermitTemplate,
);
router.get(
  "/permit-templates",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.listPermitTemplates,
);
router.get(
  "/permit-templates/:templateId",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.getPermitTemplateById,
);
router.delete(
  "/permit-templates/:templateId",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.deletePermitTemplate,
);
router.patch(
  "/permit-templates/:templateId/replace",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.replacePermitTemplateFile,
);
router.patch(
  "/permit-templates/:templateId/status",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.updatePermitTemplateStatus,
);
router.patch(
  "/permit-templates/:templateId/mappings",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.savePermitTemplateMappings,
);
router.patch(
  "/permit-templates/:templateId/watermark",
  requireAccessToken,
  requireRoles(["super_admin"]),
  PermitTemplateController.updatePermitTemplateWatermark,
);

// Inspection process configuration routes.
// Inspection process management for super admin
router.get(
  "/process",
  requireAccessToken,
  requireRoles(["super_admin"]),
  ProcessController.getInspectionProcess,
);
router.put(
  "/branding/logo",
  requireAccessToken,
  requireRoles(["super_admin"]),
  BrandingController.updateBrandingLogo,
);

router.put(
  "/process",
  requireAccessToken,
  requireRoles(["super_admin"]),
  ProcessController.saveInspectionProcess,
);

export default router;
