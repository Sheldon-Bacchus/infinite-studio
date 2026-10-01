import { XiaTangLocalPage } from "@/features/xiaji/xia-tang-local-page";

export default async function XiaJiProjectCharactersPage({ params }: { params: Promise<{ project: string }> }) {
    const { project } = await params;
    return <XiaTangLocalPage projectAssetId={project} />;
}
