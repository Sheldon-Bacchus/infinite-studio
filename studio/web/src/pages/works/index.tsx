// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useState } from "react";
import localforage from "localforage";
import { useNavigate } from "react-router-dom";
import {
    Alert,
    App,
    Badge,
    Button,
    Card,
    Descriptions,
    Divider,
    Drawer,
    Empty,
    Image,
    Input,
    List,
    Modal,
    Radio,
    Space,
    Spin,
    Table,
    Tag,
    Typography,
    Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
    AlertCircle,
    Archive,
    ArrowRight,
    CheckCircle2,
    Database,
    Download,
    FileCheck,
    FileText,
    Film,
    FolderUp,
    Inbox,
    Layers,
    Plus,
    RefreshCw,
} from "lucide-react";
import { useWorksStore } from "@/stores/use-works-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import {
    listPendingArchiveItems,
    adoptPendingArchiveItem,
    removePendingArchiveItem,
    restoreCanvasSnapshot,
    type CanvasBindingRecord,
    type PendingArchiveItem,
} from "@/lib/works/canvas-archive";
import {
    getWork,
    getExportWorkUrl,
    previewWorkPackage,
    commitWorkPackage,
    auditWork,
    scanInbox,
    adoptInbox,
    rebuildWorkIndex,
    type Work,
    type WorkPackagePreviewResult,
    type WorkAuditReport,
    type InboxFileItem,
} from "@/services/api/works";

const { Text, Title, Paragraph } = Typography;
const inboxOperationsStore = localforage.createInstance({ name: "infinite-studio-works", storeName: "inbox-operation-retries" });
const packageOperationsStore = localforage.createInstance({ name: "infinite-studio-works", storeName: "package-operation-retries" });

export default function WorksPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();

    const {
        works,
        currentWorkId,
        currentWork,
        currentCommit,
        currentRecords,
        hasDraft,
        draft,
        loading,
        committing,
        error,
        conflict,
        loadWorks,
        selectWork,
        createWork,
        commitDraft,
        discardDraft,
        refreshCurrentWork,
        archiveEntities,
        restoreEntities,
        clearError,
    } = useWorksStore();

    const [createModalOpen, setCreateModalOpen] = useState(false);
    const [newTitle, setNewTitle] = useState("");
    const [creating, setCreating] = useState(false);

    // 待归档素材状态
    const [pendingItems, setPendingItems] = useState<PendingArchiveItem[]>([]);
    const [pendingDrawerOpen, setPendingDrawerOpen] = useState(false);
    const [adoptingPending, setAdoptingPending] = useState(false);

    // 工程包导入状态
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [packageFile, setPackageFile] = useState<File | null>(null);
    const [packagePreview, setPackagePreview] = useState<WorkPackagePreviewResult | null>(null);
    const [previewingPackage, setPreviewingPackage] = useState(false);
    const [importingPackage, setImportingPackage] = useState(false);

    // 业务归档/恢复状态
    const [archiveModalOpen, setArchiveModalOpen] = useState(false);
    const [archiveFilter, setArchiveFilter] = useState<"all" | "active" | "archived">("all");
    const [archivingEntityId, setArchivingEntityId] = useState<string | null>(null);

    // 工程审计状态
    const [auditModalOpen, setAuditModalOpen] = useState(false);
    const [auditReport, setAuditReport] = useState<WorkAuditReport | null>(null);
    const [auditing, setAuditing] = useState(false);
    const [rebuilding, setRebuilding] = useState(false);

    // 收件箱状态
    const [inboxDrawerOpen, setInboxDrawerOpen] = useState(false);
    const [inboxFiles, setInboxFiles] = useState<InboxFileItem[]>([]);
    const [loadingInbox, setLoadingInbox] = useState(false);
    const [adoptingInbox, setAdoptingInbox] = useState(false);
    const [selectedInboxFiles, setSelectedInboxFiles] = useState<string[]>([]);

    const loadPending = async () => {
        try {
            const items = await listPendingArchiveItems();
            setPendingItems(items);
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        void loadPending();
    }, [currentWorkId]);

    const handleAdoptPending = async (item: PendingArchiveItem) => {
        if (!currentWork) {
            message.warning("请先选定或创建一个作品");
            return;
        }
        try {
            await adoptPendingArchiveItem(item.nodeId, currentWork.id);
            message.success(`素材《${item.title || item.kind}》已采纳进作品`);
            await loadPending();
            await refreshCurrentWork();
        } catch (err) {
            message.error(err instanceof Error ? err.message : "采纳失败");
        }
    };

    const handleRemovePending = async (item: PendingArchiveItem) => {
        try {
            await removePendingArchiveItem(item.nodeId);
            message.info("已舍弃待归档素材");
            await loadPending();
        } catch (err) {
            message.error(err instanceof Error ? err.message : "舍弃失败");
        }
    };

    const handleAdoptAllPending = async () => {
        if (!currentWork) return;
        setAdoptingPending(true);
        let successCount = 0;
        try {
            for (const item of pendingItems) {
                try {
                    await adoptPendingArchiveItem(item.nodeId, currentWork.id);
                    successCount++;
                } catch {
                    // ignore
                }
            }
            message.success(`成功采纳 ${successCount} 项素材进作品`);
            await loadPending();
            await refreshCurrentWork();
        } finally {
            setAdoptingPending(false);
        }
    };

    const handleClearAllPending = () => {
        modal.confirm({
            title: "清空所有待归档素材",
            content: "确定要清空全部未归档产物记录吗？此操作不可逆。",
            okText: "确认清空",
            okType: "danger",
            cancelText: "取消",
            onOk: async () => {
                for (const item of pendingItems) {
                    await removePendingArchiveItem(item.nodeId);
                }
                await loadPending();
                message.info("已清空待归档素材");
            },
        });
    };

    const handleExportWork = (workId: string, revision: number) => {
        const url = getExportWorkUrl(workId, revision);
        window.open(url, "_blank");
    };

    const handleSelectPackageFile = async (file: File) => {
        setPackageFile(file);
        setPreviewingPackage(true);
        setPackagePreview(null);
        try {
            const preview = await previewWorkPackage(file);
            setPackagePreview(preview);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "工程包校验失败");
        } finally {
            setPreviewingPackage(false);
        }
    };

    const handleCommitPackage = async () => {
        if (!packageFile || !packagePreview) return;
        setImportingPackage(true);
        try {
            const pendingKey = `pending:${packagePreview.packageDigest}`;
            const pending = await packageOperationsStore.getItem<{ operationId: string }>(pendingKey) || { operationId: crypto.randomUUID() };
            await packageOperationsStore.setItem(pendingKey, pending);
            const imported = await commitWorkPackage(pending.operationId, packageFile);
            message.success(`工程《${imported.title}》导入成功`);
            await packageOperationsStore.removeItem(pendingKey);
            setImportModalOpen(false);
            setPackageFile(null);
            setPackagePreview(null);
            await loadWorks();
        } catch (err) {
            message.error(err instanceof Error ? err.message : "工程包导入提交失败");
        } finally {
            setImportingPackage(false);
        }
    };

    const handleArchiveEntity = async (entityId: string) => {
        setArchivingEntityId(entityId);
        try {
            await archiveEntities([entityId]);
            message.success("实体已成功归档");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "归档失败");
        } finally {
            setArchivingEntityId(null);
        }
    };

    const handleRestoreEntity = async (entityId: string) => {
        setArchivingEntityId(entityId);
        try {
            await restoreEntities([entityId]);
            message.success("实体已成功恢复");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "恢复失败");
        } finally {
            setArchivingEntityId(null);
        }
    };

    const workEntities = useMemo(() => {
        if (!currentRecords) return [];
        const list: Array<{ id: string; type: string; title: string; archived: boolean }> = [];
        const archivableTypes = new Set(["asset", "episode", "shot", "shot_revision", "script", "prompt_revision", "generation"]);
        for (const rec of Object.values(currentRecords)) {
            if (!archivableTypes.has(rec.type)) continue;
            const data = rec.data as Record<string, unknown> | undefined;
            const archived = Boolean(data?.archived);
            const title = (data?.title as string) || (data?.domain as string) || rec.id;
            list.push({ id: rec.id, type: rec.type, title, archived });
        }
        return list;
    }, [currentRecords]);

    const filteredWorkEntities = useMemo(() => {
        if (archiveFilter === "active") return workEntities.filter((e) => !e.archived);
        if (archiveFilter === "archived") return workEntities.filter((e) => e.archived);
        return workEntities;
    }, [workEntities, archiveFilter]);

    const handleAudit = async () => {
        if (!currentWork) return;
        setAuditing(true);
        try {
            const report = await auditWork(currentWork.id);
            setAuditReport(report);
            setAuditModalOpen(true);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "工程审计请求失败");
        } finally {
            setAuditing(false);
        }
    };

    const handleRebuildIndex = async () => {
        if (!currentWork) return;
        setRebuilding(true);
        try {
            await rebuildWorkIndex(currentWork.id);
            message.success("SQLite 索引重建完成");
            const report = await auditWork(currentWork.id);
            setAuditReport(report);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "索引重建失败");
        } finally {
            setRebuilding(false);
        }
    };

    const handleOpenInbox = async () => {
        if (!currentWork) return;
        setLoadingInbox(true);
        try {
            const res = await scanInbox(currentWork.id);
            setInboxFiles(res.files || []);
            setSelectedInboxFiles(res.files ? res.files.filter((f) => f.status === "new").map((f) => f.filename) : []);
            setInboxDrawerOpen(true);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "扫描收件箱失败");
        } finally {
            setLoadingInbox(false);
        }
    };

    const handleAdoptInboxFiles = async () => {
        if (!currentWork || selectedInboxFiles.length === 0) return;
        setAdoptingInbox(true);
        try {
            const selectedFiles = inboxFiles
                .filter((f) => selectedInboxFiles.includes(f.filename))
                .map((f) => ({ filename: f.filename, expectedSha256: f.sha256 }));
            const pendingKey = `pending:${currentWork.id}`;
            const previous = await inboxOperationsStore.getItem<{ baseRevision: number; operationId: string; files: Array<{ filename: string; expectedSha256: string }> }>(pendingKey);
            const filesToAdopt = selectedFiles.length ? selectedFiles : previous?.files || [];
            if (!filesToAdopt.length) return;
            const samePayload = previous && JSON.stringify(previous.files) === JSON.stringify(filesToAdopt);
            const operation = samePayload ? previous : { baseRevision: currentWork.revision, operationId: crypto.randomUUID(), files: filesToAdopt };
            await inboxOperationsStore.setItem(pendingKey, operation);
            await adoptInbox(currentWork.id, operation);
            const detail = await getWork(currentWork.id);
            const state = useWorksStore.getState();
            if (state.currentWorkId === currentWork.id) {
                useWorksStore.setState({ currentWork: detail.work, currentCommit: detail.currentCommit, currentRecords: detail.records });
            }
            await inboxOperationsStore.removeItem(pendingKey);
            message.success(`成功采纳 ${filesToAdopt.length} 个文件进入作品`);
            await handleOpenInbox();
        } catch (err) {
            message.error(err instanceof Error ? err.message : "采纳文件失败");
        } finally {
            setAdoptingInbox(false);
        }
    };

    const handleOpenCanvas = async () => {
        if (!currentWork) return;
        try {
            const detail = await getWork(currentWork.id);
            const bindingRec = Object.values(detail.records).find((r) => r.type === "canvas_binding");
            const binding = bindingRec?.data as unknown as CanvasBindingRecord | undefined;
            if (binding?.canvasId) {
                if (binding.canvasSnapshot) {
                    const restored = restoreCanvasSnapshot(binding);
                    if (restored) {
                        useCanvasStore.getState().restoreWorksCanvasProject(restored);
                    }
                }
                navigate(`/sudio/${binding.canvasId}`);
            } else {
                const newCanvasId = useCanvasStore.getState().createProject(`画布 - ${currentWork.title}`);
                navigate(`/sudio/${newCanvasId}`);
            }
        } catch (err) {
            message.error(err instanceof Error ? err.message : "进入画布失败");
        }
    };

    useEffect(() => {
        loadWorks().catch(() => {
            // error handled in store
        });
    }, [loadWorks]);

    const handleCreate = async () => {
        if (!newTitle.trim()) {
            message.warning("请输入作品标题");
            return;
        }
        setCreating(true);
        try {
            const created = await createWork(newTitle.trim());
            message.success(`作品《${created.title}》创建成功`);
            setCreateModalOpen(false);
            setNewTitle("");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "创建作品失败");
        } finally {
            setCreating(false);
        }
    };

    const handleSelect = async (work: Work) => {
        if (work.id === currentWorkId) return;

        if (hasDraft) {
            modal.confirm({
                title: "存在未提交的草稿",
                content: "当前作品有尚未提交的业务修改。切换作品可能会保留该作品草稿，是否确认切换？",
                okText: "确认切换",
                cancelText: "取消",
                onOk: async () => {
                    try {
                        await selectWork(work.id, { force: true });
                        message.success(`已切换至作品《${work.title}》`);
                    } catch (err) {
                        message.error(err instanceof Error ? err.message : "切换作品失败");
                    }
                },
            });
            return;
        }

        try {
            await selectWork(work.id);
            message.success(`已切换至作品《${work.title}》`);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "切换作品失败");
        }
    };

    const handleCommitDraft = async () => {
        try {
            const res = await commitDraft();
            message.success(`草稿提交成功，已推进至版本 r${res.revision}`);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "提交草稿失败");
        }
    };

    const handleDiscardDraft = () => {
        modal.confirm({
            title: "放弃未提交草稿",
            content: "确定要放弃当前作品未提交的本地草稿修改吗？此操作不可逆。",
            okText: "放弃修改",
            okType: "danger",
            cancelText: "取消",
            onOk: async () => {
                await discardDraft();
                message.info("已清空未提交草稿");
            },
        });
    };

    const columns: ColumnsType<Work> = [
        {
            title: "作品标题",
            dataIndex: "title",
            key: "title",
            render: (text, record) => (
                <Space direction="vertical" size={2}>
                    <Space>
                        <Film className="h-4 w-4 text-stone-500" />
                        <Text strong>{text}</Text>
                        {record.id === currentWorkId && <Tag color="blue">当前选用</Tag>}
                    </Space>
                    <Text type="secondary" className="text-xs font-mono">
                        {record.id}
                    </Text>
                </Space>
            ),
        },
        {
            title: "修订版本",
            dataIndex: "revision",
            key: "revision",
            width: 110,
            render: (rev) => <Tag color="geekblue">r{rev}</Tag>,
        },
        {
            title: "当前提交",
            dataIndex: "currentCommitId",
            key: "currentCommitId",
            width: 150,
            render: (cid) => (
                <Text code className="text-xs">
                    {cid ? cid.slice(0, 12) + "…" : "-"}
                </Text>
            ),
        },
        {
            title: "更新时间",
            dataIndex: "updatedAt",
            key: "updatedAt",
            width: 180,
            render: (date) => (
                <Text type="secondary" className="text-xs">
                    {date ? new Date(date).toLocaleString("zh-CN") : "-"}
                </Text>
            ),
        },
        {
            title: "操作",
            key: "action",
            width: 220,
            render: (_, record) => (
                <Space size="small">
                    {record.id !== currentWorkId ? (
                        <Button
                            size="small"
                            type="primary"
                            ghost
                            onClick={() => void handleSelect(record)}
                        >
                            选用
                        </Button>
                    ) : (
                        <Button size="small" disabled>
                            已选用
                        </Button>
                    )}
                    <Button
                        size="small"
                        icon={<Database className="h-3.5 w-3.5" />}
                        onClick={() => navigate(`/works/${record.id}/migration`)}
                    >
                        迁移
                    </Button>
                </Space>
            ),
        },
    ];

    return (
        <div className="flex h-full flex-col overflow-hidden bg-background text-stone-800 dark:text-stone-100">
            <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:py-8">
                <div className="mx-auto max-w-7xl space-y-6">
                    {/* 页面顶栏 */}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <Title level={3} className="!mb-1 text-stone-900 dark:text-stone-100">
                                作品库
                            </Title>
                            <Paragraph type="secondary" className="!mb-0">
                                统一管理本地创作工程，支持素材、剧本、分镜及关联画布恢复与双向保存。
                            </Paragraph>
                        </div>
                        <Space>
                            <Button
                                icon={<Layers className="h-4 w-4" />}
                                onClick={() => setPendingDrawerOpen(true)}
                            >
                                待归档素材 {pendingItems.length > 0 && <Badge count={pendingItems.length} className="ml-1" />}
                            </Button>
                            <Button
                                icon={<FolderUp className="h-4 w-4" />}
                                onClick={() => setImportModalOpen(true)}
                            >
                                导入工程包
                            </Button>
                            <Button
                                icon={<RefreshCw className="h-4 w-4" />}
                                onClick={() => void loadWorks()}
                                loading={loading}
                            >
                                刷新
                            </Button>
                            <Button
                                icon={<Database className="h-4 w-4" />}
                                onClick={() => navigate("/works/migration")}
                            >
                                数据迁移
                            </Button>
                            <Button
                                type="primary"
                                icon={<Plus className="h-4 w-4" />}
                                onClick={() => setCreateModalOpen(true)}
                            >
                                新建作品
                            </Button>
                        </Space>
                    </div>

                    {/* 错误或冲突提示 */}
                    {error && (
                        <Alert
                            message="操作错误"
                            description={error}
                            type="error"
                            showIcon
                            closable
                            onClose={clearError}
                        />
                    )}

                    {conflict && (
                        <Alert
                            message="版本提交冲突"
                            description={`${conflict.message}${conflict.remoteRevision ? ` (远端权威版本已推进至 r${conflict.remoteRevision})` : ""}。本地草稿已妥善保留，请核验基准后重新提交。`}
                            type="warning"
                            showIcon
                            action={
                                <Button size="small" onClick={() => void refreshCurrentWork()}>
                                    重新加载基准
                                </Button>
                            }
                        />
                    )}

                    {/* 当前活跃作品状态卡片 */}
                    {currentWork ? (
                        <Card
                            className="border border-stone-200 shadow-sm dark:border-stone-800"
                            title={
                                <Space>
                                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                                    <span>当前活跃作品：<strong>{currentWork.title}</strong></span>
                                    <Tag color="geekblue">修订版本 r{currentWork.revision}</Tag>
                                </Space>
                            }
                            extra={
                                <Space>
                                    <Button
                                        size="small"
                                        onClick={() => navigate(`/works/${currentWork.id}/migration`)}
                                    >
                                        导入/迁移至此作品
                                    </Button>
                                    <Button
                                        size="small"
                                        type="primary"
                                        onClick={() => void handleOpenCanvas()}
                                    >
                                        进入画布 <ArrowRight className="ml-1 h-3.5 w-3.5" />
                                    </Button>
                                </Space>
                            }
                        >
                            <div className="grid gap-4 sm:grid-cols-3">
                                <div>
                                    <Text type="secondary" className="text-xs">作品 ID</Text>
                                    <div className="font-mono text-sm font-medium">{currentWork.id}</div>
                                </div>
                                <div>
                                    <Text type="secondary" className="text-xs">当前版本提交</Text>
                                    <div className="font-mono text-sm">
                                        {currentCommit?.id ? currentCommit.id.slice(0, 16) + "…" : "-"}
                                    </div>
                                </div>
                                <div>
                                    <Text type="secondary" className="text-xs">草稿与保存状态</Text>
                                    <div>
                                        {hasDraft ? (
                                            <Space>
                                                <Tag color="warning" icon={<AlertCircle className="h-3 w-3 inline" />}>
                                                    存在未提交草稿 ({draft?.changes.length || 0} 项)
                                                </Tag>
                                                <Button
                                                    size="small"
                                                    type="primary"
                                                    loading={committing}
                                                    onClick={() => void handleCommitDraft()}
                                                >
                                                    提交草稿
                                                </Button>
                                                <Button
                                                    size="small"
                                                    danger
                                                    onClick={handleDiscardDraft}
                                                >
                                                    放弃修改
                                                </Button>
                                            </Space>
                                        ) : (
                                            <Tag color="success">已全部保存</Tag>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <Divider className="my-3" />
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Space wrap>
                                    <Button
                                        size="small"
                                        icon={<Download className="h-3.5 w-3.5" />}
                                        onClick={() => handleExportWork(currentWork.id, currentWork.revision)}
                                    >
                                        导出工程包 (ZIP)
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<Archive className="h-3.5 w-3.5" />}
                                        onClick={() => setArchiveModalOpen(true)}
                                    >
                                        素材与记录归档
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<FileCheck className="h-3.5 w-3.5" />}
                                        onClick={() => void handleAudit()}
                                        loading={auditing}
                                    >
                                        工程审计
                                    </Button>
                                    <Button
                                        size="small"
                                        icon={<Inbox className="h-3.5 w-3.5" />}
                                        onClick={() => void handleOpenInbox()}
                                        loading={loadingInbox}
                                    >
                                        文件收件箱
                                    </Button>
                                </Space>
                                <Space>
                                    <Button
                                        size="small"
                                        icon={<Layers className="h-3.5 w-3.5" />}
                                        onClick={() => setPendingDrawerOpen(true)}
                                    >
                                        待归档素材 {pendingItems.length > 0 && <Badge count={pendingItems.length} className="ml-1" />}
                                    </Button>
                                </Space>
                            </div>
                        </Card>
                    ) : (
                        <Card className="border border-dashed border-stone-300 text-center dark:border-stone-700">
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="尚未选定当前作品。未选定作品时，旧来源仅供只读浏览。请新建或选择一个作品开始创作。"
                            >
                                <Space>
                                    <Button
                                        type="primary"
                                        icon={<Plus className="h-4 w-4" />}
                                        onClick={() => setCreateModalOpen(true)}
                                    >
                                        新建作品
                                    </Button>
                                    <Button onClick={() => navigate("/works/migration")}>
                                        前往数据迁移
                                    </Button>
                                </Space>
                            </Empty>
                        </Card>
                    )}

                    {/* 作品列表 */}
                    <Card
                        title="所有作品列表"
                        className="border border-stone-200 shadow-sm dark:border-stone-800"
                    >
                        <Table
                            rowKey="id"
                            loading={loading}
                            columns={columns}
                            dataSource={works}
                            pagination={{ pageSize: 10 }}
                            locale={{ emptyText: "暂无作品，点击上方“新建作品”开始创建" }}
                        />
                    </Card>
                </div>
            </main>

            {/* 新建作品弹窗 */}
            <Modal
                title="新建作品工程"
                open={createModalOpen}
                onOk={() => void handleCreate()}
                onCancel={() => setCreateModalOpen(false)}
                confirmLoading={creating}
                okText="立即创建"
                cancelText="取消"
            >
                <div className="space-y-4 py-2">
                    <Paragraph type="secondary" className="text-xs">
                        作品是无限片场的创作工程，统一管理素材、剧本、分镜及关联画布。
                    </Paragraph>
                    <div>
                        <label className="mb-1 block text-sm font-medium">作品标题</label>
                        <Input
                            placeholder="例如：赛博迷航第一季 / 剧本·虾画"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            onPressEnter={() => void handleCreate()}
                            autoFocus
                        />
                    </div>
                </div>
            </Modal>

            {/* 待归档素材抽屉 */}
            <Drawer
                title={
                    <Space>
                        <Layers className="h-5 w-5 text-indigo-600" />
                        <span>画布生成待归档素材 ({pendingItems.length})</span>
                    </Space>
                }
                open={pendingDrawerOpen}
                onClose={() => setPendingDrawerOpen(false)}
                width={520}
                extra={
                    <Space>
                        {pendingItems.length > 0 && currentWork && (
                            <Button
                                size="small"
                                type="primary"
                                loading={adoptingPending}
                                onClick={() => void handleAdoptAllPending()}
                            >
                                全部采纳进作品
                            </Button>
                        )}
                        {pendingItems.length > 0 && (
                            <Button
                                size="small"
                                danger
                                onClick={handleClearAllPending}
                            >
                                清空
                            </Button>
                        )}
                    </Space>
                }
            >
                {pendingItems.length === 0 ? (
                    <Empty description="暂无待归档素材。在画布中生成图片、视频、音频或创建提示词后会自动登记至此。" />
                ) : (
                    <List
                        itemLayout="vertical"
                        dataSource={pendingItems}
                        renderItem={(item) => (
                            <List.Item
                                key={item.nodeId}
                                actions={[
                                    <Button
                                        key="adopt"
                                        size="small"
                                        type="primary"
                                        ghost
                                        disabled={!currentWork}
                                        onClick={() => void handleAdoptPending(item)}
                                    >
                                        采纳进作品
                                    </Button>,
                                    <Button
                                        key="discard"
                                        size="small"
                                        danger
                                        onClick={() => void handleRemovePending(item)}
                                    >
                                        舍弃
                                    </Button>,
                                ]}
                            >
                                <List.Item.Meta
                                    avatar={
                                        item.kind === "image" && (item.url || item.blob) ? (
                                            <Image
                                                width={64}
                                                height={64}
                                                className="rounded object-cover"
                                                src={item.url || (item.blob ? URL.createObjectURL(item.blob) : "")}
                                            />
                                        ) : (
                                            <div className="flex h-16 w-16 items-center justify-center rounded bg-stone-100 font-mono text-xs uppercase text-stone-500 dark:bg-stone-800">
                                                {item.kind}
                                            </div>
                                        )
                                    }
                                    title={
                                        <Space>
                                            <Text strong>{item.title || "生成产物"}</Text>
                                            <Tag color={item.kind === "video" ? "purple" : item.kind === "audio" ? "orange" : item.kind === "image" ? "blue" : "default"}>
                                                {item.kind}
                                            </Tag>
                                        </Space>
                                    }
                                    description={
                                        <div className="space-y-1 text-xs">
                                            {item.prompt && (
                                                <Paragraph ellipsis={{ rows: 2 }} type="secondary" className="!mb-0">
                                                    提示词: {item.prompt}
                                                </Paragraph>
                                            )}
                                            <div className="font-mono text-stone-400">
                                                登记时间: {new Date(item.createdAt).toLocaleString("zh-CN")}
                                            </div>
                                        </div>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                )}
            </Drawer>

            {/* 导入工程包弹窗 */}
            <Modal
                title="导入作品工程包 (ZIP)"
                open={importModalOpen}
                onCancel={() => {
                    setImportModalOpen(false);
                    setPackageFile(null);
                    setPackagePreview(null);
                }}
                footer={
                    <Space>
                        <Button onClick={() => setImportModalOpen(false)}>取消</Button>
                        <Button
                            type="primary"
                            disabled={!packagePreview || !packagePreview.canCommit}
                            loading={importingPackage}
                            onClick={() => void handleCommitPackage()}
                        >
                            确认导入工程
                        </Button>
                    </Space>
                }
            >
                <div className="space-y-4 py-2">
                    <Paragraph type="secondary" className="text-xs">
                        选择包含权威 work.json 与提交清单的规范 ZIP 工程包。系统将严格校验路径穿越、大小写冲突与媒体哈希。
                    </Paragraph>
                    <Upload.Dragger
                        accept=".zip"
                        maxCount={1}
                        beforeUpload={(file) => {
                            void handleSelectPackageFile(file);
                            return false;
                        }}
                        showUploadList={false}
                    >
                        <p className="ant-upload-drag-icon">
                            <FolderUp className="mx-auto h-8 w-8 text-stone-400" />
                        </p>
                        <p className="ant-upload-text">点击或将 ZIP 工程包拖拽至此</p>
                    </Upload.Dragger>

                    {previewingPackage && <Spin tip="正在校验工程包结构与 SHA-256 摘要..." />}

                    {packagePreview && (
                        <Card size="small" className="border-stone-200 bg-stone-50 dark:bg-stone-900">
                            <div className="space-y-2 text-xs">
                                <div><strong>作品标题:</strong> {packagePreview.title}</div>
                                <div><strong>作品 ID:</strong> <span className="font-mono">{packagePreview.workId}</span></div>
                                <div><strong>最新修订:</strong> r{packagePreview.revision} ({packagePreview.commitsCount} 次提交)</div>
                                <div><strong>业务记录:</strong> {packagePreview.recordsCount} 条，<strong>媒体文件:</strong> {packagePreview.mediaCount} 个 ({((packagePreview.totalBytes || 0) / 1024 / 1024).toFixed(2)} MB)</div>
                                {packagePreview.conflicts && packagePreview.conflicts.length > 0 && (
                                    <Alert
                                        type="error"
                                        showIcon
                                        message="检测到冲突或不合规项"
                                        description={packagePreview.conflicts.map((c) => c.message).join("; ")}
                                    />
                                )}
                            </div>
                        </Card>
                    )}
                </div>
            </Modal>

            {/* 素材与业务记录归档管理弹窗 */}
            <Modal
                title={`素材与业务记录归档管理 - ${currentWork?.title || ""}`}
                open={archiveModalOpen}
                onCancel={() => setArchiveModalOpen(false)}
                width={720}
                footer={null}
            >
                <div className="space-y-4 py-2">
                    <div className="flex items-center justify-between">
                        <Radio.Group
                            value={archiveFilter}
                            onChange={(e) => setArchiveFilter(e.target.value)}
                            size="small"
                        >
                            <Radio.Button value="all">全部 ({workEntities.length})</Radio.Button>
                            <Radio.Button value="active">活跃 ({workEntities.filter((e) => !e.archived).length})</Radio.Button>
                            <Radio.Button value="archived">已归档 ({workEntities.filter((e) => e.archived).length})</Radio.Button>
                        </Radio.Group>
                    </div>
                    <Table
                        size="small"
                        rowKey="id"
                        pagination={{ pageSize: 8 }}
                        dataSource={filteredWorkEntities}
                        columns={[
                            {
                                title: "类型",
                                dataIndex: "type",
                                key: "type",
                                width: 110,
                                render: (t) => <Tag>{t}</Tag>,
                            },
                            {
                                title: "名称/标识",
                                key: "name",
                                render: (_, r) => (
                                    <Space direction="vertical" size={1}>
                                        <Text strong>{r.title || r.id}</Text>
                                        <Text type="secondary" className="font-mono text-xs">{r.id}</Text>
                                    </Space>
                                ),
                            },
                            {
                                title: "状态",
                                key: "archived",
                                width: 90,
                                render: (_, r) => (
                                    r.archived ? <Tag color="default">已归档</Tag> : <Tag color="green">活跃</Tag>
                                ),
                            },
                            {
                                title: "操作",
                                key: "action",
                                width: 90,
                                render: (_, r) => (
                                    r.archived ? (
                                        <Button
                                            size="small"
                                            type="primary"
                                            ghost
                                            loading={archivingEntityId === r.id}
                                            onClick={() => void handleRestoreEntity(r.id)}
                                        >
                                            恢复
                                        </Button>
                                    ) : (
                                        <Button
                                            size="small"
                                            danger
                                            loading={archivingEntityId === r.id}
                                            onClick={() => void handleArchiveEntity(r.id)}
                                        >
                                            归档
                                        </Button>
                                    )
                                ),
                            },
                        ]}
                    />
                </div>
            </Modal>

            {/* 工程安全审计与修复弹窗 */}
            <Modal
                title={`工程安全审计与校验 - ${currentWork?.title || ""}`}
                open={auditModalOpen}
                onCancel={() => setAuditModalOpen(false)}
                width={620}
                footer={
                    <Space>
                        <Button
                            icon={<RefreshCw className="h-4 w-4" />}
                            onClick={() => void handleRebuildIndex()}
                            loading={rebuilding}
                        >
                            重建 SQLite 索引
                        </Button>
                        <Button type="primary" onClick={() => setAuditModalOpen(false)}>关闭</Button>
                    </Space>
                }
            >
                {auditReport ? (
                    <div className="space-y-4 py-2">
                        <Alert
                            type={auditReport.healthy ? "success" : "warning"}
                            showIcon
                            message={auditReport.healthy ? "工程结构健康" : "工程存在潜在孤立项或需核验项"}
                            description={`已审计提交 ${auditReport.validCommits} 次，校验不可变记录 ${auditReport.verifiedRecords} 条，校验媒体原件 ${auditReport.verifiedMedia} 个。`}
                        />
                        <Descriptions bordered size="small" column={2}>
                            <Descriptions.Item label="作品 ID">{auditReport.workId}</Descriptions.Item>
                            <Descriptions.Item label="权威版本">r{auditReport.revision}</Descriptions.Item>
                            <Descriptions.Item label="最新 Commit"><span className="font-mono text-xs">{auditReport.headCommitId?.slice(0, 16)}…</span></Descriptions.Item>
                            <Descriptions.Item label="健康状态">{auditReport.healthy ? "健康 (Healthy)" : "需注意"}</Descriptions.Item>
                            <Descriptions.Item label="有效提交">{auditReport.validCommits}</Descriptions.Item>
                            <Descriptions.Item label="有效记录">{auditReport.verifiedRecords}</Descriptions.Item>
                            <Descriptions.Item label="有效媒体">{auditReport.verifiedMedia}</Descriptions.Item>
                            <Descriptions.Item label="孤立提交">{auditReport.orphanCommits?.length || 0}</Descriptions.Item>
                            <Descriptions.Item label="孤立记录">{auditReport.orphanRecords?.length || 0}</Descriptions.Item>
                            <Descriptions.Item label="孤立媒体">{auditReport.orphanMedia?.length || 0}</Descriptions.Item>
                        </Descriptions>
                    </div>
                ) : (
                    <Spin tip="正在审计工程提交链与 SHA-256 哈希..." />
                )}
            </Modal>

            {/* 外部收件箱抽屉 */}
            <Drawer
                title={
                    <Space>
                        <Inbox className="h-5 w-5 text-amber-600" />
                        <span>外部收件箱 (Inbox)</span>
                    </Space>
                }
                open={inboxDrawerOpen}
                onClose={() => setInboxDrawerOpen(false)}
                width={560}
                extra={
                    <Space>
                        <Button
                            icon={<RefreshCw className="h-3.5 w-3.5" />}
                            size="small"
                            onClick={() => void handleOpenInbox()}
                            loading={loadingInbox}
                        >
                            重新扫描
                        </Button>
                        <Button
                            type="primary"
                            size="small"
                            disabled={selectedInboxFiles.length === 0}
                            loading={adoptingInbox}
                            onClick={() => void handleAdoptInboxFiles()}
                        >
                            采纳选中文件 ({selectedInboxFiles.length})
                        </Button>
                    </Space>
                }
            >
                <div className="space-y-4">
                    <Alert
                        type="info"
                        showIcon
                        message="使用说明"
                        description="直接将外部媒体文件复制到作品目录下的 inbox/ 文件夹中。点击扫描后，服务自动计算 SHA-256 并去重；点击采纳将安全原子移入作品媒体库并注册资产。"
                    />
                    {inboxFiles.length === 0 ? (
                        <Empty description="收件箱目录暂无新增文件。可将媒体放入作品 inbox/ 文件夹后点击重新扫描。" />
                    ) : (
                        <Table
                            size="small"
                            rowKey="filename"
                            pagination={false}
                            dataSource={inboxFiles}
                            rowSelection={{
                                selectedRowKeys: selectedInboxFiles,
                                onChange: (keys) => setSelectedInboxFiles(keys as string[]),
                            }}
                            columns={[
                                {
                                    title: "文件名",
                                    dataIndex: "filename",
                                    key: "filename",
                                    render: (text) => <Text strong className="text-xs">{text}</Text>,
                                },
                                {
                                    title: "大小",
                                    dataIndex: "bytes",
                                    key: "bytes",
                                    width: 90,
                                    render: (b) => <Text className="font-mono text-xs">{(b / 1024).toFixed(1)} KB</Text>,
                                },
                                {
                                    title: "状态",
                                    dataIndex: "status",
                                    key: "status",
                                    width: 110,
                                    render: (s) => (
                                        s === "duplicate" ? <Tag color="orange">已收录重复</Tag> : <Tag color="green">待收录</Tag>
                                    ),
                                },
                            ]}
                        />
                    )}
                </div>
            </Drawer>
        </div>
    );
}
