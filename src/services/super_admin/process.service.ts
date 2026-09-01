import InspectionProcess from "@/models/process/process.model";
import { InspectionDepartmentType } from "@/types/models/process.type";

const DEFAULT_PROCESS_KEY = "inspection_process";
const DEFAULT_PROCESS_NAME = "Inspection Process";

const normalizeDepartments = (departments: InspectionDepartmentType[]) => {
  // Re-number departments so the saved order stays contiguous.
  return [...departments]
    .sort((a, b) => a.sequence - b.sequence)
    .map((department, index) => ({
      ...department,
      sequence: index + 1,
    }));
};

export const getInspectionProcessS = async () => {
  // Load or initialize the shared inspection process record.
  const process = await InspectionProcess.findOne({
    key: DEFAULT_PROCESS_KEY,
  }).lean();
  if (process) return process;

  const created = await InspectionProcess.create({
    key: DEFAULT_PROCESS_KEY,
    name: DEFAULT_PROCESS_NAME,
    departments: [],
  });

  return created.toObject();
};

export const saveInspectionProcessS = async (
  departments: InspectionDepartmentType[],
) => {
  // Save the normalized inspection department sequence.
  const updated = await InspectionProcess.findOneAndUpdate(
    { key: DEFAULT_PROCESS_KEY },
    {
      key: DEFAULT_PROCESS_KEY,
      name: DEFAULT_PROCESS_NAME,
      departments: normalizeDepartments(departments),
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  ).lean();

  return updated;
};
