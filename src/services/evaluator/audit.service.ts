import Account from "@/models/account/account.model";
import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import PermitApplication from "@/models/permit_application/permit-application.model";

const normalizeText = (value: unknown) => String(value ?? "").trim();

// Describe evaluator workflow audit query inputs.
type GetEvaluatorWorkflowAuditParams = {
  page: number;
  limit: number;
  permit?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

type EvaluatorLatestStatusRow = {
  _id: unknown;
  application?: unknown;
  applicant?: unknown;
  permitName?: string;
  status?: string;
  evaluatorRemark?: string;
  createdAt?: Date | null;
  submittedAt?: Date | null;
};

type EvaluatorAuditEventRow = {
  _id: string;
  applicationId: string;
  permitName: string;
  applicantName: string;
  statusCode: string;
  source: "evaluator";
  actorName: string;
  remark: string;
  inspectionInspectorName?: string;
  inspectionDepartmentName?: string;
  approvalDate?: Date | null;
  occurredAt: Date | null;
};

const EVALUATOR_ALLOWED_STATUSES = new Set(["for_admin_approval"]);

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const MANILA_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const buildFullName = (account: any) => {
  // Build a readable full name for audit output.
  if (!account) return "";

  const parts = [
    account.firstName,
    account.middleName,
    account.lastName,
    account.suffix,
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean);

  return parts.join(" ");
};

const buildStatusLabel = (statusCode: string) =>
  normalizeText(statusCode).replace(/_/g, " ");

const buildDateSearchStrings = (value: Date | null) => {
  // Generate searchable date variants for local time.
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return [];

  const parts = new Map(
    MANILA_DATE_PARTS_FORMATTER.formatToParts(value).map((part) => [
      part.type,
      part.value,
    ]),
  );

  const year = parts.get("year") ?? "";
  const month = parts.get("month") ?? "";
  const day = parts.get("day") ?? "";
  const hour = parts.get("hour") ?? "";
  const minute = parts.get("minute") ?? "";
  if (!year || !month || !day || !hour || !minute) return [];

  return [
    `${year}-${month}-${day} ${hour}:${minute}`,
    `${month}/${day}/${year} ${hour}:${minute}`,
  ];
};

const buildSearchHaystack = (row: EvaluatorAuditEventRow) =>
  [
    row.permitName,
    row.remark,
    row.applicantName,
    row.actorName,
    buildStatusLabel(row.statusCode),
    row.statusCode,
    row.source,
    row.inspectionInspectorName,
    row.inspectionDepartmentName,
    ...buildDateSearchStrings(row.occurredAt),
    ...buildDateSearchStrings(row.approvalDate ?? null),
  ]
    .join("\n")
    .toLowerCase();

const collectLatestEvaluatorStatuses = async (params: {
  match: Record<string, any>;
  skip: number;
  limit: number;
  collectAll: boolean;
}) => {
  // Select the latest status per application for audit reporting.
  const seenApplications = new Set<string>();
  const rows: EvaluatorLatestStatusRow[] = [];
  let total = 0;

  const cursor = OwnerApplicationStatus.find(params.match)
    .select(
      "_id application applicant permitName status evaluatorRemark createdAt submittedAt",
    )
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor();

  try {
    for await (const row of cursor as AsyncIterable<EvaluatorLatestStatusRow>) {
      const applicationKey = String(row.application ?? row._id ?? "");
      if (!applicationKey || seenApplications.has(applicationKey)) continue;

      seenApplications.add(applicationKey);
      total += 1;

      if (params.collectAll) {
        rows.push(row);
        continue;
      }

      if (total <= params.skip) continue;
      if (rows.length < params.limit) {
        rows.push(row);
      }
    }
  } finally {
    await cursor.close();
  }

  return { rows, total };
};

const hydrateEvaluatorAuditEvents = async (
  rows: EvaluatorLatestStatusRow[],
): Promise<EvaluatorAuditEventRow[]> => {
  // Populate related accounts and applications for evaluator audit rows.
  if (rows.length === 0) return [];

  const applicantIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.applicant ?? ""))
        .filter((value) => value.length > 0),
    ),
  );
  const applicationIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.application ?? ""))
        .filter((value) => value.length > 0),
    ),
  );

  const [applicantDocs, applicationDocs] = await Promise.all([
    applicantIds.length > 0
      ? Account.find({ _id: { $in: applicantIds } })
          .select("_id firstName middleName lastName suffix")
          .lean()
      : Promise.resolve([]),
    applicationIds.length > 0
      ? PermitApplication.find({ _id: { $in: applicationIds } })
          .select("_id evaluatorResult.evaluator inspectionFlow")
          .lean()
      : Promise.resolve([]),
  ]);

  const applicantMap = new Map(
    applicantDocs.map((account: any) => [String(account._id), account]),
  );
  const applicationMap = new Map(
    applicationDocs.map((application: any) => [
      String(application._id),
      application,
    ]),
  );

  const evaluatorIds = Array.from(
    new Set(
      applicationDocs
        .map((application: any) =>
          String(application?.evaluatorResult?.evaluator ?? ""),
        )
        .filter((value) => value.length > 0),
    ),
  );

  const evaluatorDocs =
    evaluatorIds.length > 0
      ? await Account.find({ _id: { $in: evaluatorIds } })
          .select("_id firstName middleName lastName suffix")
          .lean()
      : [];

  const evaluatorMap = new Map(
    evaluatorDocs.map((account: any) => [String(account._id), account]),
  );

  return rows.map((row) => {
    const applicationId = String(row.application ?? "");
    const applicationDoc = applicationMap.get(applicationId);
    const evaluatorId = String(
      (applicationDoc as any)?.evaluatorResult?.evaluator ?? "",
    );
    const occurredAt = row.createdAt ?? row.submittedAt ?? null;
    const inspectionSteps = Array.isArray(
      (applicationDoc as any)?.inspectionFlow?.steps,
    )
      ? (applicationDoc as any).inspectionFlow.steps
      : [];
    const latestCompletedInspectionStep = [...inspectionSteps]
      .filter((step: any) => Boolean(step?.completedAt))
      .sort(
        (left: any, right: any) =>
          new Date(right?.completedAt ?? 0).getTime() -
          new Date(left?.completedAt ?? 0).getTime(),
      )[0];
    const hasInspectionApproval = Boolean(latestCompletedInspectionStep);
    const inspectionInspectorName = normalizeText(
      latestCompletedInspectionStep?.assignedInspectorName,
    );
    const inspectionDepartmentName = normalizeText(
      latestCompletedInspectionStep?.processName,
    );

    return {
      _id: String(row._id ?? ""),
      applicationId,
      permitName: normalizeText(row.permitName) || "Unknown Permit",
      applicantName:
        buildFullName(applicantMap.get(String(row.applicant ?? ""))) ||
        "Unknown Applicant",
      statusCode: normalizeText(row.status),
      source: "evaluator",
      actorName: buildFullName(evaluatorMap.get(evaluatorId)) || "Evaluator",
      remark: normalizeText(row.evaluatorRemark),
      inspectionInspectorName: inspectionInspectorName || undefined,
      inspectionDepartmentName: inspectionDepartmentName || undefined,
      approvalDate:
        hasInspectionApproval &&
        occurredAt instanceof Date &&
        !Number.isNaN(occurredAt.getTime())
          ? occurredAt
          : null,
      occurredAt:
        occurredAt instanceof Date && !Number.isNaN(occurredAt.getTime())
          ? occurredAt
          : null,
    };
  });
};

export const getEvaluatorWorkflowAuditEventsS = async (
  params: GetEvaluatorWorkflowAuditParams,
) => {
  // Return paginated evaluator workflow audit results.
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(100, Math.max(1, Number(params.limit || 20)));
  const skip = (page - 1) * limit;

  const match: Record<string, any> = {
    deletedAt: null,
    statusSource: "evaluator",
    status: { $in: [...EVALUATOR_ALLOWED_STATUSES] },
  };

  const dateFrom = normalizeText(params.dateFrom);
  const dateTo = normalizeText(params.dateTo);
  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) createdAt.$gte = from;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        createdAt.$lte = to;
      }
    }
    if (Object.keys(createdAt).length > 0) {
      match.createdAt = createdAt;
    }
  }

  const permit = normalizeText(params.permit);
  if (permit) {
    match.permitName = { $regex: `^${escapeRegExp(permit)}$`, $options: "i" };
  }

  const permitOptionsPromise = OwnerApplicationStatus.distinct("permitName", {
    deletedAt: null,
    statusSource: "evaluator",
    status: { $in: [...EVALUATOR_ALLOWED_STATUSES] },
  }).then((values) => {
    const uniquePermits = new Map<string, string>();

    values
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .forEach((value) => {
        const key = value.toLowerCase();
        if (key === "all") return;
        if (!uniquePermits.has(key)) {
          uniquePermits.set(key, value);
        }
      });

    return Array.from(uniquePermits.values()).sort((a, b) =>
      a.localeCompare(b),
    );
  });

  const searchNeedle = normalizeText(params.search).toLowerCase();
  const { rows, total } = await collectLatestEvaluatorStatuses({
    match,
    skip,
    limit,
    collectAll: searchNeedle.length > 0,
  });
  const permitOptions = await permitOptionsPromise;

  if (!searchNeedle) {
    const data = await hydrateEvaluatorAuditEvents(rows);
    return {
      data,
      permits: permitOptions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  const hydratedRows = await hydrateEvaluatorAuditEvents(rows);
  const filteredRows = hydratedRows.filter((row) =>
    buildSearchHaystack(row).includes(searchNeedle),
  );
  const paginatedRows = filteredRows.slice(skip, skip + limit);

  return {
    data: paginatedRows,
    permits: permitOptions,
    pagination: {
      page,
      limit,
      total: filteredRows.length,
      totalPages: Math.max(1, Math.ceil(filteredRows.length / limit)),
      hasNextPage: page * limit < filteredRows.length,
      hasPrevPage: page > 1,
    },
  };
};
