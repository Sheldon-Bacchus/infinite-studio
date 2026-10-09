// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
    Alert,
    Button,
    Card,
    Col,
    Divider,
    Empty,
    Input,
    List,
    message,
    Progress,
    Radio,
    Row,
    Select,
    Space,
    Spin,
    Statistic,
    Steps,
    Table,
    Tag,
    Typography,
    Upload,
} from "antd";
import type { UploadProps } from "antd";
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Database,
    Download,
    FileArchive,
    FileText,
    Film,
    Layers,
    RefreshCw,
    ShieldCheck,
    Upload as UploadIcon,
} from "lucide-react";
import { nanoid } from "nanoid";

import {
    commitMigration,
    createWork,
    getWork,
    listWorks,
    previewMigration,
    type MigrationCommitResult,
    type MigrationPreviewResult,
    type Work,
} from "@/services/api/works";
import {
    downloadBlob,
    exportCanvasMigrationPackage,
    exportXiaMigrationPackage,
    inspectMigrationZip,
    listCanvasProjects,
    listXiaProjects,
    type ExportedMigrationPackage,
    type ProjectOption,
} from "@/lib/works/migration-source";
import { useWorksStore } from "@/stores/use-works-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { restoreCanvasSnapshot, type CanvasBindingRecord } from "@/lib/works/canvas-archive";

const { Title, Text, Paragraph } = Typography;

export default function WorksMigrationPage() {
    const navigate = useNavigate();
    const { workId: paramWorkId } = useParams<{ workId?: string }>();

    // 作品列表与目标作品状态
    const [works, setWorks] = useState<Work[]>([]);
    const [loadingWorks, setLoadingWorks] = useState(false);
    const [targetWorkId, setTargetWorkId] = useState<string>(paramWorkId || "");
    const [newWorkTitle, setNewWorkTitle] = useState("");
    const [creatingWork, setCreatingWork] = useState(false);

    // 来源项目/画布选择 (Point 9)
    const [sourceType, setSourceType] = useState<"infinite-xia" | "infinite-canvas">("infinite-xia");
    const [xiaProjects, setXiaProjects] = useState<ProjectOption[]>([]);
    const [canvasProjects, setCanvasProjects] = useState<ProjectOption[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string>("");
    const [exporting, setExporting] = useState(false);
    const [exportedPackage, setExportedPackage] = useState<ExportedMigrationPackage | null>(null);

    // 待迁移包与预览状态 (Point 10: 绑定版本与固定请求 ID)
    const [packageBlob, setPackageBlob] = useState<Blob | null>(null);
    const [packageName, setPackageName] = useState<string>("");
    const [previewing, setPreviewing] = useState(false);
    const [previewResult, setPreviewResult] = useState<MigrationPreviewResult | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const previewRevisionRef = useRef<number>(0);
    const capturedBaseRevisionRef = useRef<number>(0);
    const stableOperationIdRef = useRef<string>("");

    // 提交迁移状态
    const [committing, setCommitting] = useState(false);
    const [commitResult, setCommitResult] = useState<MigrationCommitResult | null>(null);

    // 当前步骤：0: 导出/选择包, 1: 预览核验, 2: 确认发布
    const [currentStep, setCurrentStep] = useState(0);

    // 加载已有作品与来源项目
    const refreshWorksList = async () => {
        setLoadingWorks(true);
        try {
            const list = await listWorks();
            setWorks(list);
            if (!targetWorkId && list.length > 0) {
                setTargetWorkId(list[0].id);
            }
        } catch (err) {
            message.error(err instanceof Error ? err.message : "获取作品列表失败");
        } finally {
            setLoadingWorks(false);
        }
    };

    useEffect(() => {
        void refreshWorksList();
        void listXiaProjects().then((list) => {
            setXiaProjects(list);
            if (list.length > 0) {
                setSelectedProjectId((prev) => prev || list[0].id);
            }
        }).catch((err) => {
            message.error(err instanceof Error ? err.message : "读取无限虾项目失败");
        });
        void listCanvasProjects().then((list) => {
            setCanvasProjects(list);
        }).catch((err) => {
            message.error(err instanceof Error ? err.message : "读取画布项目失败");
        });
    }, [message]);

    // 快捷新建作品
    const handleCreateNewWork = async () => {
        const title = newWorkTitle.trim() || "迁移新建作品";
        setCreatingWork(true);
        try {
            const res = await createWork({
                operationId: nanoid(),
                title,
            });
            message.success(`成功新建作品：${res.work.title}`);
            setNewWorkTitle("");
            await refreshWorksList();
            setTargetWorkId(res.work.id);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "新建作品失败");
        } finally {
            setCreatingWork(false);
        }
    };

    // 步骤 1：只读备份导出 (Point 9)
    const handleExportSource = async () => {
        setExporting(true);
        try {
            let pkg: ExportedMigrationPackage;
            if (sourceType === "infinite-xia") {
                pkg = await exportXiaMigrationPackage(selectedProjectId || undefined);
            } else {
                pkg = await exportCanvasMigrationPackage(selectedProjectId || undefined);
            }
            setExportedPackage(pkg);
            setPackageBlob(pkg.blob);
            setPackageName(pkg.filename);

            // 触发本地保存，确保数据安全
            downloadBlob(pkg.blob, pkg.filename);
            message.success("只读备份包已导出并开始下载，已自动载入待迁移缓冲区");
            setCurrentStep(1);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "导出旧来源备份失败");
        } finally {
            setExporting(false);
        }
    };

    // 上传 ZIP 文件 (Point 10: 校验合法清单，不伪造合法结果)
    const uploadProps: UploadProps = {
        name: "file",
        multiple: false,
        accept: ".zip,application/zip",
        showUploadList: false,
        beforeUpload: async (file) => {
            const check = await inspectMigrationZip(file);
            if (!check.isValid || !check.manifest) {
                message.error(`ZIP 包格式无效: ${check.error || "缺少清单"}`);
                return false;
            }
            setPackageBlob(file);
            setPackageName(file.name);
            setExportedPackage(null);
            setCurrentStep(1);
            message.success(`已载入备份包：${file.name}`);
            return false;
        },
    };

    // 步骤 2：执行预览分析 (Point 10: 绑定请求版本，丢弃过时响应，捕获 baseRevision 与稳定 operationId)
    const handleRunPreview = async () => {
        if (!targetWorkId) {
            message.warning("请先选择或新建目标作品");
            return;
        }
        if (!packageBlob) {
            message.warning("请先导出或上传迁移备份 ZIP 包");
            return;
        }

        const reqRevision = ++previewRevisionRef.current;
        setPreviewing(true);
        setPreviewError(null);
        setPreviewResult(null);

        try {
            const detail = await getWork(targetWorkId);
            if (previewRevisionRef.current !== reqRevision) return;

            const res = await previewMigration(targetWorkId, packageBlob);
            if (previewRevisionRef.current !== reqRevision) return;

            setPreviewResult(res);
            capturedBaseRevisionRef.current = detail.work.revision;
            stableOperationIdRef.current = nanoid();

            if (!res.canCommit) {
                message.warning("预览检测到缺件或阻断冲突，请查看提示");
            } else {
                message.success("迁移预览分析通过，映射已就绪");
            }
        } catch (err) {
            if (previewRevisionRef.current !== reqRevision) return;
            const msg = err instanceof Error ? err.message : "迁移预览分析失败";
            setPreviewError(msg);
            message.error(msg);
        } finally {
            if (previewRevisionRef.current === reqRevision) {
                setPreviewing(false);
            }
        }
    };

    useEffect(() => {
        // 目标作品或包变更使旧预览失效 (Point 10)
        previewRevisionRef.current += 1;
        setPreviewResult(null);
        setPreviewError(null);
        capturedBaseRevisionRef.current = 0;
        stableOperationIdRef.current = "";

        if (targetWorkId && packageBlob && currentStep === 1) {
            void handleRunPreview();
        }
    }, [targetWorkId, packageBlob, currentStep]);

    // 步骤 3：确认显式迁移并提交 (Point 10: 捕获预览时的 baseRevision 与固定 operationId，重试复用)
    const handleCommit = async () => {
        if (!targetWorkId || !packageBlob || !previewResult) {
            message.warning("请等待预览检查完成后再提交");
            return;
        }
        if (!previewResult.canCommit) {
            message.error("当前备份包存在缺件或严重冲突，无法提交发布");
            return;
        }

        const baseRevision = capturedBaseRevisionRef.current;
        let operationId = stableOperationIdRef.current;
        if (!operationId) {
            operationId = nanoid();
            stableOperationIdRef.current = operationId;
        }

        setCommitting(true);
        try {
            const res = await commitMigration(targetWorkId, baseRevision, operationId, packageBlob);
            setCommitResult(res);
            setCurrentStep(2);
            message.success("迁移发布完成！新版本已持久落盘");
        } catch (err) {
            message.error(err instanceof Error ? err.message : "提交迁移失败");
        } finally {
            setCommitting(false);
        }
    };

    // 缺件表格列定义
    const missingColumns = [
        { title: "路径 / 来源资产", dataIndex: "path", render: (text: string, r: { sourceAssetId?: string; path?: string }) => text || r.sourceAssetId || "-" },
        { title: "原因", dataIndex: "reason" },
        { title: "SHA-256", dataIndex: "sha256", render: (t?: string) => t ? <Text code copyable>{t.slice(0, 16)}...</Text> : "-" },
    ];

    // 操作概要列定义
    const operationColumns = [
        { title: "操作类型", dataIndex: "action", render: (t: string) => <Tag color="blue">{t}</Tag> },
        { title: "目标描述", dataIndex: "targetName" },
        { title: "详情", dataIndex: "details" },
    ];

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
            <div>
                <Space orientation="horizontal" size="middle">
                    <Database className="w-8 h-8 text-blue-600" />
                    <div>
                        <Title level={3} className="!mb-0">作品数据迁移与双向归档</Title>
                        <Text type="secondary">
                            只读导出旧版创作档案，通过确定性哈希与实体映射安全发布至本地作品仓库。严格保障原件完整性，杜绝静默污染。
                        </Text>
                    </div>
                </Space>
            </div>

            <Steps
                current={currentStep}
                items={[
                    { title: "备份与载入", description: "只读导出 / 选择 ZIP 包" },
                    { title: "映射与预览", description: "缺件核对与冲突分析" },
                    { title: "发布完成", description: "不可变提交与显式切换" },
                ]}
            />

            {/* 步骤 1：旧数据导出与目标选择 */}
            <Card
                title={
                    <Space>
                        <FileArchive className="w-5 h-5 text-indigo-500" />
                        <span>第一步：选择旧数据来源并只读导出备份</span>
                    </Space>
                }
                extra={
                    <Space>
                        <Button icon={<RefreshCw className="w-4 h-4" />} onClick={refreshWorksList} loading={loadingWorks}>
                            刷新作品
                        </Button>
                    </Space>
                }
            >
                <Row gutter={[24, 24]}>
                    <Col span={24} md={12}>
                        <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200/50 dark:border-white/10">
                            <Title level={5} className="!mb-1">1. 选择待导出的浏览器旧来源</Title>
                            <Paragraph type="secondary" className="!mb-3 text-sm">
                                系统将以完全只读模式读取 IndexedDB，提取所有分集、剧本、镜头与媒体原件，计算确定性内容摘要并打包为标准 ZIP。
                            </Paragraph>

                            <Radio.Group
                                value={sourceType}
                                onChange={(e) => {
                                    const next = e.target.value as "infinite-xia" | "infinite-canvas";
                                    setSourceType(next);
                                    if (next === "infinite-xia") {
                                        setSelectedProjectId(xiaProjects[0]?.id || "");
                                    } else {
                                        setSelectedProjectId(canvasProjects[0]?.id || "");
                                    }
                                }}
                                className="w-full"
                            >
                                <Space orientation="vertical" className="w-full">
                                    <Radio value="infinite-xia" className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 w-full">
                                        <Space>
                                            <Film className="w-4 h-4 text-emerald-500" />
                                            <div>
                                                <div className="font-medium">无限虾项目 (workspace-v1)</div>
                                                <div className="text-xs text-gray-500">包含项目设定、分集、剧本、镜头版本链及虾塘资产</div>
                                            </div>
                                        </Space>
                                    </Radio>
                                    <Radio value="infinite-canvas" className="p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 w-full">
                                        <Space>
                                            <Layers className="w-4 h-4 text-blue-500" />
                                            <div>
                                                <div className="font-medium">本地画布与素材库 (Canvas & Assets)</div>
                                                <div className="text-xs text-gray-500">包含本地画布项目节点、连线及素材库媒体原件</div>
                                            </div>
                                        </Space>
                                    </Radio>
                                </Space>
                            </Radio.Group>

                            {/* 选择单个项目或画布 (Point 9) */}
                            {sourceType === "infinite-xia" && xiaProjects.length > 0 && (
                                <div className="space-y-1">
                                    <Text strong className="text-xs">选择无限虾来源项目 (单项目导出)：</Text>
                                    <Select
                                        value={selectedProjectId || undefined}
                                        onChange={(val) => setSelectedProjectId(val)}
                                        className="w-full"
                                        placeholder="请选择无限虾项目"
                                        options={xiaProjects.map((p) => ({
                                            value: p.id,
                                            label: p.title,
                                        }))}
                                    />
                                </div>
                            )}

                            {sourceType === "infinite-canvas" && canvasProjects.length > 0 && (
                                <div className="space-y-1">
                                    <Text strong className="text-xs">选择画布来源项目 (单画布导出)：</Text>
                                    <Select
                                        value={selectedProjectId || undefined}
                                        onChange={(val) => setSelectedProjectId(val)}
                                        className="w-full"
                                        placeholder="请选择画布"
                                        options={canvasProjects.map((p) => ({
                                            value: p.id,
                                            label: p.title,
                                        }))}
                                    />
                                </div>
                            )}

                            <div className="pt-2">
                                <Button
                                    type="primary"
                                    icon={<Download className="w-4 h-4" />}
                                    loading={exporting}
                                    onClick={handleExportSource}
                                    className="w-full"
                                >
                                    只读导出并下载备份包 (ZIP)
                                </Button>
                            </div>

                            <Divider plain className="!my-2 text-xs text-gray-400">或者直接上传已有备份</Divider>

                            <Upload {...uploadProps}>
                                <Button icon={<UploadIcon className="w-4 h-4" />} className="w-full">
                                    选择本地已有的备份 ZIP 包
                                </Button>
                            </Upload>
                        </div>
                    </Col>

                    <Col span={24} md={12}>
                        <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-white/5 border border-gray-200/50 dark:border-white/10">
                            <Title level={5} className="!mb-1">2. 指定目标本地作品</Title>
                            <Paragraph type="secondary" className="!mb-3 text-sm">
                                迁移数据将以原子提交形式发布到所选作品中，生成新的不可变版本清单。
                            </Paragraph>

                            <div className="space-y-2">
                                <Text strong className="text-xs">选择已有登记作品：</Text>
                                <Select
                                    value={targetWorkId}
                                    onChange={(val) => setTargetWorkId(val)}
                                    loading={loadingWorks}
                                    className="w-full"
                                    placeholder="请选择目标作品"
                                    options={works.map((w) => ({
                                        value: w.id,
                                        label: `${w.title} (${w.id.slice(0, 8)}...) - rev ${w.revision}`,
                                    }))}
                                />
                            </div>

                            <Divider plain className="!my-2 text-xs text-gray-400">或新建空白作品后迁移</Divider>

                            <Space orientation="horizontal" className="w-full">
                                <Input
                                    placeholder="新作品标题（默认：未命名作品）"
                                    value={newWorkTitle}
                                    onChange={(e) => setNewWorkTitle(e.target.value)}
                                    onPressEnter={handleCreateNewWork}
                                />
                                <Button onClick={handleCreateNewWork} loading={creatingWork}>
                                    新建作品
                                </Button>
                            </Space>

                            {packageBlob && (
                                <Alert
                                    type="info"
                                    showIcon
                                    icon={<FileArchive className="w-4 h-4" />}
                                    message={`当前待分析包：${packageName || "migration.zip"} (${(packageBlob.size / 1024).toFixed(1)} KB)`}
                                    description={
                                        exportedPackage?.manifest?.sourceDigest
                                            ? `来源指纹: ${exportedPackage.manifest.sourceDigest.slice(0, 16)}...`
                                            : "已就绪，可开始预览分析"
                                    }
                                    className="!mt-4"
                                />
                            )}
                        </div>
                    </Col>
                </Row>
            </Card>

            {/* 步骤 2：预览核验面板 */}
            {currentStep >= 1 && (
                <Card
                    title={
                        <Space>
                            <ShieldCheck className="w-5 h-5 text-blue-500" />
                            <span>第二步：迁移数据预览与一致性核验</span>
                        </Space>
                    }
                    extra={
                        <Button
                            icon={<RefreshCw className="w-4 h-4" />}
                            onClick={handleRunPreview}
                            loading={previewing}
                        >
                            重新分析预览
                        </Button>
                    }
                >
                    {previewing ? (
                        <div className="py-12 text-center">
                            <Spin size="large" />
                            <Paragraph type="secondary" className="!mt-4">
                                正在核验 ZIP 目录安全性、校验媒体 SHA-256 摘要并分析作品版本冲突...
                            </Paragraph>
                        </div>
                    ) : previewError ? (
                        <Alert
                            type="error"
                            showIcon
                            icon={<AlertTriangle className="w-5 h-5" />}
                            message="预览核验失败"
                            description={previewError}
                        />
                    ) : previewResult ? (
                        <div className="space-y-6">
                            {/* 冲突与缺件高亮提示 */}
                            {previewResult.missingFiles.length > 0 && (
                                <Alert
                                    type="error"
                                    showIcon
                                    icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
                                    message="存在缺失的媒体原件，已阻断发布"
                                    description={
                                        <div>
                                            <p className="mb-2">
                                                检测到 {previewResult.missingFiles.length} 项媒体原件在备份包中不存在或哈希不匹配。
                                                为保证权威作品档案的可恢复性，系统严禁在缺件情况下发布提交。
                                            </p>
                                            <Table
                                                size="small"
                                                dataSource={previewResult.missingFiles}
                                                columns={missingColumns}
                                                rowKey={(r, idx) => r.path || String(idx)}
                                                pagination={false}
                                            />
                                        </div>
                                    }
                                />
                            )}

                            {previewResult.conflicts.map((c, idx) => (
                                <Alert
                                    key={idx}
                                    type={c.type === "already_migrated" ? "info" : "warning"}
                                    showIcon
                                    message={`冲突分析：${c.type}`}
                                    description={c.message}
                                />
                            ))}

                            {/* 概要统计 */}
                            <Row gutter={16}>
                                <Col span={6}>
                                    <Card size="small">
                                        <Statistic title="来源标题" value={previewResult.title} />
                                    </Card>
                                </Col>
                                <Col span={6}>
                                    <Card size="small">
                                        <Statistic title="来源类型" value={previewResult.sourceType} />
                                    </Card>
                                </Col>
                                <Col span={6}>
                                    <Card size="small">
                                        <Statistic
                                            title="内容指纹 (SHA-256)"
                                            value={previewResult.sourceDigest ? `${previewResult.sourceDigest.slice(0, 10)}...` : "-"}
                                        />
                                    </Card>
                                </Col>
                                <Col span={6}>
                                    <Card size="small">
                                        <Statistic
                                            title="提交许可状态"
                                            value={previewResult.canCommit ? "允许提交" : "阻断中"}
                                            valueStyle={{ color: previewResult.canCommit ? "#3f8600" : "#cf1322" }}
                                        />
                                    </Card>
                                </Col>
                            </Row>

                            {/* 预期操作 */}
                            <div>
                                <Title level={5} className="!mb-2">预期执行的业务操作概要</Title>
                                <Table
                                    size="small"
                                    dataSource={previewResult.operations}
                                    columns={operationColumns}
                                    rowKey="action"
                                    pagination={false}
                                />
                            </div>

                            {/* 确认迁移按钮 */}
                            <div className="pt-4 flex items-center justify-between border-t border-gray-200 dark:border-white/10">
                                <div>
                                    <Text type="secondary">
                                        点击下方按钮将备份包归档并保存为作品最新版本。
                                    </Text>
                                </div>
                                <Button
                                    type="primary"
                                    size="large"
                                    icon={<CheckCircle2 className="w-5 h-5" />}
                                    disabled={!previewResult.canCommit}
                                    loading={committing}
                                    onClick={handleCommit}
                                >
                                    确认迁移并保存作品
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Empty description="请先载入备份包以启动预览" />
                    )}
                </Card>
            )}

            {/* 步骤 3：完成与显式切换 */}
            {commitResult && (
                <Card
                    className="border-green-500/30 bg-green-50/10"
                    title={
                        <Space>
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                            <span className="text-emerald-700 dark:text-emerald-400">第三步：作品已成功保存</span>
                        </Space>
                    }
                >
                    <div className="space-y-6">
                        <Alert
                            type="success"
                            showIcon
                            message="作品迁移成功！"
                            description={`作品 ${commitResult.workId} 已成功推进至版本 r${commitResult.revision}，提交 ID: ${commitResult.commitId}。备份包已保存在 backups/${commitResult.backupId}/。`}
                        />

                        <Row gutter={16}>
                            <Col span={6}>
                                <Card size="small">
                                    <Statistic title="当前版本" value={`r${commitResult.revision}`} />
                                </Card>
                            </Col>
                            <Col span={6}>
                                <Card size="small">
                                    <Statistic title="素材与数据" value={commitResult.entityCount} suffix="项" />
                                </Card>
                            </Col>
                            <Col span={6}>
                                <Card size="small">
                                    <Statistic title="媒体原件" value={commitResult.mediaCount} suffix="个" />
                                </Card>
                            </Col>
                            <Col span={6}>
                                <Card size="small">
                                    <Statistic title="搜索索引" value={commitResult.indexState === "up_to_date" ? "已同步" : "待重建"} />
                                </Card>
                            </Col>
                        </Row>

                        <div className="p-4 rounded bg-gray-100 dark:bg-white/5 font-mono text-xs space-y-1">
                            <div>作品 ID: {commitResult.workId}</div>
                            <div>提交 ID: {commitResult.commitId}</div>
                            <div>操作 ID: {commitResult.operationId}</div>
                            <div>备份包: {commitResult.backupId}</div>
                            <div>指纹: {commitResult.sourceDigest}</div>
                        </div>

                        {/* 显式切换按钮：先走 store 门控，恢复权威 binding 后导航到具体画布 */}
                        <div className="flex items-center justify-end space-x-4 pt-4 border-t border-gray-200 dark:border-white/10">
                            <Button onClick={() => navigate("/works")}>
                                返回作品库
                            </Button>
                            <Button
                                type="primary"
                                icon={<ArrowRight className="w-4 h-4" />}
                                onClick={async () => {
                                    try {
                                        await useWorksStore.getState().selectWork(commitResult.workId, { force: true });
                                        const detail = await getWork(commitResult.workId);
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
                                            const newCanvasId = useCanvasStore.getState().createProject(`画布 - ${previewResult?.title || "作品关联画布"}`);
                                            navigate(`/sudio/${newCanvasId}`);
                                        }
                                    } catch (err) {
                                        message.error(err instanceof Error ? err.message : "切换作品画布失败");
                                    }
                                }}
                            >
                                切换并进入作品画布
                            </Button>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
