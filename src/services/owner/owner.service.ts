import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import Permit from "@/models/permit/permit.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import {
  PermitApplicationResponseType,
  PermitApplicationType,
} from "@/types/models/permit-application.type";
import {
  PermitFieldTypeOption,
  PermitFieldValidationKind,
  PermitType,
} from "@/types/models/permit.type";
import { runInTransaction } from "@/utils/db/transaction.util";
import { buildCombinedPaymentQrValue } from "@/utils/payment/payment-qr.util";
import { Types } from "mongoose";

type OwnerNotificationScope = "application" | "inspection" | "payment";
type OwnerGeneratedDocumentKind = "permit" | "inspection_certificate";

const FIELD_TYPES_WITH_OPTIONS = ["select", "checkbox", "radio"];
const FIELD_TYPES_WITH_VALIDATION = ["text", "textarea"];
const BUSINESS_NAME_FIELD_ID_CANDIDATES = [
  "business name",
  "trade name",
  "establishment name",
];
const BUSINESS_NAME_LABEL_CANDIDATES = [
  "business name",
  "trade name",
  "establishment name",
];
const INSPECTION_STATUS_CODES = [
  "for_inspection",
  "inspection_pending",
  "inspection_approved",
  "inspection_scheduled",
  "inspection_rescheduled",
  "inspection_denied",
  "inspection_passed",
  "inspection_for_completion",
  "inspection_failed",
];
const PAYMENT_STATUS_CODES = [
  "for_admin_approval",
  "payment_breakdown",
  "payment_pending",
  "payment_paid",
  "payment_confirmed",
];
const OWNER_STATUS_DETAIL_APPLICATION_SELECT = [
  "inspectionFlow.currentStepIndex",
  "inspectionFlow.steps.processId",
  "inspectionFlow.steps.processName",
  "inspectionFlow.steps.sequence",
  "inspectionFlow.steps.assignedInspector",
  "inspectionFlow.steps.assignedInspectorName",
  "inspectionFlow.steps.assignedAt",
  "inspectionFlow.steps.scheduledInspectionAt",
  "inspectionFlow.steps.scheduleStatus",
  "inspectionFlow.steps.scheduleRemark",
  "inspectionFlow.steps.completedAt",
  "inspectionFlow.steps.completionRemark",
  "inspectionFlow.steps.assessmentResult",
  "inspectionFlow.steps.reassessmentRequestedAt",
  "paymentAssessments.departmentId",
  "paymentAssessments.departmentName",
  "paymentAssessments.generatedAt",
  "paymentAssessments.items.feeName",
  "paymentAssessments.items.amount",
  "paymentAssessments.totalAmount",
  "paymentAssessments.paymentStatus",
  "paymentAssessments.statusUpdatedAt",
  "paymentAssessments.statusUpdatedByName",
  "generatedPermit.templateName",
  "generatedPermit.templateVersion",
  "generatedPermit.sentToApplicantAt",
  "generatedPermit.file.fileName",
  "generatedPermit.file.mimeType",
  "generatedPermit.file.generatedAt",
  "generatedPermit.file.pdf.mimeType",
  "generatedPermit.file.pdf.generatedAt",
  "generatedInspectionCertificate.templateName",
  "generatedInspectionCertificate.templateVersion",
  "generatedInspectionCertificate.sentToApplicantAt",
  "generatedInspectionCertificate.file.fileName",
  "generatedInspectionCertificate.file.mimeType",
  "generatedInspectionCertificate.file.generatedAt",
  "generatedInspectionCertificate.file.pdf.mimeType",
  "generatedInspectionCertificate.file.pdf.generatedAt",
].join(" ");

// Normalize generated PDF file names and guarantee a .pdf extension.
const sanitizePdfFileName = (value: unknown, fallback: string) => {
  const fileName = sanitizeString(value);
  if (!fileName) return fallback;
  if (/\.pdf$/i.test(fileName)) return fileName;
  if (/\.[a-z0-9]+$/i.test(fileName)) {
    return fileName.replace(/\.[a-z0-9]+$/i, ".pdf");
  }
  return `${fileName}.pdf`;
};

// Convert any input into a trimmed string for safe comparisons.
const sanitizeString = (value: unknown) => String(value ?? "").trim();

// Normalize text so matching ignores case, separators, and extra spacing.
const normalizeTextForComparison = (value: unknown) =>
  sanitizeString(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

// Use the same normalization for business-name duplicate checks.
const normalizeBusinessNameForComparison = (value: unknown) =>
  normalizeTextForComparison(value);

// Pull the first text value out of checkbox-style or scalar responses.
const extractResponseTextValue = (value: unknown) => {
  if (Array.isArray(value)) {
    return sanitizeString(value[0]);
  }
  return sanitizeString(value);
};

// Detect which response field holds the business name value.
const isBusinessNameResponseField = (response: {
  fieldId?: unknown;
  label?: unknown;
}) => {
  const fieldId = normalizeTextForComparison(response.fieldId);
  const label = normalizeTextForComparison(response.label);

  const matchesFieldId = BUSINESS_NAME_FIELD_ID_CANDIDATES.some(
    (candidate) =>
      fieldId === candidate ||
      fieldId.endsWith(candidate) ||
      fieldId.includes(candidate),
  );
  const matchesLabel = BUSINESS_NAME_LABEL_CANDIDATES.some((candidate) =>
    label.includes(candidate),
  );

  return matchesFieldId || matchesLabel;
};

// Read the submitted business name from the permit form responses.
const extractBusinessNameFromResponses = (
  responses: Array<{
    fieldId?: unknown;
    label?: unknown;
    type?: unknown;
    value?: unknown;
  }>,
) => {
  for (const response of responses) {
    if (normalizeTextForComparison(response.type) === "file") continue;
    if (!isBusinessNameResponseField(response)) continue;

    const value = extractResponseTextValue(response.value);
    if (value) return value;
  }

  return "";
};

// Reject submissions that reuse an already approved business name.
const ensureUniqueRegisteredBusinessName = async (params: {
  responses: PermitApplicationResponseType[];
  excludeApplicationId?: string;
}) => {
  const businessName = extractBusinessNameFromResponses(params.responses);
  if (!businessName) return;

  const normalizedBusinessName =
    normalizeBusinessNameForComparison(businessName);
  if (!normalizedBusinessName) return;

  const query: Record<string, unknown> = {
    "adminResult.decision": "approved",
  };

  if (
    params.excludeApplicationId &&
    Types.ObjectId.isValid(params.excludeApplicationId)
  ) {
    query._id = { $ne: new Types.ObjectId(params.excludeApplicationId) };
  }

  const existingApprovedApplications = await PermitApplication.find(query)
    .select("responses")
    .lean();

  const hasDuplicate = existingApprovedApplications.some((application) => {
    const existingBusinessName = extractBusinessNameFromResponses(
      Array.isArray(application.responses) ? application.responses : [],
    );

    return (
      existingBusinessName &&
      normalizeBusinessNameForComparison(existingBusinessName) ===
        normalizedBusinessName
    );
  });

  if (hasDuplicate) {
    throw new Error(
      "Business name is already registered. Please use a different business name.",
    );
  }
};

// Format inspection dates for owner-facing schedule remarks.
const formatScheduleDateTime = (value?: Date | string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// Build compact reference fragments for payment QR codes.
const sanitizeReferencePart = (value: unknown, fallback: string) => {
  const normalized = sanitizeString(value)
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  return normalized || fallback;
};

// Convert the reference date into a compact YYYYMMDD token.
const formatPaymentReferenceDate = (value?: Date | string | null) => {
  if (!value) return "PENDING";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "PENDING";

  return date.toISOString().slice(0, 10).replace(/-/g, "");
};

// Compose a stable payment reference from the application and department.
const buildPaymentReference = (params: {
  applicationId: string;
  departmentId: string;
  generatedAt?: Date | string | null;
}) => {
  const applicationPart = sanitizeReferencePart(
    params.applicationId,
    "APP",
  ).slice(-8);
  const departmentPart = sanitizeReferencePart(
    params.departmentId,
    "DEPT",
  ).slice(-6);
  const datePart = formatPaymentReferenceDate(params.generatedAt);

  return `BPLO-${applicationPart}-${departmentPart}-${datePart}`;
};

// Render payment totals in a human-friendly PHP amount format.
const formatPaymentAmount = (value: number) =>
  `PHP ${Number(value ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Summarize all fee items so the QR payload stays compact.
const buildQrFeeSummary = (
  items: Array<{ feeName: string; amount: number }>,
) => {
  if (items.length === 0) return "";

  const summary = items
    .map(
      (item) =>
        `${sanitizeString(item.feeName)} ${formatPaymentAmount(item.amount)}`,
    )
    .join("; ");

  if (summary.length <= 120) {
    return `Fees: ${summary}`;
  }

  return `Fees: ${items.length} item(s). Review the full breakdown in Payment Status.`;
};

// Assemble the full payment QR payload shown to the owner.
const buildPaymentQrValue = (params: {
  paymentReference: string;
  applicationId: string;
  permitType: string;
  departmentName: string;
  items: Array<{ feeName: string; amount: number }>;
  totalAmount: number;
  paymentStatus: string;
  generatedAt?: Date | string | null;
}) => {
  const feeSummary = buildQrFeeSummary(params.items);

  return [
    "BPLO PAYMENT",
    `Ref: ${params.paymentReference}`,
    `App: ${params.applicationId}`,
    `Permit: ${sanitizeString(params.permitType)}`,
    `Dept: ${sanitizeString(params.departmentName)}`,
    feeSummary,
    `Total: ${formatPaymentAmount(params.totalAmount)}`,
    "How to pay:",
    "1. Present this QR to the BPLO Treasurer.",
    "2. Pay the total amount due.",
    "3. Keep your official receipt.",
    `Status: ${sanitizeString(params.paymentStatus).toUpperCase() || "PENDING"}`,
  ]
    .filter(Boolean)
    .join("\n");
};

// Turn an inspection schedule update into a readable history remark.
const buildScheduleDetailRemark = (params: {
  status: string;
  inspectionScheduledAt?: Date | string | null;
  rawRemark?: string | null;
}) => {
  const action =
    params.status === "inspection_rescheduled"
      ? "New Schedule"
      : "Set Schedule";
  const scheduleDate = formatScheduleDateTime(params.inspectionScheduledAt);
  const cleanRemark = sanitizeString(params.rawRemark);

  const detailLines = [
    `Action: ${action}`,
    `Date: ${scheduleDate || "Not available"}`,
    `Remarks: ${cleanRemark || "None"}`,
  ];

  return detailLines.join("\n");
};

// Narrow notification queries to application, inspection, or payment events.
const buildOwnerNotificationScopeFilter = (scope?: OwnerNotificationScope) => {
  const inspectionFilter = {
    $or: [
      { statusSource: { $in: ["bplo_admin", "inspector"] } },
      {
        $and: [
          {
            $or: [
              { statusSource: "system" },
              { statusSource: null },
              { statusSource: { $exists: false } },
            ],
          },
          { status: { $in: INSPECTION_STATUS_CODES } },
        ],
      },
    ],
  };
  const paymentFilter = {
    $or: [
      { statusSource: "treasurer" },
      { status: { $in: PAYMENT_STATUS_CODES } },
    ],
  };

  switch (scope) {
    case "inspection":
      return inspectionFilter;
    case "payment":
      return paymentFilter;
    case "application":
      return {
        $nor: [inspectionFilter, paymentFilter],
      };
    default:
      return {};
  }
};

// Detect whether the application is currently waiting for owner re-submission.
const isOwnerResubmissionState = (
  application?: {
    currentStage?: string | null;
    tableStatus?: string | null;
  } | null,
) => {
  if (!application) return false;

  if (
    application.currentStage &&
    application.currentStage !== "business_owner_application_status"
  ) {
    return false;
  }

  return application.tableStatus === "re_submission";
};

// Normalize generated document metadata for API responses.
const mapGeneratedDocumentMetadata = (document: any) => {
  if (!document) return null;

  return {
    templateName: sanitizeString(document.templateName),
    templateVersion: Number(document.templateVersion ?? 0),
    sentToApplicantAt: document.sentToApplicantAt ?? null,
    file: {
      fileName: sanitizeString(document.file?.fileName),
      mimeType: sanitizeString(document.file?.mimeType),
      generatedAt: document.file?.generatedAt ?? null,
      pdf: document.file?.pdf
        ? {
            mimeType: sanitizeString(document.file.pdf.mimeType),
            generatedAt: document.file.pdf.generatedAt ?? null,
            available: true,
          }
        : null,
    },
  };
};

// Pick the generated document container based on the requested kind.
const getGeneratedDocumentRecord = (params: {
  application: any;
  documentKind: OwnerGeneratedDocumentKind;
}) => {
  return params.documentKind === "permit"
    ? params.application?.generatedPermit
    : params.application?.generatedInspectionCertificate;
};

// Prepare a downloadable document summary for the owner UI.
const buildOwnerGeneratedDocumentSummary = (params: {
  statusId: string;
  applicationRefId: string;
  permitType: string;
  documentKind: OwnerGeneratedDocumentKind;
  document: any;
}) => {
  const metadata = mapGeneratedDocumentMetadata(params.document);
  if (!metadata?.file?.pdf?.available) return null;

  return {
    id: `${params.statusId}-${params.documentKind}`,
    statusId: params.statusId,
    applicationRefId: params.applicationRefId,
    permitType: params.permitType,
    documentKind: params.documentKind,
    templateName: metadata.templateName,
    templateVersion: metadata.templateVersion,
    sentToApplicantAt: metadata.sentToApplicantAt,
    generatedAt:
      metadata.file.pdf?.generatedAt ?? metadata.file.generatedAt ?? null,
    fileName: sanitizePdfFileName(
      metadata.file.fileName,
      params.documentKind === "permit"
        ? "business-permit.pdf"
        : "inspection-certificate.pdf",
    ),
    mimeType: metadata.file.pdf?.mimeType || "application/pdf",
  };
};

// Prefer the newest inspection remark when building the detail feed.
const buildLatestInspectionFeedback = (application: any) => {
  const steps = Array.isArray(application?.inspectionFlow?.steps)
    ? application.inspectionFlow.steps
    : [];

  const completedWithRemark = steps
    .filter(
      (step: any) =>
        step?.completedAt && sanitizeString(step?.completionRemark),
    )
    .sort(
      (a: any, b: any) =>
        new Date(b.completedAt as string).getTime() -
        new Date(a.completedAt as string).getTime(),
    );

  if (completedWithRemark.length > 0) {
    const latest = completedWithRemark[0];
    const department = sanitizeString(latest?.processName);
    const remark = sanitizeString(latest?.completionRemark);
    return department
      ? `${department} feedback: ${remark}`
      : `Inspection feedback: ${remark}`;
  }

  const currentIndex = Number(
    application?.inspectionFlow?.currentStepIndex ?? 0,
  );
  const currentStep = steps[currentIndex];
  if (currentStep) {
    const department = sanitizeString(currentStep?.processName);
    const inspector = sanitizeString(currentStep?.assignedInspectorName);
    const scheduledAt = currentStep?.scheduledInspectionAt
      ? new Date(currentStep.scheduledInspectionAt as string)
      : null;

    if (scheduledAt && !Number.isNaN(scheduledAt.getTime())) {
      const scheduleText = scheduledAt.toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      const reason = sanitizeString(currentStep?.scheduleRemark);
      if (reason) {
        return `Schedule updated for ${department} on ${scheduleText}. Reason: ${reason}`;
      }
      return `Inspection scheduled for ${department} on ${scheduleText}.`;
    }

    if (department && inspector) {
      return `Ongoing: ${department} inspection assigned to ${inspector}.`;
    }
    if (department) {
      return `Ongoing: ${department} inspection is in progress.`;
    }
  }

  return "";
};

// Flatten inspection steps into a UI-friendly progress list.
const buildInspectionUpdates = (application: any) => {
  const steps = Array.isArray(application?.inspectionFlow?.steps)
    ? application.inspectionFlow.steps
    : [];
  const currentIndex = Number(
    application?.inspectionFlow?.currentStepIndex ?? 0,
  );

  return steps
    .map((step: any, index: number) => {
      const assignedAt = step?.assignedAt ?? null;
      const completedAt = step?.completedAt ?? null;
      const scheduleStatus = sanitizeString(step?.scheduleStatus);
      const stage = completedAt
        ? "completed"
        : scheduleStatus === "rescheduled"
          ? "rescheduled"
          : scheduleStatus === "scheduled"
            ? "scheduled"
            : index === currentIndex
              ? "current"
              : index < currentIndex
                ? "completed"
                : "queued";

      const feedback = sanitizeString(step?.completionRemark);
      return {
        processId: sanitizeString(step?.processId),
        processName: sanitizeString(step?.processName),
        sequence: Number(step?.sequence ?? index + 1),
        assignedInspectorName: sanitizeString(step?.assignedInspectorName),
        assignedAt,
        scheduledInspectionAt: step?.scheduledInspectionAt ?? null,
        scheduleRemark: sanitizeString(step?.scheduleRemark),
        completedAt,
        stage,
        feedback,
      };
    })
    .sort((a: any, b: any) => a.sequence - b.sequence);
};

// Map the application state into the owner status label taxonomy.
const getOwnerApplicationStatusLabel = (application: any) => {
  const decision = sanitizeString(application.evaluatorResult?.decision);
  const adminDecision = sanitizeString(application.adminResult?.decision);
  const inspectionDecision = sanitizeString(
    application.inspectionAdminResult?.decision,
  );

  if (adminDecision === "approved") return "approved";
  if (adminDecision === "denied") return "failed";

  if (inspectionDecision === "denied") return "inspection_denied";
  if (inspectionDecision === "pending") return "inspection_pending";

  if (application.currentStage === "business_owner_application_status") {
    return "re_submission";
  }

  if (application.currentStage === "inspector_inspection_request") {
    const currentStepIndex = Number(
      application.inspectionFlow?.currentStepIndex ?? 0,
    );
    const currentStep = application.inspectionFlow?.steps?.[currentStepIndex];
    const scheduleStatus = sanitizeString(currentStep?.scheduleStatus);
    if (scheduleStatus === "rescheduled") return "inspection_rescheduled";
    if (scheduleStatus === "scheduled") return "inspection_scheduled";
    if (inspectionDecision === "approved") return "inspection_approved";
    return "for_inspection";
  }

  if (application.currentStage === "admin_inspection_request") {
    if (inspectionDecision === "approved") return "inspection_approved";
    if (inspectionDecision === "pending") return "inspection_pending";
    if (inspectionDecision === "denied") return "inspection_denied";
    return "for_inspection";
  }

  if (application.currentStage === "admin_permit_approval") {
    return "for_admin_approval";
  }

  if (application.currentStage === "admin_permit_validity") {
    return "approved";
  }

  if (!application.currentStage) {
    if (decision === "re_submission") return "re_submission";
    if (decision === "for_inspection") return "for_inspection";
    if (decision === "for_admin_approval") return "for_admin_approval";
  }

  return "submitted";
};

// Keep only file attachments that look complete enough to save.
const sanitizeFiles = (files: unknown) => {
  if (!Array.isArray(files)) return [];
  return files
    .map((file) => ({
      name: sanitizeString((file as any)?.name),
      mimeType: sanitizeString((file as any)?.mimeType),
      size: Number((file as any)?.size ?? 0),
      url: sanitizeString((file as any)?.url),
    }))
    .filter((file) => file.name && file.mimeType && file.url && file.size > 0);
};

// Enforce required-field rules based on the response type.
const validateRequiredField = (
  field: PermitFieldTypeOption,
  response: PermitApplicationResponseType,
) => {
  if (!field.required) return true;

  if (field.type === "file") {
    return Array.isArray(response.files) && response.files.length > 0;
  }

  if (field.type === "checkbox") {
    return Array.isArray(response.value) && response.value.length > 0;
  }

  return Boolean(response.value && String(response.value).trim());
};

// Normalize the submitted value to the expected shape for the field.
const validateFieldValue = (field: PermitFieldTypeOption, value: unknown) => {
  if (field.type === "checkbox") {
    if (!Array.isArray(value)) return [];
    return value.map((item) => sanitizeString(item)).filter(Boolean);
  }

  return sanitizeString(value);
};

// Reject option values that do not belong to the field definition.
const ensureOptionValidity = (
  field: PermitFieldTypeOption,
  response: PermitApplicationResponseType,
) => {
  if (!FIELD_TYPES_WITH_OPTIONS.includes(field.type)) return true;

  const validOptions = field.options ?? [];
  if (field.type === "checkbox") {
    const values = Array.isArray(response.value) ? response.value : [];
    return values.every((item) => validOptions.includes(item));
  }

  return typeof response.value === "string"
    ? validOptions.includes(response.value)
    : false;
};

// Resolve the validation regex used by text and textarea fields.
const getFieldValidationRegex = (
  kind?: PermitFieldValidationKind,
  customRegex?: string,
): RegExp | null => {
  if (!kind || kind === "none") return null;
  if (kind === "letters_only") return /^[A-Za-z\s.'-]+$/;
  if (kind === "numbers_only") return /^\d+$/;
  if (kind === "alphanumeric") return /^[A-Za-z0-9]+$/;

  if (kind === "custom_regex") {
    const pattern = sanitizeString(customRegex);
    if (!pattern) return null;
    try {
      return new RegExp(pattern);
    } catch {
      return null;
    }
  }

  return null;
};

// Produce the user-facing validation error for an invalid field response.
const getFieldValidationError = (
  field: PermitFieldTypeOption,
  response: PermitApplicationResponseType,
): string | null => {
  if (!FIELD_TYPES_WITH_VALIDATION.includes(field.type)) return null;

  const rawValue = sanitizeString(response.value);
  if (!rawValue) return null;

  const regex = getFieldValidationRegex(
    field.validation?.kind,
    field.validation?.regex,
  );
  if (!regex) return null;
  if (regex.test(rawValue)) return null;

  const customMessage = sanitizeString(field.validation?.message);
  if (customMessage) return customMessage;

  if (field.validation?.kind === "letters_only") {
    return `${field.label}: only letters are allowed.`;
  }
  if (field.validation?.kind === "numbers_only") {
    return `${field.label}: only numbers are allowed.`;
  }
  if (field.validation?.kind === "alphanumeric") {
    return `${field.label}: only letters and numbers are allowed.`;
  }
  return `${field.label}: invalid format.`;
};

// Return every active permit that the owner can apply for.
export const getAvailablePermitsS = async () => {
  return Permit.find({ isActive: true })
    .select(
      "name description formTitle formDescription fields createdAt updatedAt",
    )
    .sort({ createdAt: -1 })
    .lean();
};

// Load a single permit record for the application form.
export const getPermitForApplicationS = async (permitId: string) => {
  if (!Types.ObjectId.isValid(permitId)) return null;
  return Permit.findById(permitId).lean();
};

// Allow re-submission only when the application is in the expected owner state.
export const canOwnerAccessInactivePermitResubmissionS = async (params: {
  permitId: string;
  applicationId: string;
  applicantId: string;
}) => {
  if (!Types.ObjectId.isValid(params.permitId)) return false;
  if (!Types.ObjectId.isValid(params.applicationId)) return false;
  if (!Types.ObjectId.isValid(params.applicantId)) return false;

  const application = await PermitApplication.findById(params.applicationId)
    .select("permit applicant currentStage tableStatus")
    .lean();

  if (!application) return false;
  if (String(application.applicant) !== params.applicantId) return false;
  if (String(application.permit) !== params.permitId) return false;

  return isOwnerResubmissionState(application);
};

// Validate and persist a new permit application submission.
export const createPermitApplicationS = async (params: {
  permitId: string;
  applicantId: string;
  responses: any[];
}) => {
  const permit = await getPermitForApplicationS(params.permitId);
  if (!permit) return null;
  if (!permit.isActive) {
    throw new Error("This permit is no longer available for new applications.");
  }

  const fieldMap = new Map(permit.fields.map((field) => [field.id, field]));

  const normalizedResponses: PermitApplicationResponseType[] =
    permit.fields.map((field) => {
      const rawResponse = params.responses.find(
        (response) => sanitizeString(response?.fieldId) === field.id,
      );

      const normalized: PermitApplicationResponseType = {
        fieldId: field.id,
        label: field.label,
        type: field.type,
        value: null,
        files: [],
      };

      if (!rawResponse) return normalized;

      if (field.type === "file") {
        normalized.files = sanitizeFiles(rawResponse.files);
        return normalized;
      }

      normalized.value = validateFieldValue(field, rawResponse.value);
      return normalized;
    });

  const hasInvalidOption = normalizedResponses.some((response) => {
    const field = fieldMap.get(response.fieldId);
    if (!field) return true;
    return !ensureOptionValidity(field, response);
  });

  if (hasInvalidOption) {
    throw new Error("Invalid option value found for one or more fields.");
  }

  const missingRequiredField = normalizedResponses.some((response) => {
    const field = fieldMap.get(response.fieldId);
    if (!field) return true;
    return !validateRequiredField(field, response);
  });

  if (missingRequiredField) {
    throw new Error("Please complete all required fields before submitting.");
  }

  const invalidConstraint = normalizedResponses.find((response) => {
    const field = fieldMap.get(response.fieldId);
    if (!field) return false;
    return Boolean(getFieldValidationError(field, response));
  });

  if (invalidConstraint) {
    const field = fieldMap.get(invalidConstraint.fieldId);
    if (field) {
      throw new Error(
        getFieldValidationError(field, invalidConstraint) ??
          "Invalid field format.",
      );
    }
  }

  await ensureUniqueRegisteredBusinessName({
    responses: normalizedResponses,
  });

  const applicationPayload: Partial<PermitApplicationType> = {
    permit: new Types.ObjectId(params.permitId),
    applicant: new Types.ObjectId(params.applicantId),
    permitName: permit.name,
    formTitle: permit.formTitle || permit.name,
    responses: normalizedResponses,
    status: "submitted",
    tableStatus: "for_review",
    currentStage: "evaluator_application_request",
    destinationModule: "evaluator_application_request",
    // Start with version 1 so the initial "submitted" notification is
    // immediately shown as unread (bold) in the owner's Application Status
    // list. ownerStatusReadVersion stays at 0 (default) so unreadCount = 1.
    ownerStatusVersion: 1,
    ownerStatusSource: "system",
    submittedAt: new Date(),
  };

  const applicationObj = await runInTransaction(async (session) => {
    const application = await PermitApplication.create([applicationPayload], {
      session,
    });
    const created = application[0];

    await OwnerApplicationStatus.create(
      [
        {
          permit: new Types.ObjectId(params.permitId),
          application: created._id,
          applicant: new Types.ObjectId(params.applicantId),
          permitName: permit.name,
          status: "submitted",
          statusSource: "system",
          submittedAt: new Date(),
        },
      ],
      { session },
    );

    return created.toObject();
  });

  return applicationObj;
};

// Fetch the current owner re-submission payload for one application.
export const getOwnerApplicationByIdS = async (params: {
  applicationId: string;
  applicantId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.applicantId)) return null;

  const application = await PermitApplication.findById(
    params.applicationId,
  ).lean();

  if (!application) return null;
  if (String(application.applicant) !== params.applicantId) return null;
  if (!isOwnerResubmissionState(application)) return null;

  return {
    _id: String(application._id),
    permitId: String(application.permit),
    tableStatus: application.tableStatus,
    evaluatorRemark: sanitizeString(application.evaluatorResult?.remark),
    responses: application.responses ?? [],
  };
};

// Rebuild the submitted responses so they match the permit schema.
const normalizeResponsesForPermit = (
  permit: PermitType,
  inputResponses: any[],
): PermitApplicationResponseType[] => {
  const permitFields = permit.fields as PermitFieldTypeOption[];
  const fieldMap = new Map(permitFields.map((field) => [field.id, field]));

  const normalizedResponses: PermitApplicationResponseType[] = permitFields.map(
    (field) => {
      const rawResponse = inputResponses.find(
        (response) => sanitizeString(response?.fieldId) === field.id,
      );

      const normalized: PermitApplicationResponseType = {
        fieldId: field.id,
        label: field.label,
        type: field.type,
        value: null,
        files: [],
      };

      if (!rawResponse) return normalized;

      if (field.type === "file") {
        normalized.files = sanitizeFiles(rawResponse.files);
        return normalized;
      }

      normalized.value = validateFieldValue(field, rawResponse.value);
      return normalized;
    },
  );

  const hasInvalidOption = normalizedResponses.some((response) => {
    const field = fieldMap.get(response.fieldId);
    if (!field) return true;
    return !ensureOptionValidity(field, response);
  });

  if (hasInvalidOption) {
    throw new Error("Invalid option value found for one or more fields.");
  }

  const missingRequiredField = normalizedResponses.some((response) => {
    const field = fieldMap.get(response.fieldId);
    if (!field) return true;
    return !validateRequiredField(field, response);
  });

  if (missingRequiredField) {
    throw new Error("Please complete all required fields before submitting.");
  }

  const invalidConstraint = normalizedResponses.find((response) => {
    const field = fieldMap.get(response.fieldId);
    if (!field) return false;
    return Boolean(getFieldValidationError(field, response));
  });

  if (invalidConstraint) {
    const field = fieldMap.get(invalidConstraint.fieldId);
    if (field) {
      throw new Error(
        getFieldValidationError(field, invalidConstraint) ??
          "Invalid field format.",
      );
    }
  }

  return normalizedResponses;
};

// Replace the prior submission with the owner's updated responses.
export const resubmitPermitApplicationS = async (params: {
  applicationId: string;
  applicantId: string;
  responses: any[];
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.applicantId)) return null;

  const application = await PermitApplication.findById(params.applicationId);
  if (!application) return null;
  if (String(application.applicant) !== params.applicantId) return null;
  if (
    application.currentStage &&
    application.currentStage !== "business_owner_application_status"
  ) {
    throw new Error(
      "This application is not in the business owner re-submission state.",
    );
  }

  if (application.tableStatus !== "re_submission") {
    throw new Error("This application is not marked for re-submission.");
  }

  const permit = await getPermitForApplicationS(String(application.permit));
  if (!permit) return null;

  const normalizedResponses = normalizeResponsesForPermit(
    permit,
    params.responses,
  );

  await ensureUniqueRegisteredBusinessName({
    responses: normalizedResponses,
    excludeApplicationId: params.applicationId,
  });

  application.responses = normalizedResponses;
  application.status = "submitted";
  application.tableStatus = "re_submission";
  application.currentStage = "evaluator_application_request";
  application.destinationModule = "evaluator_application_request";
  application.ownerStatusReadVersion = Number(
    application.ownerStatusVersion ?? 0,
  );
  application.ownerStatusReadAt = new Date();
  application.submittedAt = new Date();

  const saved = await application.save();
  return saved.toObject();
};

// Let the owner request another review for a completed inspection step.
export const requestInspectionReassessmentS = async (params: {
  applicationId: string;
  applicantId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.applicantId)) return null;

  const application = await PermitApplication.findById(params.applicationId);
  if (!application) return null;
  if (String(application.applicant) !== params.applicantId) return null;
  if (application.currentStage !== "inspector_inspection_request") return null;
  if (!application.inspectionFlow?.steps?.length) return null;

  const currentStepIndex = Number(
    application.inspectionFlow.currentStepIndex ?? 0,
  );
  const currentStep = application.inspectionFlow.steps[currentStepIndex];
  if (!currentStep) return null;
  if (!currentStep.assignedInspector) return null;
  if (currentStep.completedAt) return null;
  if (sanitizeString(currentStep.assessmentResult) !== "for_completion") {
    throw new Error(
      "Re-assessment can only be requested for inspections marked For Completion.",
    );
  }
  if (currentStep.reassessmentRequestedAt) {
    throw new Error(
      "Re-assessment has already been requested for this inspection.",
    );
  }

  currentStep.reassessmentRequestedAt = new Date();
  currentStep.scheduleStatus = "unscheduled";
  currentStep.scheduledInspectionAt = null;
  currentStep.scheduleRemark = "";
  currentStep.scheduleUpdatedAt = new Date();

  application.ownerStatusSource = "inspector";

  const saved = await application.save();
  return saved.toObject();
};

// Return the notification list visible in the owner's application status page.
export const getOwnerApplicationStatusesS = async (applicantId: string) => {
  if (!Types.ObjectId.isValid(applicantId)) return [];

  const statuses = await OwnerApplicationStatus.find({
    applicant: new Types.ObjectId(applicantId),
    deletedAt: null,
  })
    .populate("permit", "name")
    .populate(
      "application",
      [
        "currentStage",
        "tableStatus",
        "inspectionFlow.currentStepIndex",
        "inspectionFlow.steps.assessmentResult",
        "inspectionFlow.steps.reassessmentRequestedAt",
        "inspectionFlow.steps.completedAt",
        "inspectionFlow.steps.assignedInspector",
      ].join(" "),
    )
    .sort({ createdAt: -1 })
    .lean();

  const latestForCompletionByApplication = new Map<string, string>();
  for (const status of statuses) {
    if (status.status !== "inspection_for_completion") continue;
    const appId = String(
      (status.application as any)?._id ?? status.application,
    );
    if (!appId) continue;
    if (!latestForCompletionByApplication.has(appId)) {
      latestForCompletionByApplication.set(appId, String(status._id));
    }
  }

  return statuses.map((status) => {
    const permitName =
      sanitizeString((status.permit as any)?.name) ||
      sanitizeString(status.permitName) ||
      "Unknown Permit";
    const isRead = status.isRead === true;
    const evaluatorRemark = sanitizeString(status.evaluatorRemark);
    const adminRemark = sanitizeString(status.adminRemark);
    const inspectionRemark = sanitizeString(status.inspectionRemark);
    const visibleRemark = inspectionRemark || evaluatorRemark || adminRemark;
    const rawApplication = status.application as any;
    const applicationRefId = String(
      (status.application as any)?._id ?? status.application,
    );
    const currentStepIndex = Number(
      rawApplication?.inspectionFlow?.currentStepIndex ?? 0,
    );
    const currentStep =
      rawApplication?.inspectionFlow?.steps?.[currentStepIndex];
    const latestForCompletionStatusId =
      latestForCompletionByApplication.get(applicationRefId) ?? "";
    const isLatestForCompletionNotification =
      status.status === "inspection_for_completion" &&
      String(status._id) === latestForCompletionStatusId;
    const canRequestReassessment =
      isLatestForCompletionNotification &&
      sanitizeString(currentStep?.assessmentResult) === "for_completion" &&
      !currentStep?.reassessmentRequestedAt &&
      !currentStep?.completedAt &&
      String(currentStep?.assignedInspector ?? "").trim().length > 0;
    const canResubmit =
      status.status === "re_submission" &&
      isOwnerResubmissionState(rawApplication);

    return {
      _id: String(status._id),
      applicationRefId,
      permitId: String((status.permit as any)?._id ?? status.permit),
      permitType: permitName,
      status: status.status,
      statusSource: status.statusSource,
      canResubmit,
      canRequestReassessment,
      reassessmentRequestedAt: isLatestForCompletionNotification
        ? (currentStep?.reassessmentRequestedAt ?? null)
        : null,
      evaluatorRemark: visibleRemark,
      adminRemark,
      submittedAt: status.submittedAt,
      updatedAt: status.updatedAt,
      decidedAt: status.createdAt,
      unreadCount: isRead ? 0 : 1,
      isRead,
    };
  });
};

// Return the detailed owner status view for one notification record.
export const getOwnerApplicationStatusDetailS = async (params: {
  applicationId: string;
  applicantId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.applicantId)) return null;

  // Fetch from OwnerApplicationStatus (the status history record)
  const status = await OwnerApplicationStatus.findById(params.applicationId)
    .populate("permit", "name")
    .populate("application", OWNER_STATUS_DETAIL_APPLICATION_SELECT)
    .lean();

  if (!status) return null;
  if (String(status.applicant) !== params.applicantId) return null;

  const permitName =
    sanitizeString((status.permit as any)?.name) ||
    sanitizeString(status.permitName) ||
    "Unknown Permit";
  const rawApplication = status.application as any;
  const latestForCompletion = await OwnerApplicationStatus.findOne({
    application: status.application,
    status: "inspection_for_completion",
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .select("_id")
    .lean();
  const isLatestForCompletionNotification =
    status.status === "inspection_for_completion" &&
    String(latestForCompletion?._id ?? "") === String(status._id);
  const currentStepIndex = Number(
    rawApplication?.inspectionFlow?.currentStepIndex ?? 0,
  );
  const currentStep = rawApplication?.inspectionFlow?.steps?.[currentStepIndex];
  const canRequestReassessment =
    isLatestForCompletionNotification &&
    sanitizeString(currentStep?.assessmentResult) === "for_completion" &&
    !currentStep?.reassessmentRequestedAt &&
    !currentStep?.completedAt &&
    String(currentStep?.assignedInspector ?? "").trim().length > 0;
  const applicationRefId = String(
    (status.application as any)?._id ?? status.application,
  );
  const rawPaymentAssessments = Array.isArray(
    rawApplication?.paymentAssessments,
  )
    ? rawApplication.paymentAssessments
    : [];
  const snapshotPaymentAssessments = Array.isArray(
    (status as any).paymentAssessmentSnapshot,
  )
    ? (status as any).paymentAssessmentSnapshot
    : [];
  const paymentAssessmentsSource =
    status.status === "payment_breakdown" &&
    snapshotPaymentAssessments.length > 0
      ? snapshotPaymentAssessments
      : rawPaymentAssessments;

  return {
    _id: String(status._id),
    applicationRefId,
    permitId: String((status.permit as any)?._id ?? status.permit),
    permitType: permitName,
    status: status.status,
    statusSource: status.statusSource,
    remark:
      status.status === "inspection_scheduled" ||
      status.status === "inspection_rescheduled"
        ? buildScheduleDetailRemark({
            status: status.status,
            inspectionScheduledAt: status.inspectionScheduledAt,
            rawRemark: status.inspectionRemark,
          })
        : status.status === "failed" && status.adminRemark
          ? status.adminRemark
          : status.status === "inspection_failed" ||
              status.status === "inspection_for_completion" ||
              status.status === "inspection_passed"
            ? status.inspectionRemark ||
              status.evaluatorRemark ||
              status.adminRemark
            : status.status === "inspection_denied"
              ? status.inspectionRemark || status.evaluatorRemark
              : status.status === "re_submission"
                ? status.evaluatorRemark
                : status.evaluatorRemark || status.adminRemark,
    decidedAt: status.createdAt,
    canRequestReassessment,
    reassessmentRequestedAt: isLatestForCompletionNotification
      ? (currentStep?.reassessmentRequestedAt ?? null)
      : null,
    inspectionUpdates: buildInspectionUpdates(rawApplication),
    combinedPaymentQrValue: buildCombinedPaymentQrValue({
      applicationId: applicationRefId,
      assessments: paymentAssessmentsSource,
    }),
    paymentAssessments: paymentAssessmentsSource.map((assessment: any) => {
      const departmentId = sanitizeString(assessment?.departmentId);
      const departmentName = sanitizeString(assessment?.departmentName);
      const generatedAt = assessment?.generatedAt ?? null;
      const totalAmount = Number(assessment?.totalAmount ?? 0);
      const paymentStatus = sanitizeString(
        assessment?.paymentStatus || "pending",
      );
      const items = Array.isArray(assessment?.items)
        ? assessment.items.map((item: any) => ({
            feeName: sanitizeString(item?.feeName),
            amount: Number(item?.amount ?? 0),
          }))
        : [];
      const paymentReference = buildPaymentReference({
        applicationId: applicationRefId,
        departmentId,
        generatedAt,
      });

      return {
        departmentId,
        departmentName,
        generatedAt,
        totalAmount,
        paymentStatus,
        statusUpdatedAt: assessment?.statusUpdatedAt ?? null,
        statusUpdatedByName: sanitizeString(assessment?.statusUpdatedByName),
        paymentReference,
        qrValue: buildPaymentQrValue({
          paymentReference,
          applicationId: applicationRefId,
          permitType: permitName,
          departmentName,
          items,
          totalAmount,
          paymentStatus,
          generatedAt,
        }),
        items,
      };
    }),
    generatedPermit: mapGeneratedDocumentMetadata(
      rawApplication?.generatedPermit,
    ),
    generatedInspectionCertificate: mapGeneratedDocumentMetadata(
      rawApplication?.generatedInspectionCertificate,
    ),
  };
};

// Collect the generated permit and inspection documents for an owner.
export const getOwnerGeneratedDocumentsS = async (applicantId: string) => {
  if (!Types.ObjectId.isValid(applicantId)) return [];

  const statuses = await OwnerApplicationStatus.find({
    applicant: new Types.ObjectId(applicantId),
    deletedAt: null,
  })
    .populate("permit", "name")
    .populate("application", OWNER_STATUS_DETAIL_APPLICATION_SELECT)
    .sort({ createdAt: -1 })
    .lean();

  const latestStatusByApplication = new Map<string, any>();
  for (const status of statuses) {
    const applicationRefId = String(
      (status.application as any)?._id ?? status.application,
    );
    if (!applicationRefId) continue;
    if (!latestStatusByApplication.has(applicationRefId)) {
      latestStatusByApplication.set(applicationRefId, status);
    }
  }

  const documents = [...latestStatusByApplication.values()].flatMap(
    (status) => {
      const permitType =
        sanitizeString((status.permit as any)?.name) ||
        sanitizeString(status.permitName) ||
        "Unknown Permit";
      const rawApplication = status.application as any;
      const applicationRefId = String(
        rawApplication?._id ?? status.application,
      );
      const statusId = String(status._id);

      const permitDocument = buildOwnerGeneratedDocumentSummary({
        statusId,
        applicationRefId,
        permitType,
        documentKind: "permit",
        document: rawApplication?.generatedPermit,
      });
      const inspectionCertificate = buildOwnerGeneratedDocumentSummary({
        statusId,
        applicationRefId,
        permitType,
        documentKind: "inspection_certificate",
        document: rawApplication?.generatedInspectionCertificate,
      });

      return [permitDocument, inspectionCertificate].filter(Boolean);
    },
  );

  return documents.sort((left: any, right: any) => {
    const leftTime = left?.generatedAt
      ? new Date(left.generatedAt).getTime()
      : 0;
    const rightTime = right?.generatedAt
      ? new Date(right.generatedAt).getTime()
      : 0;
    return rightTime - leftTime;
  });
};

// Load the generated PDF buffer for the requested owner document.
export const getOwnerGeneratedDocumentPdfS = async (params: {
  applicationId: string;
  applicantId: string;
  documentKind: OwnerGeneratedDocumentKind;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.applicantId)) return null;

  const status = await OwnerApplicationStatus.findById(params.applicationId)
    .select("application applicant deletedAt")
    .lean();

  if (!status) return null;
  if (String(status.applicant) !== params.applicantId) return null;
  if ((status as any).deletedAt) return null;

  const application = await PermitApplication.findById(status.application)
    .select(
      params.documentKind === "permit"
        ? "generatedPermit"
        : "generatedInspectionCertificate",
    )
    .lean();

  if (!application) return null;

  const document = getGeneratedDocumentRecord({
    application,
    documentKind: params.documentKind,
  });
  const watermarkedContentBase64 = sanitizeString(
    document?.file?.pdf?.watermarkedContentBase64,
  );

  if (!watermarkedContentBase64) return null;

  return {
    fileName: sanitizePdfFileName(
      document?.file?.fileName,
      params.documentKind === "permit"
        ? "business-permit.pdf"
        : "inspection-certificate.pdf",
    ),
    mimeType:
      sanitizeString(document?.file?.pdf?.mimeType) || "application/pdf",
    generatedAt: document?.file?.pdf?.generatedAt ?? null,
    buffer: Buffer.from(watermarkedContentBase64, "base64"),
  };
};

// Count unread application notifications for the owner badge.
export const getOwnerUnreadApplicationCountS = async (applicantId: string) => {
  const applications = await getOwnerApplicationStatusesS(applicantId);

  return applications.reduce(
    (total, application) => total + Number(application.unreadCount ?? 0),
    0,
  );
};

// Mark a single notification as read after the owner opens it.
export const markOwnerApplicationStatusAsReadS = async (params: {
  applicationId: string;
  applicantId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.applicantId)) return null;

  const status = await OwnerApplicationStatus.findById(params.applicationId);

  if (!status) return null;
  if (String(status.applicant) !== params.applicantId) return null;
  if (status.deletedAt) return null;

  status.isRead = true;
  await status.save();

  return {
    _id: String(status._id),
    readAt: status.updatedAt,
  };
};

// Mark every visible owner notification as read in one update.
export const markAllOwnerApplicationStatusesAsReadS = async (params: {
  applicantId: string;
  scope?: OwnerNotificationScope;
}) => {
  if (!Types.ObjectId.isValid(params.applicantId)) {
    return { modifiedCount: 0 };
  }

  const now = new Date();
  const result = await OwnerApplicationStatus.updateMany(
    {
      applicant: new Types.ObjectId(params.applicantId),
      deletedAt: null,
      isRead: false,
      ...buildOwnerNotificationScopeFilter(params.scope),
    },
    { $set: { isRead: true } },
  );

  return {
    modifiedCount: result.modifiedCount ?? 0,
    readAt: now,
    scope: params.scope ?? "all",
  };
};
