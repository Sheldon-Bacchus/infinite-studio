import { LocalStudioBeatsPage } from "@/features/xiaji/local-studio-pages";

export default async function XiaJiEpisodeBeatsPage({ params, searchParams }: { params: Promise<{ project: string; episode: string }>; searchParams: Promise<{ sub?: string; beatAssetId?: string }> }) {
    const [{ project, episode }, query] = await Promise.all([params, searchParams]);
    const validStages = ["text", "sketch", "render", "audio", "video"] as const;
    const activeStage = validStages.includes(query.sub as typeof validStages[number]) ? query.sub as typeof validStages[number] : "text";
    return <LocalStudioBeatsPage projectAssetId={project} episodeAssetId={episode} activeStage={activeStage} selectedBeatAssetId={query.beatAssetId} />;
}
