import { z } from "zod";

export const topicStatusSchema = z.enum(["initialized", "collecting_sources", "ready_for_planning", "researched"]);

export const researchTopicSchema = z.object({
  id: z.string().min(1),
  type: z.literal("research_topic"),
  name: z.string().min(1),
  goal: z.string().min(1).optional(),
  intendedOutput: z.string().min(1).optional(),
  status: topicStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const topicCorpusManifestSchema = z.object({
  id: z.string().min(1),
  type: z.literal("topic_corpus"),
  topicId: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).default([]),
  notebookBindingIds: z.array(z.string().min(1)).default([]),
  notebookSourceManifestIds: z.array(z.string().min(1)).default([]),
  managedNotebookImportIds: z.array(z.string().min(1)).default([]),
  runIds: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type ResearchTopic = z.infer<typeof researchTopicSchema>;
export type TopicStatus = z.infer<typeof topicStatusSchema>;
export type TopicCorpusManifest = z.infer<typeof topicCorpusManifestSchema>;
