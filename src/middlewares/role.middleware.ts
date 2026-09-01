import { Request, Response, NextFunction } from "express";
import { AppError } from "@/utils/error/app-error.util";
import { AccountDocumentType } from "@/types/models/account.type";

interface AuthedRequest extends Request {
    account?: AccountDocumentType | null;
}

// I changed the name to be more universal and made it accept an array of roles
export const requireRoles = (allowedRoles: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const authedRequest = req as AuthedRequest;

        // Check if they are logged in at all
        if (!authedRequest.account) {
            return next(new AppError("Unauthorized: You are not logged in.", 401));
        }

        // Identify the user's role
        const userRole = authedRequest.account.role;

        // Check if their role is inside the allowed list
        if (!allowedRoles.includes(userRole)) {
            return next(new AppError(`Forbidden: Your role (${userRole}) does not have access.`, 403));
        }

        // If they have the right role, let them through
        next();
    };
};