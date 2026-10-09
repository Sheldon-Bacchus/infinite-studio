export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasMediaType = "image" | "audio" | "video";
export type CanvasMediaUsage =
    | "appearance" | "detail" | "scene" | "prop" | "storyboard" | "first_frame" | "last_frame"
    | "voice_style" | "dialogue" | "music" | "ambience" | "sound_effect" | "original_audio"
    | "action" | "camera" | "pacing" | "edit_source" | "continuation_source" | "keyframe_source";

export type CanvasSubject = { subjectId: string; name: string; description: string };
export type CanvasVideoBinding = {
    bindingId: string;
    subjectId?: string;
    assetId: string;
    nodeId: string;
    mediaType: CanvasMediaType;
    usage: CanvasMediaUsage;
    order: number;
};
export type CanvasMediaRef = { storageKey: string; fileId?: string };
export type CanvasVideoInputBinding = CanvasVideoBinding & { contentVersion: string; mimeType?: string; mediaRef: CanvasMediaRef };
export type CanvasVideoGroupSnapshot = { groupId: string; memberNodeIds: string[] };
export type CanvasVideoGenerationParams = {
    mode: "frames" | "reference";
    seconds: string;
    size: string;
    resolution: string;
    aspectRatio: string;
    generateAudio: boolean;
    watermark: boolean;
};
export type CanvasVideoInputSnapshot = {
    schemaVersion: 1;
    snapshotId: string;
    sourceNodeId: string;
    adapterId: string;
    adapterConfigFingerprint: string;
    model: string;
    prompt: string;
    params: CanvasVideoGenerationParams;
    groupMembers: CanvasVideoGroupSnapshot[];
    bindings: CanvasVideoInputBinding[];
    mapping?: VideoInputMappingRow[];
    issues?: VideoInputIssue[];
    fingerprint: string;
};

export type ReferencePlanProvenance = {
    key: string;
    stableId: string;
    nodeId: string;
    label: string;
    title: string;
    kind: "image" | "video" | "audio" | "text" | "subject";
    usage?: string;
    sourceType: "node" | "group_member" | "subject" | "binding";
    groupTitle?: string;
    groupNodeId?: string;
    selectedImageId?: string;
    selectedImageIdUnknown?: boolean;
    fileId?: string;
    storageKey?: string;
    assetId?: string;
    contentVersion?: string;
    originalFilename?: string;
    model?: string;
    generationId?: string;
    previewUrl?: string;
    immutableThumbnail?: string;
    text?: string;
    status: "valid" | "unreferenced" | "unsupported" | "missing";
    disabledReason?: string;
};

export type CanvasGenerationInputSnapshot = {
    schemaVersion: 1;
    snapshotId: string;
    mode: CanvasGenerationMode;
    prompt: string;
    sourceNode?: {
        nodeId: string;
        type: CanvasNodeTypeId;
        title: string;
        workId?: string;
        objectId?: string;
        revisionId?: string;
    };
    model: string;
    parameters: Record<string, unknown>;
    references: ReferencePlanProvenance[];
    createdAt: string;
    videoInputSnapshot?: CanvasVideoInputSnapshot;
    parentGenerationId?: string;
};

export type CanvasVideoInputCapabilities = {
    adapterId: "openai-video-v1" | "gemini-video-v1" | "script-video-v1";
    media: Partial<Record<CanvasMediaType, { usages: CanvasMediaUsage[]; maxCount: number }>>;
};
export type VideoInputIssue = { code: string; message: string; bindingId?: string; subjectId?: string; nodeId?: string };
export type VideoInputItem = {
    kind: "text" | "image" | "video" | "audio" | "subject";
    stableId: string;
    nodeId?: string;
    name: string;
    number: number;
    h3Tag?: string;
    referenced: boolean;
    previewUrl?: string;
    text?: string;
    disabled?: boolean;
    disabledReason?: string;
};
export type VideoInputMappingRow = {
    tag: string;
    name: string;
    kind: "text" | "image" | "video" | "audio" | "subject";
    bindingId?: string;
    nodeId?: string;
    previewUrl?: string;
    selectedImageId?: string;
    selectedImageIdUnknown?: boolean;
    originalFilename?: string;
    groupNodeId?: string;
    groupTitle?: string;
    subjectName?: string;
    workflowField?: string;
    status: "valid" | "unreferenced" | "unsupported" | "error" | "unverified";
    statusText?: string;
    source?: string;
};
export type CanvasVideoInputCandidate = {
    sourceNodeId: string;
    prompt: string;
    compiledPrompt: string;
    model: string;
    adapterId?: string;
    adapterConfigFingerprint: string;
    params: CanvasVideoGenerationParams;
    groupMembers: CanvasVideoGroupSnapshot[];
    bindings: CanvasVideoInputBinding[];
    unresolvedReferences: string[];
    issues: VideoInputIssue[];
    mapping: VideoInputMappingRow[];
    fingerprint: string;
};

export type CanvasNodeImage = {
    id: string;
    assetId?: string;
    contentVersion?: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey?: string;
    fileId?: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeText = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    count?: number;
    textCount?: number;
    texts?: CanvasNodeText[];
    primaryTextId?: string;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    videoMode?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    fileId?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    generationId?: string;
    startWorkId?: string;
    videoTaskId?: string;
    videoTaskProvider?: "openai" | "gemini" | "autodl" | "plugin";
    assetId?: string;
    contentVersion?: string;
    videoBindings?: CanvasVideoBinding[];
    confirmedVideoInput?: { fingerprint: string; confirmedAt: string; snapshot: CanvasVideoInputSnapshot };
    generationInputSnapshot?: CanvasVideoInputSnapshot | CanvasGenerationInputSnapshot;
    generationHistoryIds?: string[];
    parentGenerationId?: string;
    referenceNodeOrder?: string[];
    videoPromptPlainTextReferences?: string[];
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    agentOperationId?: string;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    fileId?: string;
    legacyStorageKey?: string;
    mediaMissing?: boolean;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    fileId?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
