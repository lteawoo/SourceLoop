import { z } from "zod";

export const runStatusSchema = z.enum(["planned", "running", "completed", "incomplete", "failed"]);
export const questionKindSchema = z.enum(["core", "structure", "deep_dive", "comparison", "execution", "evidence_gap"]);

export const plannedQuestionSchema = z.object({
  id: z.string().min(1),
  kind: questionKindSchema,
  prompt: z.string().min(1),
  objective: z.string().min(1),
  order: z.number().int().nonnegative()
});

export const planningScopeSchema = z.object({
  maxQuestions: z.number().int().positive().optional(),
  selectedFamilies: z.array(questionKindSchema).min(1).optional()
});

export const executionScopeSchema = z.object({
  questionIds: z.array(z.string().min(1)).min(1).optional(),
  fromQuestionId: z.string().min(1).optional(),
  limit: z.number().int().positive().optional()
});

export const questionBatchSchema = z.object({
  id: z.string().min(1),
  type: z.literal("question_batch"),
  topic: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  objective: z.string().min(1),
  intendedOutput: z.string().min(1).optional(),
  questionFamilies: z.array(z.string().min(1)).default([]),
  planningScope: planningScopeSchema.optional(),
  createdAt: z.string().datetime(),
  questions: z.array(plannedQuestionSchema).min(1)
});

export const citationReferenceSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  note: z.string().min(1).optional()
});

export const qaExchangeSchema = z.object({
  id: z.string().min(1),
  type: z.literal("qa_exchange"),
  runId: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  questionId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
  citations: z.array(citationReferenceSchema),
  createdAt: z.string().datetime(),
  answerSource: z.literal("notebooklm")
});

export const runIndexSchema = z.object({
  id: z.string().min(1),
  type: z.literal("qa_run"),
  topic: z.string().min(1),
  topicId: z.string().min(1).optional(),
  notebookBindingId: z.string().min(1),
  questionBatchId: z.string().min(1),
  status: runStatusSchema,
  executionMode: z.enum(["attached_chrome", "fixture"]).optional(),
  attachedChromeTargetId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  planningScope: planningScopeSchema.optional(),
  executionScope: executionScopeSchema.optional(),
  completedQuestionIds: z.array(z.string().min(1)).default([]),
  failedQuestionId: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
  outputArtifacts: z.array(z.string().min(1)).default([])
});

export const outputArtifactSchema = z.object({
  id: z.string().min(1),
  type: z.literal("output_artifact"),
  runId: z.string().min(1),
  topicId: z.string().min(1).optional(),
  format: z.enum(["brief", "outline"]),
  createdAt: z.string().datetime(),
  supportingExchangeIds: z.array(z.string().min(1)).default([])
});

export type CitationReference = z.infer<typeof citationReferenceSchema>;
export type PlannedQuestion = z.infer<typeof plannedQuestionSchema>;
export type PlanningScope = z.infer<typeof planningScopeSchema>;
export type ExecutionScope = z.infer<typeof executionScopeSchema>;
export type QuestionBatch = z.infer<typeof questionBatchSchema>;
export type QAExchange = z.infer<typeof qaExchangeSchema>;
export type QARunIndex = z.infer<typeof runIndexSchema>;
export type OutputArtifact = z.infer<typeof outputArtifactSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
