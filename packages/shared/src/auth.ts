import { z } from 'zod';

// Roles & Status

export type UserRole = 'admin' | 'player' | 'bot';
export type UserStatus = 'active' | 'inactive' | 'banned';

// JWT

export interface JwtPayload {
  userId: string;
  role: UserRole;
}

// Safe user representation (no password hash)

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Request schemas

export const RegisterRequestSchema = z.object({
  // Bot accounts own these names; a player taking one would get its bot station.
  username: z
    .string()
    .trim()
    .min(3)
    .max(50)
    .refine((name) => !name.toLowerCase().startsWith('orion-bot-'), 'Username is reserved'),
  // Lowercased, so Bob@x.com and bob@x.com are one account.
  email: z
    .email()
    .max(255)
    .toLowerCase()
    .refine((email) => !email.endsWith('@system.invalid'), 'Email domain is reserved'),
  password: z.string().min(12).max(128),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.email().max(255).toLowerCase(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

// Response schema

export interface AuthResponse {
  token: string;
  user: AuthenticatedUser;
}
