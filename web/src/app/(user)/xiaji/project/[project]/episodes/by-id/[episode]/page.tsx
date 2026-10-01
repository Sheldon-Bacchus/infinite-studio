import { redirect } from "next/navigation";

import { localStudioRoutes } from "@/features/xiaji/local-studio-routes";

export default async function XiaJiEpisodePage({ params }: { params: Promise<{ project: string; episode: string }> }) {
    const { project, episode } = await params;
    redirect(localStudioRoutes.script(project, episode));
}
