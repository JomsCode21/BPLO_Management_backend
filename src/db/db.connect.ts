import mongoose from "mongoose";
import dns from "dns";
import { dbEnv } from "@/env/db";

dns.setServers(["8.8.8.8", "1.1.1.1"]);

export default async function initDB() {
  try {
    // Enforce strict query filtering (only fields defined in schema are allowed in queries)
    mongoose.set("strictQuery", true);

    // Enforce strict schema mode (ignore fields not defined in schema)
    mongoose.set("strict", true);

    // Connect to MongoDB using connection string from environment variables
    await mongoose.connect(dbEnv.MONGO_DB_URI);

    // Log successful connection
    console.log("Connected to MongoDB");
  } catch (err) {
    // Log connection error (useful for debugging startup issues)
    console.error("MongoDB connection error:", err);

    // Fail startup if the app cannot connect to the database.
    throw err;
  }
}
