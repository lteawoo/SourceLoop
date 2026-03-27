import { z } from "zod";

export const notebookAccessModeSchema = z.enum(["owner", "shared", "chat-only"]);

export const notebookBindingSchema = z.object({
  id: z.string().min(1),
  type: z.literal("notebook_binding"),
  name: z.string().min(1),
  topic: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookUrl: z.string().url(),
  accessMode: notebookAccessModeSchema,
  description: z.string().min(1).optional(),
  topics: z.array(z.string().min(1)).default([]),
  attachTargetId: z.string().min(1).optional(),
  browserProfile: z.string().min(1).optional(),
  createdAt: z.string().datetime()
});

export type NotebookBinding = z.infer<typeof notebookBindingSchema>;
