import Account from "@/models/account/account.model";

export const pullExpiredSessionsS = async (accountId: string) => {
  // Remove expired sessions before token refresh or validation.
  return Account.updateOne(
    { _id: accountId },
    { $pull: { sessions: { expiresAt: { $lt: new Date() } } } },
  ).exec();
};
