import Account from "@/models/account/account.model";
import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import { validateMainTreasurerPaymentReceiptInput } from "@/services/main-treasurer/payment-assessment-confirmation.validation";
import { runInTransaction } from "@/utils/db/transaction.util";
import { buildCombinedPaymentQrValue } from "@/utils/payment/payment-qr.util";
import { Types } from "mongoose";

const normalizeText = (value: unknown) => String(value ?? "").trim();

// Coerce unknown values into safe numeric totals for payment computations.
const toNumber = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// Build the display name used for treasurer-facing account labels.
const buildOfficerName = (account: any) => {
  const parts = [account?.firstName, account?.middleName, account?.lastName]
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const suffix = normalizeText(account?.suffix);
  return suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
};

const buildPaymentOwnerRemark = (params: {
  departmentName: string;
  paymentStatus: "pending" | "paid";
  treasurerName: string;
}) => {
  const actor = params.treasurerName || "Treasurer";
  const statusLabel = params.paymentStatus === "paid" ? "paid" : "pending";
  return `${actor} updated the ${params.departmentName} payment status to ${statusLabel}.`;
};

const buildTotalPaymentPaidOwnerRemark = (params: {
  treasurerName: string;
  totalAmount: number;
}) => {
  const actor = params.treasurerName || "Treasurer";
  const formattedTotal = toNumber(params.totalAmount).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${actor} recorded your total assessment payment. Total paid: PHP ${formattedTotal}. Your evaluator can now continue the permit for BPLO admin approval.`;
};

const matchesMainTreasurerAvailability = {
  currentStage: { $in: ["admin_permit_approval", "admin_permit_validity"] },
};

const isMainTreasurerApplicationAvailable = (application: any) =>
  ["admin_permit_approval", "admin_permit_validity"].includes(
    normalizeText(application?.currentStage),
  );

const normalizePaymentStatus = (value: unknown): "pending" | "paid" =>
  normalizeText(value) === "paid" ? "paid" : "pending";

const getAssessmentDepartmentId = (assessment: any) =>
  normalizeText(assessment?.departmentId);

const getDepartmentIdsForCombinedPaymentTransition = (
  paymentAssessments: any[],
  nextPaymentStatus: "pending" | "paid",
) =>
  paymentAssessments
    .filter(
      (assessment) =>
        normalizePaymentStatus(assessment?.paymentStatus) !== nextPaymentStatus,
    )
    .map((assessment) => getAssessmentDepartmentId(assessment))
    .filter(Boolean);

const hasSameDepartmentIdSet = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((departmentId) => right.includes(departmentId));

const COMBINED_MAIN_TREASURER_PAYMENT_ERROR =
  "Main treasurer payments must be updated as one combined transaction across all departments for the application.";

const MAIN_TREASURER_STAGE_ERROR =
  "Application is not currently available for main treasurer payment processing.";

const MAIN_TREASURER_CONFIRMATION_REQUIRED_ERROR =
  "Use the main treasurer payment confirmation flow to record paid transactions.";

// Summarize payment workload counts for the treasurer dashboard.
export const getMainTreasurerDashboardS = async () => {
  const applications = await PermitApplication.find({
    ...matchesMainTreasurerAvailability,
    paymentAssessments: { $exists: true, $ne: [] },
  })
    .select("paymentAssessments")
    .lean();

  const groupedByApplicant = applications.map((application: any) => {
    const assessments = Array.isArray(application.paymentAssessments)
      ? application.paymentAssessments
      : [];
    const paidCount = assessments.filter(
      (assessment: any) => normalizeText(assessment.paymentStatus) === "paid",
    ).length;
    const totalAmount = assessments.reduce(
      (sum: number, assessment: { totalAmount: number }) =>
        sum + toNumber(assessment.totalAmount),
      0,
    );
    const totalPayableAmount = assessments.reduce(
      (sum: number, assessment: any) =>
        normalizeText(assessment.paymentStatus) === "paid"
          ? sum
          : sum + toNumber(assessment.totalAmount),
      0,
    );
    const isFullyPaid =
      assessments.length > 0 && paidCount === assessments.length;

    return {
      isFullyPaid,
      totalAmount,
      totalPayableAmount,
    };
  });

  const totalAssessments = groupedByApplicant.length;
  const totalPending = groupedByApplicant.filter(
    (group) => !group.isFullyPaid,
  ).length;
  const totalPaid = groupedByApplicant.filter(
    (group) => group.isFullyPaid,
  ).length;
  const totalAmountDue = groupedByApplicant.reduce(
    (sum: number, group: { totalPayableAmount: number }) =>
      sum + group.totalPayableAmount,
    0,
  );

  return {
    totalAssessments,
    totalPending,
    totalPaid,
    totalAmountDue,
  };
};

// Return every payment assessment the main treasurer can act on.
export const getMainTreasurerPaymentsS = async () => {
  const applications = await PermitApplication.find({
    ...matchesMainTreasurerAvailability,
    paymentAssessments: { $exists: true, $ne: [] },
  })
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate("permit", "name")
    .sort({ updatedAt: -1, submittedAt: -1 })
    .lean();

  return applications.flatMap((application: any) => {
    const applicantName = buildOfficerName(application.applicant);
    const permitType =
      normalizeText(application?.permit?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";
    const combinedQrValue = buildCombinedPaymentQrValue({
      applicationId: String(application._id),
      assessments: application.paymentAssessments ?? [],
    });

    return (application.paymentAssessments ?? []).map((assessment: any) => ({
      applicationId: String(application._id),
      applicantName,
      applicantEmail: normalizeText(application?.applicant?.email),
      permitType,
      departmentId: normalizeText(assessment.departmentId),
      departmentName: normalizeText(assessment.departmentName),
      generatedAt: assessment.generatedAt ?? null,
      totalAmount: toNumber(assessment.totalAmount),
      paymentStatus: normalizeText(assessment.paymentStatus || "pending"),
      statusUpdatedAt: assessment.statusUpdatedAt ?? null,
      statusUpdatedByName: normalizeText(assessment.statusUpdatedByName),
      combinedQrValue,
    }));
  });
};

// Apply the combined status update across all departments in one transaction.
const updateMainTreasurerPaymentStatusesInternalS = async (params: {
  applicationId: string;
  paymentStatus: "pending" | "paid";
  treasurerId: string;
  departmentIds: string[];
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  const normalizedDepartmentIds = Array.from(
    new Set(
      params.departmentIds.map((id) => normalizeText(id)).filter(Boolean),
    ),
  );
  if (normalizedDepartmentIds.length === 0) return null;

  const updated = await runInTransaction(async (session) => {
    const application = await PermitApplication.findById(
      params.applicationId,
    ).session(session);
    if (!application) return null;
    if (!isMainTreasurerApplicationAvailable(application)) {
      throw new Error(MAIN_TREASURER_STAGE_ERROR);
    }

    const paymentAssessments = application.paymentAssessments ?? [];
    if (paymentAssessments.length === 0) return null;

    const availableDepartmentIds = paymentAssessments
      .map((assessment: any) => getAssessmentDepartmentId(assessment))
      .filter(Boolean);
    if (
      normalizedDepartmentIds.some(
        (departmentId) => !availableDepartmentIds.includes(departmentId),
      )
    ) {
      return null;
    }

    const requiredDepartmentIds = getDepartmentIdsForCombinedPaymentTransition(
      paymentAssessments as any[],
      params.paymentStatus,
    );
    if (
      !hasSameDepartmentIdSet(normalizedDepartmentIds, requiredDepartmentIds)
    ) {
      throw new Error(COMBINED_MAIN_TREASURER_PAYMENT_ERROR);
    }

    if (requiredDepartmentIds.length === 0) {
      return application.toObject();
    }

    const treasurer = await Account.findById(params.treasurerId)
      .select("firstName middleName lastName suffix")
      .session(session)
      .lean();
    const treasurerName = buildOfficerName(treasurer);

    const targets = paymentAssessments.filter((assessment: any) =>
      requiredDepartmentIds.includes(getAssessmentDepartmentId(assessment)),
    );
    if (targets.length !== requiredDepartmentIds.length) {
      throw new Error(COMBINED_MAIN_TREASURER_PAYMENT_ERROR);
    }

    const wasFullyPaidBeforeUpdate = paymentAssessments.every(
      (assessment: any) =>
        normalizePaymentStatus(assessment.paymentStatus) === "paid",
    );
    const paymentUpdatedAt = new Date();
    const changedDepartments: string[] = [];

    for (const target of targets as any[]) {
      target.paymentStatus = params.paymentStatus;
      target.statusUpdatedAt = paymentUpdatedAt;
      target.statusUpdatedBy = new Types.ObjectId(params.treasurerId);
      target.statusUpdatedByName = treasurerName;
      changedDepartments.push(normalizeText(target.departmentName));
    }

    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "treasurer";

    const saved = await application.save({ session });
    const assessmentsAfterUpdate = saved.paymentAssessments ?? [];
    const isFullyPaidAfterUpdate = assessmentsAfterUpdate.every(
      (assessment: any) =>
        normalizePaymentStatus(assessment.paymentStatus) === "paid",
    );
    const totalAmount = assessmentsAfterUpdate.reduce(
      (sum: number, assessment: any) => sum + toNumber(assessment.totalAmount),
      0,
    );

    if (params.paymentStatus === "paid") {
      if (!wasFullyPaidBeforeUpdate && isFullyPaidAfterUpdate) {
        await OwnerApplicationStatus.create(
          [
            {
              permit: application.permit,
              application: application._id,
              applicant: application.applicant,
              permitName: application.permitName,
              status: "payment_paid",
              statusSource: "treasurer",
              adminRemark: buildTotalPaymentPaidOwnerRemark({
                treasurerName,
                totalAmount,
              }),
            },
          ],
          { session },
        );
      }
    } else {
      const firstDepartmentName = changedDepartments[0] || "Department";
      await OwnerApplicationStatus.create(
        [
          {
            permit: application.permit,
            application: application._id,
            applicant: application.applicant,
            permitName: application.permitName,
            status: "payment_pending",
            statusSource: "treasurer",
            adminRemark: buildPaymentOwnerRemark({
              departmentName: firstDepartmentName,
              paymentStatus: params.paymentStatus,
              treasurerName,
            }),
          },
        ],
        { session },
      );
    }

    return saved.toObject();
  });

  return updated;
};

// Confirm a paid receipt after validating the scanned QR and received amount.
export const confirmMainTreasurerPaymentReceiptS = async (params: {
  applicationId: string;
  qrValue: string;
  amountReceived: unknown;
  treasurerId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  const normalizedQrValue = normalizeText(params.qrValue);
  if (!normalizedQrValue) {
    throw new Error("Scanned payment QR is required.");
  }

  const amountReceived = Number(params.amountReceived);
  if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
    throw new Error("Amount received must be a valid positive number.");
  }

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(
      params.applicationId,
    ).session(session);
    if (!application) return null;

    const paymentAssessments = application.paymentAssessments ?? [];
    if (paymentAssessments.length === 0) return null;

    const applicationId = String(application._id);
    const { unpaidAssessments } = validateMainTreasurerPaymentReceiptInput({
      applicationId,
      currentStage: application.currentStage,
      qrValue: normalizedQrValue,
      amountReceived,
      paymentAssessments: paymentAssessments as any[],
    });

    const treasurer = await Account.findById(params.treasurerId)
      .select("firstName middleName lastName suffix")
      .session(session)
      .lean();
    const treasurerName = buildOfficerName(treasurer);
    const paymentUpdatedAt = new Date();

    for (const assessment of unpaidAssessments as any[]) {
      assessment.paymentStatus = "paid";
      assessment.statusUpdatedAt = paymentUpdatedAt;
      assessment.statusUpdatedBy = new Types.ObjectId(params.treasurerId);
      assessment.statusUpdatedByName = treasurerName;
    }

    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "treasurer";

    const saved = await application.save({ session });
    const totalAmount = (saved.paymentAssessments ?? []).reduce(
      (sum: number, assessment: any) => sum + toNumber(assessment.totalAmount),
      0,
    );

    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "payment_paid",
          statusSource: "treasurer",
          adminRemark: buildTotalPaymentPaidOwnerRemark({
            treasurerName,
            totalAmount,
          }),
        },
      ],
      { session },
    );

    return saved.toObject();
  });
};

// Update a single department payment while enforcing the combined-payment rule.
export const updateMainTreasurerPaymentStatusS = async (params: {
  applicationId: string;
  departmentId: string;
  paymentStatus: "pending" | "paid";
  treasurerId: string;
}) => {
  if (params.paymentStatus === "paid") {
    throw new Error(MAIN_TREASURER_CONFIRMATION_REQUIRED_ERROR);
  }

  return updateMainTreasurerPaymentStatusesInternalS({
    applicationId: params.applicationId,
    paymentStatus: params.paymentStatus,
    treasurerId: params.treasurerId,
    departmentIds: [params.departmentId],
  });
};

// Update multiple department payment statuses in one request.
export const updateMainTreasurerPaymentStatusesBatchS = async (params: {
  applicationId: string;
  paymentStatus: "pending" | "paid";
  treasurerId: string;
  departmentIds: string[];
}) => {
  if (params.paymentStatus === "paid") {
    throw new Error(MAIN_TREASURER_CONFIRMATION_REQUIRED_ERROR);
  }

  return updateMainTreasurerPaymentStatusesInternalS(params);
};
