import { z } from "zod";

export const notebookSourceKindSchema = z.enum([
  "youtube-playlist",
  "youtube-channel",
  "document-set",
  "web-collection",
  "mixed",
  "other"
]);

export const notebookSourceManifestSchema = z.object({
  id: z.string().min(1),
  type: z.literal("notebook_source_manifest"),
  topicId: z.string().min(1),
  notebookBindingId: z.string().min(1),
  kind: notebookSourceKindSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  itemCount: z.number().int().positive().optional(),
  refs: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type NotebookSourceKind = z.infer<typeof notebookSourceKindSchema>;
export type NotebookSourceManifest = z.infer<typeof notebookSourceManifestSchema>;
