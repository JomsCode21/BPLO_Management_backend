import Account from "@/models/account/account.model";
import DepartmentFeeTemplate from "@/models/payment/department-fee-assessment.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import {
  DepartmentFeeTemplateItemType,
  DepartmentFeeTemplateType,
} from "@/types/models/payment.type";
import { ClientSession, Types } from "mongoose";

const normalizeText = (value: unknown) => String(value ?? "").trim();

const toNumber = (value: unknown) => {
  // Convert numeric-like values to safe numbers for calculations.
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const buildOfficerName = (account: any) => {
  // Build a readable officer name for audit and payment records.
  const parts = [account?.firstName, account?.middleName, account?.lastName]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const suffix = normalizeText(account?.suffix);
  return suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
};

const normalizeTemplateItems = (
  items: unknown,
): DepartmentFeeTemplateItemType[] => {
  // Normalize fee items before saving them to the template.
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => ({
      feeName: normalizeText((item as any)?.feeName),
      amount: toNumber((item as any)?.amount),
    }))
    .filter((item) => item.feeName && item.amount >= 0);
};

const buildTemplateResponse = (template: any): DepartmentFeeTemplateType => ({
  // Shape a lean template payload for API responses.
  _id: String(template._id),
  departmentId: normalizeText(template.departmentId),
  departmentName: normalizeText(template.departmentName),
  items: (template.items ?? []).map((item: any) => ({
    feeName: normalizeText(item.feeName),
    amount: toNumber(item.amount),
  })),
  totalAmount: toNumber(template.totalAmount),
  createdBy: template.createdBy ?? null,
  createdByName: normalizeText(template.createdByName),
  updatedBy: template.updatedBy ?? null,
  updatedByName: normalizeText(template.updatedByName),
  createdAt: template.createdAt,
  updatedAt: template.updatedAt,
});

const matchesMainTreasurerAvailability = {
  currentStage: { $in: ["admin_permit_approval", "admin_permit_validity"] },
};

export const getDepartmentFeeTemplateS = async (departmentId: string) => {
  // Load a department fee template when it exists.
  const template = await DepartmentFeeTemplate.findOne({ departmentId }).lean();
  if (!template) return null;
  return buildTemplateResponse(template);
};

export const upsertDepartmentFeeTemplateS = async (params: {
  departmentId: string;
  departmentName: string;
  items: unknown;
  accountId: string;
}) => {
  // Create or update the department fee template.
  const normalizedItems = normalizeTemplateItems(params.items);

  if (normalizedItems.length === 0) {
    throw new Error("At least one fee item is required.");
  }

  const totalAmount = normalizedItems.reduce(
    (sum: number, item: { amount: number }) => sum + toNumber(item.amount),
    0,
  );

  const account = await Account.findById(params.accountId)
    .select("firstName middleName lastName suffix")
    .lean();
  const actorName = buildOfficerName(account);

  const existing = await DepartmentFeeTemplate.findOne({
    departmentId: params.departmentId,
  });

  if (existing) {
    existing.departmentName = params.departmentName;
    existing.items = normalizedItems as any;
    existing.totalAmount = totalAmount;
    existing.updatedBy = new Types.ObjectId(params.accountId);
    existing.updatedByName = actorName;

    const saved = await existing.save();
    return buildTemplateResponse(saved.toObject());
  }

  const created = await DepartmentFeeTemplate.create({
    departmentId: params.departmentId,
    departmentName: params.departmentName,
    items: normalizedItems,
    totalAmount,
    createdBy: new Types.ObjectId(params.accountId),
    createdByName: actorName,
    updatedBy: new Types.ObjectId(params.accountId),
    updatedByName: actorName,
  });

  return buildTemplateResponse(created.toObject());
};

export const autoGeneratePaymentAssessmentS = async (params: {
  applicationId: string;
  departmentId: string;
  departmentName: string;
  session?: ClientSession;
}) => {
  // Create or refresh the department payment assessment on the application.
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  const template = await DepartmentFeeTemplate.findOne({
    departmentId: params.departmentId,
  })
    .session(params.session ?? null)
    .lean();

  if (
    !template ||
    !Array.isArray(template.items) ||
    template.items.length === 0
  ) {
    return null;
  }

  const application = await PermitApplication.findById(
    params.applicationId,
  ).session(params.session ?? null);
  if (!application) return null;

  const items = template.items.map((item: any) => ({
    feeName: normalizeText(item.feeName),
    amount: toNumber(item.amount),
  }));

  const totalAmount = toNumber(template.totalAmount);

  const existingIndex = (application.paymentAssessments ?? []).findIndex(
    (assessment: any) =>
      normalizeText(assessment.departmentId) ===
      normalizeText(params.departmentId),
  );

  const payload = {
    departmentId: params.departmentId,
    departmentName: params.departmentName,
    generatedAt: new Date(),
    items,
    totalAmount,
    paymentStatus: "pending" as const,
    statusUpdatedAt: null,
    statusUpdatedBy: null,
    statusUpdatedByName: "",
  };

  if (existingIndex >= 0) {
    (application.paymentAssessments as any)[existingIndex] = payload as any;
  } else {
    (application.paymentAssessments as any[]).push(payload as any);
  }

  const saved = await application.save({ session: params.session });
  return saved.toObject();
};

export const getDepartmentTreasurerDashboardS = async (
  departmentId: string,
) => {
  // Summarize payment assessments for the department treasurer dashboard.
  const records = await PermitApplication.find({
    ...matchesMainTreasurerAvailability,
    paymentAssessments: {
      $elemMatch: {
        departmentId,
      },
    },
  })
    .select("paymentAssessments")
    .lean();

  const assessments = records.flatMap((record: any) =>
    (record.paymentAssessments ?? []).filter(
      (assessment: any) =>
        normalizeText(assessment.departmentId) === departmentId,
    ),
  );

  const totalAssessments = assessments.length;
  const totalPending = assessments.filter(
    (assessment: any) => normalizeText(assessment.paymentStatus) !== "paid",
  ).length;
  const totalPaid = assessments.filter(
    (assessment: any) => normalizeText(assessment.paymentStatus) === "paid",
  ).length;
  const totalAmountDue = assessments.reduce(
    (sum: number, assessment: any) =>
      normalizeText(assessment.paymentStatus) === "paid"
        ? sum
        : sum + toNumber(assessment.totalAmount),
    0,
  );

  return {
    totalAssessments,
    totalPending,
    totalPaid,
    totalAmountDue,
  };
};

export const getDepartmentTreasurerPayersS = async (
  departmentId: string,
  paymentStatus?: "pending" | "paid",
) => {
  // Return the applications and payment details for a department treasurer.
  const applications = await PermitApplication.find({
    ...matchesMainTreasurerAvailability,
    paymentAssessments: {
      $elemMatch: {
        departmentId,
      },
    },
  })
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate("permit", "name")
    .sort({ updatedAt: -1, submittedAt: -1 })
    .lean();

  return applications
    .map((application: any) => {
      const assessment = (application.paymentAssessments ?? []).find(
        (entry: any) => normalizeText(entry.departmentId) === departmentId,
      );
      if (!assessment) return null;
      const normalizedPaymentStatus =
        normalizeText(assessment.paymentStatus || "pending") === "paid"
          ? "paid"
          : "pending";
      if (paymentStatus && normalizedPaymentStatus !== paymentStatus) {
        return null;
      }

      const applicantName = buildOfficerName(application.applicant);
      const permitType =
        normalizeText(application?.permit?.name) ||
        normalizeText(application.permitName) ||
        "Unknown Permit";

      return {
        _id: String(application._id),
        applicantName,
        applicantEmail: normalizeText(application?.applicant?.email),
        permitType,
        departmentId: normalizeText(assessment.departmentId),
        departmentName: normalizeText(assessment.departmentName),
        generatedAt: assessment.generatedAt ?? null,
        paymentStatus: normalizedPaymentStatus,
        totalAmount: toNumber(assessment.totalAmount),
      };
    })
    .filter(Boolean);
};
