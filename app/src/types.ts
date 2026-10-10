// Shared types for Trellis Studio.

export type Resolution = 512 | 1024 | 1536;
export type BgRemoval = "auto" | "birefnet" | "threshold";
export type Uv = "xatlas" | "box";
/** GLB texture encoding: WebP is smaller, PNG opens in every DCC tool / importer. */
export type TextureFormat = "webp" | "png";

/** Generation knobs mapped onto trellis-server's POST /generate form fields. */
export interface GenParams {
  resolution: Resolution;
  seed: number;
  bgRemoval: BgRemoval;
  uv: Uv;
  /**
   * QEM decimation face target (server field `faces`, CLI `--faces`).
   * 0 or absent = the server's default: 300K at 1024/1536, 150K at 512.
   * Optional because gallery records saved before this field existed lack it.
   */
  faces?: number;
  /** UV atlas size in px (server field `atlas`, CLI `--atlas`). 0 or absent = default (2048, 1024 at res 512). */
  atlas?: number;
  /** Texture encoding (server field `webp=off` for PNG). Absent = WebP, the server default. */
  textures?: TextureFormat;
}

/**
 * Texture format Studio always requests. It only changes how the colors are
 * stored in the GLB, not the model. The engine's default WebP (glTF extension
 * EXT_texture_webp) is far smaller, but a GLB that requires it won't open at
 * all in tools without that extension; PNG opens in every DCC tool and in
 * Unreal, which is where Studio's output goes. Not a user control.
 */
export const TEXTURE_FORMAT: TextureFormat = "png";

export const DEFAULT_PARAMS: GenParams = {
  resolution: 1024,
  seed: 42,
  bgRemoval: "auto",
  uv: "xatlas",
  faces: 0,
  atlas: 0,
  textures: TEXTURE_FORMAT,
};

/** Compact face count: 49812 -> "49.8K", 300000 -> "300K", 1250000 -> "1.25M". */
export function formatFaces(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return String(n);
}

/**
 * Label for a gallery/queue tile: the resolution, plus the face target and
 * atlas when they're set, e.g. "1024", "1024 · 50K", "1024 · 50K · 4096".
 */
export function tileLabel(p: GenParams): string {
  const parts = [`${p.resolution}`];
  if (p.faces) parts.push(formatFaces(p.faces));
  if (p.atlas) parts.push(String(p.atlas));
  return parts.join(" · ");
}

/** Written by the installer, read by the Tauri shell + surfaced to the UI. */
export interface AppConfig {
  serverBin: string;
  modelsDir: string;
  backend: string;
  gpu: number;
  host: string;
  port: number;
  /** where generated GLBs are auto-saved (Tauri only). */
  outputDir: string;
  /** true once the shell has a usable config.json; false => "setup needed". */
  configured: boolean;
}

/** One persisted generation (IndexedDB record). */
export interface GenRecord {
  id: string;
  ts: number;
  name: string;
  params: GenParams;
  input: Blob; // source image
  glb: Blob; // resulting model/gltf-binary
  thumb: Blob | null; // model-viewer snapshot for the gallery
}
