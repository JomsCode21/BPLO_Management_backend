import AdminFeeTemplate from "@/models/payment/admin-fee-assessment.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import { ClientSession, Types } from "mongoose";

const normalizeText = (value: unknown) => String(value ?? "").trim();

export const ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID = "bplo_admin_assessment";
export const ADMIN_FEE_ASSESSMENT_DEPARTMENT_NAME = "BPLO Admin";

export const ensureAdminFeeAssessmentOnApplicationS = async (params: {
  applicationId: string;
  session?: ClientSession;
}) => {
  // Attach the admin fee assessment snapshot to the application when needed.
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  const application = await PermitApplication.findById(
    params.applicationId,
  ).session(params.session ?? null);
  if (!application) return null;

  const permitId = normalizeText(application.permit);
  if (!permitId) return application.toObject();

  const template = await AdminFeeTemplate.findOne({ permitId })
    .session(params.session ?? null)
    .lean();

  const normalizedItems = Array.isArray(template?.items)
    ? template.items
        .map((item: any) => ({
          feeName: normalizeText(item?.feeName),
          amount: Number(item?.amount ?? 0),
        }))
        .filter((item) => item.feeName.length > 0 && item.amount >= 0)
    : [];

  if (normalizedItems.length === 0) {
    return application.toObject();
  }

  const totalAmount = normalizedItems.reduce(
    (sum, item) => sum + Number(item.amount ?? 0),
    0,
  );

  const assessments = Array.isArray(application.paymentAssessments)
    ? application.paymentAssessments
    : [];
  const existingIndex = assessments.findIndex(
    (assessment: any) =>
      normalizeText(assessment?.departmentId) ===
      ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID,
  );

  const payload = {
    departmentId: ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID,
    departmentName:
      normalizeText(template?.permitName) ||
      ADMIN_FEE_ASSESSMENT_DEPARTMENT_NAME,
    generatedAt: new Date(),
    items: normalizedItems,
    totalAmount,
    paymentStatus: "pending" as const,
    statusUpdatedAt: null,
    statusUpdatedBy: null,
    statusUpdatedByName: "",
  };

  if (existingIndex >= 0) {
    const existing = (application.paymentAssessments as any[])[existingIndex];
    if (normalizeText(existing?.paymentStatus) === "paid") {
      return application.toObject();
    }

    (application.paymentAssessments as any[])[existingIndex] = payload as any;
  } else {
    (application.paymentAssessments as any[]).push(payload as any);
  }

  const saved = await application.save({ session: params.session });
  return saved.toObject();
};
