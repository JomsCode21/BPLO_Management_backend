import { Document } from "mongoose";

// Represents one inspection department node in the process flow.
export type InspectionDepartmentType = {
  id: string;
  name: string;
  sequence: number;
};

// Represents the inspection workflow configuration document.
export type InspectionProcessType = {
  _id: string;
  key: "inspection_process";
  name: string;
  departments: InspectionDepartmentType[];
  createdAt?: Date;
  updatedAt?: Date;
};

// Represents a hydrated mongoose inspection process document.
export type InspectionProcessDocumentType = InspectionProcessType & Document;
