import bcrypt from "bcryptjs";

// Hashes a plain text value using bcrypt with a generated salt.
export const hashValue = async (value: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10);
  return await bcrypt.hash(value, salt);
};

// Compares an entered value against an existing bcrypt hash.
export const compareHashed = async (
  enteredValue: string,
  storedValue: string,
): Promise<boolean> => {
  return await bcrypt.compare(enteredValue, storedValue);
};
