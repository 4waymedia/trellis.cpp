import "./ui.css";
import { generate, health } from "./api";
import { loadConfig } from "./config";
import { getPrefs } from "./prefs";
import { GenerationQueue } from "./queue";
import { renderSettings } from "./settings";
import { all, clear as clearStore, del as removeRecord, get as getRecord, isEphemeral, newId, put } from "./store";
import { isTauri, listen, saveBytes, saveToOutputDir } from "./tauri";
import { Viewer } from "./viewer";
import { DEFAULT_PARAMS, type GenParams, type GenRecord } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- element refs ----
const dropzone = $("dropzone");
const fileInput = $<HTMLInputElement>("file-input");
const inputPreview = $<HTMLImageElement>("input-preview");
const dropHint = $("dropzone-hint");
const generateBtn = $<HTMLButtonElement>("generate-btn");
const progress = $("progress");
const progressStage = $("progress-stage");
const progressElapsed = $("progress-elapsed");
const cancelBtn = $<HTMLButtonElement>("cancel-btn");
const resetViewBtn = $<HTMLButtonElement>("reset-view");
const saveGlbBtn = $<HTMLButtonElement>("save-glb");
const viewerCaption = $("viewer-caption");
const galleryEl = $("gallery");
const clearGalleryBtn = $("clear-gallery");
const backendBadge = $("backend-badge");
const serverDot = $("server-dot");
const serverLabel = $("server-label");
const setupBanner = $("setup-banner");

// ---- state ----
const viewer = new Viewer($("viewer-mount"));
let inputImage: Blob | null = null;
let inputName = "input.png";
let currentGlb: Blob | null = null;
let currentName = "model"; // input name of the result in the viewer (not of the running job)
let activeId: string | null = null;
let serverOnline = false;
let generating = false;
/** Settings of the job currently running; null when idle. */
let runningParams: GenParams | null = null;
let abort: AbortController | null = null;
let elapsedTimer: number | null = null;
let galleryUrls: string[] = [];
let warnedEphemeral = false;

/** Images waiting behind the running job (see queue.ts). */
const queue = new GenerationQueue(
  {
    wrap: $("queue"),
    label: $("queue-label"),
    list: $("queue-list"),
    clearBtn: $("clear-queue"),
  },
  () => updateGenerateEnabled(),
);

// ---- controls -> params ----
function readParams(): GenParams {
  const res = parseInt(($("ctl-res") as HTMLSelectElement).value, 10);
  const seed = parseInt(($("ctl-seed") as HTMLInputElement).value, 10);
  return {
    resolution: (res === 512 || res === 1536 ? res : 1024) as GenParams["resolution"],
    seed: isNaN(seed) ? DEFAULT_PARAMS.seed : seed,
    bgRemoval: ($("ctl-bg") as HTMLSelectElement).value as GenParams["bgRemoval"],
    uv: ($("ctl-uv") as HTMLSelectElement).value as GenParams["uv"],
  };
}

function applyParams(p: GenParams): void {
  ($("ctl-res") as HTMLSelectElement).value = String(p.resolution);
  ($("ctl-seed") as HTMLInputElement).value = String(p.seed);
  ($("ctl-bg") as HTMLSelectElement).value = p.bgRemoval;
  ($("ctl-uv") as HTMLSelectElement).value = p.uv;
}

// ---- toasts ----
function toast(msg: string, kind: "" | "ok" | "err" = ""): void {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 8000 : 4000);
}

// ---- input image ----
function setInput(blob: Blob, name: string): void {
  inputImage = blob;
  inputName = name || "input.png";
  inputPreview.src = URL.createObjectURL(blob);
  inputPreview.classList.remove("hidden");
  dropHint.classList.add("hidden");
  updateGenerateEnabled();
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") fileInput.click();
});
fileInput.addEventListener("change", () => {
  acceptFiles([...(fileInput.files ?? [])]);
  fileInput.value = ""; // let the same file be picked again
});
// HTML5 drag-and-drop. In Tauri this needs `dragDropEnabled: false` on the
// window (tauri.conf.json): otherwise the webview's native file-drop handler
// swallows the drop on Windows/WebView2 and the page never sees the files.

// A file dropped anywhere outside the drop zone must not make the webview
// navigate to it (which would replace the whole app with the image).
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
const isImage = (f: File) => f.type.startsWith("image/") || IMAGE_EXT.test(f.name);

/**
 * Single entry point for every new image (browse, drop, paste).
 * Idle: the image becomes the input, ready for Generate.
 * Generating: it joins the queue and runs after the current job.
 */
function acceptImage(image: Blob, name: string): void {
  if (generating) enqueue(image, name);
  else setInput(image, name);
}

/**
 * Browse / drop entry point for one or more files. Non-images are skipped
 * with a toast. With several images, only the first can become the input;
 * the rest always queue behind it.
 */
function acceptFiles(files: File[]): void {
  const images = files.filter(isImage);
  const skipped = files.length - images.length;
  if (skipped) {
    toast(
      skipped === 1 && files.length === 1
        ? `"${files[0].name}" isn't an image — drop a PNG, JPEG or WebP.`
        : `Skipped ${skipped} non-image file${skipped > 1 ? "s" : ""}.`,
      "err",
    );
  }
  // Only the first can become the input; the rest always queue (when idle they'd
  // otherwise just replace each other in the preview).
  images.forEach((f, i) => (i === 0 ? acceptImage(f, f.name) : enqueue(f, f.name)));
}

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  }),
);
// dragleave also fires when the pointer moves onto a child (the preview <img>),
// which made the highlight flicker; only clear it when actually leaving the zone.
dropzone.addEventListener("dragleave", (e) => {
  if (!dropzone.contains((e as DragEvent).relatedTarget as Node | null)) dropzone.classList.remove("drag");
});
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag");
  acceptFiles([...((e as DragEvent).dataTransfer?.files ?? [])]);
});
window.addEventListener("paste", async (e: ClipboardEvent) => {
  for (const item of e.clipboardData?.items ?? []) {
    const image = item.type.startsWith("image/") && item.getAsFile();
    if (image) return acceptImage(image, image.name || "pasted.png");
  }
  // WebKitGTK can omit image data from ClipboardEvent. Since paste was
  // user-triggered, try reading the clipboard item list for an image.
  const items = await navigator.clipboard.read().catch(() => []);
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith("image/"));
    if (type) {
      const image = await item.getType(type).catch(() => null);
      if (image) return acceptImage(image, "pasted.png");
    }
  }
});

// ---- queue ----
/**
 * Queue an image. Its settings are fixed now, from one of two sources
 * (Settings → "Queued images use the same settings…", prefs.ts):
 *   - on, while a job runs: a copy of the running job's settings, so a batch
 *     dropped onto a running generation all comes out the same;
 *   - otherwise: whatever the settings panel shows right now.
 */
function enqueue(image: Blob, name: string): void {
  const params = getPrefs().queueSameSettings && runningParams ? { ...runningParams } : readParams();
  queue.add(image, name, params);
}

/**
 * Start the next queued image, if any, with the settings it was queued with.
 *
 * Note: if the server is offline this pauses instead, keeping the queue
 * intact. Otherwise every remaining item would fail instantly in turn and the
 * whole batch would be lost to error toasts. Generate resumes it.
 */
function startNextQueued(): void {
  if (generating || queue.size === 0) return;
  if (!serverOnline) {
    toast(`Server offline — queue paused (${queue.size} waiting). Press Generate to resume.`, "err");
    return;
  }
  const next = queue.take()!;
  setInput(next.image, next.name);
  void doGenerate(next.params);
}

// ---- generate ----
function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateGenerateEnabled(): void {
  generateBtn.disabled = !(serverOnline && (inputImage || queue.size > 0) && !generating);
}

/**
 * Generate a model from the current input, then hand off to the queue.
 *
 * @param params Settings for this run. Defaults to the settings panel (the
 *               Generate button); queued jobs pass the settings they were
 *               queued with.
 *
 * Note: the input image and name are captured at the start. Drops and pastes
 * during the run go to the queue, but `inputImage` still changes when the
 * queue advances, so the result must be saved under this job's own input.
 */
async function doGenerate(params: GenParams = readParams()): Promise<void> {
  if (generating) return;
  if (!inputImage) return startNextQueued(); // Generate with only a queue: start it
  const image = inputImage;
  const name = inputName;
  generating = true;
  runningParams = params;
  dropzone.classList.add("queueing");
  updateGenerateEnabled();
  progress.classList.remove("hidden");
  progressStage.textContent = "starting…";
  const started = Date.now();
  progressElapsed.textContent = "0:00";
  elapsedTimer = window.setInterval(() => {
    progressElapsed.textContent = fmtElapsed(Date.now() - started);
  }, 1000);
  abort = new AbortController();
  try {
    const { glb } = await generate(image, params, abort.signal);
    currentGlb = glb;
    currentName = name;

    const rec: GenRecord = {
      id: newId(),
      ts: Date.now(),
      name,
      params,
      input: image,
      glb,
      thumb: null,
    };

    // 1) Write the GLB to the output folder FIRST. This on-disk file is the real
    // deliverable and must survive any later failure — a dead gallery DB (some
    // WebKitGTK builds can't open IndexedDB) or a WebGL/model-viewer crash must
    // never cost the user a successful generation.
    let savedPath: string | null = null;
    if (isTauri()) {
      try {
        const bytes = new Uint8Array(await glb.arrayBuffer());
        const base = name.replace(/\.[^.]+$/, "") || "model";
        const fname = `${base}_${params.resolution}_seed${params.seed}_${rec.id}.glb`;
        savedPath = await saveToOutputDir(fname, bytes);
      } catch (e) {
        toast(`Auto-save to output folder failed: ${(e as Error).message}`, "err");
      }
    }
    toast(savedPath ? `Saved to ${savedPath}` : "Generation complete", "ok");

    // 2) Add it to the gallery. The store falls back to in-memory if IndexedDB
    // is unavailable, so this never throws and never blocks the save above.
    await put(rec);
    if (isEphemeral() && !warnedEphemeral) {
      warnedEphemeral = true;
      toast(
        "Gallery won't persist across restarts (IndexedDB unavailable on this system) — " +
          "but every generation is still saved to your output folder.",
        "err",
      );
    }
    activeId = rec.id;
    setViewerTools(true);
    viewerCaption.textContent = `${params.resolution} · seed ${params.seed} · ${(glb.size / 1e6).toFixed(1)} MB`;
    await refreshGallery();

    // 3) Best-effort 3D preview + gallery thumbnail — never blocks the save above.
    try {
      await viewer.load(glb);
      const thumb = await viewer.thumbnail();
      if (thumb) {
        rec.thumb = thumb;
        await put(rec);
        await refreshGallery();
      }
    } catch (e) {
      toast(`3D preview couldn't render (your result is still saved): ${(e as Error).message}`, "err");
    }
  } catch (e) {
    if (abort?.signal.aborted) {
      toast(queue.size ? `Generation cancelled — queue paused (${queue.size} waiting)` : "Generation cancelled");
    } else toast(`${name}: ${(e as Error).message || "generation failed"}`, "err");
  } finally {
    generating = false;
    runningParams = null;
    dropzone.classList.remove("queueing");
    if (elapsedTimer) window.clearInterval(elapsedTimer);
    progress.classList.add("hidden");
    updateGenerateEnabled();
  }
  // Success or failure, move on to the next queued image: one bad input
  // shouldn't stall a batch. Cancel pauses instead, since the user asked to stop.
  if (!abort?.signal.aborted) startNextQueued();
}

generateBtn.addEventListener("click", () => void doGenerate());
cancelBtn.addEventListener("click", () => abort?.abort());

// ---- viewer tools ----
function setViewerTools(on: boolean): void {
  resetViewBtn.disabled = !on;
  saveGlbBtn.disabled = !on;
}
resetViewBtn.addEventListener("click", () => viewer.resetView());
saveGlbBtn.addEventListener("click", async () => {
  if (!currentGlb) return;
  const bytes = new Uint8Array(await currentGlb.arrayBuffer());
  const base = currentName.replace(/\.[^.]+$/, "") || "model";
  const ok = await saveBytes(`${base}.glb`, bytes);
  if (ok) toast("Saved", "ok");
});

// ---- gallery ----
async function loadRecord(id: string): Promise<void> {
  const rec = await getRecord(id);
  if (!rec) return;
  try {
    await viewer.load(rec.glb);
  } catch (e) {
    toast((e as Error).message, "err");
    return;
  }
  // While a job runs, the dropzone shows that job's input; only the viewer changes.
  if (!generating) {
    inputImage = rec.input;
    inputName = rec.name;
    inputPreview.src = URL.createObjectURL(rec.input);
    inputPreview.classList.remove("hidden");
    dropHint.classList.add("hidden");
    applyParams(rec.params);
  }
  currentGlb = rec.glb;
  currentName = rec.name;
  activeId = rec.id;
  setViewerTools(true);
  viewerCaption.textContent = `${rec.name} · ${rec.params.resolution} · seed ${rec.params.seed}`;
  updateGenerateEnabled();
  await refreshGallery();
}

async function refreshGallery(): Promise<void> {
  galleryUrls.forEach((u) => URL.revokeObjectURL(u));
  galleryUrls = [];
  const recs = await all();
  galleryEl.innerHTML = "";
  if (!recs.length) {
    galleryEl.innerHTML = `<div class="gallery-empty">No generations yet.</div>`;
    return;
  }
  for (const r of recs) {
    const item = document.createElement("div");
    item.className = "gitem" + (r.id === activeId ? " active" : "");
    item.title = `${r.name} · ${new Date(r.ts).toLocaleString()}`;

    const img = document.createElement("img");
    const src = r.thumb ?? r.input;
    const url = URL.createObjectURL(src);
    galleryUrls.push(url);
    img.src = url;
    item.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "gmeta";
    meta.textContent = `${r.params.resolution}`;
    item.appendChild(meta);

    const delBtn = document.createElement("button");
    delBtn.className = "gdel";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeRecord(r.id);
      if (activeId === r.id) activeId = null;
      await refreshGallery();
    });
    item.appendChild(delBtn);

    item.addEventListener("click", () => loadRecord(r.id));
    galleryEl.appendChild(item);
  }
}

clearGalleryBtn.addEventListener("click", async () => {
  if (!confirm("Delete all saved generations?")) return;
  await clearStore();
  activeId = null;
  await refreshGallery();
});

// ---- settings modal ----
const modal = $("settings-modal");
async function openSettings(): Promise<void> {
  await renderSettings($("settings-body"), () => {
    pollHealth();
    modal.classList.add("hidden");
    toast("Settings applied");
  });
  modal.classList.remove("hidden");
}
$("settings-btn").addEventListener("click", openSettings);
$("banner-settings").addEventListener("click", openSettings);
$("settings-close").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});

// ---- server status ----
async function pollHealth(): Promise<void> {
  const cfg = await loadConfig(true);
  backendBadge.textContent = cfg.backend !== "unknown" ? cfg.backend : "—";
  const ok = await health();
  serverOnline = ok;
  serverDot.className = "dot " + (ok ? "ok" : "err");
  serverLabel.textContent = ok ? "ready" : cfg.configured ? "offline" : "setup needed";
  const needSetup = !ok && !cfg.configured;
  setupBanner.classList.toggle("hidden", !needSetup);
  if (needSetup) {
    (setupBanner.querySelector("span") as HTMLElement).textContent =
      "Trellis Studio isn't set up yet — run the installer or point it at your models directory.";
  } else if (!ok && cfg.configured) {
    setupBanner.classList.remove("hidden");
    (setupBanner.querySelector("span") as HTMLElement).textContent =
      "Server is offline — it may still be loading, or check the models directory in settings.";
  }
  updateGenerateEnabled();
}

// ---- server log -> progress (Tauri only) ----
listen<string>("server-log", (line) => {
  const t = String(line).trim();
  if (generating && t) progressStage.textContent = t;
});

// ---- boot ----
async function boot(): Promise<void> {
  setViewerTools(false);
  await refreshGallery();
  await pollHealth();
  window.setInterval(pollHealth, 4000);
  if (!isTauri()) {
    // Browser mode: no shell to report a backend.
    backendBadge.textContent = "browser";
  }
}
boot();
