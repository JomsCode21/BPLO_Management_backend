import Account from "@/models/account/account.model";
import InspectionProcess from "@/models/process/process.model";
import * as AdminService from "@/services/super_admin/admin.service";
import { InspectionDepartmentType } from "@/types/models/process.type";
import { emitDashboardStats } from "@/utils/admin/emit-dashboard-stats.util";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";

const OFFICER_ROLES = [
  "evaluator",
  "inspector",
  "bplo_admin",
  "department_treasurer",
  "main_treasurer",
];

const requiresDepartment = (role: string) => {
  // Require department assignment only for department-scoped officer roles.
  return role === "inspector" || role === "department_treasurer";
};

const getTreasurerTypeByRole = (role: string) => {
  // Map officer role to treasurer subtype when applicable.
  if (role === "department_treasurer") return "department_treasurer" as const;
  if (role === "main_treasurer") return "main_treasurer" as const;
  return "" as const;
};

const assertDepartmentTreasurerAvailability = async (
  departmentId: string,
  excludeOfficerId?: string,
) => {
  // Enforce one department treasurer account per department.
  const existingDepartmentTreasurer = await Account.findOne({
    role: "department_treasurer",
    departmentId,
    ...(excludeOfficerId ? { _id: { $ne: excludeOfficerId } } : {}),
  })
    .select("_id")
    .lean();

  if (existingDepartmentTreasurer) {
    throw new AppError(
      "Selected department already has a department treasurer assigned.",
      409,
    );
  }
};

// Dashboard Stats
export const getDashboard = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve dashboard statistics for super admin monitoring.
    const stats = await AdminService.getDashboardData();
    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

// Create official accounts
export const createOfficerAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Validate and create a new officer account by role and department.
    const {
      firstName,
      middleName,
      lastName,
      suffix,
      gender,
      email,
      password,
      role,
      departmentId,
    } = req.body;

    // Manual Validation
    if (!firstName || !lastName || !gender || !email || !password || !role) {
      return next(new AppError("All required fields must be provided.", 400));
    }

    if (!OFFICER_ROLES.includes(role)) {
      return next(new AppError("Invalid role selected.", 400));
    }

    let resolvedDepartmentId = "";
    let resolvedDepartmentName = "";

    if (requiresDepartment(role)) {
      const rawDepartmentId = String(departmentId ?? "").trim();
      if (!rawDepartmentId) {
        return next(
          new AppError(
            "Department is required for inspector and department treasurer accounts.",
            400,
          ),
        );
      }

      const process = await InspectionProcess.findOne({
        key: "inspection_process",
      }).lean();
      const departments = (process?.departments ??
        []) as InspectionDepartmentType[];
      const department = departments.find(
        (item) => item.id === rawDepartmentId,
      );

      if (!department) {
        return next(
          new AppError(
            "Selected department is invalid or no longer available.",
            400,
          ),
        );
      }

      resolvedDepartmentId = department.id;
      resolvedDepartmentName = department.name;
    }

    const existingAccount = await Account.findOne({ email: email });
    if (existingAccount) {
      return next(
        new AppError("An account with this email already exists.", 409),
      );
    }

    if (role === "department_treasurer" && resolvedDepartmentId) {
      await assertDepartmentTreasurerAvailability(resolvedDepartmentId);
    }

    const newOfficer = await AdminService.createOfficialAccountS({
      firstName,
      middleName,
      lastName,
      suffix,
      gender,
      email,
      password,
      role,
      departmentId: resolvedDepartmentId,
      departmentName: resolvedDepartmentName,
      treasurerType: getTreasurerTypeByRole(String(role)),
    });

    // Broadcast updated dashboard stats to all connected clients
    await emitDashboardStats();

    res.status(201).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} account created successfully.`,
      data: newOfficer,
    });
  } catch (error) {
    next(error);
  }
};

// Get all officers by role
export const getOfficers = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve officer accounts, optionally filtered by role.
    const role = req.query.role as string;

    const allowedRoles = [
      "evaluator",
      "inspector",
      "bplo_admin",
      "super_admin",
      "department_treasurer",
      "main_treasurer",
    ];

    // If no role specified, return all officers
    if (!role) {
      const officers = await AdminService.getAllOfficers();
      return res.status(200).json({
        success: true,
        message: "All officers retrieved successfully.",
        data: officers,
      });
    }

    // If role specified, validate and filter by role
    if (!allowedRoles.includes(role)) {
      return next(
        new AppError(
          "Please provide a valid role (evaluator, inspector, bplo_admin, super_admin, department_treasurer, main_treasurer).",
          400,
        ),
      );
    }

    const officers = await AdminService.getUsersByRoles(role);

    res.status(200).json({
      success: true,
      message: `${role.charAt(0).toUpperCase() + role.slice(1)}s retrieved successfully.`,
      data: officers,
    });
  } catch (error) {
    next(error);
  }
};

export const getOfficerById = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve a single officer record eligible for management.
    const officerId = String(req.params.officerId ?? "");

    if (!Types.ObjectId.isValid(officerId)) {
      return next(new AppError("Invalid officer ID.", 400));
    }

    const officer = await AdminService.getOfficerByIdS(officerId);

    if (!officer) {
      return next(new AppError("Officer not found.", 404));
    }

    if (!OFFICER_ROLES.includes(String(officer.role ?? ""))) {
      return next(
        new AppError(
          "Only BPLO admin, evaluator, inspector, and treasurer accounts can be edited from this page.",
          400,
        ),
      );
    }

    return res.status(200).json({
      success: true,
      message: "Officer retrieved successfully.",
      data: officer,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateOfficerAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Update an existing officer role with validation and constraints.
    const officerId = String(req.params.officerId ?? "");
    const requesterId = String((req as any).account?._id ?? "");
    const role = String(req.body.role ?? "")
      .trim()
      .toLowerCase();
    const requestedDepartmentId = String(req.body.departmentId ?? "").trim();

    if (!Types.ObjectId.isValid(officerId)) {
      return next(new AppError("Invalid officer ID.", 400));
    }

    if (!role) {
      return next(new AppError("Role is required.", 400));
    }

    if (requesterId && requesterId === officerId) {
      return next(new AppError("You cannot edit your own account role.", 400));
    }

    if (!OFFICER_ROLES.includes(role)) {
      return next(new AppError("Invalid role selected.", 400));
    }

    const existingOfficer = await AdminService.getOfficerByIdS(officerId);

    if (!existingOfficer) {
      return next(new AppError("Officer not found.", 404));
    }

    if (!OFFICER_ROLES.includes(String(existingOfficer.role ?? ""))) {
      return next(
        new AppError(
          "Only BPLO admin, evaluator, inspector, and treasurer accounts can be edited from this page.",
          400,
        ),
      );
    }

    if (
      existingOfficer.role === "inspector" &&
      role !== "inspector" &&
      (await AdminService.hasActiveInspectorAssignmentsS(officerId))
    ) {
      return next(
        new AppError(
          "This inspector still has active inspection assignments. Reassign or complete them first.",
          409,
        ),
      );
    }

    let resolvedDepartmentId = "";
    let resolvedDepartmentName = "";

    if (requiresDepartment(role)) {
      const rawDepartmentId =
        requestedDepartmentId ||
        String(existingOfficer.departmentId ?? "").trim();

      if (!rawDepartmentId) {
        return next(
          new AppError(
            "Department is required for inspector and department treasurer accounts.",
            400,
          ),
        );
      }

      const process = await InspectionProcess.findOne({
        key: "inspection_process",
      }).lean();
      const departments = (process?.departments ??
        []) as InspectionDepartmentType[];
      const department = departments.find(
        (item) => item.id === rawDepartmentId,
      );

      if (!department) {
        return next(
          new AppError(
            "Selected department is invalid or no longer available.",
            400,
          ),
        );
      }

      resolvedDepartmentId = department.id;
      resolvedDepartmentName = department.name;
    }

    if (role === "department_treasurer" && resolvedDepartmentId) {
      await assertDepartmentTreasurerAvailability(
        resolvedDepartmentId,
        officerId,
      );
    }

    const updatedOfficer = await AdminService.updateOfficerRoleS(officerId, {
      role,
      departmentId: resolvedDepartmentId,
      departmentName: resolvedDepartmentName,
      treasurerType: getTreasurerTypeByRole(role),
    });

    if (!updatedOfficer) {
      return next(new AppError("Officer not found.", 404));
    }

    await emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Officer updated successfully.",
      data: updatedOfficer,
    });
  } catch (error) {
    return next(error);
  }
};

export const deleteOfficerAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Delete an officer account after access and role checks.
    const officerId = String(req.params.officerId ?? "");
    const requesterId = String((req as any).account?._id ?? "");

    if (!Types.ObjectId.isValid(officerId)) {
      return next(new AppError("Invalid officer ID.", 400));
    }

    if (requesterId && requesterId === officerId) {
      return next(new AppError("You cannot delete your own account.", 400));
    }

    const existingOfficer = await Account.findById(officerId)
      .select("role")
      .lean();

    if (!existingOfficer) {
      return next(new AppError("Officer not found.", 404));
    }

    if (!OFFICER_ROLES.includes(String(existingOfficer.role ?? ""))) {
      return next(
        new AppError(
          "Only BPLO admin, evaluator, inspector, and treasurer accounts can be deleted from this page.",
          400,
        ),
      );
    }

    const deletedOfficer = await AdminService.deleteOfficerS(officerId);

    if (!deletedOfficer) {
      return next(new AppError("Officer not found.", 404));
    }

    await emitDashboardStats();

    return res.status(200).json({
      success: true,
      message: "Officer deleted successfully.",
      data: deletedOfficer,
    });
  } catch (error) {
    return next(error);
  }
};

// Update admin profile
export const updateProfile = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Update profile details for the currently authenticated admin.
    const adminId = (req as any).account._id;
    const updateAdmin = await AdminService.updateAdminProfile(
      adminId,
      req.body,
    );

    res.status(200).json({
      status: "success",
      message: "Profile updated successfully.",
      data: updateAdmin,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return next(new AppError("Email already exists.", 409));
    }
    next(error);
  }
};
