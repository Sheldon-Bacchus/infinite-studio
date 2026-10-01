import path from "node:path";
import { fileURLToPath } from "node:url";
import { importLocalCanvasZip } from "../canvas-agent/local-canvas-import.mjs";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zipPath = path.resolve(workspace, process.argv[2] || "data/guga-dora-h3-deduped-long-voices.zip");
const result = await importLocalCanvasZip({ zipPath });
console.log(JSON.stringify(result, null, 2));
