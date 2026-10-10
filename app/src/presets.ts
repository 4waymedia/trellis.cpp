// Output presets: named combinations of face target, atlas size and texture
// format, chosen by what the asset is for rather than by raw numbers.
//
// A preset only sets the OUTPUT budget. Resolution (how good the generated
// shape is) stays the user's choice, so a "Game prop" can still come from a
// res-1536 generation; each preset's hint says when a resolution suits it.
//
// Presets are not stored with a generation. The face/atlas/texture values are
// stored, and the preset is worked out from them again whenever it's needed
// (matchPreset), so editing a value by hand simply makes it "Custom" and old
// gallery records are labelled correctly too.
//
// Texture format is not a user control: it follows the preset (texturesFor).
// It only changes how the colors are stored in the GLB, not the model. The
// engine's default WebP (glTF extension EXT_texture_webp) is far smaller, but
// not every DCC tool or engine importer reads it, and a GLB that requires it
// won't open at all there; PNG opens everywhere. So only Showcase, which is
// for viewing, keeps WebP; every other preset, and Custom, uses PNG.

import { formatFaces, type GenParams, type TextureFormat } from "./types";

/** Texture format for a Custom budget (no preset): the format every tool can open. */
const CUSTOM_TEXTURES: TextureFormat = "png";

export type PresetId = "handoff" | "showcase" | "hero" | "game" | "lite" | "icon";

/** The output-budget fields a preset controls. 0 = server default ("auto"). */
export type OutputBudget = Required<Pick<GenParams, "faces" | "atlas" | "textures">>;

export interface Preset extends OutputBudget {
  id: PresetId;
  /** Full name for the dropdown. */
  label: string;
  /** Short name for 56–88 px gallery/queue tiles. */
  short: string;
  /** One line under the dropdown: what it's for. */
  hint: string;
}

/**
 * All presets, in dropdown order. Values are a starting point for Reapers
 * (Unreal, PC + tablets); retune here once real assets come back from the modeler.
 */
export const PRESETS: readonly Preset[] = [
  {
    id: "handoff", label: "Modeler handoff", short: "Handoff",
    faces: 0, atlas: 4096, textures: "png",
    hint: "Maximum detail as reference for a 3D modeler. Use res 1536.",
  },
  {
    id: "showcase", label: "Showcase", short: "Showcase",
    faces: 0, atlas: 0, textures: "webp",
    hint: "Engine defaults (300K faces): renders, turntables, viewing.",
  },
  {
    id: "hero", label: "Hero", short: "Hero",
    faces: 150_000, atlas: 2048, textures: "png",
    hint: "Unreal placeholder for characters, bosses, close-up assets.",
  },
  {
    id: "game", label: "Game prop", short: "Game",
    faces: 50_000, atlas: 2048, textures: "png",
    hint: "Unreal placeholder for standard props (PC, consoles, tablets).",
  },
  {
    id: "lite", label: "Lite", short: "Lite",
    faces: 25_000, atlas: 1024, textures: "png",
    hint: "Background props, distant objects, low-end devices. Res 512 is enough.",
  },
  {
    id: "icon", label: "Icon", short: "Icon",
    faces: 10_000, atlas: 1024, textures: "png",
    hint: "Inventory and menu models, small on screen. Res 512 is enough.",
  },
];

/** The preset matching today's defaults: what a fresh install and legacy records map to. */
export const DEFAULT_PRESET: PresetId = "showcase";

export function getPreset(id: PresetId): Preset {
  return PRESETS.find((p) => p.id === id)!;
}

/**
 * The preset whose face target and atlas match these params, or null for
 * "Custom". Every preset has a distinct faces/atlas pair, so texture format
 * isn't part of the match (it follows from the preset; see texturesFor).
 * Missing fields (gallery records from before they existed) count as the
 * server defaults: auto faces, auto atlas.
 */
export function matchPreset(p: Pick<GenParams, "faces" | "atlas">): Preset | null {
  const faces = p.faces ?? 0;
  const atlas = p.atlas ?? 0;
  return PRESETS.find((x) => x.faces === faces && x.atlas === atlas) ?? null;
}

/** Texture format for a face/atlas budget: the matching preset's, else PNG for Custom. */
export function texturesFor(p: Pick<GenParams, "faces" | "atlas">): TextureFormat {
  return matchPreset(p)?.textures ?? CUSTOM_TEXTURES;
}

/**
 * Label for a gallery/queue tile: "1024 · Game" for a preset, or the raw
 * budget for Custom, e.g. "1024 · 80K/4096".
 */
export function tileLabel(p: GenParams): string {
  const preset = matchPreset(p);
  if (preset) return `${p.resolution} · ${preset.short}`;
  const faces = p.faces ? formatFaces(p.faces) : "auto";
  return `${p.resolution} · ${faces}/${p.atlas || "auto"}`;
}
