import mongoose, { ClientSession } from "mongoose";

type TransactionOperation<T> = (session: ClientSession) => Promise<T>;

// Runs a database operation inside a mongoose transaction session.
export const runInTransaction = async <T>(
  operation: TransactionOperation<T>,
) => {
  const session = await mongoose.startSession();

  let result!: T;
  let hasResult = false;

  try {
    await session.withTransaction(async () => {
      result = await operation(session);
      hasResult = true;
    });

    if (!hasResult) {
      throw new Error("Transaction finished without a result.");
    }

    return result;
  } finally {
    await session.endSession();
  }
};
