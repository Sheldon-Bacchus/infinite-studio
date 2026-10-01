import { redirect } from "next/navigation";

import { localStudioRoutes } from "@/features/xiaji/local-studio-routes";

export default async function XiaJiLegacyProjectPage({ params }: { params: Promise<{ project: string }> }) {
    const { project } = await params;
    redirect(localStudioRoutes.project(project));
}
