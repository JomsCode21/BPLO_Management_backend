import { NextFunction, Request, Response, Router } from "express";

import * as AuditController from "@/controllers/department-treasurer/audit.controller";
import * as PaymentAssessmentController from "@/controllers/department-treasurer/department-treasurer.controller";
import { requireRoles } from "@/middlewares/role.middleware";
import { requireAccessToken } from "@/middlewares/token.middleware";

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
  // Prevent cached GET responses from showing stale treasurer data.
  if (req.method === "GET") {
    setNoCacheHeaders(res);
  }
  next();
});

router.use(requireAccessToken, requireRoles(["department_treasurer"]));

// Department treasurer dashboard and audit routes.
router.get(
  "/dashboard",
  PaymentAssessmentController.getDepartmentTreasurerDashboard,
);
router.get(
  "/audit/workflow",
  AuditController.getDepartmentTreasurerWorkflowAuditEvents,
);
router.get(
  "/audit/workflow/download-pdf",
  AuditController.downloadDepartmentTreasurerWorkflowAuditPdf,
);

// Payment payer and fee template management routes.
router.get("/payers", PaymentAssessmentController.getDepartmentTreasurerPayers);
router.get(
  "/fee-assessment",
  PaymentAssessmentController.getDepartmentFeeTemplate,
);
router.put(
  "/fee-assessment",
  PaymentAssessmentController.upsertDepartmentFeeTemplate,
);

export default router;
