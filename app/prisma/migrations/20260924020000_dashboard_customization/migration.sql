-- Dashboard layouts contain presentation state only. Permissions and report
-- visibility are deliberately resolved at read and write time by the app.
CREATE TABLE "RoleDashboardLayout" (
    "role" "UserRole" NOT NULL,
    "configuration" JSONB NOT NULL,
    "updatedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RoleDashboardLayout_pkey" PRIMARY KEY ("role")
);

CREATE TABLE "UserDashboardLayout" (
    "userId" INTEGER NOT NULL,
    "role" "UserRole" NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserDashboardLayout_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "RoleDashboardLayout_updatedById_idx" ON "RoleDashboardLayout"("updatedById");
CREATE INDEX "UserDashboardLayout_role_idx" ON "UserDashboardLayout"("role");

ALTER TABLE "RoleDashboardLayout" ADD CONSTRAINT "RoleDashboardLayout_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserDashboardLayout" ADD CONSTRAINT "UserDashboardLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
