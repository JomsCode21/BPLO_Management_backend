import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import { Types } from "mongoose";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Normalize values before comparing and filtering audit data.
const normalizeText = (value: unknown) => String(value ?? "").trim();
const BPLO_ADMIN_ASSESSMENT_DEPARTMENT_ID = "bplo_admin_assessment";

// Build a display name from the linked account fields.
const buildFullName = (account: any) => {
  if (!account) return "";
  const parts = [account.firstName, account.middleName, account.lastName]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const suffix = normalizeText(account.suffix);
  return suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
};

type GetBploWorkflowAuditParams = {
  page: number;
  limit: number;
  permit?: string;
  source?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

type WorkflowAuditCursorRow = {
  _id: unknown;
  application?: unknown;
  createdAt?: Date | null;
};

type BploWorkflowAuditEventRow = {
  _id: string;
  applicationId: string;
  permitName: string;
  applicantName: string;
  applicantEmail: string;
  statusCode: string;
  source: string;
  actorName: string;
  remark: string;
  totalAmountToSettle: number;
  amountPaid: number;
  occurredAt: Date | null;
};

const BPLO_ALLOWED_STATUSES = new Set([
  "for_inspection",
  "inspection_pending",
  "inspection_approved",
  "inspection_scheduled",
  "inspection_rescheduled",
  "inspection_denied",
  "inspection_passed",
  "inspection_for_completion",
  "inspection_failed",
  "for_admin_approval",
  "re_submission",
  "approved",
  "failed",
]);

const BPLO_ALLOWED_SOURCES = ["evaluator", "bplo_admin", "inspector"];
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
const buildSearchHaystack = (row: BploWorkflowAuditEventRow) =>
  [
    ...buildDateSearchStrings(row.occurredAt),
    row.permitName,
    row.applicantName,
    String(row.totalAmountToSettle),
    String(row.amountPaid),
  ]
    .join("\n")
    .toLowerCase();

const formatAuditDateTime = (value: Date | null) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(value ?? 0));

const formatCurrencyForPdf = (value: number) => {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `PHP ${safeAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const truncateText = (value: string, maxLength: number) => {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text || "-";
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
};

const collectWorkflowStatusIds = async (params: {
  match: Record<string, any>;
  skip: number;
  limit: number;
  collectAll?: boolean;
}) => {
  const ids: string[] = [];
  let total = 0;

  const cursor = OwnerApplicationStatus.find(params.match)
    .select(["_id", "application"].join(" "))
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor();

  try {
    for await (const row of cursor as AsyncIterable<WorkflowAuditCursorRow>) {
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

const resolveEventActor = (statusRecord: any, application: any) => {
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

const hydrateBploWorkflowAuditEvents = async (
  statusIds: string[],
): Promise<BploWorkflowAuditEventRow[]> => {
  if (statusIds.length === 0) return [];

  const orderMap = new Map(statusIds.map((id, index) => [String(id), index]));

  const rows = await OwnerApplicationStatus.find({
    _id: { $in: statusIds },
  })
    .populate("applicant", "firstName middleName lastName suffix email")
    .populate({
      path: "application",
      select:
        "evaluatorResult adminResult inspectionAdminResult inspectionFlow paymentAssessments",
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
      const snapshot = Array.isArray(row.paymentAssessmentSnapshot)
        ? row.paymentAssessmentSnapshot
        : [];
      const applicationAssessments = Array.isArray(
        (row.application as any)?.paymentAssessments,
      )
        ? (row.application as any).paymentAssessments
        : [];
      const matchingSnapshotAssessment = snapshot.find(
        (assessment: any) =>
          normalizeText(assessment?.departmentId) ===
          BPLO_ADMIN_ASSESSMENT_DEPARTMENT_ID,
      );
      const matchingApplicationAssessment = applicationAssessments.find(
        (assessment: any) =>
          normalizeText(assessment?.departmentId) ===
          BPLO_ADMIN_ASSESSMENT_DEPARTMENT_ID,
      );
      const totalAmountToSettle = Number(
        matchingSnapshotAssessment?.totalAmount ??
          matchingApplicationAssessment?.totalAmount ??
          0,
      );
      const paymentStatus = normalizeText(
        matchingSnapshotAssessment?.paymentStatus ??
          matchingApplicationAssessment?.paymentStatus,
      ).toLowerCase();
      const amountPaid = paymentStatus === "paid" ? totalAmountToSettle : 0;
      const paidAt =
        matchingSnapshotAssessment?.statusUpdatedAt ??
        matchingApplicationAssessment?.statusUpdatedAt ??
        null;

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
        totalAmountToSettle,
        amountPaid,
        occurredAt: paidAt ?? row.createdAt ?? row.submittedAt ?? null,
      };
    })
    .sort(
      (left, right) =>
        (orderMap.get(left._id) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(right._id) ?? Number.MAX_SAFE_INTEGER),
    );
};

const getBploWorkflowAuditRowsForScope = async (
  params: Omit<GetBploWorkflowAuditParams, "page" | "limit">,
) => {
  const match: Record<string, any> = {
    deletedAt: null,
    status: { $in: [...BPLO_ALLOWED_STATUSES] },
    statusSource: { $in: BPLO_ALLOWED_SOURCES },
  };

  const source = normalizeText(params.source).toLowerCase();
  if (source && BPLO_ALLOWED_SOURCES.includes(source)) {
    match.statusSource = source;
  }
  const permit = normalizeText(params.permit);
  if (permit) {
    match.permitName = { $regex: `^${escapeRegExp(permit)}$`, $options: "i" };
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

  const { ids: statusIds } = await collectWorkflowStatusIds({
    match,
    skip: 0,
    limit: 100,
    collectAll: true,
  });

  if (statusIds.length === 0) return [];

  const hydratedRows = await hydrateBploWorkflowAuditEvents(statusIds);
  const search = normalizeText(params.search).toLowerCase();
  if (!search) return hydratedRows;
  return hydratedRows.filter((row) =>
    buildSearchHaystack(row).includes(search),
  );
};

export const getBploWorkflowAuditEventsS = async (
  params: GetBploWorkflowAuditParams,
) => {
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(100, Math.max(1, Number(params.limit || 20)));
  const skip = (page - 1) * limit;

  const match: Record<string, any> = {
    deletedAt: null,
    status: { $in: [...BPLO_ALLOWED_STATUSES] },
    statusSource: { $in: BPLO_ALLOWED_SOURCES },
  };

  const source = normalizeText(params.source).toLowerCase();
  if (source && BPLO_ALLOWED_SOURCES.includes(source)) {
    match.statusSource = source;
  }
  const permit = normalizeText(params.permit);
  if (permit) {
    match.permitName = { $regex: `^${escapeRegExp(permit)}$`, $options: "i" };
  }

  const permitsPromise = OwnerApplicationStatus.distinct("permitName", {
    deletedAt: null,
    status: { $in: [...BPLO_ALLOWED_STATUSES] },
    statusSource: { $in: BPLO_ALLOWED_SOURCES },
  }).then((values) => {
    const uniquePermits = new Map<string, string>();
    values
      .map((value) => normalizeText(value))
      .filter(Boolean)
      .forEach((value) => {
        const key = value.toLowerCase();
        if (key === "all") return;
        if (!uniquePermits.has(key)) uniquePermits.set(key, value);
      });
    return Array.from(uniquePermits.values()).sort((a, b) =>
      a.localeCompare(b),
    );
  });

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

  if (statusIds.length === 0) {
    const permits = await permitsPromise;
    return {
      data: [],
      permits,
      pagination: {
        page,
        limit,
        total: shouldFilterBySearch ? 0 : total,
        totalPages: Math.max(
          1,
          Math.ceil((shouldFilterBySearch ? 0 : total) / limit),
        ),
        hasNextPage: false,
        hasPrevPage: page > 1,
      },
    };
  }

  const hydratedRows = await hydrateBploWorkflowAuditEvents(statusIds);
  const permits = await permitsPromise;
  const filteredRows = shouldFilterBySearch
    ? hydratedRows.filter((row) => buildSearchHaystack(row).includes(search))
    : hydratedRows;
  const paginatedRows = shouldFilterBySearch
    ? filteredRows.slice(skip, skip + limit)
    : filteredRows;
  const filteredTotal = shouldFilterBySearch ? filteredRows.length : total;

  return {
    data: paginatedRows,
    permits,
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

export const downloadBploWorkflowAuditPdfS = async (
  params: Omit<GetBploWorkflowAuditParams, "page" | "limit">,
) => {
  const rows = await getBploWorkflowAuditRowsForScope(params);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 842;
  const pageHeight = 595;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 36;
  const left = 32;

  const drawHeader = () => {
    page.drawText("BPLO Workflow Audit History", {
      x: left,
      y,
      size: 15,
      font: bold,
      color: rgb(0.06, 0.16, 0.26),
    });
    y -= 18;
    page.drawText(`Generated: ${new Date().toLocaleString("en-PH")}`, {
      x: left,
      y,
      size: 9,
      font,
      color: rgb(0.32, 0.36, 0.43),
    });
    y -= 14;
    const scopeTags: string[] = [];
    if (normalizeText(params.search))
      scopeTags.push(`Search: ${normalizeText(params.search)}`);
    if (normalizeText(params.permit))
      scopeTags.push(`Permit: ${normalizeText(params.permit)}`);
    if (normalizeText(params.dateFrom))
      scopeTags.push(`From: ${normalizeText(params.dateFrom)}`);
    if (normalizeText(params.dateTo))
      scopeTags.push(`To: ${normalizeText(params.dateTo)}`);
    page.drawText(
      `Scope: ${scopeTags.length > 0 ? scopeTags.join(" | ") : "No filters applied (all records)"}`,
      {
        x: left,
        y,
        size: 9,
        font,
        color: rgb(0.32, 0.36, 0.43),
      },
    );
    y -= 18;

    const headers = [
      { label: "When", x: left, max: 22 },
      { label: "Permit", x: 190, max: 18 },
      { label: "Applicant", x: 315, max: 18 },
      { label: "Total To Settle", x: 500, max: 18 },
      { label: "Amount Paid", x: 650, max: 16 },
    ];
    headers.forEach((header) => {
      page.drawText(header.label, {
        x: header.x,
        y,
        size: 9,
        font: bold,
        color: rgb(0.06, 0.16, 0.26),
      });
    });
    y -= 12;
    page.drawLine({
      start: { x: left, y },
      end: { x: pageWidth - left, y },
      thickness: 0.7,
      color: rgb(0.82, 0.85, 0.9),
    });
    y -= 10;
  };

  drawHeader();

  if (rows.length === 0) {
    page.drawText("No records found for the selected filter scope.", {
      x: left,
      y,
      size: 10,
      font,
      color: rgb(0.32, 0.36, 0.43),
    });
  }

  for (const row of rows) {
    if (y < 36) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - 36;
      drawHeader();
    }

    page.drawText(truncateText(formatAuditDateTime(row.occurredAt), 22), {
      x: left,
      y,
      size: 9,
      font,
      color: rgb(0.11, 0.13, 0.17),
    });
    page.drawText(truncateText(row.permitName, 18), {
      x: 190,
      y,
      size: 9,
      font,
      color: rgb(0.11, 0.13, 0.17),
    });
    page.drawText(truncateText(row.applicantName, 18), {
      x: 315,
      y,
      size: 9,
      font,
      color: rgb(0.11, 0.13, 0.17),
    });
    page.drawText(
      truncateText(formatCurrencyForPdf(row.totalAmountToSettle), 18),
      {
        x: 500,
        y,
        size: 9,
        font,
        color: rgb(0.11, 0.13, 0.17),
      },
    );
    page.drawText(truncateText(formatCurrencyForPdf(row.amountPaid), 16), {
      x: 650,
      y,
      size: 9,
      font,
      color: rgb(0.11, 0.13, 0.17),
    });
    y -= 12;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};
