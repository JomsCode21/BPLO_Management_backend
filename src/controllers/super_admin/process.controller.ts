import * as ProcessService from "@/services/super_admin/process.service";
import { InspectionDepartmentType } from "@/types/models/process.type";
import { AppError } from "@/utils/error/app-error.util";
import { NextFunction, Request, Response } from "express";

const buildDepartmentId = (name: string, index: number) => {
  // Build a stable fallback id from department name and position.
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || `department_${index + 1}`;
};

const sanitizeDepartments = (raw: unknown): InspectionDepartmentType[] => {
  // Validate and normalize department entries before persistence.
  if (!Array.isArray(raw)) {
    throw new AppError("Departments must be an array.", 400);
  }

  const departments = raw.map((item, index) => {
    const name = String((item as any)?.name ?? "").trim();
    if (!name) {
      throw new AppError(`Department #${index + 1} must have a name.`, 400);
    }

    return {
      id: String((item as any)?.id ?? buildDepartmentId(name, index)).trim(),
      name,
      sequence: Number.isFinite((item as any)?.sequence)
        ? Number((item as any).sequence)
        : index + 1,
    };
  });

  const names = new Set<string>();
  for (const department of departments) {
    const key = department.name.toLowerCase();
    if (names.has(key)) {
      throw new AppError(`Duplicate department name: ${department.name}`, 400);
    }
    names.add(key);
  }

  return departments;
};

export const getInspectionProcess = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Retrieve the current inspection routing process configuration.
    const process = await ProcessService.getInspectionProcessS();
    return res.status(200).json({
      success: true,
      message: "Inspection process retrieved successfully.",
      data: process,
    });
  } catch (error) {
    return next(error);
  }
};

export const saveInspectionProcess = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Validate and save the updated inspection process departments.
    const departments = sanitizeDepartments(req.body?.departments);
    const process = await ProcessService.saveInspectionProcessS(departments);

    return res.status(200).json({
      success: true,
      message: "Inspection process saved successfully.",
      data: process,
    });
  } catch (error) {
    return next(error);
  }
};
