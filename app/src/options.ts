// Every user-facing generation option in one place: the values the server
// accepts, the labels Studio shows for them, and the output presets.
//
// The settings editor (controls.ts), the settings chips, gallery/queue tiles
// and the handoff notes all read from here, so a setting is always described
// the same way everywhere.
//
// Labels follow the design handoff; values are the engine's real ones:
//   Background removal  Auto -> auto · Always -> birefnet · Simple -> threshold
//   UV unwrap           xatlas -> xatlas · Box -> box (faster, looser packing)

import { formatFaces, type BgRemoval, type GenParams, type Resolution, type Uv } from "./types";

/** One choice in a segmented control. */
export interface Choice<T> {
  value: T;
  label: string;
  /** Tooltip explaining the choice. */
  title?: string;
}

export const RESOLUTIONS: readonly Choice<Resolution>[] = [
  { value: 512, label: "512 · fast", title: "Light single-resolution path; enough for small or distant assets" },
  { value: 1024, label: "1024", title: "512 -> 1024 cascade (the engine default)" },
  { value: 1536, label: "1536 · high", title: "Finest grid, but slower (about 2x) and in tests it can lose small features like eyes and soften the texture; prefer 1024 for characters" },
];

export const BG_REMOVALS: readonly Choice<BgRemoval>[] = [
  { value: "auto", label: "Auto", title: "Keep an image's own transparency; otherwise remove the background (BiRefNet)" },
  { value: "birefnet", label: "Always", title: "Always run neural background removal (BiRefNet)" },
  { value: "threshold", label: "Simple", title: "Fast white-background keyer; can cut bright highlights out of the object" },
];

export const UV_UNWRAPS: readonly Choice<Uv>[] = [
  { value: "xatlas", label: "xatlas", title: "Unique UV charts, best texture use (default)" },
  { value: "box", label: "Box", title: "Six-way box projection: much faster, looser packing" },
];

export const TEXTURE_CHOICES: readonly Choice<boolean>[] = [
  { value: true, label: "On", title: "Textured, decimated model (default)" },
  { value: false, label: "Off", title: "Geometry only: the raw decoder mesh, no texture and no face-count target (much larger file)" },
];

/** Short label used in chips: "bg auto" / "bg always" / "bg simple". */
export function bgLabel(v: BgRemoval): string {
  return (BG_REMOVALS.find((c) => c.value === v)?.label ?? v).toLowerCase();
}

// ---------------- Output presets ----------------

export type PresetId = "icon" | "lite" | "character" | "game" | "hero" | "handoff";

/** A named face target + atlas pair, chosen by what the asset is for. */
export interface Preset {
  id: PresetId;
  label: string;
  faces: number;
  atlas: number;
  title: string;
}

/**
 * The six presets, in grid order (Custom gets its own row below). Values are a
 * starting point for Reapers (Unreal, PC + tablets, plus modeler handoff);
 * retune them here.
 */
export const PRESETS: readonly Preset[] = [
  { id: "icon", label: "Icon", faces: 10_000, atlas: 1024, title: "Inventory and menu models, small on screen" },
  { id: "lite", label: "Lite", faces: 25_000, atlas: 1024, title: "Background props, distant objects, low-end devices" },
  { id: "character", label: "Character", faces: 25_000, atlas: 2048, title: "Characters at gameplay distance: a light mesh with a sharp face texture" },
  { id: "game", label: "Game", faces: 50_000, atlas: 2048, title: "Standard props for Unreal" },
  { id: "hero", label: "Hero", faces: 150_000, atlas: 2048, title: "Characters, bosses, close-up assets" },
  { id: "handoff", label: "Handoff", faces: 300_000, atlas: 4096, title: "Maximum detail as reference for a 3D modeler (use 1024; 1536 can lose small features)" },
];

/** Choices in the Custom panel. */
export const FACE_CHOICES: readonly number[] = [10_000, 25_000, 50_000, 100_000, 150_000, 300_000];
export const ATLAS_CHOICES: readonly number[] = [1024, 2048, 4096];

/** "10K · 1K": a preset's sub-label in the grid. */
export function presetSub(p: { faces: number; atlas: number }): string {
  return `${formatFaces(p.faces)} · ${p.atlas / 1024}K`;
}

/**
 * Resolve absent/0 faces or atlas (records from older builds, where 0 meant
 * "server default") to the values the server actually used, so every record
 * can be shown against the presets.
 */
export function budgetOf(p: GenParams): { faces: number; atlas: number } {
  return {
    faces: p.faces || (p.resolution === 512 ? 150_000 : 300_000),
    atlas: p.atlas || (p.resolution === 512 ? 1024 : 2048),
  };
}

/** The preset matching these params' face target and atlas, or null for Custom. */
export function matchPreset(p: GenParams): Preset | null {
  const { faces, atlas } = budgetOf(p);
  return PRESETS.find((x) => x.faces === faces && x.atlas === atlas) ?? null;
}

/** Name of the params' preset, or "Custom". */
export function presetName(p: GenParams): string {
  return matchPreset(p)?.label ?? "Custom";
}

/** Chip for the output budget: "Game 50K/2048". */
export function budgetChip(p: GenParams): string {
  const { faces, atlas } = budgetOf(p);
  return `${presetName(p)} ${formatFaces(faces)}/${atlas}`;
}

/** Every setting as chips: ["1024", "bg auto", "xatlas", "Game 50K/2048", "seed 42"]. */
export function paramChips(p: GenParams): string[] {
  return [`${p.resolution}`, `bg ${bgLabel(p.bgRemoval)}`, p.uv, budgetChip(p), `seed ${p.seed}`];
}

/** Gallery/queue tile label: "1024 · Game". */
export function tileLabel(p: GenParams): string {
  return `${p.resolution} · ${presetName(p)}`;
}
