import Account from "@/models/account/account.model";
import PermitApplication from "@/models/permit_application/permit-application.model";
import { getEmailLogoUrl } from "@/services/super_admin/branding.service";
import { AccountType } from "@/types/models/account.type";
import { hashValue } from "@/utils/bcrypt/bcrypt.util";
import { sendAccountCreatedEmail } from "@/utils/emails/AccountCreated";
import { Types } from "mongoose";

const DASHBOARD_ROLE_META = [
  { key: "admins", label: "Admins", queryRole: "bplo_admin" },
  { key: "inspectors", label: "Inspectors", queryRole: "inspector" },
  { key: "evaluators", label: "Evaluators", queryRole: "evaluator" },
  {
    key: "departmentTreasurers",
    label: "Dept Treasurers",
    queryRole: "department_treasurer",
  },
  {
    key: "mainTreasurers",
    label: "Main Treasurers",
    queryRole: "main_treasurer",
  },
] as const;

// Aggregate officer and application metrics for the super admin dashboard.
export const getDashboardData = async () => {
  const [
    roleCounts,
    totalApplications,
    activeApplications,
    approvedApplications,
    rejectedApplications,
    pendingEvaluation,
    pendingInspectionReview,
    activeInspections,
    awaitingPermitApproval,
    readyForRelease,
    applicationsWithPayments,
    fullyPaidApplications,
  ] = await Promise.all([
    Promise.all(
      DASHBOARD_ROLE_META.map((role) =>
        Account.countDocuments({ role: role.queryRole }),
      ),
    ),
    PermitApplication.countDocuments(),
    PermitApplication.countDocuments({
      status: { $in: ["submitted", "in_review"] },
    }),
    PermitApplication.countDocuments({ status: "approved" }),
    PermitApplication.countDocuments({ status: "rejected" }),
    PermitApplication.countDocuments({
      currentStage: "evaluator_application_request",
    }),
    PermitApplication.countDocuments({
      currentStage: "admin_inspection_request",
    }),
    PermitApplication.countDocuments({
      currentStage: "inspector_inspection_request",
    }),
    PermitApplication.countDocuments({
      currentStage: "admin_permit_approval",
      "evaluatorResult.decision": "for_admin_approval",
    }),
    PermitApplication.countDocuments({
      currentStage: "admin_permit_validity",
    }),
    PermitApplication.countDocuments({
      paymentAssessments: { $exists: true, $ne: [] },
    }),
    PermitApplication.countDocuments({
      paymentAssessments: { $exists: true, $ne: [] },
      $nor: [
        {
          paymentAssessments: {
            $elemMatch: {
              paymentStatus: { $ne: "paid" },
            },
          },
        },
      ],
    }),
  ]);

  const countsByKey = DASHBOARD_ROLE_META.reduce(
    (acc, role, index) => {
      acc[role.key] = Number(roleCounts[index] ?? 0);
      return acc;
    },
    {
      admins: 0,
      inspectors: 0,
      evaluators: 0,
      departmentTreasurers: 0,
      mainTreasurers: 0,
    } as Record<(typeof DASHBOARD_ROLE_META)[number]["key"], number>,
  );

  const totalOfficers = DASHBOARD_ROLE_META.reduce(
    (sum, role) => sum + countsByKey[role.key],
    0,
  );

  const rankedRoles = DASHBOARD_ROLE_META.map((role) => {
    const count = countsByKey[role.key];
    const share =
      totalOfficers > 0 ? Math.round((count / totalOfficers) * 100) : 0;

    return {
      key: role.key,
      label: role.label,
      count,
      share,
    };
  }).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.label.localeCompare(right.label);
  });

  const activeRoleMetrics = rankedRoles.filter((role) => role.count > 0);
  const dominantRole = rankedRoles.find((role) => role.count > 0) ?? null;
  const leanestActiveRole =
    activeRoleMetrics.length > 0
      ? [...activeRoleMetrics].sort((left, right) => {
          if (left.count !== right.count) return left.count - right.count;
          return left.label.localeCompare(right.label);
        })[0]
      : null;
  const treasuryCoverage =
    countsByKey.departmentTreasurers + countsByKey.mainTreasurers;
  const coreOperations =
    countsByKey.admins + countsByKey.inspectors + countsByKey.evaluators;
  const awaitingPayment = Math.max(
    0,
    Number(applicationsWithPayments) - Number(fullyPaidApplications),
  );

  return {
    evaluators: countsByKey.evaluators,
    inspectors: countsByKey.inspectors,
    admins: countsByKey.admins,
    departmentTreasurers: countsByKey.departmentTreasurers,
    mainTreasurers: countsByKey.mainTreasurers,
    analytics: {
      totalOfficers,
      activeRoles: activeRoleMetrics.length,
      treasuryCoverage,
      coreOperations,
      dominantRole,
      leanestActiveRole,
    },
    workflow: {
      totalApplications,
      activeApplications,
      approvedApplications,
      rejectedApplications,
      pendingEvaluation,
      pendingInspectionReview,
      activeInspections,
      awaitingPermitApproval,
      readyForRelease,
      applicationsWithPayments,
      awaitingPayment,
      fullyPaidApplications,
    },
  };
};

// Fetch every account assigned to a single role.
export const getUsersByRoles = async (role: string) => {
  return await Account.find({ role: role })
    .select("-password -sessions")
    .sort({ createdAt: -1 })
    .lean();
};

// Fetch the full officer roster across operational roles.
export const getAllOfficers = async () => {
  return await Account.find({
    role: {
      $in: [
        "super_admin",
        "evaluator",
        "inspector",
        "bplo_admin",
        "department_treasurer",
        "main_treasurer",
      ],
    },
  })
    .select("-password -sessions")
    .sort({ createdAt: -1 })
    .lean();
};

// Load one officer record by identifier without sensitive fields.
export const getOfficerByIdS = async (officerId: string) => {
  return Account.findById(officerId).select("-password -sessions").lean();
};

// Group officers by role so the UI can render role-based sections.
export const getAllOfficerGroup = async () => {
  const officer = await Account.aggregate([
    {
      $match: {
        role: {
          $in: [
            "evaluator",
            "inspector",
            "bplo_admin",
            "department_treasurer",
            "main_treasurer",
          ],
        },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $project: {
        firstName: 1,
        lastName: 1,
        email: 1,
        role: 1,
        gender: 1,
        createdAt: 1,
        profilePictureUrl: 1,
      },
    },
    {
      $group: {
        _id: "$role",
        members: { $push: "$$ROOT" },
      },
    },
  ]);

  const initialGroups = {
    bplo_admin: [],
    evaluator: [],
    inspector: [],
    department_treasurer: [],
    main_treasurer: [],
  } as Record<string, any[]>;

  return officer.reduce((acc, curr) => {
    if (acc[curr._id]) {
      acc[curr._id] = curr.members;
    }
    return acc;
  }, initialGroups);
};

// Create a new officer account and notify the recipient by email.
export const createOfficialAccountS = async (data: Partial<AccountType>) => {
  // Store the plain password before hashing for email
  const plainPassword = data.password;

  if (data.password) {
    data.password = await hashValue(data.password);
  }

  const newAccount = await Account.create(data);

  // Send email with account credentials
  if (plainPassword && data.email && data.firstName && data.role) {
    try {
      const logoUrl = await getEmailLogoUrl();
      await sendAccountCreatedEmail(
        data.email,
        data.firstName,
        plainPassword,
        data.role,
        logoUrl,
      );
    } catch (emailError) {
      console.error("Failed to send account creation email:", emailError);
      // Don't throw error - account was created successfully
    }
  }

  // Remove password from response for security
  const accountObj = newAccount.toObject();
  const { password, ...accountWithoutPassword } = accountObj;

  return accountWithoutPassword;
};

// Remove an officer account while preserving non-officer roles.
export const deleteOfficerS = async (officerId: string) => {
  const deletedOfficer = await Account.findOneAndDelete({
    _id: officerId,
    role: {
      $in: [
        "bplo_admin",
        "evaluator",
        "inspector",
        "department_treasurer",
        "main_treasurer",
      ],
    },
  })
    .select("-password -sessions")
    .lean();

  return deletedOfficer;
};

// Check whether an inspector still has live inspection assignments.
export const hasActiveInspectorAssignmentsS = async (officerId: string) => {
  const activeAssignments = await PermitApplication.countDocuments({
    currentStage: "inspector_inspection_request",
    "inspectionFlow.steps": {
      $elemMatch: {
        assignedInspector: new Types.ObjectId(officerId),
        completedAt: null,
      },
    },
  });

  return activeAssignments > 0;
};

// Reassign an officer to another operational role and department.
export const updateOfficerRoleS = async (
  officerId: string,
  data: {
    role: string;
    departmentId?: string;
    departmentName?: string;
    treasurerType?: "department_treasurer" | "main_treasurer" | "";
  },
) => {
  return Account.findOneAndUpdate(
    {
      _id: officerId,
      role: {
        $in: [
          "bplo_admin",
          "evaluator",
          "inspector",
          "department_treasurer",
          "main_treasurer",
        ],
      },
    },
    {
      role: data.role,
      departmentId: data.departmentId ?? "",
      departmentName: data.departmentName ?? "",
      treasurerType: data.treasurerType ?? "",
    },
    {
      returnDocument: "after",
      runValidators: true,
    },
  )
    .select("-password -sessions")
    .lean();
};

// Update the current admin profile while blocking role changes.
export const updateAdminProfile = async (
  id: string,
  data: Partial<AccountType>,
) => {
  delete data.role; // Prevent role updates

  if (data.password) {
    data.password = await hashValue(data.password);
  }

  const admin = await Account.findById(id);

  if (!admin) {
    throw new Error("Admin account not found.");
  }

  Object.assign(admin, data);

  await admin.save();

  const adminObj = admin.toObject();
  const { password, sessions, ...adminWithoutSensitiveData } = adminObj;

  return adminWithoutSensitiveData;
};
