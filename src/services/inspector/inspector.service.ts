import Account from "@/models/account/account.model";
import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import {
  InspectionAssessmentResultType,
  InspectionStepType,
  PaymentAssessmentType,
} from "@/types/models/permit-application.type";
import { runInTransaction } from "@/utils/db/transaction.util";
import { ClientSession, Types } from "mongoose";
import { autoGeneratePaymentAssessmentS } from "@/services/department-treasurer/department-treasurer.service";
import { ensureAdminFeeAssessmentOnApplicationS } from "@/services/payment/admin-fee-template-application.service";

const normalizeText = (value: unknown) => String(value ?? "").trim();

const validateInspectionAtNotPast = (inspectionAt: Date) => {
  if (inspectionAt.getTime() < Date.now()) {
    throw new Error("Inspection schedule date/time cannot be in the past.");
  }
};

const buildApplicantName = (applicant: any) => {
  if (!applicant) return "Unknown Applicant";

  const parts = [applicant.firstName, applicant.middleName, applicant.lastName]
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const suffix = normalizeText(applicant.suffix);
  const fullName = suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
  return fullName || "Unknown Applicant";
};

const buildInspectorName = (inspector: any) => {
  if (!inspector) return "";

  const parts = [inspector.firstName, inspector.middleName, inspector.lastName]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const suffix = normalizeText(inspector.suffix);
  return suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
};

const formatCurrency = (value: number) =>
  `PHP ${Number(value ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const buildPaymentBreakdownRemark = (assessment: any) => {
  const departmentName = normalizeText(assessment?.departmentName) || "Department";
  const totalAmount = Number(assessment?.totalAmount ?? 0);

  return `Payment breakdown for ${departmentName} is ready. Department total: ${formatCurrency(
    totalAmount,
  )}. Open this update to view the full fee breakdown.`;
};

const buildPaymentReadyRemark = (
  assessments: PaymentAssessmentType[] | undefined,
) => {
  const normalizedAssessments = Array.isArray(assessments) ? assessments : [];
  const totalAmount = normalizedAssessments.reduce(
    (sum, assessment) => sum + Number(assessment?.totalAmount ?? 0),
    0,
  );
  const departmentCount = normalizedAssessments.length;

  return `All required inspection departments are complete. Your combined payment QR is now ready. Total due: ${formatCurrency(
    totalAmount,
  )}. Pay at the main treasurer before the evaluator forwards this permit to BPLO admin. Included departments: ${departmentCount}.`;
};

const buildPaymentAssessmentSnapshot = (
  assessments: PaymentAssessmentType[] | undefined,
) =>
  (assessments ?? []).map((assessment) => ({
    departmentId: normalizeText(assessment?.departmentId),
    departmentName: normalizeText(assessment?.departmentName),
    generatedAt: assessment?.generatedAt ?? null,
    items: Array.isArray(assessment?.items)
      ? assessment.items.map((item) => ({
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

const pickDepartmentInspector = async (
  departmentId: string,
  session?: ClientSession,
) => {
  const inspectors = (await Account.find({
    role: "inspector",
    departmentId,
  })
    .session(session ?? null)
    .select("_id firstName middleName lastName suffix createdAt")
    .lean()) as Array<any>;

  if (inspectors.length === 0) {
    return { inspectorId: null as Types.ObjectId | null, inspectorName: "" };
  }

  const activeLoads = await PermitApplication.aggregate([
    { $match: { currentStage: "inspector_inspection_request" } },
    { $unwind: "$inspectionFlow.steps" },
    {
      $match: {
        "inspectionFlow.steps.processId": departmentId,
        "inspectionFlow.steps.completedAt": null,
        "inspectionFlow.steps.assignedInspector": { $ne: null },
      },
    },
    {
      $group: {
        _id: "$inspectionFlow.steps.assignedInspector",
        activeCount: { $sum: 1 },
        lastAssignedAt: { $max: "$inspectionFlow.steps.assignedAt" },
      },
    },
  ]).session(session ?? null);

  const loadMap = new Map(
    activeLoads.map((item) => [
      String(item._id),
      {
        activeCount: Number(item.activeCount ?? 0),
        lastAssignedAt: item.lastAssignedAt
          ? new Date(item.lastAssignedAt as string)
          : null,
      },
    ]),
  );

  const ranked = inspectors
    .map((inspector) => {
      const inspectorId = String(inspector._id);
      const load = loadMap.get(inspectorId);
      return {
        inspector,
        activeCount: load?.activeCount ?? 0,
        lastAssignedAt: load?.lastAssignedAt ?? null,
      };
    })
    .sort((a, b) => {
      if (a.activeCount !== b.activeCount) return a.activeCount - b.activeCount;

      const aTime = a.lastAssignedAt?.getTime() ?? 0;
      const bTime = b.lastAssignedAt?.getTime() ?? 0;
      if (aTime !== bTime) return aTime - bTime;

      const aCreated = a.inspector.createdAt
        ? new Date(a.inspector.createdAt).getTime()
        : 0;
      const bCreated = b.inspector.createdAt
        ? new Date(b.inspector.createdAt).getTime()
        : 0;
      if (aCreated !== bCreated) return aCreated - bCreated;

      return String(a.inspector._id).localeCompare(String(b.inspector._id));
    });

  const selected = ranked[0]?.inspector;
  if (!selected) {
    return { inspectorId: null as Types.ObjectId | null, inspectorName: "" };
  }

  return {
    inspectorId: new Types.ObjectId(String(selected._id)),
    inspectorName: buildInspectorName(selected),
  };
};

const assignInspectorToStep = async (
  steps: InspectionStepType[],
  stepIndex: number,
  session?: ClientSession,
) => {
  const nextSteps = [...steps];
  const target = nextSteps[stepIndex];
  if (!target) return nextSteps;

  const selected = await pickDepartmentInspector(target.processId, session);
  target.assignedInspector = selected.inspectorId;
  target.assignedInspectorName = selected.inspectorName;
  target.assignedAt = new Date();
  target.scheduledInspectionAt = null;
  target.scheduleStatus = "unscheduled";
  target.scheduleRemark = "";
  target.scheduleUpdatedAt = null;
  target.assessedScheduleAt = null;
  target.assessmentResult = null;
  target.assessmentRemark = "";
  target.assessmentSubmittedAt = null;
  target.reassessmentRequestedAt = null;
  target.completedAt = null;
  target.completionRemark = "";

  return nextSteps;
};

export const getInspectorInspectionRequestApplicationsS = async (
  inspectorId: string,
) => {
  const applications = await PermitApplication.find({
    currentStage: "inspector_inspection_request",
    "inspectionFlow.steps.assignedInspector": new Types.ObjectId(inspectorId),
  })
    .select(
      "inspectionFlow permitName applicant permit updatedAt submittedAt",
    )
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({ updatedAt: -1, submittedAt: -1 })
    .lean();

  return applications
    .map((application) => {
      const currentStepIndex = Number(
        application.inspectionFlow?.currentStepIndex ?? 0,
      );
      const currentStep = application.inspectionFlow?.steps?.[currentStepIndex];
      if (!currentStep) return null;

      if (String(currentStep.assignedInspector ?? "") !== inspectorId)
        return null;
      if (currentStep.completedAt) return null;
      if (currentStep.scheduledInspectionAt) return null;
      const hasForCompletionResult =
        normalizeText(currentStep.assessmentResult) === "for_completion";
      if (hasForCompletionResult && !currentStep.reassessmentRequestedAt) {
        return null;
      }

      const permitName =
        normalizeText((application.permit as any)?.name) ||
        normalizeText(application.permitName) ||
        "Unknown Permit";

      return {
        _id: String(application._id),
        applicantName: buildApplicantName(application.applicant),
        permitType: permitName,
        currentDepartment: normalizeText(currentStep.processName),
        currentDepartmentId: normalizeText(currentStep.processId),
        currentSequence: Number(currentStep.sequence ?? 0),
        totalDepartments: Number(
          application.inspectionFlow?.steps?.length ?? 0,
        ),
        assignedAt: currentStep.assignedAt ?? application.updatedAt ?? null,
        submittedAt: application.submittedAt,
      };
    })
    .filter(Boolean);
};

export const getInspectorInspectionSchedulesS = async (inspectorId: string) => {
  const applications = await PermitApplication.find({
    currentStage: "inspector_inspection_request",
    "inspectionFlow.steps.assignedInspector": new Types.ObjectId(inspectorId),
  })
    .select(
      "inspectionFlow permitName applicant permit updatedAt submittedAt",
    )
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({ updatedAt: -1, submittedAt: -1 })
    .lean();

  return applications
    .map((application) => {
      const currentStepIndex = Number(
        application.inspectionFlow?.currentStepIndex ?? 0,
      );
      const currentStep = application.inspectionFlow?.steps?.[currentStepIndex];
      if (!currentStep) return null;
      if (String(currentStep.assignedInspector ?? "") !== inspectorId)
        return null;
      if (currentStep.completedAt) return null;
      if (!currentStep.scheduledInspectionAt) return null;
      if (currentStep.assessmentSubmittedAt) return null;

      const permitName =
        normalizeText((application.permit as any)?.name) ||
        normalizeText(application.permitName) ||
        "Unknown Permit";

      return {
        _id: String(application._id),
        applicantName: buildApplicantName(application.applicant),
        permitType: permitName,
        currentDepartment: normalizeText(currentStep.processName),
        currentDepartmentId: normalizeText(currentStep.processId),
        currentSequence: Number(currentStep.sequence ?? 0),
        totalDepartments: Number(application.inspectionFlow?.steps?.length ?? 0),
        scheduledInspectionAt: currentStep.scheduledInspectionAt,
        scheduleStatus: normalizeText(currentStep.scheduleStatus || "scheduled"),
        scheduleRemark: normalizeText(currentStep.scheduleRemark),
        assignedAt: currentStep.assignedAt ?? application.updatedAt ?? null,
        submittedAt: application.submittedAt,
      };
    })
    .filter(Boolean);
};

export const getInspectorPermitReleaseApplicationsS = async (
  inspectorId: string,
) => {
  if (!Types.ObjectId.isValid(inspectorId)) return [];

  const applications = await PermitApplication.find({
    "inspectionFlow.steps.assignedInspector": new Types.ObjectId(inspectorId),
    generatedInspectionCertificate: { $exists: true, $ne: null },
  })
    .select(
      [
        "applicant",
        "permit",
        "permitName",
        "generatedInspectionCertificate.file.generatedAt",
        "generatedInspectionCertificate.sentToApplicantAt",
        "submittedAt",
      ].join(" "),
    )
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({
      "generatedInspectionCertificate.file.generatedAt": -1,
      submittedAt: -1,
    })
    .setOptions({ allowDiskUse: true })
    .lean();

  return applications.map((application) => {
    const permitName =
      normalizeText((application.permit as any)?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";
    const sentToApplicantAt =
      application.generatedInspectionCertificate?.sentToApplicantAt ?? null;

    return {
      _id: String(application._id),
      applicantName: buildApplicantName(application.applicant),
      permitType: permitName,
      generatedAt:
        application.generatedInspectionCertificate?.file?.generatedAt ?? null,
      sentToApplicantAt,
      releaseStatus: sentToApplicantAt ? "sent_to_applicant" : "for_release",
      submittedAt: application.submittedAt,
    };
  });
};

export const getInspectorDashboardS = async (inspectorId: string) => {
  if (!Types.ObjectId.isValid(inspectorId)) {
    return {
      pendingRequests: 0,
      todayInspections: 0,
      upcomingInspections: 0,
      resultBreakdown: {
        passed: 0,
        forCompletion: 0,
        failed: 0,
      },
      monthlyInspections: [] as Array<{
        key: string;
        label: string;
        count: number;
      }>,
      peakMonth: null as { key: string; label: string; count: number } | null,
      analytics: {
        activeSchedules: 0,
        readyAssessments: 0,
        overdueInspections: 0,
        rescheduledInspections: 0,
        averageMonthlyInspections: 0,
        averageTurnaroundDays: null as number | null,
        nextInspectionAt: null as Date | null,
        busiestWeekday: null as { key: string; label: string; count: number } | null,
      },
    };
  }

  const [pendingRequestApplications, scheduled] = await Promise.all([
    getInspectorInspectionRequestApplicationsS(inspectorId),
    getInspectorInspectionSchedulesS(inspectorId),
  ]);
  const pendingRequests = pendingRequestApplications.length;

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const tomorrowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  let todayInspections = 0;
  let upcomingInspections = 0;
  let readyAssessments = 0;
  let overdueInspections = 0;
  let rescheduledInspections = 0;
  let nextInspectionAt: Date | null = null;

  for (const item of scheduled) {
    const scheduleDate = new Date(String(item?.scheduledInspectionAt ?? ""));
    if (Number.isNaN(scheduleDate.getTime())) continue;

    const scheduleTime = scheduleDate.getTime();
    if (scheduleTime >= todayStart.getTime() && scheduleTime < tomorrowStart.getTime()) {
      todayInspections += 1;
    } else if (scheduleTime >= tomorrowStart.getTime()) {
      upcomingInspections += 1;
    }

    if (scheduleTime <= now.getTime()) readyAssessments += 1;
    if (scheduleTime < todayStart.getTime()) overdueInspections += 1;
    if (normalizeText(item?.scheduleStatus) === "rescheduled") {
      rescheduledInspections += 1;
    }

    if (scheduleTime > now.getTime()) {
      if (!nextInspectionAt || scheduleTime < nextInspectionAt.getTime()) {
        nextInspectionAt = scheduleDate;
      }
    }
  }

  const applications = await PermitApplication.find({
    "inspectionFlow.steps.assignedInspector": new Types.ObjectId(inspectorId),
  })
    .select("inspectionFlow.steps")
    .lean();

  const resultBreakdown = {
    passed: 0,
    forCompletion: 0,
    failed: 0,
  };
  const weekdayTemplate = [
    { key: "sun", label: "Sunday", count: 0 },
    { key: "mon", label: "Monday", count: 0 },
    { key: "tue", label: "Tuesday", count: 0 },
    { key: "wed", label: "Wednesday", count: 0 },
    { key: "thu", label: "Thursday", count: 0 },
    { key: "fri", label: "Friday", count: 0 },
    { key: "sat", label: "Saturday", count: 0 },
  ];
  let turnaroundTotalMs = 0;
  let turnaroundCount = 0;

  const monthTemplate = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("en-PH", {
      month: "short",
      year: "numeric",
    }).format(date);
    return { key, label, count: 0 };
  });
  const monthMap = new Map(monthTemplate.map((item) => [item.key, item]));

  for (const application of applications) {
    const steps = application?.inspectionFlow?.steps ?? [];
    for (const step of steps) {
      if (String(step?.assignedInspector ?? "") !== inspectorId) continue;

      const result = normalizeText(step?.assessmentResult);
      if (result === "passed") resultBreakdown.passed += 1;
      if (result === "for_completion") resultBreakdown.forCompletion += 1;
      if (result === "failed") resultBreakdown.failed += 1;

      const measuredAt =
        step?.assessedScheduleAt ?? step?.assessmentSubmittedAt ?? null;
      if (measuredAt) {
        const measuredDate = new Date(measuredAt);

        if (!Number.isNaN(measuredDate.getTime())) {
          const measuredKey = `${measuredDate.getFullYear()}-${String(measuredDate.getMonth() + 1).padStart(2, "0")}`;
          const monthBucket = monthMap.get(measuredKey);
          if (monthBucket) monthBucket.count += 1;

          const weekdayBucket = weekdayTemplate[measuredDate.getDay()];
          if (weekdayBucket) weekdayBucket.count += 1;
        }
      }

      const assignedAt = step?.assignedAt ? new Date(step.assignedAt) : null;
      const assessmentSubmittedAt = step?.assessmentSubmittedAt
        ? new Date(step.assessmentSubmittedAt)
        : null;
      if (
        assignedAt &&
        assessmentSubmittedAt &&
        !Number.isNaN(assignedAt.getTime()) &&
        !Number.isNaN(assessmentSubmittedAt.getTime()) &&
        assessmentSubmittedAt.getTime() >= assignedAt.getTime()
      ) {
        turnaroundTotalMs +=
          assessmentSubmittedAt.getTime() - assignedAt.getTime();
        turnaroundCount += 1;
      }
    }
  }

  const monthlyInspections = monthTemplate.map((item) => ({
    key: item.key,
    label: item.label,
    count: item.count,
  }));

  const peakMonth = monthlyInspections.reduce<{
    key: string;
    label: string;
    count: number;
  } | null>((top, month) => {
    if (!top) return month;
    return month.count > top.count ? month : top;
  }, null);
  const monthlyTotal = monthlyInspections.reduce(
    (sum, month) => sum + month.count,
    0,
  );
  const busiestWeekday = weekdayTemplate.reduce<{
    key: string;
    label: string;
    count: number;
  } | null>((top, day) => {
    if (!top) return day;
    return day.count > top.count ? day : top;
  }, null);
  const averageTurnaroundDays =
    turnaroundCount > 0
      ? Number(
          (
            turnaroundTotalMs /
            turnaroundCount /
            (1000 * 60 * 60 * 24)
          ).toFixed(1),
        )
      : null;

  return {
    pendingRequests,
    todayInspections,
    upcomingInspections,
    resultBreakdown,
    monthlyInspections,
    peakMonth,
    analytics: {
      activeSchedules: scheduled.length,
      readyAssessments,
      overdueInspections,
      rescheduledInspections,
      averageMonthlyInspections: Number((monthlyTotal / 12).toFixed(1)),
      averageTurnaroundDays,
      nextInspectionAt,
      busiestWeekday:
        busiestWeekday && busiestWeekday.count > 0 ? busiestWeekday : null,
    },
  };
};

export const getInspectorRoutedApplicationByIdS = async (params: {
  applicationId: string;
  inspectorId: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.inspectorId)) return null;

  const application = await PermitApplication.findById(params.applicationId)
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate("permit", "name sections fields")
    .lean();

  if (!application) return null;
  if (application.currentStage !== "inspector_inspection_request") return null;

  const currentStepIndex = Number(
    application.inspectionFlow?.currentStepIndex ?? 0,
  );
  const currentStep = application.inspectionFlow?.steps?.[currentStepIndex];
  if (!currentStep) return null;
  if (String(currentStep.assignedInspector ?? "") !== params.inspectorId)
    return null;
  if (currentStep.completedAt) return null;

  const permitName =
    normalizeText((application.permit as any)?.name) ||
    normalizeText(application.permitName) ||
    "Unknown Permit";

  return {
    ...application,
    _id: String(application._id),
    permitType: permitName,
    applicantName: buildApplicantName(application.applicant),
    currentDepartment: normalizeText(currentStep.processName),
    currentDepartmentId: normalizeText(currentStep.processId),
    currentSequence: Number(currentStep.sequence ?? 0),
    totalDepartments: Number(application.inspectionFlow?.steps?.length ?? 0),
    assignedAt: currentStep.assignedAt ?? application.updatedAt ?? null,
    scheduledInspectionAt: currentStep.scheduledInspectionAt ?? null,
    scheduleStatus: normalizeText(currentStep.scheduleStatus || "unscheduled"),
    scheduleRemark: normalizeText(currentStep.scheduleRemark),
  };
};

export const setInspectorInspectionScheduleS = async (params: {
  applicationId: string;
  inspectorId: string;
  inspectionAt: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.inspectorId)) return null;

  const inspectionAt = new Date(params.inspectionAt);
  if (Number.isNaN(inspectionAt.getTime())) {
    throw new Error("Invalid inspection schedule date/time.");
  }
  validateInspectionAtNotPast(inspectionAt);

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(params.applicationId).session(
      session,
    );
    if (!application) return null;
    if (application.currentStage !== "inspector_inspection_request") return null;
    if (!application.inspectionFlow?.steps?.length) return null;

    const currentStepIndex = Number(
      application.inspectionFlow.currentStepIndex ?? 0,
    );
    const currentStep = application.inspectionFlow.steps[currentStepIndex];
    if (!currentStep) return null;
    if (String(currentStep.assignedInspector ?? "") !== params.inspectorId)
      return null;
    if (currentStep.completedAt) return null;
    if (currentStep.scheduledInspectionAt) {
      throw new Error(
        "Inspection schedule already exists. Use schedule update instead.",
      );
    }

    currentStep.scheduledInspectionAt = inspectionAt;
    currentStep.scheduleStatus = "scheduled";
    currentStep.scheduleUpdatedAt = new Date();
    currentStep.scheduleRemark = "";
    currentStep.assessedScheduleAt = null;
    currentStep.assessmentResult = null;
    currentStep.assessmentRemark = "";
    currentStep.assessmentSubmittedAt = null;
    currentStep.reassessmentRequestedAt = null;

    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "inspector";

    const saved = await application.save({ session });

    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "inspection_scheduled",
          statusSource: "inspector",
          inspectionScheduledAt: inspectionAt,
          inspectionRemark: "",
        },
      ],
      { session },
    );

    return saved.toObject();
  });
};

export const updateInspectorInspectionScheduleS = async (params: {
  applicationId: string;
  inspectorId: string;
  inspectionAt: string;
  remark: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.inspectorId)) return null;

  const inspectionAt = new Date(params.inspectionAt);
  if (Number.isNaN(inspectionAt.getTime())) {
    throw new Error("Invalid inspection schedule date/time.");
  }
  validateInspectionAtNotPast(inspectionAt);

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(params.applicationId).session(
      session,
    );
    if (!application) return null;
    if (application.currentStage !== "inspector_inspection_request") return null;
    if (!application.inspectionFlow?.steps?.length) return null;

    const currentStepIndex = Number(
      application.inspectionFlow.currentStepIndex ?? 0,
    );
    const currentStep = application.inspectionFlow.steps[currentStepIndex];
    if (!currentStep) return null;
    if (String(currentStep.assignedInspector ?? "") !== params.inspectorId)
      return null;
    if (currentStep.completedAt) return null;
    if (!currentStep.scheduledInspectionAt) {
      throw new Error("No existing inspection schedule found for this request.");
    }

    currentStep.scheduledInspectionAt = inspectionAt;
    currentStep.scheduleStatus = "rescheduled";
    currentStep.scheduleUpdatedAt = new Date();
    currentStep.scheduleRemark = normalizeText(params.remark);
    currentStep.assessedScheduleAt = null;
    currentStep.assessmentResult = null;
    currentStep.assessmentRemark = "";
    currentStep.assessmentSubmittedAt = null;
    currentStep.reassessmentRequestedAt = null;

    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "inspector";

    const saved = await application.save({ session });

    const ownerRemark = normalizeText(params.remark);
    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "inspection_rescheduled",
          statusSource: "inspector",
          inspectionScheduledAt: inspectionAt,
          inspectionRemark: ownerRemark,
        },
      ],
      { session },
    );

    return saved.toObject();
  });
};

export const completeInspectorInspectionStepS = async (params: {
  applicationId: string;
  inspectorId: string;
  result: InspectionAssessmentResultType;
  completionRemark?: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;
  if (!Types.ObjectId.isValid(params.inspectorId)) return null;

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(params.applicationId).session(
      session,
    );
    if (!application) return null;

    if (application.currentStage !== "inspector_inspection_request") return null;
    if (!application.inspectionFlow?.steps?.length) return null;

    const currentStepIndex = Number(
      application.inspectionFlow.currentStepIndex ?? 0,
    );
    const currentStep = application.inspectionFlow.steps[currentStepIndex];
    if (!currentStep) return null;

    if (String(currentStep.assignedInspector ?? "") !== params.inspectorId)
      return null;
    if (currentStep.completedAt) return null;
    if (!currentStep.scheduledInspectionAt) {
      throw new Error(
        "Inspection schedule is required before submitting an assessment.",
      );
    }
    if (currentStep.assessmentSubmittedAt) {
      throw new Error(
        "Inspection assessment for this schedule is already submitted.",
      );
    }

    const assessmentRemark = normalizeText(params.completionRemark);
    if (
      (params.result === "failed" || params.result === "for_completion") &&
      !assessmentRemark
    ) {
      throw new Error("Remark is required for this assessment result.");
    }

    currentStep.assessedScheduleAt = currentStep.scheduledInspectionAt;
    currentStep.assessmentResult = params.result;
    currentStep.assessmentRemark = assessmentRemark;
    currentStep.assessmentSubmittedAt = new Date();
    currentStep.reassessmentRequestedAt = null;

    if (params.result === "for_completion") {
      currentStep.scheduledInspectionAt = null;
      currentStep.scheduleStatus = "unscheduled";
      currentStep.scheduleRemark = "";
      currentStep.scheduleUpdatedAt = new Date();

      application.currentStage = "inspector_inspection_request";
      application.destinationModule = "inspector_inspection_request";
      application.ownerStatusVersion =
        Number(application.ownerStatusVersion ?? 0) + 1;
      application.ownerStatusSource = "inspector";

      const savedForCompletion = await application.save({ session });

      await OwnerApplicationStatus.create(
        [
          {
            permit: application.permit,
            application: application._id,
            applicant: application.applicant,
            permitName: application.permitName,
            status: "inspection_for_completion",
            statusSource: "inspector",
            inspectionRemark: assessmentRemark,
            inspectionScheduledAt: currentStep.assessedScheduleAt ?? null,
          },
        ],
        { session },
      );

      return savedForCompletion.toObject();
    }

    if (params.result === "failed") {
      currentStep.completedAt = new Date();
      currentStep.completionRemark = assessmentRemark;
      application.status = "rejected";
      application.currentStage = "business_owner_application_status";
      application.destinationModule = "business_owner_application_status";

      application.ownerStatusVersion =
        Number(application.ownerStatusVersion ?? 0) + 1;
      application.ownerStatusSource = "inspector";

      const savedFailed = await application.save({ session });

      await OwnerApplicationStatus.create(
        [
          {
            permit: application.permit,
            application: application._id,
            applicant: application.applicant,
            permitName: application.permitName,
            status: "inspection_failed",
            statusSource: "inspector",
            inspectionRemark: assessmentRemark,
            inspectionScheduledAt: currentStep.assessedScheduleAt ?? null,
          },
        ],
        { session },
      );

      return savedFailed.toObject();
    }

    currentStep.completedAt = new Date();
    currentStep.completionRemark = assessmentRemark;

    const nextStepIndex = currentStepIndex + 1;
    const isFinalInspectionStep =
      nextStepIndex >= application.inspectionFlow.steps.length;

    if (!isFinalInspectionStep) {
      const nextSteps = await assignInspectorToStep(
        application.inspectionFlow.steps as InspectionStepType[],
        nextStepIndex,
        session,
      );
      application.inspectionFlow.steps = nextSteps as any;
      application.inspectionFlow.currentStepIndex = nextStepIndex;
      application.currentStage = "inspector_inspection_request";
      application.destinationModule = "inspector_inspection_request";
    } else {
      application.currentStage = "admin_permit_approval";
      application.destinationModule = "admin_permit_approval";
    }

    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "inspector";

    const saved = await application.save({ session });

    const paymentAssessmentApplication = await autoGeneratePaymentAssessmentS({
      applicationId: String(application._id),
      departmentId: normalizeText(currentStep.processId),
      departmentName: normalizeText(currentStep.processName),
      session,
    });
    const mergedPaymentAssessmentApplication =
      await ensureAdminFeeAssessmentOnApplicationS({
        applicationId: String(application._id),
        session,
      });
    const generatedAssessment = (
      paymentAssessmentApplication as any
    )?.paymentAssessments?.find(
      (assessment: any) =>
        normalizeText(assessment?.departmentId) ===
        normalizeText(currentStep.processId),
    );

    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "inspection_passed",
          statusSource: "inspector",
          inspectionRemark: assessmentRemark,
          inspectionScheduledAt: currentStep.assessedScheduleAt ?? null,
        },
      ],
      { session },
    );

    if (generatedAssessment && !isFinalInspectionStep) {
      await OwnerApplicationStatus.create(
        [
          {
            permit: application.permit,
            application: application._id,
            applicant: application.applicant,
            permitName: application.permitName,
            status: "payment_breakdown",
            statusSource: "system",
            adminRemark: buildPaymentBreakdownRemark(generatedAssessment),
            paymentAssessmentSnapshot: buildPaymentAssessmentSnapshot(
              (mergedPaymentAssessmentApplication as any)?.paymentAssessments ??
                (paymentAssessmentApplication as any)?.paymentAssessments,
            ),
          },
        ],
        { session },
      );
    }

    if (isFinalInspectionStep) {
      await OwnerApplicationStatus.create(
        [
          {
            permit: application.permit,
            application: application._id,
            applicant: application.applicant,
            permitName: application.permitName,
            status: "payment_pending",
            statusSource: "system",
            adminRemark: buildPaymentReadyRemark(
              (mergedPaymentAssessmentApplication as any)?.paymentAssessments ??
                (paymentAssessmentApplication as any)?.paymentAssessments,
            ),
            paymentAssessmentSnapshot: buildPaymentAssessmentSnapshot(
              (mergedPaymentAssessmentApplication as any)?.paymentAssessments ??
                (paymentAssessmentApplication as any)?.paymentAssessments,
            ),
          },
        ],
        { session },
      );
    }

    return saved.toObject();
  });
};
