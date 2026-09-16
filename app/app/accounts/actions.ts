"use server";

import { prisma } from "@/lib/prisma";
import { createAccountRecord } from "@/lib/accounts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createAccount(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const accountType = String(formData.get("accountType") || "").trim();
  const industry = String(formData.get("industry") || "").trim();
  const territory = String(formData.get("territory") || "").trim();
  const website = String(formData.get("website") || "").trim();
  const phone = String(formData.get("phone") || "").trim();

  if (!name) {
    throw new Error("Account name is required.");
  }

  await createAccountRecord(prisma, {
    name,
    accountType: accountType || null,
    industry: industry || null,
    territory: territory || null,
    website: website || null,
    phone: phone || null,
  });

  revalidatePath("/accounts");
  redirect("/accounts");
}
