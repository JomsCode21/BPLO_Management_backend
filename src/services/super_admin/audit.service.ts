import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import { Types } from "mongoose";

// Normalize values before comparing and filtering audit data.
const normalizeText = (value: unknown) => String(value ?? "").trim();

// Build a display name from the linked account fields.
const buildFullName = (account: any) => {
  if (!account) return "";
  const parts = [account.firstName, account.middleName, account.lastName]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const suffix = normalizeText(account.suffix);
  return suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
};

type GetWorkflowAuditParams = {
  page: number;
  limit: number;
  source?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

type WorkflowAuditEventRow = {
  _id: string;
  applicationId: string;
  permitName: string;
  applicantName: string;
  applicantEmail: string;
  statusCode: string;
  source: string;
  actorName: string;
  remark: string;
  occurredAt: Date | null;
};

const SEARCH_DATE_FORMATTER = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

const SEARCH_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Turn status and source codes into human-readable labels.
const normalizeLabel = (value: string) =>
  normalizeText(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

// Add multiple date formats so search matches user-entered values.
const buildDateSearchStrings = (value: Date | null) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return [];

  const parts = new Map(
    SEARCH_DATE_PARTS_FORMATTER.formatToParts(value).map((part) => [
      part.type,
      part.value,
    ]),
  );

  const year = parts.get("year") ?? "";
  const month = parts.get("month") ?? "";
  const day = parts.get("day") ?? "";
  const hour = parts.get("hour") ?? "";
  const minute = parts.get("minute") ?? "";

  return [
    SEARCH_DATE_FORMATTER.format(value),
    year && month && day && hour && minute
      ? `${year}-${month}-${day} ${hour}:${minute}`
      : "",
    year && month && day && hour && minute
      ? `${month}/${day}/${year} ${hour}:${minute}`
      : "",
  ].filter(Boolean);
};

// Collapse the searchable fields into one lowercased string.
const buildSearchHaystack = (row: WorkflowAuditEventRow) =>
  [
    ...buildDateSearchStrings(row.occurredAt),
    normalizeLabel(row.statusCode),
    row.statusCode,
    normalizeLabel(row.source),
    row.source,
    row.actorName,
    row.permitName,
    row.applicantName,
    row.applicantEmail,
    row.remark,
  ]
    .join("\n")
    .toLowerCase();

const collectWorkflowStatusIds = async (params: {
  match: Record<string, any>;
  skip: number;
  limit: number;
  collectAll?: boolean;
}) => {
  const ids: string[] = [];
  let total = 0;

  const cursor = OwnerApplicationStatus.find(params.match)
    .select("_id")
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor();

  try {
    for await (const row of cursor as AsyncIterable<{ _id?: unknown }>) {
      total += 1;

      if (params.collectAll) {
        ids.push(String(row._id ?? ""));
        continue;
      }

      if (total <= params.skip) continue;
      if (ids.length < params.limit) {
        ids.push(String(row._id ?? ""));
      }
    }
  } finally {
    await cursor.close();
  }

  return { ids, total };
};

const hydrateWorkflowAuditEvents = async (
  statusIds: string[],
): Promise<WorkflowAuditEventRow[]> => {
  if (statusIds.length === 0) return [];

  const orderMap = new Map(statusIds.map((id, index) => [String(id), index]));

  const rows = await OwnerApplicationStatus.find({
    _id: { $in: statusIds },
  })
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate({
      path: "application",
      select:
        "evaluatorResult adminResult inspectionAdminResult paymentAssessments inspectionFlow",
      populate: [
        {
          path: "evaluatorResult.evaluator",
          select: "firstName middleName lastName suffix",
        },
        {
          path: "adminResult.admin",
          select: "firstName middleName lastName suffix",
        },
        {
          path: "inspectionAdminResult.admin",
          select: "firstName middleName lastName suffix",
        },
      ],
    })
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  return rows
    .map((row: any) => {
      const applicantName = buildFullName(row.applicant) || "Unknown Applicant";
      const applicationId = (() => {
        if (row.application && typeof row.application === "object") {
          return String((row.application as any)._id ?? "");
        }
        if (Types.ObjectId.isValid(String(row.application ?? ""))) {
          return String(row.application);
        }
        return "";
      })();

      const sourceLabel = normalizeText(row.statusSource || "system");
      const remark =
        normalizeText(row.inspectionRemark) ||
        normalizeText(row.evaluatorRemark) ||
        normalizeText(row.adminRemark);

      return {
        _id: String(row._id),
        applicationId,
        permitName: normalizeText(row.permitName) || "Unknown Permit",
        applicantName,
        applicantEmail: normalizeText((row.applicant as any)?.email),
        statusCode: normalizeText(row.status),
        source: sourceLabel,
        actorName: resolveEventActor(row, row.application),
        remark,
        occurredAt: row.createdAt ?? row.submittedAt ?? null,
      };
    })
    .sort(
      (left, right) =>
        (orderMap.get(left._id) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(right._id) ?? Number.MAX_SAFE_INTEGER),
    );
};

const resolveEventActor = (statusRecord: any, application: any): string => {
  const source = normalizeText(statusRecord?.statusSource || "system");
  const statusCode = normalizeText(statusRecord?.status);

  if (source === "evaluator") {
    return (
      buildFullName(application?.evaluatorResult?.evaluator) || "Evaluator"
    );
  }

  if (source === "bplo_admin") {
    const inspectionStatuses = new Set([
      "inspection_pending",
      "inspection_denied",
      "inspection_approved",
    ]);
    if (inspectionStatuses.has(statusCode)) {
      return (
        buildFullName(application?.inspectionAdminResult?.admin) || "BPLO Admin"
      );
    }
    return buildFullName(application?.adminResult?.admin) || "BPLO Admin";
  }

  if (source === "treasurer") {
    const assessments = Array.isArray(application?.paymentAssessments)
      ? application.paymentAssessments
      : [];
    const names = Array.from(
      new Set(
        assessments
          .map((assessment: any) =>
            normalizeText(assessment?.statusUpdatedByName),
          )
          .filter(Boolean),
      ),
    );
    return (names[0] as string) || "Treasurer";
  }

  if (source === "inspector") {
    const activeStep = (() => {
      const stepIndex = Number(
        application?.inspectionFlow?.currentStepIndex ?? 0,
      );
      return application?.inspectionFlow?.steps?.[stepIndex];
    })();
    return normalizeText(activeStep?.assignedInspectorName) || "Inspector";
  }

  return "System";
};

// Return the filtered super admin workflow audit feed.
export const getWorkflowAuditEventsS = async (
  params: GetWorkflowAuditParams,
) => {
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(100, Math.max(1, Number(params.limit || 20)));
  const skip = (page - 1) * limit;

  const match: Record<string, any> = {
    deletedAt: null,
  };

  const source = normalizeText(params.source).toLowerCase();
  const normalizedSource =
    source &&
    ["system", "evaluator", "bplo_admin", "inspector", "treasurer"].includes(
      source,
    )
      ? source
      : "";
  if (normalizedSource) {
    match.statusSource = normalizedSource;
  }

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

  const search = normalizeText(params.search).toLowerCase();
  const shouldFilterBySearch = search.length > 0;
  const { ids: statusIds, total } = await collectWorkflowStatusIds({
    match,
    skip: shouldFilterBySearch ? 0 : skip,
    limit,
    collectAll: shouldFilterBySearch,
  });

  if (statusIds.length === 0 && !shouldFilterBySearch) {
    return {
      data: [],
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

  const hydratedRows = await hydrateWorkflowAuditEvents(statusIds);
  const data = shouldFilterBySearch
    ? hydratedRows.filter((row) => buildSearchHaystack(row).includes(search))
    : hydratedRows;
  const filteredTotal = shouldFilterBySearch ? data.length : total;
  const paginatedData = shouldFilterBySearch
    ? data.slice(skip, skip + limit)
    : data;

  return {
    data: paginatedData,
    pagination: {
      page,
      limit,
      total: filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
      hasNextPage: page * limit < filteredTotal,
      hasPrevPage: page > 1,
    },
  };
};
