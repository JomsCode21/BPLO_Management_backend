import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import InspectionProcess from "@/models/process/process.model";
import { ensureAdminFeeAssessmentOnApplicationS } from "@/services/payment/admin-fee-template-application.service";
import { EvaluatorDecisionType } from "@/types/models/permit-application.type";
import { runInTransaction } from "@/utils/db/transaction.util";
import { Types } from "mongoose";

const DEFAULT_PROCESS_KEY = "inspection_process";
const BUSINESS_NAME_CANDIDATES = [
  "business name",
  "trade name",
  "establishment name",
];

const normalizeText = (value: unknown) => String(value ?? "").trim();
const normalizeTextForComparison = (value: unknown) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const normalizeBusinessNameForComparison = (value: unknown) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

const extractResponseTextValue = (value: unknown) => {
  if (Array.isArray(value)) return normalizeText(value[0]);
  return normalizeText(value);
};

const isBusinessNameResponseField = (response: {
  fieldId?: unknown;
  label?: unknown;
}) => {
  const normalizedFieldId = normalizeTextForComparison(response.fieldId);
  const normalizedLabel = normalizeTextForComparison(response.label);

  return BUSINESS_NAME_CANDIDATES.some(
    (candidate) =>
      normalizedFieldId === candidate ||
      normalizedFieldId.endsWith(candidate) ||
      normalizedFieldId.includes(candidate) ||
      normalizedLabel.includes(candidate),
  );
};

const extractBusinessNameFromResponses = (responses: any[]) => {
  if (!Array.isArray(responses)) return "";

  for (const response of responses) {
    if (normalizeTextForComparison(response?.type) === "file") continue;
    if (!isBusinessNameResponseField(response ?? {})) continue;

    const businessName = extractResponseTextValue(response?.value);
    if (businessName) return businessName;
  }

  return "";
};

const buildBusinessRegistrationHistory = async (params: {
  application: any;
  limit?: number;
}) => {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 10), 30));
  const applicantId = String(params.application?.applicant?._id ?? "");
  const businessName = extractBusinessNameFromResponses(
    params.application?.responses ?? [],
  );

  if (!Types.ObjectId.isValid(applicantId) || !businessName) {
    return null;
  }

  const normalizedBusinessName = normalizeBusinessNameForComparison(businessName);
  if (!normalizedBusinessName) return null;

  const applications = await PermitApplication.find({
    applicant: new Types.ObjectId(applicantId),
  })
    .select(
      [
        "_id",
        "permit",
        "permitName",
        "responses",
        "tableStatus",
        "currentStage",
        "evaluatorResult.decision",
        "adminResult.decision",
        "adminResult.decidedAt",
        "submittedAt",
      ].join(" "),
    )
    .populate("permit", "name")
    .sort({ submittedAt: -1 })
    .allowDiskUse(true)
    .lean();

  const filtered = applications.filter((application) => {
    const candidateBusinessName = extractBusinessNameFromResponses(
      application.responses ?? [],
    );

    return (
      candidateBusinessName &&
      normalizeBusinessNameForComparison(candidateBusinessName) ===
        normalizedBusinessName
    );
  });

  const approvedRecords = filtered.filter(
    (application) => normalizeText(application.adminResult?.decision) === "approved",
  );
  const deniedRecords = filtered.filter(
    (application) => normalizeText(application.adminResult?.decision) === "denied",
  );
  const resubmissionRecords = filtered.filter(
    (application) =>
      application.tableStatus === "re_submission" ||
      normalizeText(application.evaluatorResult?.decision) === "re_submission",
  );

  const latestApprovedRecord = approvedRecords
    .filter((application) => Boolean(application.adminResult?.decidedAt))
    .sort(
      (left, right) =>
        new Date(String(right.adminResult?.decidedAt ?? "")).getTime() -
        new Date(String(left.adminResult?.decidedAt ?? "")).getTime(),
    )[0];

  const currentApplicationId = String(params.application?._id ?? "");
  const recentApplications = filtered.slice(0, limit).map((application) => {
    const permitName =
      normalizeText((application.permit as any)?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";

    return {
      applicationId: String(application._id),
      permitType: permitName,
      tableStatus:
        application.tableStatus === "re_submission"
          ? "re_submission"
          : "for_review",
      currentStage: normalizeText(application.currentStage),
      evaluatorDecision: normalizeText(application.evaluatorResult?.decision),
      adminDecision: normalizeText(application.adminResult?.decision),
      submittedAt: application.submittedAt,
      isCurrent: String(application._id) === currentApplicationId,
    };
  });

  return {
    businessName,
    normalizedBusinessName,
    totalApplicationsForApplicantAndBusiness: filtered.length,
    attemptCount: filtered.length,
    successfulCount: approvedRecords.length,
    approvedCount: approvedRecords.length,
    deniedFinalCount: deniedRecords.length,
    deniedCount: deniedRecords.length,
    reSubmissionCount: resubmissionRecords.length,
    lastApprovedAt: latestApprovedRecord?.adminResult?.decidedAt ?? null,
    recentApplications,
  };
};

const formatCurrency = (value: number) =>
  `PHP ${Number(value ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const buildPaymentReadyRemark = (assessments: any[] | undefined) => {
  const normalized = Array.isArray(assessments) ? assessments : [];
  const totalAmount = normalized.reduce(
    (sum, assessment) => sum + Number(assessment?.totalAmount ?? 0),
    0,
  );
  const departmentCount = normalized.length;

  return `Your combined payment QR is now ready. Total due: ${formatCurrency(
    totalAmount,
  )}. Pay at the main treasurer before BPLO admin approval. Included departments: ${departmentCount}.`;
};

const buildPaymentBreakdownRemark = (assessments: any[] | undefined) => {
  const normalized = Array.isArray(assessments) ? assessments : [];
  const totalAmount = normalized.reduce(
    (sum, assessment) => sum + Number(assessment?.totalAmount ?? 0),
    0,
  );

  return `Your payment breakdown is ready. Current total due: ${formatCurrency(
    totalAmount,
  )}. Open this update to review fee details before payment.`;
};

const buildPaymentAssessmentSnapshot = (assessments: any[] | undefined) =>
  (assessments ?? []).map((assessment) => ({
    departmentId: normalizeText(assessment?.departmentId),
    departmentName: normalizeText(assessment?.departmentName),
    generatedAt: assessment?.generatedAt ?? null,
    items: Array.isArray(assessment?.items)
      ? assessment.items.map((item: any) => ({
          feeName: normalizeText(item?.feeName),
          amount: Number(item?.amount ?? 0),
        }))
      : [],
    totalAmount: Number(assessment?.totalAmount ?? 0),
    paymentStatus:
      normalizeText(assessment?.paymentStatus) === "paid" ? "paid" : "pending",
    statusUpdatedAt: assessment?.statusUpdatedAt ?? null,
    statusUpdatedByName: normalizeText(assessment?.statusUpdatedByName),
  }));

const buildApplicantName = (applicant: any) => {
  if (!applicant) return "Unknown Applicant";

  const parts = [applicant.firstName, applicant.middleName, applicant.lastName]
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const suffix = normalizeText(applicant.suffix);
  const fullName = suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
  return fullName || "Unknown Applicant";
};

const buildAccountName = (account: any) => {
  if (!account) return "";

  const parts = [account.firstName, account.middleName, account.lastName]
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const suffix = normalizeText(account.suffix);
  return suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
};

const getPaymentStatusSummary = (application: any) => {
  const paymentAssessments = Array.isArray(application?.paymentAssessments)
    ? application.paymentAssessments
    : [];
  const totalAssessments = paymentAssessments.length;
  const unpaidAssessments = paymentAssessments.filter(
    (assessment: any) => normalizeText(assessment?.paymentStatus) !== "paid",
  );
  const unpaidCount = unpaidAssessments.length;
  const isPaymentSettled = totalAssessments > 0 && unpaidCount === 0;

  return {
    totalAssessments,
    unpaidCount,
    isPaymentSettled,
  };
};

const resolveInspectionWhereNow = (application: any) => {
  const currentStage = normalizeText(application?.currentStage);
  const evaluatorDecision = normalizeText(application?.evaluatorResult?.decision);
  const steps = Array.isArray(application?.inspectionFlow?.steps)
    ? application.inspectionFlow.steps
    : [];
  const totalDepartments = steps.length;
  const completedDepartments = steps.filter((step: any) => !!step?.completedAt).length;
  const currentStepIndex = Number(application?.inspectionFlow?.currentStepIndex ?? 0);
  const currentStep = steps[currentStepIndex];
  const currentDepartment = normalizeText(currentStep?.processName);
  const { totalAssessments, unpaidCount, isPaymentSettled } =
    getPaymentStatusSummary(application);

  if (
    currentStage === "admin_permit_approval" &&
    evaluatorDecision === "for_admin_approval"
  ) {
    return "Queued for BPLO admin approval";
  }
  if (totalDepartments > 0 && completedDepartments >= totalDepartments) {
    if (totalAssessments === 0 || unpaidCount > 0) {
      return "Waiting for owner payment";
    }
    if (isPaymentSettled) {
      return "Payment received. Ready for evaluator submission";
    }
  }
  if (currentStage === "inspector_inspection_request" && currentDepartment) {
    return `Under ${currentDepartment} inspection`;
  }
  if (currentStage === "admin_inspection_request") {
    return "Waiting for inspection routing review";
  }
  if (currentDepartment) return `Under ${currentDepartment} inspection`;

  return "Pending inspection update";
};

const mapInspectionSummary = (application: any) => {
  const steps = Array.isArray(application?.inspectionFlow?.steps)
    ? application.inspectionFlow.steps
    : [];
  const currentStage = normalizeText(application?.currentStage);

  const totalDepartments = steps.length;
  const completedDepartments = steps.filter((step: any) => !!step?.completedAt).length;
  const hasReinspection = steps.some(
    (step: any) => !!step?.reassessmentRequestedAt && !step?.completedAt,
  );
  const whereNow = resolveInspectionWhereNow(application);
  const evaluatorDecision = normalizeText(application?.evaluatorResult?.decision);
  const { isPaymentSettled } = getPaymentStatusSummary(application);
  const isDone =
    totalDepartments > 0 &&
    completedDepartments >= totalDepartments &&
    !(
      currentStage === "admin_permit_approval" &&
      evaluatorDecision === "for_admin_approval"
    );

  const statusLabel = hasReinspection
    ? "For Reinspection"
    : currentStage === "admin_permit_approval" &&
        evaluatorDecision === "for_admin_approval"
      ? "For Admin Approval"
    : isDone
      ? "Done"
      : `${completedDepartments}/${Math.max(totalDepartments, 0)}`;

  return {
    statusLabel,
    completedDepartments,
    totalDepartments,
    hasReinspection,
    whereNow,
    isPaymentSettled,
    waitingForPayment:
      !hasReinspection &&
      totalDepartments > 0 &&
      completedDepartments >= totalDepartments &&
      !isPaymentSettled &&
      evaluatorDecision !== "for_admin_approval",
    canSubmitForAdminApproval:
      !hasReinspection &&
      totalDepartments > 0 &&
      completedDepartments >= totalDepartments &&
      isPaymentSettled &&
      evaluatorDecision !== "for_admin_approval",
  };
};

const mapInspectionSteps = (application: any) => {
  const steps = Array.isArray(application?.inspectionFlow?.steps)
    ? application.inspectionFlow.steps
    : [];
  const currentStepIndex = Number(application?.inspectionFlow?.currentStepIndex ?? 0);

  return [...steps]
    .sort((a: any, b: any) => Number(a?.sequence ?? 0) - Number(b?.sequence ?? 0))
    .map((step: any, index: number) => {
      const isDone = !!step?.completedAt;
      const hasReinspection = !!step?.reassessmentRequestedAt && !isDone;
      const scheduleStatus = normalizeText(step?.scheduleStatus || "unscheduled");
      const status = hasReinspection
        ? "for_reinspection"
        : isDone
          ? "done"
          : index === currentStepIndex
            ? "in_progress"
            : scheduleStatus === "rescheduled"
              ? "rescheduled"
              : scheduleStatus === "scheduled"
                ? "scheduled"
                : "pending";

      return {
        processId: normalizeText(step?.processId),
        processName: normalizeText(step?.processName),
        sequence: Number(step?.sequence ?? index + 1),
        status,
        isDone,
        hasReinspection,
        inspectionDate: step?.assessedScheduleAt ?? step?.scheduledInspectionAt ?? null,
        completedAt: step?.completedAt ?? null,
        assignedInspectorName: normalizeText(step?.assignedInspectorName),
        completionRemark: normalizeText(step?.completionRemark),
      };
    });
};

export const getEvaluatorApplicationsS = async () => {
  const applications = await PermitApplication.find({
    $or: [
      { currentStage: "evaluator_application_request" },
      {
        currentStage: { $exists: false },
        "evaluatorResult.decision": { $exists: false },
      },
    ],
  })
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({ submittedAt: -1 })
    .lean();

  return applications.map((application) => {
    const permitName =
      normalizeText((application.permit as any)?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";

    return {
      _id: String(application._id),
      applicantName: buildApplicantName(application.applicant),
      permitType: permitName,
      tableStatus:
        application.tableStatus === "re_submission"
          ? "re_submission"
          : "for_review",
      submittedAt: application.submittedAt,
      evaluatorResult: application.evaluatorResult ?? null,
    };
  });
};

export const getEvaluatorApplicationByIdS = async (applicationId: string) => {
  if (!Types.ObjectId.isValid(applicationId)) return null;

  const application = await PermitApplication.findOne({
    _id: applicationId,
    $or: [
      { currentStage: "evaluator_application_request" },
      {
        currentStage: { $exists: false },
        "evaluatorResult.decision": { $exists: false },
      },
    ],
  })
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate("permit", "name sections fields")
    .lean();

  if (!application) return null;

  const permitName =
    normalizeText((application.permit as any)?.name) ||
    normalizeText(application.permitName) ||
    "Unknown Permit";
  const businessRegistrationHistory = await buildBusinessRegistrationHistory({
    application,
  });

  return {
    ...application,
    _id: String(application._id),
    permitType: permitName,
    applicantName: buildApplicantName(application.applicant),
    tableStatus:
      application.tableStatus === "re_submission"
        ? "re_submission"
        : "for_review",
    businessRegistrationHistory,
  };
};

export const getInspectionProcessForEvaluatorS = async () => {
  const process = await InspectionProcess.findOne({
    key: DEFAULT_PROCESS_KEY,
  }).lean();
  if (process) return process;

  const created = await InspectionProcess.create({
    key: DEFAULT_PROCESS_KEY,
    name: "Inspection Process",
    departments: [],
  });

  return created.toObject();
};

export const getEvaluatorInspectionReviewApplicationsS = async () => {
  const applications = await PermitApplication.find({
    "evaluatorResult.decision": "for_inspection",
    currentStage: {
      $in: [
        "admin_inspection_request",
        "inspector_inspection_request",
        "admin_permit_approval",
      ],
    },
  })
    .select(
      [
        "_id",
        "applicant",
        "permit",
        "permitName",
        "submittedAt",
        "updatedAt",
        "currentStage",
        "inspectionFlow",
        "paymentAssessments.paymentStatus",
        "evaluatorResult.decision",
      ].join(" "),
    )
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({ updatedAt: -1, submittedAt: -1 })
    .lean();

  return applications.map((application) => {
    const permitName =
      normalizeText((application.permit as any)?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";
    const inspectionReview = mapInspectionSummary(application);

    return {
      _id: String(application._id),
      applicantName: buildApplicantName(application.applicant),
      permitType: permitName,
      submittedAt: application.submittedAt,
      inspectionReview,
    };
  });
};

export const getEvaluatorInspectionReviewByIdS = async (applicationId: string) => {
  if (!Types.ObjectId.isValid(applicationId)) return null;

  const application = await PermitApplication.findOne({
    _id: applicationId,
    "evaluatorResult.decision": "for_inspection",
    currentStage: {
      $in: [
        "admin_inspection_request",
        "inspector_inspection_request",
        "admin_permit_approval",
      ],
    },
  })
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate("permit", "name sections fields")
    .populate("evaluatorResult.evaluator", "firstName middleName lastName suffix")
    .lean();

  if (!application) return null;

  const permitName =
    normalizeText((application.permit as any)?.name) ||
    normalizeText(application.permitName) ||
    "Unknown Permit";
  const evaluatorName = buildAccountName((application as any)?.evaluatorResult?.evaluator);
  const inspectionReview = mapInspectionSummary(application);

  return {
    ...application,
    _id: String(application._id),
    permitType: permitName,
    applicantName: buildApplicantName(application.applicant),
    tableStatus:
      application.tableStatus === "re_submission"
        ? "re_submission"
        : "for_review",
    inspectionReview: {
      ...inspectionReview,
      evaluatorName: evaluatorName || "Unknown Evaluator",
      currentStage: normalizeText(application.currentStage),
      steps: mapInspectionSteps(application),
    },
  };
};

export const submitInspectionReviewForAdminApprovalS = async (params: {
  applicationId: string;
  evaluatorId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(params.applicationId).session(
      session,
    );
    if (!application) return null;

    if (application.evaluatorResult?.decision !== "for_inspection") {
      throw new Error("Only inspection-reviewed applications can be submitted.");
    }

    const steps = Array.isArray(application.inspectionFlow?.steps)
      ? application.inspectionFlow.steps
      : [];
    const total = steps.length;
    const completed = steps.filter((step: any) => !!step?.completedAt).length;
    const hasReinspection = steps.some(
      (step: any) => !!step?.reassessmentRequestedAt && !step?.completedAt,
    );

    if (hasReinspection) {
      throw new Error(
        "Application is marked for reinspection and cannot be submitted yet.",
      );
    }

    if (total <= 0 || completed < total) {
      throw new Error("Complete all inspection departments before submitting.");
    }

    const paymentAssessments = Array.isArray(application.paymentAssessments)
      ? application.paymentAssessments
      : [];
    if (paymentAssessments.length === 0) {
      throw new Error(
        "Generate the combined owner payment first before submitting to BPLO admin.",
      );
    }

    const hasUnpaidAssessment = paymentAssessments.some(
      (assessment: any) => normalizeText(assessment?.paymentStatus) !== "paid",
    );
    if (hasUnpaidAssessment) {
      throw new Error(
        "Wait for the owner payment to be recorded by the main treasurer before submitting to BPLO admin.",
      );
    }

    if (application.currentStage !== "admin_permit_approval") {
      application.currentStage = "admin_permit_approval";
      application.destinationModule = "admin_permit_approval";
    }

    application.status = "in_review";
    application.evaluatorResult = {
      ...(application.evaluatorResult as any),
      evaluator: new Types.ObjectId(params.evaluatorId),
      decision: "for_admin_approval",
      decidedAt: new Date(),
    };
    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "evaluator";

    const saved = await application.save({ session });

    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "for_admin_approval",
          statusSource: "evaluator",
        },
      ],
      { session },
    );

    return saved.toObject();
  });
};

export const saveApplicationEvaluationS = async (params: {
  applicationId: string;
  evaluatorId: string;
  decision: EvaluatorDecisionType;
  notRequiredProcessIds: string[];
  remark?: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  const process = await getInspectionProcessForEvaluatorS();
  const processList = [...(process.departments ?? [])].sort(
    (a, b) => a.sequence - b.sequence,
  );

  const processMap = new Set(processList.map((item) => item.id));
  const invalidNotRequired = params.notRequiredProcessIds.find(
    (processId) => !processMap.has(processId),
  );

  if (invalidNotRequired) {
    throw new Error("One or more selected process IDs are invalid.");
  }

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(params.applicationId).session(
      session,
    );
    if (!application) return null;
    if (
      application.currentStage &&
      application.currentStage !== "evaluator_application_request"
    ) {
      return null;
    }

    application.tableStatus =
      params.decision === "re_submission" ? "re_submission" : "for_review";
    application.status = "in_review";

    if (params.decision === "for_admin_approval") {
      application.currentStage = "admin_permit_approval";
      application.destinationModule = "admin_permit_approval";
    } else if (params.decision === "for_inspection") {
      application.currentStage = "admin_inspection_request";
      application.destinationModule = "admin_inspection_request";
    } else {
      application.currentStage = "business_owner_application_status";
      application.destinationModule = "business_owner_application_status";
    }

    application.evaluatorResult = {
      evaluator: new Types.ObjectId(params.evaluatorId),
      decision: params.decision,
      processDecisions:
        params.decision === "for_inspection"
          ? processList.map((department) => ({
              processId: department.id,
              processName: department.name,
              sequence: department.sequence,
              notRequired: params.notRequiredProcessIds.includes(department.id),
            }))
          : [],
      remark:
        params.decision === "re_submission" ? normalizeText(params.remark) : "",
      decidedAt: new Date(),
    };
    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "evaluator";

    const saved = await application.save({ session });

    const ownerStatuses: any[] = [
      {
        permit: application.permit,
        application: application._id,
        applicant: application.applicant,
        permitName: application.permitName,
        status: params.decision,
        statusSource: "evaluator",
        evaluatorRemark:
          params.decision === "re_submission"
            ? normalizeText(params.remark)
            : "",
      },
    ];

    if (params.decision === "for_admin_approval") {
      const paymentReady =
        await ensureAdminFeeAssessmentOnApplicationS({
          applicationId: String(application._id),
          session,
        });

      const paymentAssessments = Array.isArray(
        (paymentReady as any)?.paymentAssessments,
      )
        ? (paymentReady as any).paymentAssessments
        : [];

      if (paymentAssessments.length > 0) {
        ownerStatuses.push({
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "payment_breakdown",
          statusSource: "system",
          adminRemark: buildPaymentBreakdownRemark(paymentAssessments),
          paymentAssessmentSnapshot: buildPaymentAssessmentSnapshot(
            paymentAssessments,
          ),
        });
        ownerStatuses.push({
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "payment_pending",
          statusSource: "system",
          adminRemark: buildPaymentReadyRemark(paymentAssessments),
          paymentAssessmentSnapshot: buildPaymentAssessmentSnapshot(
            paymentAssessments,
          ),
        });
      }
    }

    await OwnerApplicationStatus.create(ownerStatuses, { session });

    if (params.decision === "for_admin_approval") {
      const refreshed = await PermitApplication.findById(application._id)
        .session(session)
        .lean();
      return refreshed ?? saved.toObject();
    }

    return saved.toObject();
  });
};

export const getEvaluatorDashboardS = async () => {
  const evaluatorRequestFilter = {
    $or: [
      { currentStage: "evaluator_application_request" },
      {
        currentStage: { $exists: false },
        "evaluatorResult.decision": { $exists: false },
      },
    ],
  };

  const applicationRequestsPromise =
    PermitApplication.countDocuments(evaluatorRequestFilter);
  const reSubmissionRequestsPromise = PermitApplication.countDocuments({
    ...evaluatorRequestFilter,
    tableStatus: "re_submission",
  });

  const inspectionApplicationsPromise = PermitApplication.find({
    "evaluatorResult.decision": "for_inspection",
    currentStage: {
      $in: [
        "admin_inspection_request",
        "inspector_inspection_request",
        "admin_permit_approval",
      ],
    },
  })
    .select("inspectionFlow currentStage submittedAt updatedAt")
    .lean();

  const processPromise = getInspectionProcessForEvaluatorS();

  const [
    applicationRequests,
    reSubmissionRequests,
    inspectionApplications,
    process,
  ] =
    await Promise.all([
      applicationRequestsPromise,
      reSubmissionRequestsPromise,
      inspectionApplicationsPromise,
      processPromise,
    ]);

  const queueMap = new Map<
    string,
    {
      departmentId: string;
      departmentName: string;
      queue: number;
      overdueQueue: number;
    }
  >();
  const queueAgeMap = new Map<
    string,
    {
      totalAgeDays: number;
      count: number;
      maxAgeDays: number;
    }
  >();

  const processDepartments = [...(process.departments ?? [])].sort(
    (a, b) => a.sequence - b.sequence,
  );
  for (const department of processDepartments) {
    const departmentId = normalizeText(department.id);
    const departmentName = normalizeText(department.name) || "Unknown Department";
    if (!departmentId) continue;
    queueMap.set(departmentId, {
      departmentId,
      departmentName,
      queue: 0,
      overdueQueue: 0,
    });
  }

  let ongoingInspections = 0;
  let completeInspections = 0;
  let waitingInspectionRouting = 0;
  let underDepartmentInspection = 0;
  let waitingForPayment = 0;
  let readyForEvaluatorSubmission = 0;
  let forAdminApproval = 0;
  let forReinspection = 0;
  const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
  const nowTime = Date.now();
  let totalQueueAgeDays = 0;
  let totalQueuedApplications = 0;
  let oldestQueueAgeDays = 0;

  for (const application of inspectionApplications) {
    const steps = Array.isArray(application?.inspectionFlow?.steps)
      ? application.inspectionFlow.steps
      : [];
    const currentStage = normalizeText(application?.currentStage);
    const totalDepartments = steps.length;
    const completedDepartments = steps.filter(
      (step: any) => !!step?.completedAt,
    ).length;
    const hasReinspection = steps.some(
      (step: any) => !!step?.reassessmentRequestedAt && !step?.completedAt,
    );
    const evaluatorDecision = normalizeText(application?.evaluatorResult?.decision);
    const isComplete =
      totalDepartments > 0 && completedDepartments >= totalDepartments;
    const { isPaymentSettled } = getPaymentStatusSummary(application);

    if (currentStage === "admin_inspection_request") {
      waitingInspectionRouting += 1;
    } else if (
      currentStage === "admin_permit_approval" &&
      evaluatorDecision === "for_admin_approval"
    ) {
      forAdminApproval += 1;
    } else if (hasReinspection) {
      forReinspection += 1;
    } else if (isComplete) {
      if (isPaymentSettled) {
        readyForEvaluatorSubmission += 1;
      } else {
        waitingForPayment += 1;
      }
    } else {
      underDepartmentInspection += 1;
    }

    if (isComplete) {
      completeInspections += 1;
      continue;
    }

    ongoingInspections += 1;

    const currentStepIndex = Number(
      application?.inspectionFlow?.currentStepIndex ?? 0,
    );
    const currentStep = steps[currentStepIndex];
    if (!currentStep || currentStep.completedAt) continue;

    const departmentId = normalizeText(currentStep.processId);
    const departmentName =
      normalizeText(currentStep.processName) || "Unknown Department";
    if (!departmentId) continue;

    if (!queueMap.has(departmentId)) {
      queueMap.set(departmentId, {
        departmentId,
        departmentName,
        queue: 0,
        overdueQueue: 0,
      });
    }

    const existing = queueMap.get(departmentId);
    if (existing) {
      existing.queue += 1;

      const queueStartRaw =
        currentStep.assignedAt ?? application.updatedAt ?? application.submittedAt;
      const queueStart = new Date(String(queueStartRaw ?? ""));
      if (!Number.isNaN(queueStart.getTime())) {
        const queueAgeMs = nowTime - queueStart.getTime();
        const queueAgeDays = queueAgeMs / (24 * 60 * 60 * 1000);

        totalQueueAgeDays += queueAgeDays;
        totalQueuedApplications += 1;
        oldestQueueAgeDays = Math.max(oldestQueueAgeDays, queueAgeDays);

        const existingAge = queueAgeMap.get(departmentId) ?? {
          totalAgeDays: 0,
          count: 0,
          maxAgeDays: 0,
        };
        existingAge.totalAgeDays += queueAgeDays;
        existingAge.count += 1;
        existingAge.maxAgeDays = Math.max(existingAge.maxAgeDays, queueAgeDays);
        queueAgeMap.set(departmentId, existingAge);

        if (queueAgeMs >= oneWeekMs) {
          existing.overdueQueue += 1;
        }
      }
    }
  }

  const departmentInspectionQueue = Array.from(queueMap.values())
    .map((item) => {
      const queueAge = queueAgeMap.get(item.departmentId);
      return {
        ...item,
        averageQueueAgeDays:
          queueAge && queueAge.count > 0
            ? Number((queueAge.totalAgeDays / queueAge.count).toFixed(1))
            : null,
        oldestQueueAgeDays:
          queueAge && queueAge.count > 0
            ? Number(queueAge.maxAgeDays.toFixed(1))
            : null,
      };
    })
    .sort((a, b) => {
      if (b.queue !== a.queue) return b.queue - a.queue;
      return a.departmentName.localeCompare(b.departmentName);
    });

  const departmentsInQueue = departmentInspectionQueue.filter(
    (item) => item.queue > 0,
  ).length;
  const departmentsWithOverdueQueue = departmentInspectionQueue.filter(
    (item) => item.overdueQueue > 0,
  ).length;
  const overdueQueueItems = departmentInspectionQueue.reduce(
    (sum, item) => sum + Number(item.overdueQueue ?? 0),
    0,
  );
  const totalQueueItems = departmentInspectionQueue.reduce(
    (sum, item) => sum + Number(item.queue ?? 0),
    0,
  );
  const configuredDepartments = departmentInspectionQueue.length;
  const totalInspectionFlow = ongoingInspections + completeInspections;
  const freshestRequests = Math.max(
    Number(applicationRequests ?? 0) - Number(reSubmissionRequests ?? 0),
    0,
  );
  const busiestDepartment =
    departmentInspectionQueue.find((item) => item.queue > 0) ?? null;
  const averageQueueAgeDays =
    totalQueuedApplications > 0
      ? Number((totalQueueAgeDays / totalQueuedApplications).toFixed(1))
      : null;
  const normalizedOldestQueueAgeDays =
    totalQueuedApplications > 0 ? Number(oldestQueueAgeDays.toFixed(1)) : null;
  const queueHealth =
    overdueQueueItems > 0
      ? "attention"
      : totalQueueItems > 0
        ? "stable"
        : "clear";
  const activeWorkload = Number(applicationRequests ?? 0) + ongoingInspections;
  const workflowPressure =
    overdueQueueItems > 0 || activeWorkload >= 12
      ? "heavy"
      : activeWorkload >= 5
        ? "moderate"
        : "light";

  return {
    applicationRequests: Number(applicationRequests ?? 0),
    ongoingInspections,
    completeInspections,
    departmentInspectionQueue,
    requestBreakdown: {
      forReview: freshestRequests,
      reSubmission: Number(reSubmissionRequests ?? 0),
    },
    inspectionBreakdown: {
      waitingInspectionRouting,
      underDepartmentInspection,
      waitingForPayment,
      readyForEvaluatorSubmission,
      forAdminApproval,
      forReinspection,
    },
    analytics: {
      totalInspectionFlow,
      totalQueueItems,
      overdueQueueItems,
      departmentsInQueue,
      departmentsWithOverdueQueue,
      configuredDepartments,
      busiestDepartment,
      oldestQueueAgeDays: normalizedOldestQueueAgeDays,
      averageQueueAgeDays,
      queueHealth,
      workflowPressure,
    },
    generatedAt: new Date().toISOString(),
  };
};
