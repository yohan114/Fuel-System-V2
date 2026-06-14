import React from "react";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import AllocatorConsole from "./AllocatorConsole";

export default async function AllocatorPage() {
  const session = await getSession();
  if (!session || (session.role !== "ADMIN" && session.role !== "ALLOCATOR")) {
    redirect("/");
  }

  // Fetch projects list
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
  });

  // Fetch active fleet assets
  const assets = await prisma.asset.findMany({
    where: {
      status: { not: "DISPOSED" },
    },
    include: {
      project: true,
      category: true,
    },
    orderBy: { code: "asc" },
  });

  return (
    <AllocatorConsole
      initialAssets={assets}
      projects={projects}
      isAdmin={session.role === "ADMIN"}
    />
  );
}
