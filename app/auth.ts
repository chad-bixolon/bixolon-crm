import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';
import { resolveGoogleIdentity, resolveLinkedSession } from '@/lib/identity';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in', error: '/access-denied' },
  providers: [Google({
    authorization: { params: { scope: 'openid email profile', ...(process.env.GOOGLE_WORKSPACE_DOMAIN ? { hd: process.env.GOOGLE_WORKSPACE_DOMAIN } : {}) } },
  })],
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider !== 'google') return false;
      const result = await resolveGoogleIdentity(prisma, profile ?? {}, process.env.GOOGLE_WORKSPACE_DOMAIN);
      if (!('user' in result)) return `/access-denied?reason=${result.reason}`;
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === 'google' && profile) {
        const result = await resolveGoogleIdentity(prisma, profile, process.env.GOOGLE_WORKSPACE_DOMAIN);
        token.crmUserId = result.user?.id;
        token.crmIdentityId = result.identityId;
      }
      return token;
    },
    async session({ session, token }) {
      const id = token.crmUserId, identityId = token.crmIdentityId;
      const user = typeof id === 'number' && typeof identityId === 'number' ? await resolveLinkedSession(prisma, id, identityId) : null;
      if (user) {
        session.crmUser = { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email, role: user.role, active: true };
      }
      return session;
    },
  },
});
