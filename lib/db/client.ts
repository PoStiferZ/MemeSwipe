import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

const queryClient = postgres(url, {
  prepare: false,
  max: process.env.NODE_ENV === "production" ? 5 : 10,
});

export const db = drizzle(queryClient, { schema });
export { schema };
