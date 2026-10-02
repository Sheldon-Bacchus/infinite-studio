import { LocalStudioScriptPage } from "@/features/xiaji/local-studio-pages";

export default async function XiaJiEpisodeScriptPage({ params }: { params: Promise<{ project: string; episode: string }> }) {
    const { project, episode } = await params;
    return <LocalStudioScriptPage projectAssetId={project} episodeAssetId={episode} />;
}
