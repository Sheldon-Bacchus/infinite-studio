import { LocalStudioComposePage } from "@/features/xiaji/local-studio-pages";

export default async function XiaJiEpisodeComposePage({ params, searchParams }: { params: Promise<{ project: string; episode: string }>; searchParams: Promise<{ focusBeatAssetId?: string }> }) {
    const [{ project, episode }, query] = await Promise.all([params, searchParams]);
    return <LocalStudioComposePage projectAssetId={project} episodeAssetId={episode} focusBeatAssetId={query.focusBeatAssetId} />;
}
