import OwnerApplicationStatus from "@/models/owner_application_status/owner-application-status.model";
import { Types } from "mongoose";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const normalizeText = (value: unknown) => String(value ?? "").trim();

// Describe the department treasurer audit query parameters.
type GetDepartmentTreasurerWorkflowAuditParams = {
  departmentId: string;
  page: number;
  limit: number;
  permit?: string;
  source?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

type DepartmentWorkflowAuditCursorRow = {
  _id: unknown;
  application?: unknown;
  statusSource?: string;
};

type DepartmentTreasurerWorkflowAuditEventRow = {
  _id: string;
  applicationId: string;
  permitName: string;
  applicantName: string;
  statusCode: string;
  source: string;
  actorName: string;
  remark: string;
  totalAmountToSettle: number;
  amountPaid: number;
  occurredAt: Date | null;
};

const isDepartmentTreasurerWorkflowAuditEventRow = (
  value: DepartmentTreasurerWorkflowAuditEventRow | null,
): value is DepartmentTreasurerWorkflowAuditEventRow => Boolean(value);

const DEPARTMENT_TREASURER_ALLOWED_STATUSES = new Set([
  "payment_paid",
  "payment_confirmed",
]);

const DEPARTMENT_TREASURER_ALLOWED_SOURCES = ["system", "treasurer"];
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

const buildApplicantName = (applicant: any) => {
  // Build a readable full name for audit output.
  const parts = [
    applicant?.firstName,
    applicant?.middleName,
    applicant?.lastName,
  ]
    .map((part) => normalizeText(part))
    .filter(Boolean);
  const suffix = normalizeText(applicant?.suffix);
  const fullName = suffix ? `${parts.join(" ")} ${suffix}` : parts.join(" ");
  return fullName || "Unknown Applicant";
};

const normalizeLabel = (value: string) =>
  normalizeText(value)
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const resolveTreasurerActor = (row: any, departmentId: string) => {
  // Resolve the actor name from the matching payment snapshot or source.
  const source = normalizeText(row?.statusSource || "system").toLowerCase();
  if (source === "system") return "System";

  const snapshot = Array.isArray(row?.paymentAssessmentSnapshot)
    ? row.paymentAssessmentSnapshot
    : [];
  const match = snapshot.find(
    (assessment: any) =>
      normalizeText(assessment?.departmentId) === normalizeText(departmentId),
  );

  const byName = normalizeText(match?.statusUpdatedByName);
  if (byName) return byName;
  return "Treasurer";
};

const buildDateSearchStrings = (value: Date | null) => {
  // Create searchable date strings in the local timezone.
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

const buildSearchHaystack = (row: DepartmentTreasurerWorkflowAuditEventRow) =>
  [
    ...buildDateSearchStrings(row.occurredAt),
    normalizeLabel(row.statusCode),
    row.statusCode,
    row.permitName,
    row.applicantName,
    String(row.totalAmountToSettle),
    String(row.amountPaid),
    row.remark,
  ]
    .join("\n")
    .toLowerCase();

const formatAuditDateTime = (value: Date | null) => {
  // Format timestamps for audit table and PDF output.
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
};

const formatCurrencyForPdf = (value: number) => {
  // Format currency for PDF rendering.
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `PHP ${safeAmount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const truncateText = (value: string, maxLength: number) => {
  // Clamp long text so PDF columns stay readable.
  const text = normalizeText(value);
  if (text.length <= maxLength) return text || "-";
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
};

const buildBaseMatch = (params: { dateFrom?: string; dateTo?: string }) => {
  // Build the shared query filter for department treasurer audit lookups.
  const match: Record<string, any> = {
    deletedAt: null,
    status: { $in: [...DEPARTMENT_TREASURER_ALLOWED_STATUSES] },
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

  return match;
};

const collectDepartmentWorkflowStatusIds = async (params: {
  match: Record<string, any>;
  source: string;
  skip: number;
  limit: number;
  collectAll?: boolean;
}) => {
  // Stream matching audit status ids while applying pagination rules.
  const ids: string[] = [];
  let total = 0;

  const cursor = OwnerApplicationStatus.find(params.match)
    .select("_id application statusSource")
    .sort({ createdAt: -1, _id: -1 })
    .lean()
    .cursor();

  try {
    for await (const row of cursor as AsyncIterable<DepartmentWorkflowAuditCursorRow>) {
      const rowSource = normalizeText(row.statusSource).toLowerCase();
      if (params.source && rowSource !== params.source) continue;
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

const hydrateDepartmentWorkflowAuditEvents = async (
  statusIds: string[],
  departmentId: string,
): Promise<DepartmentTreasurerWorkflowAuditEventRow[]> => {
  // Populate and shape the final audit rows for response rendering.
  if (statusIds.length === 0) return [];

  const orderMap = new Map(statusIds.map((id, index) => [String(id), index]));

  const rows = await OwnerApplicationStatus.find({
    _id: { $in: statusIds },
  })
    .populate("applicant", "firstName middleName lastName suffix")
    .populate("application", "paymentAssessments")
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  return rows
    .map((row: any) => {
      const statusCode = normalizeText(row.status);
      const isPaidEvent =
        statusCode === "payment_paid" || statusCode === "payment_confirmed";
      const applicationId = Types.ObjectId.isValid(
        String(row.application ?? ""),
      )
        ? String(row.application)
        : "";
      const applicationAssessments = Array.isArray(
        (row.application as any)?.paymentAssessments,
      )
        ? (row.application as any).paymentAssessments
        : [];
      const snapshot = Array.isArray(row?.paymentAssessmentSnapshot)
        ? row.paymentAssessmentSnapshot
        : [];
      const matchingApplicationAssessment = applicationAssessments.find(
        (assessment: any) =>
          normalizeText(assessment?.departmentId) ===
          normalizeText(departmentId),
      );
      const matchingSnapshotAssessment = snapshot.find(
        (assessment: any) =>
          normalizeText(assessment?.departmentId) ===
          normalizeText(departmentId),
      );
      const isDepartmentRelated =
        Boolean(matchingSnapshotAssessment) ||
        Boolean(matchingApplicationAssessment);
      if (!isDepartmentRelated) return null;

      const totalAmountToSettle = Number(
        matchingSnapshotAssessment?.totalAmount ??
          matchingApplicationAssessment?.totalAmount ??
          0,
      );
      const paymentStatus = normalizeText(
        matchingSnapshotAssessment?.paymentStatus ??
          matchingApplicationAssessment?.paymentStatus,
      ).toLowerCase();
      const computedAmountPaid =
        paymentStatus === "paid" ? totalAmountToSettle : 0;
      const amountPaid = isPaidEvent ? totalAmountToSettle : computedAmountPaid;
      const paidAt =
        matchingSnapshotAssessment?.statusUpdatedAt ??
        matchingApplicationAssessment?.statusUpdatedAt ??
        null;

      return {
        _id: String(row._id),
        applicationId,
        permitName: normalizeText(row.permitName) || "Unknown Permit",
        applicantName: buildApplicantName(row.applicant),
        statusCode,
        source: normalizeText(row.statusSource || "system"),
        actorName: resolveTreasurerActor(row, departmentId),
        remark: normalizeText(row.adminRemark),
        totalAmountToSettle,
        amountPaid,
        occurredAt: paidAt ?? row.createdAt ?? row.submittedAt ?? null,
      };
    })
    .filter(isDepartmentTreasurerWorkflowAuditEventRow)
    .sort(
      (left, right) =>
        (orderMap.get(left._id) ?? Number.MAX_SAFE_INTEGER) -
        (orderMap.get(right._id) ?? Number.MAX_SAFE_INTEGER),
    );
};

const getDepartmentTreasurerWorkflowAuditRowsForScope = async (
  params: Omit<GetDepartmentTreasurerWorkflowAuditParams, "page" | "limit">,
) => {
  // Load and optionally search department treasurer audit events.
  const match = buildBaseMatch({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
  const permit = normalizeText(params.permit);
  if (permit) {
    match.permitName = { $regex: `^${escapeRegExp(permit)}$`, $options: "i" };
  }

  const source = normalizeText(params.source).toLowerCase();
  const normalizedSource =
    source && DEPARTMENT_TREASURER_ALLOWED_SOURCES.includes(source)
      ? source
      : "";

  const search = normalizeText(params.search).toLowerCase();
  const shouldFilterBySearch = search.length > 0;
  const { ids: statusIds } = await collectDepartmentWorkflowStatusIds({
    match,
    source: normalizedSource,
    skip: 0,
    limit: 100,
    collectAll: true,
  });

  if (statusIds.length === 0) {
    return [];
  }

  const hydratedRows = await hydrateDepartmentWorkflowAuditEvents(
    statusIds,
    params.departmentId,
  );
  return shouldFilterBySearch
    ? hydratedRows.filter((row) => buildSearchHaystack(row).includes(search))
    : hydratedRows;
};

export const getDepartmentTreasurerWorkflowAuditEventsS = async (
  params: GetDepartmentTreasurerWorkflowAuditParams,
) => {
  // Return paginated department treasurer workflow audit results.
  const page = Math.max(1, Number(params.page || 1));
  const limit = Math.min(100, Math.max(1, Number(params.limit || 20)));
  const skip = (page - 1) * limit;

  const match = buildBaseMatch({});
  const permitsPromise = OwnerApplicationStatus.distinct(
    "permitName",
    match,
  ).then((values) => {
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

  const filteredRows =
    await getDepartmentTreasurerWorkflowAuditRowsForScope(params);
  const paginatedRows = filteredRows.slice(skip, skip + limit);
  const filteredTotal = filteredRows.length;
  const permits = await permitsPromise;

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

export const downloadDepartmentTreasurerWorkflowAuditPdfS = async (
  params: Omit<GetDepartmentTreasurerWorkflowAuditParams, "page" | "limit">,
) => {
  const rows = await getDepartmentTreasurerWorkflowAuditRowsForScope(params);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 842;
  const pageHeight = 595;
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - 36;
  const left = 32;

  const drawHeader = () => {
    page.drawText("Department Treasurer Workflow History", {
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
      { label: "When", x: left },
      { label: "Permit", x: 190 },
      { label: "Applicant", x: 315 },
      { label: "Total To Settle", x: 500 },
      { label: "Amount Paid", x: 650 },
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
