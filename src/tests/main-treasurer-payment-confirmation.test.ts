import assert from "node:assert/strict";

import { validateMainTreasurerPaymentReceiptInput } from "../services/main-treasurer/payment-assessment-confirmation.validation";
import { buildCombinedPaymentQrValue } from "../utils/payment/payment-qr.util";

const applicationId = "69cbc916281e5fbbda8bf037";

// Build a payment assessment fixture with optional overrides.
const createAssessment = (
  overrides: Partial<Record<string, unknown>> = {},
) => ({
  departmentId: "dept-1",
  departmentName: "Treasury",
  generatedAt: new Date("2026-04-07T09:00:00.000Z"),
  items: [{ feeName: "Processing Fee", amount: 255 }],
  totalAmount: 255,
  paymentStatus: "pending",
  ...overrides,
});

// Run a named assertion block and print PASS/FAIL output.
const runCase = (name: string, callback: () => void) => {
  try {
    callback();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

// Execute main treasurer payment confirmation validation cases.
const run = () => {
  runCase("accepts a valid current QR with enough payment amount", () => {
    const paymentAssessments = [createAssessment()];
    const qrValue = buildCombinedPaymentQrValue({
      applicationId,
      assessments: paymentAssessments,
    });

    const result = validateMainTreasurerPaymentReceiptInput({
      applicationId,
      currentStage: "admin_permit_approval",
      qrValue,
      amountReceived: 255,
      paymentAssessments,
    });

    assert.equal(result.remainingAmountDue, 255);
    assert.equal(result.unpaidAssessments.length, 1);
    assert.deepEqual(result.unpaidDepartmentIds, ["dept-1"]);
  });

  runCase("rejects a stale or mismatched QR value", () => {
    const currentAssessments = [createAssessment({ totalAmount: 255 })];
    const staleAssessments = [
      createAssessment({
        totalAmount: 200,
        items: [{ feeName: "Old Processing Fee", amount: 200 }],
      }),
    ];
    const staleQrValue = buildCombinedPaymentQrValue({
      applicationId,
      assessments: staleAssessments,
    });

    assert.throws(
      () =>
        validateMainTreasurerPaymentReceiptInput({
          applicationId,
          currentStage: "admin_permit_approval",
          qrValue: staleQrValue,
          amountReceived: 255,
          paymentAssessments: currentAssessments,
        }),
      /Scanned QR code does not match the current BPLO payment record\./,
    );
  });

  runCase("rejects insufficient payment amount", () => {
    const paymentAssessments = [createAssessment()];
    const qrValue = buildCombinedPaymentQrValue({
      applicationId,
      assessments: paymentAssessments,
    });

    assert.throws(
      () =>
        validateMainTreasurerPaymentReceiptInput({
          applicationId,
          currentStage: "admin_permit_approval",
          qrValue,
          amountReceived: 200,
          paymentAssessments,
        }),
      /Insufficient amount received\./,
    );
  });

  runCase("rejects already-paid applications", () => {
    const paymentAssessments = [
      createAssessment({
        paymentStatus: "paid",
        statusUpdatedAt: new Date("2026-04-07T10:00:00.000Z"),
        statusUpdatedByName: "Main Treasurer",
      }),
    ];
    const qrValue = buildCombinedPaymentQrValue({
      applicationId,
      assessments: paymentAssessments,
    });

    assert.throws(
      () =>
        validateMainTreasurerPaymentReceiptInput({
          applicationId,
          currentStage: "admin_permit_validity",
          qrValue,
          amountReceived: 255,
          paymentAssessments,
        }),
      /Payment is already marked as paid\./,
    );
  });

  console.log("All main treasurer payment confirmation tests passed.");
};

try {
  run();
} catch (error) {
  process.exitCode = 1;
  console.error(error);
}
