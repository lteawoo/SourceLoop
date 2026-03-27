import { z } from "zod";

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["url", "pdf", "file", "transcript"]),
  sourceUri: z.string().min(1),
  title: z.string().min(1),
  topicId: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  capturedAt: z.string().datetime(),
  topicTags: z.array(z.string().min(1)).default([]),
  language: z.string().min(1).optional()
});

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
