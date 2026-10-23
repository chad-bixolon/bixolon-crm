import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { resolveGoogleIdentity, resolveLinkedSession } from '@/lib/identity';
import { e2eAuthEnabled } from '@/lib/e2e-auth';
import { activeTrustedDomains, emailDomain, trustedGoogleDomain } from '@/lib/trusted-domains';

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/sign-in', error: '/access-denied' },
  providers: [Google({
    authorization: { params: { scope: 'openid email profile' } },
  }), ...(e2eAuthEnabled() ? [Credentials({ id: 'e2e', name: 'Local E2E', credentials: { email: {}, token: {} }, async authorize(credentials) {
    if (!e2eAuthEnabled() || credentials?.token !== process.env.E2E_AUTH_TOKEN || typeof credentials.email !== 'string' || !credentials.email.endsWith('@e2e.saleshub.local')) return null;
    const user = await prisma.user.findUnique({ where: { email: credentials.email } });
    return user?.active && !user.archivedAt ? { id: String(user.id), email: user.email, name: `${user.firstName} ${user.lastName}` } : null;
  } })] : [])],
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider === 'e2e') return e2eAuthEnabled();
      if (account?.provider !== 'google') return false;
      const result = await resolveGoogleIdentity(prisma, profile ?? {}, await activeTrustedDomains(prisma));
      if (!('user' in result)) return `/access-denied?reason=${result.reason}`;
      return true;
    },
    async jwt({ token, account, profile }) {
      if (account?.provider === 'e2e' && e2eAuthEnabled()) token.e2eUserId = Number(token.sub);
      if (account?.provider === 'google' && profile) {
        const result = await resolveGoogleIdentity(prisma, profile, await activeTrustedDomains(prisma));
        token.crmUserId = result.user?.id;
        token.crmIdentityId = result.identityId;
        token.googleHostedDomain = typeof profile.hd === 'string' ? profile.hd.toLowerCase() : undefined;
        token.googleEmail = typeof profile.email === 'string' ? profile.email.toLowerCase() : undefined;
      }
      return token;
    },
    async session({ session, token }) {
      if (e2eAuthEnabled() && typeof token.e2eUserId === 'number') {
        const user = await prisma.user.findUnique({ where: { id: token.e2eUserId } });
        if (user?.active && !user.archivedAt && user.email.endsWith('@e2e.saleshub.local')) session.crmUser = { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email, role: user.role, delegatedUserAdministrationEnabled: user.delegatedUserAdministrationEnabled, active: true };
        return session;
      }
      const id = token.crmUserId, identityId = token.crmIdentityId;
      const trusted = await activeTrustedDomains(prisma);
      // Older JWTs lack the hosted-domain claim; they were issued under the former
      // single-domain check, so use their signed Google email until renewed.
      const googleEmail = token.googleEmail ?? token.email ?? undefined;
      const domain = token.googleHostedDomain ?? emailDomain(googleEmail ?? '');
      const user = trustedGoogleDomain(domain, googleEmail, trusted) && typeof id === 'number' && typeof identityId === 'number' ? await resolveLinkedSession(prisma, id, identityId) : null;
      if (user) {
        session.crmUser = { id: user.id, name: `${user.firstName} ${user.lastName}`, email: user.email, role: user.role, delegatedUserAdministrationEnabled: user.delegatedUserAdministrationEnabled, active: true };
        session.googleHostedDomain = domain;
        session.googleEmail = googleEmail;
      }
      return session;
    },
  },
});
