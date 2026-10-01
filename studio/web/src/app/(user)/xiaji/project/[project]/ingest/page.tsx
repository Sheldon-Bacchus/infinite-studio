import { LocalStudioIngestProjectPage } from "@/features/xiaji/local-studio-pages";

export default async function XiaJiProjectIngestPage({ params }: { params: Promise<{ project: string }> }) {
    const { project } = await params;
    return <LocalStudioIngestProjectPage projectAssetId={project} />;
}
