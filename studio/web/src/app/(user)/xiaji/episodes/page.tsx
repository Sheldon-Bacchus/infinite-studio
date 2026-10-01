import { redirect } from "next/navigation";

export default async function XiaJiEpisodesPage({ searchParams }: { searchParams: Promise<{ projectAssetId?: string; project?: string }> }) {
    const { projectAssetId, project } = await searchParams;
    const id = projectAssetId || project;
    redirect(id ? `/xiaji/project/${encodeURIComponent(id)}/episodes` : "/xiaji/projects");
}
