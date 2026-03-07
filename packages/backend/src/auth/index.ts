import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db/client.js';
import * as schema from '../db/schema.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../shared/logger.js';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  secret: process.env.SESSION_SECRET,
  baseURL: process.env.BASE_URL || 'http://localhost:3000',
  basePath: '/api/auth',
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'user',
        input: false,
      },
      timezone: {
        type: 'string',
        defaultValue: 'UTC',
        input: true,
      },
      locale: {
        type: 'string',
        defaultValue: 'zh-CN',
        input: true,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const adminEmail = process.env.ADMIN_EMAIL;
          if (adminEmail && user.email === adminEmail) {
            db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id)).run();
            logger.info({ userId: user.id }, 'Auto-promoted user to admin');
          }
        },
      },
    },
  },
  trustedOrigins: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ],
});

export type Auth = typeof auth;
