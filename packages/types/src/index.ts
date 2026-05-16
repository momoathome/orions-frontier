import { z } from 'zod';

// ============================================================================
// Common Types
// ============================================================================

export const UserRoleSchema = z.enum(['admin', 'player']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(['active', 'inactive', 'banned']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

// ============================================================================
// User DTOs
// ============================================================================

export const UserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(50),
  email: z.string().email(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(8),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type LoginDto = z.infer<typeof LoginSchema>;

// ============================================================================
// Auth DTOs
// ============================================================================

export const AuthResponseSchema = z.object({
  user: UserSchema,
  token: z.string(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ============================================================================
// API Response Types
// ============================================================================

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiSuccessSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: ApiErrorSchema,
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

// ============================================================================
// WebSocket Event Types
// ============================================================================

export const WsEventTypeSchema = z.enum([
  'connection',
  'disconnect',
  'ping',
  'pong',
  'error',
  'authenticate',
  'authenticated',
  'building_upgrade_completed',
]);

export type WsEventType = z.infer<typeof WsEventTypeSchema>;

export const WsMessageSchema = z.object({
  type: WsEventTypeSchema,
  payload: z.record(z.unknown()).optional(),
  timestamp: z.number(),
});

export type WsMessage = z.infer<typeof WsMessageSchema>;

// ============================================================================
// Placeholder Game Types (to be extended in later phases)
// ============================================================================

export const ResourceTypeSchema = z.enum(['metal', 'crystal', 'deuterium', 'energy']);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const BuildingTypeSchema = z.enum(['mine', 'factory', 'defense']);
export type BuildingType = z.infer<typeof BuildingTypeSchema>;

export const SpacecraftTypeSchema = z.enum(['fighter', 'cruiser', 'battleship']);
export type SpacecraftType = z.infer<typeof SpacecraftTypeSchema>;
