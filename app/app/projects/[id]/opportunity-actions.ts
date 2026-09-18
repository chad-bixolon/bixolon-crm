"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMutation } from "@/lib/current-user";
import { canEditProject } from "@/lib/projects";
import { friendlyError } from "@/lib/crm-validation";

export type LinkState = { message?: string };
export async function changeProjectOpportunity(projectId: number, _state: LinkState, form: FormData): Promise<LinkState> {
  const actor = await requireMutation("sales.write");
  const opportunityId = Number(form.get("opportunityId"));
  const operation = form.get("operation");
  if (!Number.isSafeInteger(opportunityId) || opportunityId < 1 || (operation !== "link" && operation !== "unlink")) return { message: "Choose a valid Opportunity." };
  try {
    await prisma.$transaction(async tx => {
      const [project, opportunity] = await Promise.all([
        tx.project.findUnique({ where: { id: projectId }, include: { primaryAccount: { select: { ownerId: true } } } }),
        tx.opportunity.findUnique({ where: { id: opportunityId } }),
      ]);
      if (!project || project.archivedAt || !canEditProject(actor, project)) throw new Error("Access denied to this Project.");
      if (!opportunity || (operation === "link" && opportunity.archivedAt)) throw new Error("Choose an active Opportunity.");
      if (operation === "link") {
        await tx.opportunityProject.create({ data: { projectId, opportunityId } });
      } else {
        await tx.opportunityProject.delete({ where: { opportunityId_projectId: { opportunityId, projectId } } });
      }
    });
  } catch (error) { return { message: friendlyError(error, "This link could not be changed. Check whether it already exists.") }; }
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/opportunities");
  revalidatePath("/pipeline");
  return {};
}
