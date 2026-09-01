import Account from "@/models/account/account.model";
import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import AdminFeeTemplate from "@/models/payment/admin-fee-assessment.model";
import Permit from "@/models/permit/permit.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import PermitTemplate from "@/models/permit_template/permit-template.model";
import InspectionProcess from "@/models/process/process.model";
import {
  AdminDecisionType,
  EvaluatorDecisionType,
  InspectionAdminDecisionType,
  InspectionStepType,
  PaymentAssessmentItemType,
} from "@/types/models/permit-application.type";
import { runInTransaction } from "@/utils/db/transaction.util";
import { ClientSession, Types } from "mongoose";

// Normalize values before comparing and filtering admin data.
const normalizeText = (value: unknown) => String(value ?? "").trim();
const toNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const formatCurrency = (value: number) =>
  `PHP ${Number(value ?? 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
const normalizeResolvedValues = (value: unknown): Record<string, string> => {
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entryValue]) => [
        normalizeText(key),
        normalizeText(entryValue),
      ]),
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        normalizeText(key),
        normalizeText(entryValue),
      ]),
    );
  }

  return {};
};
const ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID = "bplo_admin_assessment";
const ADMIN_FEE_ASSESSMENT_DEPARTMENT_NAME = "BPLO Admin";

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

const buildPaymentAssessmentSnapshot = (assessments: any[] | undefined) =>
  (Array.isArray(assessments) ? assessments : []).map((assessment: any) => ({
    departmentId: normalizeText(assessment?.departmentId),
    departmentName: normalizeText(assessment?.departmentName),
    generatedAt: assessment?.generatedAt ?? null,
    items: Array.isArray(assessment?.items)
      ? assessment.items.map((item: any) => ({
          feeName: normalizeText(item?.feeName),
          amount: toNumber(item?.amount),
        }))
      : [],
    totalAmount: toNumber(assessment?.totalAmount),
    paymentStatus:
      normalizeText(assessment?.paymentStatus) === "paid" ? "paid" : "pending",
    statusUpdatedAt: assessment?.statusUpdatedAt ?? null,
    statusUpdatedByName: normalizeText(assessment?.statusUpdatedByName),
  }));

const normalizeAssessmentItems = (
  items: unknown,
): PaymentAssessmentItemType[] => {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => ({
      feeName: normalizeText((item as any)?.feeName),
      amount: toNumber((item as any)?.amount),
    }))
    .filter((item) => item.feeName && item.amount >= 0);
};

export const getBploAdminFeeAssessmentPermitsS = async () => {
  const permits = await Permit.find({ isActive: true })
    .select("_id name")
    .sort({ name: 1 })
    .lean();

  return permits.map((permit: any) => ({
    permitId: String(permit._id),
    permitName: normalizeText(permit.name) || "Unknown Permit",
  }));
};

export const getBploAdminFeeAssessmentTemplateS = async (permitId: string) => {
  if (!Types.ObjectId.isValid(permitId)) return null;

  const permit = await Permit.findById(permitId).select("name").lean();
  if (!permit) return null;

  const template = await AdminFeeTemplate.findOne({ permitId }).lean();

  return {
    permitId,
    permitName: normalizeText(permit.name) || "Unknown Permit",
    items: Array.isArray(template?.items)
      ? template.items.map((item: any) => ({
          feeName: normalizeText(item?.feeName),
          amount: toNumber(item?.amount),
        }))
      : [],
    totalAmount: toNumber(template?.totalAmount),
  };
};

export const saveBploAdminFeeAssessmentTemplateS = async (params: {
  permitId: string;
  items: unknown;
  adminId: string;
}) => {
  if (!Types.ObjectId.isValid(params.permitId)) return null;

  const permit = await Permit.findById(params.permitId).select("name").lean();
  if (!permit) return null;

  const normalizedItems = normalizeAssessmentItems(params.items);
  if (normalizedItems.length === 0) {
    throw new Error("At least one fee item is required.");
  }

  const totalAmount = normalizedItems.reduce(
    (sum, item) => sum + toNumber(item.amount),
    0,
  );

  const account = await Account.findById(params.adminId)
    .select("firstName middleName lastName suffix")
    .lean();
  const actorName = buildInspectorName(account);
  const permitName = normalizeText((permit as any)?.name) || "Unknown Permit";

  const existing = await AdminFeeTemplate.findOne({
    permitId: params.permitId,
  });
  if (existing) {
    existing.permitName = permitName;
    existing.items = normalizedItems as any;
    existing.totalAmount = totalAmount;
    existing.updatedBy = new Types.ObjectId(params.adminId);
    existing.updatedByName = actorName;

    return existing.save().then((saved) => saved.toObject());
  }

  const created = await AdminFeeTemplate.create({
    permitId: params.permitId,
    permitName,
    items: normalizedItems,
    totalAmount,
    createdBy: new Types.ObjectId(params.adminId),
    createdByName: actorName,
    updatedBy: new Types.ObjectId(params.adminId),
    updatedByName: actorName,
  });

  return created.toObject();
};

export const getBploAdminPermitPaymentAnalyticsS = async () => {
  const [permits, paidByPermit] = await Promise.all([
    Permit.find({ isActive: true }).select("_id name").sort({ name: 1 }).lean(),
    PermitApplication.aggregate([
      { $unwind: "$paymentAssessments" },
      {
        $match: {
          "paymentAssessments.paymentStatus": "paid",
          "paymentAssessments.departmentId": ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID,
        },
      },
      {
        $group: {
          _id: "$permit",
          totalAmount: {
            $sum: { $ifNull: ["$paymentAssessments.totalAmount", 0] },
          },
          paidAssessmentCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const paidMap = new Map(
    paidByPermit.map((item: any) => [
      String(item?._id ?? ""),
      {
        totalAmount: toNumber(item?.totalAmount),
        paidAssessmentCount: toNumber(item?.paidAssessmentCount),
      },
    ]),
  );

  return permits.map((permit: any) => {
    const permitId = String(permit?._id ?? "");
    const permitName = normalizeText(permit?.name) || "Unknown Permit";
    const aggregate = paidMap.get(permitId);

    return {
      permitId,
      permitName,
      totalCollectedAmount: toNumber(aggregate?.totalAmount),
      paidAssessmentCount: toNumber(aggregate?.paidAssessmentCount),
    };
  });
};

export const getBploAdminPermitPaymentPayersS = async (permitId: string) => {
  if (!Types.ObjectId.isValid(permitId)) return null;

  const permit = await Permit.findById(permitId).select("name").lean();
  if (!permit) return null;

  const applications = await PermitApplication.find({
    permit: new Types.ObjectId(permitId),
    paymentAssessments: {
      $elemMatch: {
        departmentId: ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID,
        paymentStatus: "paid",
      },
    },
  })
    .populate("applicant", "firstName middleName lastName suffix email")
    .select("applicant paymentAssessments updatedAt submittedAt")
    .sort({ updatedAt: -1, submittedAt: -1 })
    .lean();

  const payers = applications.flatMap((application: any) => {
    const bploPaidAssessments = Array.isArray(application?.paymentAssessments)
      ? application.paymentAssessments.filter(
          (assessment: any) =>
            normalizeText(assessment?.departmentId) ===
              ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID &&
            normalizeText(assessment?.paymentStatus) === "paid",
        )
      : [];

    return bploPaidAssessments.map((assessment: any) => ({
      applicationId: String(application?._id ?? ""),
      applicantName: buildApplicantName(application?.applicant),
      applicantEmail: normalizeText(application?.applicant?.email),
      paidAmount: toNumber(assessment?.totalAmount),
      paidAt:
        assessment?.statusUpdatedAt ??
        assessment?.generatedAt ??
        application?.updatedAt ??
        application?.submittedAt ??
        null,
      statusUpdatedByName: normalizeText(assessment?.statusUpdatedByName),
    }));
  });

  const totalCollectedAmount = payers.reduce(
    (sum, payer) => sum + toNumber(payer.paidAmount),
    0,
  );

  return {
    permitId,
    permitName: normalizeText((permit as any)?.name) || "Unknown Permit",
    totalCollectedAmount,
    paidAssessmentCount: payers.length,
    payers,
  };
};
const buildInspectionStepsFromApplication = async (
  application: any,
  session?: ClientSession,
) => {
  const evaluatorSteps = (application?.evaluatorResult?.processDecisions ?? [])
    .filter((step: any) => !step.notRequired)
    .sort((a: any, b: any) => Number(a.sequence) - Number(b.sequence))
    .map((step: any) => ({
      processId: normalizeText(step.processId),
      processName: normalizeText(step.processName),
      sequence: Number(step.sequence),
    }))
    .filter((step: any) => step.processId && step.processName);

  if (evaluatorSteps.length > 0) return evaluatorSteps;

  const process = await InspectionProcess.findOne({
    key: "inspection_process",
  })
    .session(session ?? null)
    .lean();
  const fallbackSteps = [...(process?.departments ?? [])]
    .sort((a, b) => a.sequence - b.sequence)
    .map((department) => ({
      processId: normalizeText(department.id),
      processName: normalizeText(department.name),
      sequence: Number(department.sequence),
    }))
    .filter((step) => step.processId && step.processName);

  return fallbackSteps;
};

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

export const getAdminInspectionRequestApplicationsS = async () => {
  const applications = await PermitApplication.find({
    $or: [
      { currentStage: "admin_inspection_request" },
      {
        currentStage: { $exists: false },
        "evaluatorResult.decision": "for_inspection",
      },
    ],
  })
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({ "evaluatorResult.decidedAt": -1, submittedAt: -1 })
    .lean();

  return applications.map((application) => {
    const permitName =
      normalizeText((application.permit as any)?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";

    const adminDecision = normalizeText(
      application.inspectionAdminResult?.decision,
    );

    return {
      _id: String(application._id),
      applicantName: buildApplicantName(application.applicant),
      permitType: permitName,
      decision: "for_inspection",
      tableStatus:
        adminDecision === "approved" ||
        adminDecision === "pending" ||
        adminDecision === "denied"
          ? adminDecision
          : "pending",
      evaluatorRemark: normalizeText(application.evaluatorResult?.remark),
      decidedAt: application.evaluatorResult?.decidedAt ?? null,
      submittedAt: application.submittedAt,
    };
  });
};

export const getPermitApprovalApplicationsS = async () => {
  const applications = await PermitApplication.find({
    $or: [
      {
        currentStage: "admin_permit_approval",
        "evaluatorResult.decision": "for_admin_approval",
      },
      {
        currentStage: { $exists: false },
        "evaluatorResult.decision": "for_admin_approval",
        "adminResult.decision": { $exists: false },
      },
    ],
  })
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({ "evaluatorResult.decidedAt": -1, submittedAt: -1 })
    .lean();

  return applications.map((application) => {
    const permitName =
      normalizeText((application.permit as any)?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";
    const assessments = Array.isArray(application.paymentAssessments)
      ? application.paymentAssessments
      : [];
    const hasUnpaid = assessments.some(
      (assessment: any) => normalizeText(assessment?.paymentStatus) !== "paid",
    );
    const paymentStatus =
      assessments.length > 0 && !hasUnpaid ? "paid" : "pending";

    return {
      _id: String(application._id),
      applicantName: buildApplicantName(application.applicant),
      permitType: permitName,
      decision: "for_admin_approval",
      tableStatus: "for_admin_approval",
      paymentStatus,
      evaluatorRemark: normalizeText(application.evaluatorResult?.remark),
      decidedAt: application.evaluatorResult?.decidedAt ?? null,
      submittedAt: application.submittedAt,
    };
  });
};

export const getPermitReleaseApplicationsS = async () => {
  const applications = await PermitApplication.find({
    "adminResult.decision": "approved",
    generatedPermit: { $exists: true, $ne: null },
  })
    .select(
      [
        "applicant",
        "permit",
        "permitName",
        "adminResult.decidedAt",
        "generatedPermit.file.generatedAt",
        "generatedPermit.sentToApplicantAt",
        "submittedAt",
      ].join(" "),
    )
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("permit", "name")
    .sort({
      "generatedPermit.file.generatedAt": -1,
      "adminResult.decidedAt": -1,
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
      application.generatedPermit?.sentToApplicantAt ?? null;

    return {
      _id: String(application._id),
      applicantName: buildApplicantName(application.applicant),
      permitType: permitName,
      approvedAt: application.adminResult?.decidedAt ?? null,
      generatedAt: application.generatedPermit?.file?.generatedAt ?? null,
      sentToApplicantAt,
      releaseStatus: sentToApplicantAt ? "sent_to_applicant" : "for_release",
      submittedAt: application.submittedAt,
    };
  });
};

export const getRoutedApplicationByIdS = async (applicationId: string) => {
  if (!Types.ObjectId.isValid(applicationId)) return null;

  const application = await PermitApplication.findById(applicationId)
    .select(
      [
        "applicant",
        "permit",
        "permitName",
        "formTitle",
        "responses",
        "tableStatus",
        "evaluatorResult",
        "adminResult",
        "inspectionAdminResult",
        "inspectionFlow",
        "paymentAssessments",
        "generatedPermit.templateId",
        "generatedPermit.templateName",
        "generatedPermit.templateVersion",
        "generatedPermit.status",
        "generatedPermit.confirmedAt",
        "generatedPermit.sentToApplicantAt",
        "generatedPermit.file.fileName",
        "generatedPermit.file.mimeType",
        "generatedPermit.file.generatedAt",
        "generatedPermit.file.watermarkText",
        "generatedPermit.file.watermarkFontSizePt",
        "generatedPermit.file.pdf",
        "generatedPermit.file.pageSizeMm",
        "generatedInspectionCertificate.templateId",
        "generatedInspectionCertificate.templateName",
        "generatedInspectionCertificate.templateVersion",
        "generatedInspectionCertificate.status",
        "generatedInspectionCertificate.sentToApplicantAt",
        "generatedInspectionCertificate.file.fileName",
        "generatedInspectionCertificate.file.mimeType",
        "generatedInspectionCertificate.file.generatedAt",
        "generatedInspectionCertificate.file.watermarkText",
        "generatedInspectionCertificate.file.watermarkFontSizePt",
        "generatedInspectionCertificate.file.pdf",
        "generatedInspectionCertificate.file.pageSizeMm",
        "ownerStatusVersion",
        "ownerStatusReadVersion",
        "submittedAt",
      ].join(" "),
    )
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate(
      "permit",
      "name sections fields enablePermitValidityFormDisplay permitValidityDisplayFieldIds",
    )
    .lean();

  if (!application) return null;

  const permitName =
    normalizeText((application.permit as any)?.name) ||
    normalizeText(application.permitName) ||
    "Unknown Permit";

  return {
    ...application,
    _id: String(application._id),
    permitType: permitName,
    applicantName: buildApplicantName(application.applicant),
    tableStatus:
      application.tableStatus === "re_submission"
        ? "re_submission"
        : "for_review",
  };
};

export const upsertAdminFeeAssessmentS = async (params: {
  applicationId: string;
  adminId: string;
  items: unknown;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  const normalizedItems = normalizeAssessmentItems(params.items);
  if (normalizedItems.length === 0) {
    throw new Error("At least one admin fee item is required.");
  }

  const totalAmount = normalizedItems.reduce(
    (sum, item) => sum + toNumber(item.amount),
    0,
  );

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(
      params.applicationId,
    ).session(session);
    if (!application) return null;

    if (application.currentStage !== "admin_permit_approval") {
      throw new Error(
        "Admin fee assessment can only be updated during permit approval stage.",
      );
    }

    const existingAssessments = Array.isArray(application.paymentAssessments)
      ? application.paymentAssessments
      : [];
    const nextGeneratedAt = new Date();
    const payload = {
      departmentId: ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID,
      departmentName: ADMIN_FEE_ASSESSMENT_DEPARTMENT_NAME,
      generatedAt: nextGeneratedAt,
      items: normalizedItems,
      totalAmount,
      paymentStatus: "pending" as const,
      statusUpdatedAt: null,
      statusUpdatedBy: null,
      statusUpdatedByName: "",
    };

    const existingIndex = existingAssessments.findIndex(
      (assessment: any) =>
        normalizeText(assessment?.departmentId) ===
        ADMIN_FEE_ASSESSMENT_DEPARTMENT_ID,
    );
    if (existingIndex >= 0) {
      (application.paymentAssessments as any[])[existingIndex] = payload as any;
    } else {
      (application.paymentAssessments as any[]).push(payload as any);
    }

    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "bplo_admin";

    const saved = await application.save({ session });

    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: "payment_pending",
          statusSource: "bplo_admin",
          adminRemark: `BPLO Admin updated your fee assessment. Updated amount due: ${formatCurrency(
            totalAmount,
          )}.`,
          paymentAssessmentSnapshot: buildPaymentAssessmentSnapshot(
            saved.paymentAssessments as any[],
          ),
        },
      ],
      { session },
    );

    return saved.toObject();
  });
};

export const saveInspectionRequestDecisionS = async (params: {
  applicationId: string;
  adminId: string;
  decision: InspectionAdminDecisionType;
  remark?: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(
      params.applicationId,
    ).session(session);
    if (!application) return null;

    if (application.currentStage !== "admin_inspection_request") return null;

    application.inspectionAdminResult = {
      admin: new Types.ObjectId(params.adminId),
      decision: params.decision,
      remark: normalizeText(params.remark),
      decidedAt: new Date(),
    };

    application.ownerStatusVersion =
      Number(application.ownerStatusVersion ?? 0) + 1;
    application.ownerStatusSource = "bplo_admin";

    if (params.decision === "pending") {
      application.inspectionFlow = undefined;
      application.currentStage = "admin_inspection_request";
      application.destinationModule = "admin_inspection_request";
      application.status = "in_review";
    } else if (params.decision === "denied") {
      application.inspectionFlow = undefined;
      application.status = "rejected";
      application.currentStage = "business_owner_application_status";
      application.destinationModule = "business_owner_application_status";
    } else {
      const baseSteps = await buildInspectionStepsFromApplication(
        application,
        session,
      );

      if (baseSteps.length === 0) {
        application.currentStage = "admin_permit_approval";
        application.destinationModule = "admin_permit_approval";
        application.status = "in_review";
      } else {
        const steps: InspectionStepType[] = baseSteps.map(
          (step: (typeof baseSteps)[0]) => ({
            processId: step.processId,
            processName: step.processName,
            sequence: step.sequence,
            assignedInspector: null,
            assignedInspectorName: "",
            assignedAt: null,
            scheduledInspectionAt: null,
            scheduleStatus: "unscheduled",
            scheduleRemark: "",
            scheduleUpdatedAt: null,
            assessedScheduleAt: null,
            assessmentResult: null,
            assessmentRemark: "",
            assessmentSubmittedAt: null,
            reassessmentRequestedAt: null,
            completedAt: null,
            completionRemark: "",
          }),
        );

        const assignedSteps = await assignInspectorToStep(steps, 0, session);
        application.inspectionFlow = {
          currentStepIndex: 0,
          steps: assignedSteps,
        };
        application.currentStage = "inspector_inspection_request";
        application.destinationModule = "inspector_inspection_request";
        application.status = "in_review";
      }
    }

    const saved = await application.save({ session });

    const statusMap: Record<InspectionAdminDecisionType, string> = {
      pending: "inspection_pending",
      denied: "inspection_denied",
      approved: "inspection_approved",
    };

    await OwnerApplicationStatus.create(
      [
        {
          permit: application.permit,
          application: application._id,
          applicant: application.applicant,
          permitName: application.permitName,
          status: statusMap[params.decision],
          statusSource: "bplo_admin",
          inspectionRemark: normalizeText(params.remark),
        },
      ],
      { session },
    );

    return saved.toObject();
  });
};

export const savePermitApprovalDecisionS = async (params: {
  applicationId: string;
  adminId: string;
  decision: AdminDecisionType;
  remark?: string;
}) => {
  if (!Types.ObjectId.isValid(params.applicationId)) return null;

  return runInTransaction(async (session) => {
    const application = await PermitApplication.findById(
      params.applicationId,
    ).session(session);
    if (!application) return null;

    if (application.currentStage !== "admin_permit_approval") return null;
    if (
      normalizeText(application.evaluatorResult?.decision) !==
      "for_admin_approval"
    ) {
      return null;
    }

    const assessments = Array.isArray(application.paymentAssessments)
      ? application.paymentAssessments
      : [];
    if (assessments.length === 0) {
      throw new Error(
        "Complete the combined treasurer payment before BPLO admin approval.",
      );
    }

    const hasUnpaidAssessment = assessments.some(
      (assessment: any) => normalizeText(assessment?.paymentStatus) !== "paid",
    );
    if (hasUnpaidAssessment) {
      throw new Error(
        "Complete the combined treasurer payment before BPLO admin approval.",
      );
    }

    application.adminResult = {
      admin: new Types.ObjectId(params.adminId),
      decision: params.decision,
      remark: params.decision === "denied" ? normalizeText(params.remark) : "",
      decidedAt: new Date(),
    };

    if (params.decision === "approved") {
      application.status = "approved";
      application.tableStatus = "for_review";
      application.currentStage = "admin_permit_validity";
      application.destinationModule = "admin_permit_validity";
    } else {
      application.ownerStatusVersion =
        Number(application.ownerStatusVersion ?? 0) + 1;
      application.ownerStatusSource = "bplo_admin";
      application.status = "rejected";
      application.tableStatus = "for_review";
      application.currentStage = "business_owner_application_status";
      application.destinationModule = "business_owner_application_status";
    }

    const saved = await application.save({ session });
    if (params.decision === "denied") {
      await OwnerApplicationStatus.create(
        [
          {
            permit: application.permit,
            application: application._id,
            applicant: application.applicant,
            permitName: application.permitName,
            status: "failed",
            statusSource: "bplo_admin",
            adminRemark: normalizeText(params.remark),
          },
        ],
        { session },
      );
    }

    return saved.toObject();
  });
};

export const getPermitValidityApplicationsS = async () => {
  const applications = await PermitApplication.find({
    status: { $in: ["approved", "in_review", "submitted"] },
  })
    .select(
      [
        "applicant",
        "permit",
        "permitName",
        "status",
        "adminResult.decidedAt",
        "paymentAssessments.paymentStatus",
        "generatedPermit.templateId",
        "generatedPermit.resolvedValues",
        "responses",
        "submittedAt",
      ].join(" "),
    )
    .populate("applicant", "firstName middleName lastName suffix")
    .populate(
      "permit",
      "name showInPermitValidity isActive enablePermitValidityFormDisplay permitValidityDisplayFieldIds fields",
    )
    .lean();

  const generatedTemplateIds = Array.from(
    new Set(
      applications
        .map((application: any) =>
          normalizeText(application?.generatedPermit?.templateId),
        )
        .filter((templateId) => templateId.length > 0),
    ),
  );

  const templates = generatedTemplateIds.length
    ? await PermitTemplate.find({
        _id: { $in: generatedTemplateIds },
      })
        .select("_id mappings")
        .lean()
    : [];

  const autoIncrementMappingsByTemplateId = new Map<
    string,
    Array<{ placeholder: string; label: string }>
  >(
    templates.map((template: any) => [
      String(template?._id ?? ""),
      Array.isArray(template?.mappings)
        ? template.mappings
            .filter(
              (mapping: any) =>
                normalizeText(mapping?.sourceType) === "auto_increment",
            )
            .map((mapping: any) => ({
              placeholder: normalizeText(mapping?.placeholder),
              label: normalizeText(mapping?.label),
            }))
            .filter((mapping: { placeholder: string; label: string }) =>
              Boolean(mapping.placeholder),
            )
        : [],
    ]),
  );

  const now = new Date();
  const currentYear = now.getFullYear();
  const previousYear = currentYear - 1;

  const startOfCurrentYear = new Date(currentYear, 0, 1, 0, 0, 0, 0);
  const renewalWindowEnd = new Date(currentYear, 0, 20, 23, 59, 59, 999);
  const isWithinRenewalWindow =
    now >= startOfCurrentYear && now <= renewalWindowEnd;
  const isPostRenewalWindow = now > renewalWindowEnd;

  type PermitValidityStatusType =
    | "active"
    | "for_renewal"
    | "inactive"
    | "delinquent";

  type GroupedApplicationType = {
    key: string;
    applicantId: string;
    permitId: string;
    applicantName: string;
    permitType: string;
    permitConfig: {
      enablePermitValidityFormDisplay: boolean;
      permitValidityDisplayFieldIds: string[];
      fields: Array<{ id: string; label: string }>;
    };
    applications: Array<{
      _id: string;
      submittedAt: Date;
      approvedAt: Date | null;
      year: number;
      status: string;
      hasCompletedAnnualPayment: boolean;
      responses: Array<{
        fieldId: string;
        label: string;
        type: string;
        value?: string | string[] | null;
        files?: Array<{ name: string }>;
      }>;
      generatedPermitTemplateId: string;
      generatedPermitResolvedValues: Record<string, string>;
    }>;
  };

  const grouped = new Map<string, GroupedApplicationType>();

  for (const application of applications) {
    const applicantId = String((application as any).applicant?._id ?? "");
    const permitId = String((application as any).permit?._id ?? "");
    if (!applicantId || !permitId) continue;

    const permitIsActive = (application.permit as any)?.isActive;
    const showInPermitValidity = (application.permit as any)
      ?.showInPermitValidity;
    if (permitIsActive === false || showInPermitValidity === false) continue;

    const permitType =
      normalizeText((application.permit as any)?.name) ||
      normalizeText(application.permitName) ||
      "Unknown Permit";

    const submittedAt = new Date(application.submittedAt);
    if (Number.isNaN(submittedAt.getTime())) continue;
    const year = submittedAt.getFullYear();
    if (!Number.isFinite(year)) continue;
    const assessments = Array.isArray(application.paymentAssessments)
      ? application.paymentAssessments
      : [];
    const hasCompletedAnnualPayment =
      assessments.length > 0 &&
      assessments.every(
        (assessment: any) =>
          normalizeText(assessment?.paymentStatus) === "paid",
      );

    const key = `${applicantId}:${permitId}`;
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        key,
        applicantId,
        permitId,
        applicantName: buildApplicantName(application.applicant),
        permitType,
        permitConfig: {
          enablePermitValidityFormDisplay:
            (application.permit as any)?.enablePermitValidityFormDisplay ===
            true,
          permitValidityDisplayFieldIds: Array.isArray(
            (application.permit as any)?.permitValidityDisplayFieldIds,
          )
            ? (application.permit as any).permitValidityDisplayFieldIds
                .map((fieldId: unknown) => normalizeText(fieldId))
                .filter((fieldId: string) => fieldId.length > 0)
            : [],
          fields: Array.isArray((application.permit as any)?.fields)
            ? (application.permit as any).fields
                .map((field: any) => ({
                  id: normalizeText(field?.id),
                  label: normalizeText(field?.label),
                }))
                .filter(
                  (field: { id: string; label: string }) => field.id.length > 0,
                )
            : [],
        },
        applications: [
          {
            _id: String(application._id),
            submittedAt,
            approvedAt: application.adminResult?.decidedAt ?? null,
            year,
            status: normalizeText(application.status),
            hasCompletedAnnualPayment,
            responses: Array.isArray((application as any).responses)
              ? ((application as any).responses as Array<any>).map(
                  (response) => ({
                    fieldId: normalizeText(response?.fieldId),
                    label: normalizeText(response?.label),
                    type: normalizeText(response?.type),
                    value: response?.value,
                    files: Array.isArray(response?.files)
                      ? response.files.map((file: any) => ({
                          name: normalizeText(file?.name),
                        }))
                      : [],
                  }),
                )
              : [],
            generatedPermitTemplateId: normalizeText(
              (application as any)?.generatedPermit?.templateId,
            ),
            generatedPermitResolvedValues: normalizeResolvedValues(
              (application as any)?.generatedPermit?.resolvedValues,
            ),
          },
        ],
      });
      continue;
    }

    existing.applications.push({
      _id: String(application._id),
      submittedAt,
      approvedAt: application.adminResult?.decidedAt ?? null,
      year,
      status: normalizeText(application.status),
      hasCompletedAnnualPayment,
      responses: Array.isArray((application as any).responses)
        ? ((application as any).responses as Array<any>).map((response) => ({
            fieldId: normalizeText(response?.fieldId),
            label: normalizeText(response?.label),
            type: normalizeText(response?.type),
            value: response?.value,
            files: Array.isArray(response?.files)
              ? response.files.map((file: any) => ({
                  name: normalizeText(file?.name),
                }))
              : [],
          }))
        : [],
      generatedPermitTemplateId: normalizeText(
        (application as any)?.generatedPermit?.templateId,
      ),
      generatedPermitResolvedValues: normalizeResolvedValues(
        (application as any)?.generatedPermit?.resolvedValues,
      ),
    });
  }

  return [...grouped.values()]
    .flatMap((entry) => {
      const sortedApplications = [...entry.applications].sort(
        (a, b) => b.submittedAt.getTime() - a.submittedAt.getTime(),
      );

      const hasAnyApproved = sortedApplications.some(
        (application) => application.status === "approved",
      );
      const currentYearApplications = sortedApplications.filter(
        (application) => application.year === currentYear,
      );
      const hasCurrentYearApplication = currentYearApplications.length > 0;
      const hasCompletedCurrentYearPayment = currentYearApplications.some(
        (application) => application.hasCompletedAnnualPayment,
      );

      const wasActiveInPreviousYear = sortedApplications.some(
        (application) =>
          application.year === previousYear &&
          application.status === "approved" &&
          application.hasCompletedAnnualPayment,
      );

      const shouldIncludeRecord =
        hasAnyApproved || hasCurrentYearApplication || wasActiveInPreviousYear;
      if (!shouldIncludeRecord) return [];

      let computedStatus: PermitValidityStatusType;

      if (hasCurrentYearApplication && hasCompletedCurrentYearPayment) {
        computedStatus = "active";
      } else if (isWithinRenewalWindow) {
        computedStatus =
          wasActiveInPreviousYear || hasCurrentYearApplication
            ? "for_renewal"
            : "inactive";
      } else if (isPostRenewalWindow) {
        if (!hasCurrentYearApplication) {
          computedStatus = "inactive";
        } else if (!hasCompletedCurrentYearPayment) {
          computedStatus = "delinquent";
        } else {
          computedStatus = "active";
        }
      } else {
        computedStatus = "inactive";
      }

      return sortedApplications
        .filter((application) => Number.isFinite(application.year))
        .map((application) => {
          const shouldDisplayConfiguredFields =
            entry.permitConfig.enablePermitValidityFormDisplay === true;
          const configuredFieldIds =
            entry.permitConfig.permitValidityDisplayFieldIds;

          const responseByFieldId = new Map(
            (application.responses ?? [])
              .map(
                (response) =>
                  [normalizeText(response.fieldId), response] as const,
              )
              .filter(([fieldId]) => fieldId.length > 0),
          );

          const permitFieldLabelMap = new Map(
            entry.permitConfig.fields.map(
              (field) => [field.id, field.label] as const,
            ),
          );

          const displayedFields = shouldDisplayConfiguredFields
            ? configuredFieldIds.map((fieldId) => {
                const matchedResponse = responseByFieldId.get(fieldId);
                const normalizedType = normalizeText(matchedResponse?.type);

                let displayValue = "-";
                if (normalizedType === "file") {
                  const fileNames = (matchedResponse?.files ?? [])
                    .map((file) => normalizeText(file?.name))
                    .filter((name) => name.length > 0);
                  displayValue =
                    fileNames.length > 0 ? fileNames.join(", ") : "-";
                } else if (Array.isArray(matchedResponse?.value)) {
                  const normalizedValues = matchedResponse.value
                    .map((value) => normalizeText(value))
                    .filter((value) => value.length > 0);
                  displayValue =
                    normalizedValues.length > 0
                      ? normalizedValues.join(", ")
                      : "-";
                } else {
                  const normalizedValue = normalizeText(matchedResponse?.value);
                  displayValue = normalizedValue || "-";
                }

                return {
                  fieldId,
                  label:
                    normalizeText(matchedResponse?.label) ||
                    normalizeText(permitFieldLabelMap.get(fieldId)) ||
                    fieldId,
                  value: displayValue,
                };
              })
            : [];

          const autoIncrementMappings =
            autoIncrementMappingsByTemplateId.get(
              application.generatedPermitTemplateId,
            ) ?? [];
          const autoIncrementDisplayedFields = autoIncrementMappings
            .map((mapping) => {
              const value = normalizeText(
                application.generatedPermitResolvedValues?.[mapping.placeholder],
              );
              if (!value) return null;

              return {
                fieldId: `auto_increment:${mapping.placeholder}`,
                label: mapping.label || mapping.placeholder,
                value,
              };
            })
            .filter(
              (
                field,
              ): field is { fieldId: string; label: string; value: string } =>
                Boolean(field),
            );

          const mergedDisplayedFieldMap = new Map(
            displayedFields.map((field) => [field.fieldId, field] as const),
          );
          for (const field of autoIncrementDisplayedFields) {
            if (!mergedDisplayedFieldMap.has(field.fieldId)) {
              mergedDisplayedFieldMap.set(field.fieldId, field);
            }
          }
          const mergedDisplayedFields = [...mergedDisplayedFieldMap.values()];

          return {
            _id: application._id,
            applicantName: entry.applicantName,
            permitType: entry.permitType,
            status: computedStatus,
            currentYearApplicationId: application._id,
            permitYear: application.year,
            validFrom: new Date(application.year, 0, 1).toISOString(),
            validUntil: new Date(
              application.year,
              11,
              31,
              23,
              59,
              59,
              999,
            ).toISOString(),
            approvedAt:
              application.approvedAt ?? application.submittedAt ?? null,
            submittedAt: application.submittedAt,
            displayedFields: mergedDisplayedFields,
          };
        });
    })
    .sort(
      (a, b) =>
        new Date(b.approvedAt ?? b.submittedAt).getTime() -
        new Date(a.approvedAt ?? a.submittedAt).getTime(),
    );
};

export const getBploDashboardAnalyticsS = async () => {
  const [inspectionRequests, permitApprovals, permitValidity] =
    await Promise.all([
      getAdminInspectionRequestApplicationsS(),
      getPermitApprovalApplicationsS(),
      getPermitValidityApplicationsS(),
    ]);
  const normalizedPermitValidity = permitValidity.filter(
    (
      application,
    ): application is NonNullable<(typeof permitValidity)[number]> =>
      application !== null,
  );

  const pendingInspectionRequests = inspectionRequests.filter(
    (application) => application.tableStatus === "pending",
  ).length;
  const permitApprovalQueue = permitApprovals.length;
  const validityRecords = normalizedPermitValidity.length;

  const validityStatusOrder = [
    { key: "active", label: "Active" },
    { key: "for_renewal", label: "For Renewal" },
    { key: "inactive", label: "Inactive" },
    { key: "delinquent", label: "Delinquent" },
  ] as const;

  const validityStatusCounts = normalizedPermitValidity.reduce(
    (acc, application) => {
      acc[application.status] = Number(acc[application.status] ?? 0) + 1;
      return acc;
    },
    {
      active: 0,
      for_renewal: 0,
      inactive: 0,
      delinquent: 0,
    } as Record<(typeof validityStatusOrder)[number]["key"], number>,
  );

  const validityStatusBreakdown = validityStatusOrder.map((status) => ({
    key: status.key,
    label: status.label,
    count: Number(validityStatusCounts[status.key] ?? 0),
  }));

  const permitTypeCounts = [
    ...normalizedPermitValidity,
    ...inspectionRequests,
    ...permitApprovals,
  ].reduce((acc, application) => {
    const permitType = normalizeText(application.permitType);
    if (!permitType) return acc;

    acc.set(permitType, Number(acc.get(permitType) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());

  const permitTypeBreakdown = [...permitTypeCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([permitType, count]) => ({
      permitType,
      count: Number(count ?? 0),
    }));

  const dominantValidityStatus =
    [...validityStatusBreakdown]
      .sort((left, right) => {
        if (right.count !== left.count) return right.count - left.count;
        return left.label.localeCompare(right.label);
      })
      .find((item) => item.count > 0)?.key ?? null;

  return {
    summary: {
      validityRecords,
      pendingInspectionRequests,
      permitApprovalQueue,
      totalQueueItems: pendingInspectionRequests + permitApprovalQueue,
      permitTypesInView: permitTypeBreakdown.length,
    },
    validityStatusBreakdown,
    permitTypeBreakdown,
    queueBreakdown: [
      {
        key: "inspection_requests",
        label: "Inspection Requests",
        count: pendingInspectionRequests,
      },
      {
        key: "permit_approval",
        label: "Permit Approval Queue",
        count: permitApprovalQueue,
      },
    ],
    insights: {
      dominantValidityStatus,
      leadingPermitType: permitTypeBreakdown[0]?.permitType ?? null,
    },
    generatedAt: new Date().toISOString(),
  };
};

export const getRoutedApplicationsByDecisionS = async (
  decision: Extract<
    EvaluatorDecisionType,
    "for_inspection" | "for_admin_approval"
  >,
) => {
  if (decision === "for_inspection") {
    return getAdminInspectionRequestApplicationsS();
  }

  return getPermitApprovalApplicationsS();
};
