import { z } from "zod";

export const chromeProfileIsolationSchema = z.enum(["isolated", "unknown", "shared"]);
export const chromeAttachOwnershipSchema = z.enum(["sourceloop_managed", "user_managed", "external"]);
export const chromeNotebooklmReadinessSchema = z.enum(["unknown", "validated"]);

const attachTargetBaseSchema = z.object({
  id: z.string().min(1),
  type: z.literal("chrome_attach_target"),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  profileIsolation: chromeProfileIsolationSchema.default("unknown"),
  ownership: chromeAttachOwnershipSchema.default("external"),
  notebooklmReadiness: chromeNotebooklmReadinessSchema.default("unknown"),
  notebooklmValidatedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime()
});

export const chromeProfileAttachTargetSchema = attachTargetBaseSchema.extend({
  targetType: z.literal("profile"),
  ownership: chromeAttachOwnershipSchema.exclude(["external"]).default("user_managed"),
  profileDirPath: z.string().min(1),
  chromeExecutablePath: z.string().min(1).optional(),
  currentProcessId: z.number().int().positive().optional(),
  launchArgs: z.array(z.string()).default([]),
  remoteDebuggingPort: z.number().int().positive().optional()
});

export const chromeEndpointAttachTargetSchema = attachTargetBaseSchema.extend({
  targetType: z.literal("remote_debugging_endpoint"),
  ownership: chromeAttachOwnershipSchema.exclude(["sourceloop_managed"]).default("external"),
  endpoint: z.string().url()
});

export const chromeAttachTargetSchema = z.discriminatedUnion("targetType", [
  chromeProfileAttachTargetSchema,
  chromeEndpointAttachTargetSchema
]);

export type ChromeAttachTarget = z.infer<typeof chromeAttachTargetSchema>;
export type ChromeProfileAttachTarget = z.infer<typeof chromeProfileAttachTargetSchema>;
export type ChromeEndpointAttachTarget = z.infer<typeof chromeEndpointAttachTargetSchema>;
export type ChromeProfileIsolation = z.infer<typeof chromeProfileIsolationSchema>;
export type ChromeAttachOwnership = z.infer<typeof chromeAttachOwnershipSchema>;
export type ChromeNotebooklmReadiness = z.infer<typeof chromeNotebooklmReadinessSchema>;
