import { z } from "zod";

export const managedNotebookSetupSchema = z.object({
  id: z.string().min(1),
  type: z.literal("managed_notebook_setup"),
  topicId: z.string().min(1),
  notebookBindingId: z.string().min(1),
  remoteNotebookId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  attachTargetId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const managedNotebookImportStatusSchema = z.enum(["queued", "imported", "failed"]);

export const managedNotebookImportSchema = z.object({
  id: z.string().min(1),
  type: z.literal("managed_notebook_import"),
  topicId: z.string().min(1),
  notebookBindingId: z.string().min(1),
  managedNotebookSetupId: z.string().min(1),
  originType: z.enum(["source_artifact", "remote_url"]),
  sourceId: z.string().min(1).optional(),
  sourceUri: z.string().min(1),
  title: z.string().min(1),
  importKind: z.enum(["file_upload", "youtube_url", "web_url"]),
  status: managedNotebookImportStatusSchema,
  failureReason: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ManagedNotebookSetup = z.infer<typeof managedNotebookSetupSchema>;
export type ManagedNotebookImport = z.infer<typeof managedNotebookImportSchema>;
export type ManagedNotebookImportStatus = z.infer<typeof managedNotebookImportStatusSchema>;
