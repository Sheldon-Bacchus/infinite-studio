// SPDX-License-Identifier: AGPL-3.0-or-later
import { definePlugin, useEffect, useMemo, useRef, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasAgentOp, CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";
import type { CSSProperties } from "react";
import type { Asset } from "./core/asset-types";
import { createLocalStudioRepository } from "./core/local-studio-repository";
import { getLocalStudioRecord } from "./core/local-studio-model";
import { createXiaTangAssetInput, getXiaTangRecord, listXiaTangProjectAssets, setXiaTangCurrentMediaId, type XiaTangDomain, type XiaTangRecordType } from "./core/xia-tang-local-model";
import { previewLocalEpisodeStructure } from "./core/local-manuscript-structure";
import { validateXiajiArtifactPackage } from "./core/xiaji-artifact-package";
import { parseWorkspace, readWorkspace, saveWorkspace } from "./workspace";
import css from "./style.css";
import { storage } from "./storage";

const DOMAINS: Record<XiaTangDomain, string> = { character: "角色", scene: "场景", prop: "道具", voice: "声线" };
const text = (asset?: Asset) => asset?.kind === "text" ? asset.data.content : "";

function XiaWorkbench({ ctx }: CanvasNodeContentProps) {
    const latest = useRef(ctx);
    latest.current = ctx;
    const assetsRef = useRef<Asset[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [projectId, setProjectId] = useState("");
    const [episodeId, setEpisodeId] = useState("");
    const [tab, setTab] = useState("intake");
    const [title, setTitle] = useState("");
    const [source, setSource] = useState("");
    const [script, setScript] = useState("");
    const [beatTitle, setBeatTitle] = useState("");
    const [beatContent, setBeatContent] = useState("");
    const [beatDialogue, setBeatDialogue] = useState("");
    const [beatId, setBeatId] = useState("");
    const [references, setReferences] = useState<string[]>([]);
    const [domain, setDomain] = useState<XiaTangDomain>("character");
    const [assetTitle, setAssetTitle] = useState("");
    const [assetFields, setAssetFields] = useState("{}");
    const [entityId, setEntityId] = useState("");
    const [recordType, setRecordType] = useState("entity");
    const [parentId, setParentId] = useState("");
    const [slot, setSlot] = useState("default");
    const [packageText, setPackageText] = useState("");
    const [reviewedPackage, setReviewedPackage] = useState("");

    const updateAssets = (next: Asset[]) => { assetsRef.current = next; setAssets(next); };
    const repository = useMemo(() => createLocalStudioRepository({
        getAssets: () => assetsRef.current,
        saveAssetsAndWait: async (next) => {
            const saved = await saveWorkspace(storage, next);
            updateAssets(saved);
            latest.current.emit("infinite-xia:changed");
            return saved;
        },
        readCanonicalAssets: () => readWorkspace(storage),
    }), []);

    useEffect(() => {
        let alive = true;
        const reload = () => readWorkspace(storage).then((next) => { if (alive) updateAssets(next); }).catch((e) => { if (alive) setError(String(e)); });
        void reload().finally(() => { if (alive) setLoading(false); });
        const unsubscribe = latest.current.on("infinite-xia:changed", () => void reload());
        return () => { alive = false; unsubscribe(); };
    }, []);

    const projects = repository.listProjects();
    const project = assets.find((asset) => asset.id === projectId);
    const episodes = repository.listEpisodes(projectId);
    const episode = episodes.find((asset) => asset.id === episodeId);
    const episodeRecord = episode ? getLocalStudioRecord(episode) : null;
    const projectAssets = listXiaTangProjectAssets(assets, projectId);
    const beats = repository.listBeats(episodeId);
    const preview = useMemo(() => previewLocalEpisodeStructure(source, title), [source, title]);

    useEffect(() => {
        setScript(episodeRecord?.recordType === "episode" ? text(assets.find((asset) => asset.id === episodeRecord.scriptAssetId)) : "");
        setBeatId(""); setBeatTitle(""); setBeatContent(""); setBeatDialogue(""); setReferences([]);
    }, [episodeId, episodeRecord?.recordType === "episode" ? episodeRecord.scriptAssetId : ""]);

    async function run(action: () => Promise<unknown>, success: string) {
        if (busy || loading) return;
        setBusy(true); setError(""); setNotice("");
        try { await action(); setNotice(success); }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        finally { setBusy(false); }
    }

    async function saveAssets(next: Asset[]) {
        const saved = await saveWorkspace(storage, next);
        updateAssets(saved); latest.current.emit("infinite-xia:changed");
    }

    function projectSelect(id: string) { setProjectId(id); setEpisodeId(""); setEntityId(""); setAssetTitle(""); setAssetFields("{}"); setReviewedPackage(""); }

    function toCanvas(selected: Asset[]) {
        const nodes = ctx.getNodes();
        const ops: CanvasAgentOp[] = [];
        selected.forEach((asset, index) => {
            const id = `infinite-xia-${ctx.node.id}-${asset.id}`;
            const content = text(asset);
            const xiaRecord = getXiaTangRecord(asset);
            const metadata = {
                content: asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" || asset.kind === "audio" ? asset.data.url : xiaRecord ? `${asset.title}\n${JSON.stringify(xiaRecord.fields, null, 2)}` : content,
                status: "success" as const, xiajiAssetId: asset.id, xiajiProjectAssetId: projectId,
                ...(asset.kind === "image" ? { naturalWidth: asset.data.width, naturalHeight: asset.data.height, mimeType: asset.data.mimeType, bytes: asset.data.bytes } : {}),
                ...(asset.kind === "video" || asset.kind === "audio" ? { mimeType: asset.data.mimeType, bytes: asset.data.bytes } : {}),
            };
            if (nodes.some((node) => node.id === id)) {
                ops.push({ type: "update_node", id, patch: { title: asset.title }, metadata });
            } else {
                ops.push({ type: "add_node", id, nodeType: asset.kind, title: asset.title,
                    x: ctx.node.position.x + ctx.node.width + 80 + (index % 3) * 340,
                    y: ctx.node.position.y + Math.floor(index / 3) * 260,
                    width: 300, height: 220, metadata });
            }
        });
        ctx.applyOps(ops);
        ctx.updateMetadata({ xiajiProjectAssetId: projectId });
        setNotice(`已将 ${selected.length} 项放入当前画布；重复导入更新同一节点`);
    }

    async function loadFile(file: File | undefined, target: "source" | "workspace") {
        if (!file) return;
        await run(async () => {
            const contents = await file.text();
            if (target === "source") { setSource(contents); if (!title) setTitle(file.name.replace(/\.[^.]+$/, "")); }
            else {
                const imported = parseWorkspace(JSON.parse(contents));
                const duplicates = imported.assets.filter((item) => assetsRef.current.some((asset) => asset.id === item.id));
                if (duplicates.length) throw new Error("导入文件与已有项目 ID 重复；请使用空工作区导入，避免覆盖已有内容");
                await saveAssets([...assetsRef.current, ...imported.assets]);
            }
        }, target === "source" ? "原稿已读取，确认后创建项目" : "无限虾项目已导入");
    }

    function exportWorkspace() {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: 1, assets }, null, 2)], { type: "application/json" }));
        const a = document.createElement("a"); a.href = url; a.download = "infinite-xia-workspace.json"; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function attachMedia(file: File | undefined) {
        if (!file || !entityId) return;
        await run(async () => {
            const owner = assets.find((asset) => asset.id === entityId);
            const record = owner && getXiaTangRecord(owner);
            if (!record) throw new Error("请先保存并选择创作资产");
            const kind = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : null;
            if (!kind) throw new Error("请选择图片、视频或音频文件");
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
            });
            let width = 0, height = 0;
            if (kind === "image") { const bitmap = await createImageBitmap(file); width = bitmap.width; height = bitmap.height; bitmap.close(); }
            const now = new Date().toISOString();
            const id = crypto.randomUUID();
            const media = { id, kind, title: file.name, tags: [], coverUrl: kind === "image" ? dataUrl : "", createdAt: now, updatedAt: now,
                category: `xia-tang:${record.domain}`, source: "xia-tang", metadata: { xiaTang: { schemaVersion: 1, domain: record.domain, recordType: "media", parentId: entityId, projectAssetId: projectId, slot, fields: { name: file.name } } },
                data: kind === "image" ? { dataUrl, width, height, bytes: file.size, mimeType: file.type } : { url: dataUrl, width, height, bytes: file.size, mimeType: file.type } } as Asset;
            await saveAssets([...assets.map((asset) => asset.id === entityId ? setXiaTangCurrentMediaId(asset, [...assets, media], slot, id) : asset), media]);
        }, "媒体已保存，并设为当前版本");
    }

    return <section className="infinite-xia" data-canvas-no-zoom onMouseDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}
        style={{ color: ctx.theme.node.text, background: ctx.theme.toolbar.panel, "--xia-muted": ctx.theme.node.muted, "--xia-line": ctx.theme.node.stroke } as CSSProperties}>
        <header><div><span className="xia-kicker">INFINITE XIA</span><h2>无限虾</h2></div><div className="xia-actions">
            <button onClick={exportWorkspace} disabled={busy || loading}>导出项目</button>
            <label className="xia-file">导入项目<input type="file" accept=".json" disabled={busy || loading} onChange={(e) => { void loadFile(e.target.files?.[0], "workspace"); e.target.value = ""; }} /></label>
        </div></header>
        <div className="xia-project"><label>当前项目<select value={projectId} disabled={busy || loading} onChange={(e) => projectSelect(e.target.value)}><option value="">选择项目／新建</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            <span>{projects.length} 个项目 · {episodes.length} 集</span></div>
        <nav aria-label="无限虾工作流">{[["intake", "01 虾料"], ["assets", "02 虾塘"], ["shots", "03 虾镜"], ["review", "产物审核"]].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
        {loading && <p role="status">读取本地项目…</p>}{error && <p className="xia-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
        <div className="xia-body"><fieldset disabled={busy || loading}>
            {tab === "intake" && <>
                {!project && <><h3>从原稿建立项目</h3><label>项目名称<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
                    <label>原稿<textarea rows={8} value={source} onChange={(e) => setSource(e.target.value)} placeholder="粘贴原稿，或导入文本文件。按“第X集”标题预览分集。" /></label>
                    <label className="xia-file">读取 TXT／Markdown<input type="file" accept=".txt,.md" onChange={(e) => { void loadFile(e.target.files?.[0], "source"); e.target.value = ""; }} /></label>
                    <p className="xia-muted">预览 {preview.length} 集：{preview.map((item) => item.title).join("、") || "未识别分集，可创建后手动添加"}</p>
                    <button disabled={!title.trim() || !source.trim()} onClick={() => void run(async () => {
                        const result = await repository.createProject({ title, sourceText: source, projectType: "drama", baseStyle: "realistic", episodes: preview });
                        projectSelect(result.project.id); setTitle(""); if (result.episodes[0]) setEpisodeId(result.episodes[0].id);
                    }, "项目与原稿已保存")}>确认创建项目</button></>}
                {project && <><h3>{project.title}</h3><details><summary>项目原稿</summary><pre>{repository.getSourceText(projectId)}</pre></details>
                    <label>新分集名称<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
                    <button disabled={!title.trim()} onClick={() => void run(async () => {
                        const item = await repository.createEpisode({ projectAssetId: projectId, title, order: episodes.length + 1 }); setEpisodeId(item.id); setTitle("");
                    }, "分集已保存")}>添加分集</button>
                    <ol>{episodes.map((item) => <li key={item.id}><button onClick={() => { setEpisodeId(item.id); setTab("shots"); }}>{item.title} → 剧本与镜头</button></li>)}</ol></>}
            </>}
            {tab === "assets" && <>
                <h3>角色、场景、道具与声线</h3>{!project ? <p>先选择或创建项目。</p> : <>
                    <div className="xia-columns"><label>分类<select value={domain} onChange={(e) => { setDomain(e.target.value as XiaTangDomain); setEntityId(""); }}>{Object.entries(DOMAINS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                        <label>记录类型<select value={recordType} onChange={(e) => setRecordType(e.target.value)}><option value="entity">主体</option><option value="identity">角色身份</option><option value="variant">场景／道具变体</option><option value="voice-slot">声线槽位</option></select></label></div>
                    {recordType !== "entity" && <label>所属主体<select value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">选择主体</option>{projectAssets.filter((item) => { const r = getXiaTangRecord(item); return r?.domain === domain && r.recordType === "entity"; }).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
                    {recordType === "voice-slot" && <label>槽位<input value={slot} onChange={(e) => setSlot(e.target.value)} /></label>}
                    <label>名称<input value={assetTitle} onChange={(e) => setAssetTitle(e.target.value)} /></label>
                    <label>详细属性（JSON）<textarea rows={5} value={assetFields} onChange={(e) => setAssetFields(e.target.value)} placeholder={'{"description":"人物或场景描述"}'} /></label>
                    <div className="xia-actions"><button disabled={!assetTitle.trim() || (recordType !== "entity" && !parentId)} onClick={() => void run(async () => {
                        const fields = JSON.parse(assetFields);
                        if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("属性必须是 JSON 对象");
                        const input = createXiaTangAssetInput(domain, { ...fields, name: assetTitle }, { projectAssetId: projectId, recordType: recordType as XiaTangRecordType, parentId: recordType === "entity" ? undefined : parentId, slot: recordType === "voice-slot" ? slot : undefined });
                        const now = new Date().toISOString();
                        const item = { ...input, id: entityId || crypto.randomUUID(), createdAt: assets.find((asset) => asset.id === entityId)?.createdAt || now, updatedAt: now } as Asset;
                        await saveAssets(entityId ? assets.map((asset) => asset.id === entityId ? item : asset) : [...assets, item]);
                        setEntityId(""); setAssetTitle(""); setAssetFields("{}");
                    }, "创作资产已保存")}>{entityId ? "保存修改" : "添加资产"}</button>
                        {entityId && <button onClick={() => { setEntityId(""); setAssetTitle(""); setAssetFields("{}"); }}>取消编辑</button>}</div>
                    {entityId && <><label className="xia-file">添加图片／视频／声线版本<input type="file" accept="image/*,video/*,audio/*" onChange={(e) => { void attachMedia(e.target.files?.[0]); e.target.value = ""; }} /></label>
                        <ul>{projectAssets.filter((item) => getXiaTangRecord(item)?.recordType === "media" && getXiaTangRecord(item)?.parentId === entityId).map((item) => <li key={item.id}>{item.title}<button onClick={() => void run(() => saveAssets(assets.map((asset) => asset.id === entityId ? setXiaTangCurrentMediaId(asset, assets, getXiaTangRecord(item)?.slot || "default", item.id) : asset)), "当前媒体版本已切换")}>设为当前版本</button><button onClick={() => toCanvas([item])}>放入画布</button></li>)}</ul></>}
                    <ul>{projectAssets.filter((item) => getXiaTangRecord(item)?.domain === domain && getXiaTangRecord(item)?.recordType !== "media").map((item) => <li key={item.id}><button onClick={() => { const r = getXiaTangRecord(item)!; setEntityId(item.id); setAssetTitle(item.title); setAssetFields(JSON.stringify(r.fields, null, 2)); setRecordType(r.recordType); setParentId(r.parentId || ""); setSlot(r.slot || "default"); }}>{item.title} · {getXiaTangRecord(item)?.recordType}</button><button onClick={() => toCanvas([item])}>放入画布</button></li>)}</ul>
                </>}
            </>}
            {tab === "shots" && <>
                <h3>分集剧本与镜头</h3><label>分集<select value={episodeId} onChange={(e) => setEpisodeId(e.target.value)}><option value="">选择分集</option>{episodes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                {episode && <><label>剧本<textarea rows={8} value={script} onChange={(e) => setScript(e.target.value)} placeholder="粘贴或导入已写好的剧本。" /></label>
                    <button disabled={!script.trim()} onClick={() => void run(() => repository.saveScript({ projectAssetId: projectId, episodeAssetId: episodeId, content: script }), "剧本已保存")}>保存剧本</button>
                    <h3>{beatId ? "编辑镜头" : "添加镜头"}</h3><label>镜头标题<input value={beatTitle} onChange={(e) => setBeatTitle(e.target.value)} /></label>
                    <label>画面描述<textarea rows={3} value={beatContent} onChange={(e) => setBeatContent(e.target.value)} /></label><label>对白<textarea rows={2} value={beatDialogue} onChange={(e) => setBeatDialogue(e.target.value)} /></label>
                    <div className="xia-references">{projectAssets.filter((item) => getXiaTangRecord(item)?.recordType !== "media").map((item) => <label key={item.id}><input type="checkbox" checked={references.includes(item.id)} onChange={(e) => setReferences(e.target.checked ? [...references, item.id] : references.filter((id) => id !== item.id))} />{item.title}</label>)}</div>
                    <button disabled={!beatContent.trim()} onClick={() => void run(async () => {
                        if (beatId) await repository.updateBeat({ projectAssetId: projectId, episodeAssetId: episodeId, beatAssetId: beatId, title: beatTitle, content: beatContent, dialogueText: beatDialogue, referencedAssetIds: references });
                        else await repository.createBeat({ projectAssetId: projectId, episodeAssetId: episodeId, title: beatTitle, order: beats.length + 1, content: beatContent, dialogueText: beatDialogue, referencedAssetIds: references });
                        setBeatId(""); setBeatTitle(""); setBeatContent(""); setBeatDialogue(""); setReferences([]);
                    }, "镜头已保存")}>保存镜头</button>
                    <ul>{beats.map((item) => <li key={item.id}><button onClick={() => { const r = getLocalStudioRecord(item); setBeatId(item.id); setBeatTitle(item.title); setBeatContent(text(item)); if (r?.recordType === "beat") { setBeatDialogue(r.dialogueText || ""); setReferences(r.referencedAssetIds); } }}>{item.title}</button><button onClick={() => toCanvas([item])}>放入画布</button></li>)}</ul>
                    <button disabled={!beats.length} onClick={() => toCanvas(beats)}>本集镜头放入当前画布</button></>}
            </>}
            {tab === "review" && <>
                <h3>审核 Agent 产物包</h3><p className="xia-muted">粘贴无限虾产物 JSON，先校验项目、分集、版本与素材关系，再确认保存。</p>
                <textarea rows={10} value={packageText} onChange={(e) => { setPackageText(e.target.value); setReviewedPackage(""); }} aria-label="Agent 产物包 JSON" />
                <div className="xia-actions"><button disabled={!project || !packageText.trim()} onClick={() => void run(async () => {
                    const pkg = JSON.parse(packageText);
                    if (pkg.projectAssetId !== projectId) throw new Error("产物包不属于当前项目");
                    const result = await validateXiajiArtifactPackage(assets, { id: ctx.node.id, xiajiProjectAssetId: projectId }, pkg);
                    if (!result.ok) throw new Error(result.message);
                    setReviewedPackage(packageText);
                }, "产物校验通过，可确认保存")}>校验产物</button>
                    <button disabled={!reviewedPackage || reviewedPackage !== packageText} onClick={() => void run(() => repository.commitXiajiArtifactPackage(JSON.parse(packageText), { id: ctx.node.id, xiajiProjectAssetId: projectId }, new Date().toISOString()), "产物已审核并保存")}>确认保存</button></div>
            </>}
        </fieldset></div>
    </section>;
}

export default definePlugin({
    id: "infinite-xia", name: "无限虾", version: "0.1.0", description: "项目、原稿、分集、剧本、镜头和创作资产独立工作台", css,
    nodes: [{ type: "infinite-xia:workbench", title: "无限虾", icon: "🦐", defaultSize: { width: 840, height: 760 },
        defaultMetadata: {}, Content: XiaWorkbench }],
});

