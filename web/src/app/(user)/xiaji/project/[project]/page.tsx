import { redirect } from "next/navigation";

import { localStudioRoutes } from "@/features/xiaji/local-studio-routes";

export default async function XiaTangProjectPage({ params }: { params: Promise<{ project: string }> }) {
    const { project } = await params;
    redirect(localStudioRoutes.episodes(project));
}
