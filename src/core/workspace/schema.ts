import { z } from "zod";

export const workspaceConfigSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  paths: z.object({
    chromeTargets: z.string().min(1),
    topics: z.string().min(1),
    sources: z.string().min(1),
    notebookSources: z.string().min(1),
    notebookSetups: z.string().min(1),
    notebookImports: z.string().min(1),
    notebooks: z.string().min(1),
    bundles: z.string().min(1),
    runs: z.string().min(1),
    outputs: z.string().min(1)
  })
});

export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
