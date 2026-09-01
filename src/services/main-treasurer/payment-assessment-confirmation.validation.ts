import { matchesCombinedPaymentQrValue } from "../../utils/payment/payment-qr.util";

const MAIN_TREASURER_STAGE_ERROR =
  "Application is not currently available for main treasurer payment processing.";

const normalizeText = (value: unknown) => String(value ?? "").trim();

// Normalize numeric payment values for validation.
const toNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizePaymentStatus = (value: unknown): "pending" | "paid" =>
  normalizeText(value) === "paid" ? "paid" : "pending";

const getAssessmentDepartmentId = (assessment: any) =>
  normalizeText(assessment?.departmentId);

export const validateMainTreasurerPaymentReceiptInput = (params: {
  applicationId: string;
  currentStage: unknown;
  qrValue: string;
  amountReceived: unknown;
  paymentAssessments: any[];
}) => {
  // Validate the QR, stage, and remaining amount before marking payment paid.
  const normalizedQrValue = normalizeText(params.qrValue);
  if (!normalizedQrValue) {
    throw new Error("Scanned payment QR is required.");
  }

  const amountReceived = Number(params.amountReceived);
  if (!Number.isFinite(amountReceived) || amountReceived <= 0) {
    throw new Error("Amount received must be a valid positive number.");
  }

  if (
    !["admin_permit_approval", "admin_permit_validity"].includes(
      normalizeText(params.currentStage),
    )
  ) {
    throw new Error(MAIN_TREASURER_STAGE_ERROR);
  }

  const paymentAssessments = Array.isArray(params.paymentAssessments)
    ? params.paymentAssessments
    : [];

  const isQrMatch = matchesCombinedPaymentQrValue({
    rawValue: normalizedQrValue,
    applicationId: params.applicationId,
    assessments: paymentAssessments,
  });
  if (!isQrMatch) {
    throw new Error(
      "Scanned QR code does not match the current BPLO payment record.",
    );
  }

  const unpaidAssessments = paymentAssessments.filter(
    (assessment: any) =>
      normalizePaymentStatus(assessment?.paymentStatus) !== "paid",
  );
  if (unpaidAssessments.length === 0) {
    throw new Error("Payment is already marked as paid.");
  }

  const remainingAmountDue = unpaidAssessments.reduce(
    (sum: number, assessment: any) => sum + toNumber(assessment.totalAmount),
    0,
  );
  if (amountReceived < remainingAmountDue) {
    throw new Error(
      `Insufficient amount received. Remaining balance is PHP ${remainingAmountDue.toLocaleString(
        "en-PH",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      )}.`,
    );
  }

  const unpaidDepartmentIds = unpaidAssessments
    .map((assessment: any) => getAssessmentDepartmentId(assessment))
    .filter(Boolean);
  if (unpaidDepartmentIds.length === 0) {
    throw new Error("Payment is already marked as paid.");
  }

  return {
    amountReceived,
    normalizedQrValue,
    remainingAmountDue,
    unpaidAssessments,
    unpaidDepartmentIds,
  };
};
