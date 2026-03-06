import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // In dev, Vite proxy handles /api/* → backend
  // In production, same origin serves both
  baseURL: import.meta.env.VITE_API_URL || '',
});

// Export commonly used hooks and methods
export const {
  useSession,
  signIn,
  signUp,
  signOut,
} = authClient;
