import { z } from 'zod';

// ============================================================================
// Roles & Status
// ============================================================================

export const UserRoleSchema = z.enum(['admin', 'player']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(['active', 'inactive', 'banned']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

// ============================================================================
// JWT
// ============================================================================

export interface JwtPayload {
  userId: string;
  role: UserRole;
}

// ============================================================================
// Safe user representation (no password hash)
// ============================================================================

export const AuthenticatedUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  email: z.string().email(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

// ============================================================================
// Request schemas
// ============================================================================

export const RegisterRequestSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// ============================================================================
// Response schema
// ============================================================================

export const AuthResponseSchema = z.object({
  token: z.string(),
  user: AuthenticatedUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
