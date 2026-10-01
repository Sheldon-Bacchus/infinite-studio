import { LocalStudioEpisodesPage } from "@/features/xiaji/local-studio-pages";

export default async function XiaJiProjectEpisodesPage({ params }: { params: Promise<{ project: string }> }) {
    const { project } = await params;
    return <LocalStudioEpisodesPage projectAssetId={project} />;
}
