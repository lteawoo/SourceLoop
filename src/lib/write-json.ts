import { writeFile } from "node:fs/promises";

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

