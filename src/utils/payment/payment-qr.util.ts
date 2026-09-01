import { createHmac } from "crypto";
import { paymentEnv } from "../../env/payments";

// Normalizes unknown values into trimmed strings.
const normalizeText = (value: unknown) => String(value ?? "").trim();

// Coerces unknown values into safe finite numbers.
const toNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Formats amount values for canonical QR payload signing.
const formatQrAmount = (value: unknown) => toNumber(value).toFixed(2);

// Resolves the secret used to sign QR payload fingerprints.
const getPaymentQrSecret = () =>
  normalizeText(paymentEnv.paymentQrSecret || paymentEnv.jwtAccessToken) ||
  "BPLO_PAYMENT_QR_SECRET";

// Builds a deterministic fingerprint of assessment rows for signature checks.
const buildAssessmentFingerprint = (assessments: unknown[]) =>
  assessments
    .map((assessment) => ({
      departmentId: normalizeText((assessment as any)?.departmentId),
      generatedAt: normalizeText((assessment as any)?.generatedAt),
      totalAmount: formatQrAmount((assessment as any)?.totalAmount),
    }))
    .sort((a, b) =>
      `${a.departmentId}|${a.generatedAt}`.localeCompare(
        `${b.departmentId}|${b.generatedAt}`,
      ),
    )
    .map(
      (assessment) =>
        `${assessment.departmentId}:${assessment.totalAmount}:${assessment.generatedAt}`,
    )
    .join(";");

// Builds the canonical combined-payment QR payload for an application.
export const buildCombinedPaymentQrValue = (params: {
  applicationId: string;
  assessments: unknown[];
}) => {
  const applicationId = normalizeText(params.applicationId);
  const assessments = Array.isArray(params.assessments)
    ? params.assessments
    : [];

  if (!applicationId || assessments.length === 0) return "";

  const totalAmount = assessments.reduce(
    (sum: number, assessment) =>
      sum + toNumber((assessment as any)?.totalAmount),
    0,
  );
  const departmentCount = assessments.length;
  const fingerprint = buildAssessmentFingerprint(assessments);
  const signaturePayload = [
    applicationId,
    formatQrAmount(totalAmount),
    String(departmentCount),
    fingerprint,
  ].join("|");
  const signature = createHmac("sha256", getPaymentQrSecret())
    .update(signaturePayload)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();

  return [
    "BPLOPAY",
    `APP=${applicationId}`,
    `TOTAL=${formatQrAmount(totalAmount)}`,
    `DEPTS=${departmentCount}`,
    `SIG=${signature}`,
  ].join("|");
};

// Validates an incoming QR payload against current assessment data.
export const matchesCombinedPaymentQrValue = (params: {
  rawValue: string;
  applicationId: string;
  assessments: unknown[];
}) => {
  const rawValue = normalizeText(params.rawValue);
  if (!rawValue) return false;

  const expectedValue = buildCombinedPaymentQrValue({
    applicationId: params.applicationId,
    assessments: params.assessments,
  });

  return !!expectedValue && rawValue === expectedValue;
};
