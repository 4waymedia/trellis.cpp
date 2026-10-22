// Settings editor: the per-generation controls from the design handoff.
//
//   Resolution          segmented   512 · fast / 1024 / 1536 · high
//   Background removal  segmented   Auto / Always / Simple
//   UV unwrap           segmented   xatlas / Box
//   Texture             segmented   On / Off (geometry only)
//   Output preset       3x2 grid    Icon / Lite / Game / Hero / Handoff / Custom,
//                                   Custom opens an inline Faces + Atlas panel
//   Seed                mono input + dice (random seed)
//
// It's a small self-contained component (no framework, like the rest of the
// app): createSettingsEditor() builds the DOM once and returns get/set. Phase 1
// uses one instance for the next generation; Phase 2 reuses it in every queued
// job card and in the "New images use" defaults card.
//
// Values and labels come from options.ts; styles are .editor/.seg/.preset-grid
// in ui.css.

import {
  ATLAS_CHOICES,
  BG_REMOVALS,
  FACE_CHOICES,
  PRESETS,
  RESOLUTIONS,
  TEXTURE_CHOICES,
  UV_UNWRAPS,
  budgetOf,
  matchPreset,
  presetSub,
  type Choice,
  type PresetId,
} from "./options";
import { formatFaces, randomSeed, TEXTURE_FORMAT, type GenParams } from "./types";

export interface SettingsEditor {
  /** Root element, to be placed in the page. */
  readonly el: HTMLElement;
  /** The settings currently shown (a copy). */
  get(): GenParams;
  /** Show these settings, e.g. a gallery record's. Does not fire onChange. */
  set(p: GenParams): void;
}

/** Which cell of the preset grid is selected. */
type PresetMode = PresetId | "custom";

const DICE_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
  '<rect x="3" y="3" width="18" height="18" rx="4"></rect><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"></circle>' +
  '<circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"></circle><circle cx="12" cy="12" r="1.2" fill="currentColor"></circle></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A labelled field: label (optionally with a right-aligned summary) above a control. */
function field(label: string, control: HTMLElement, summary?: HTMLElement): HTMLElement {
  const wrap = el("div", "field");
  if (summary) {
    const head = el("div", "field-head");
    head.append(el("span", "field-label", label), summary);
    wrap.append(head);
  } else {
    wrap.append(el("span", "field-label", label));
  }
  wrap.append(control);
  return wrap;
}

/**
 * Segmented control: one button per choice, exactly one selected.
 * @returns the element and a `select(value)` to change the selection without firing onPick.
 */
function segmented<T>(
  choices: readonly Choice<T>[],
  onPick: (value: T) => void,
  compact = false,
): { el: HTMLElement; select(value: T): void } {
  const root = el("div", compact ? "seg compact" : "seg");
  root.setAttribute("role", "radiogroup");
  const buttons = choices.map((c) => {
    const b = el("button", "seg-opt", c.label);
    b.type = "button";
    b.setAttribute("role", "radio");
    if (c.title) b.title = c.title;
    b.addEventListener("click", () => {
      select(c.value);
      onPick(c.value);
    });
    root.append(b);
    return b;
  });
  function select(value: T): void {
    choices.forEach((c, i) => {
      const on = c.value === value;
      buttons[i].classList.toggle("on", on);
      buttons[i].setAttribute("aria-checked", String(on));
    });
  }
  return { el: root, select };
}

/**
 * Build a settings editor showing `initial`.
 * @param onChange called with the new settings after every user edit.
 */
export function createSettingsEditor(
  initial: GenParams,
  onChange: (p: GenParams) => void = () => {},
): SettingsEditor {
  let params: GenParams = { ...initial, textures: TEXTURE_FORMAT, texture: initial.texture !== false };
  let mode: PresetMode = matchPreset(params)?.id ?? "custom";

  const changed = () => onChange({ ...params });
  const root = el("div", "editor");

  // --- resolution / background / UV ---
  const res = segmented(RESOLUTIONS, (v) => {
    params.resolution = v;
    changed();
  });
  const bg = segmented(BG_REMOVALS, (v) => {
    params.bgRemoval = v;
    changed();
  });
  const uv = segmented(UV_UNWRAPS, (v) => {
    params.uv = v;
    changed();
  });
  const tex = segmented(TEXTURE_CHOICES, (v) => {
    params.texture = v;
    changed();
  });

  // --- output preset: 3x2 grid, a full-width Custom row, then the inline Custom panel ---
  const summary = el("span", "field-summary");
  const grid = el("div", "preset-grid");
  grid.setAttribute("role", "radiogroup");
  const presetButtons = new Map<PresetMode, HTMLButtonElement>();
  const addPresetButton = (id: PresetMode, label: string, sub: string, title: string) => {
    const b = el("button", id === "custom" ? "preset-opt preset-custom" : "preset-opt");
    b.type = "button";
    b.setAttribute("role", "radio");
    b.title = title;
    b.append(el("span", "p-name", label), el("span", "p-sub", sub));
    b.addEventListener("click", () => pickPreset(id));
    presetButtons.set(id, b);
    grid.append(b);
  };
  for (const p of PRESETS) addPresetButton(p.id, p.label, presetSub(p), p.title);
  addPresetButton("custom", "Custom", "set below", "Choose faces and atlas yourself");

  const customPanel = el("div", "custom-panel");
  const faces = segmented(
    FACE_CHOICES.map((v) => ({ value: v, label: formatFaces(v) })),
    (v) => {
      params.faces = v;
      refreshBudget();
      changed();
    },
    true,
  );
  const atlas = segmented(
    ATLAS_CHOICES.map((v) => ({ value: v, label: String(v) })),
    (v) => {
      params.atlas = v;
      refreshBudget();
      changed();
    },
    true,
  );
  customPanel.append(el("span", "field-label", "Faces"), faces.el, el("span", "field-label", "Atlas"), atlas.el);
  const presetBlock = el("div", "field");
  presetBlock.append(grid, customPanel);

  /** Selecting a preset sets faces and atlas together; Custom keeps the current values. */
  function pickPreset(id: PresetMode): void {
    mode = id;
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      params.faces = preset.faces;
      params.atlas = preset.atlas;
    }
    refreshBudget();
    changed();
  }

  /** Sync the grid, the Custom panel and the summary with `mode` and `params`. */
  function refreshBudget(): void {
    const b = budgetOf(params);
    params.faces = b.faces;
    params.atlas = b.atlas;
    presetButtons.forEach((btn, id) => {
      btn.classList.toggle("on", id === mode);
      btn.setAttribute("aria-checked", String(id === mode));
    });
    customPanel.classList.toggle("hidden", mode !== "custom");
    faces.select(b.faces);
    atlas.select(b.atlas);
    summary.textContent = `${formatFaces(b.faces)} faces · ${b.atlas} px`;
  }

  // --- seed: mono input + dice ---
  const seedInput = el("input", "seed-input");
  seedInput.type = "text";
  seedInput.inputMode = "numeric";
  seedInput.setAttribute("aria-label", "Seed");
  seedInput.addEventListener("input", () => {
    const n = parseInt(seedInput.value, 10);
    if (!isNaN(n) && n >= 0) {
      params.seed = n;
      changed();
    }
  });
  seedInput.addEventListener("blur", () => (seedInput.value = String(params.seed))); // drop invalid text
  const dice = el("button", "dice-btn");
  dice.type = "button";
  dice.title = "Random seed";
  dice.setAttribute("aria-label", "Random seed");
  dice.innerHTML = DICE_SVG;
  dice.addEventListener("click", () => {
    params.seed = randomSeed();
    seedInput.value = String(params.seed);
    changed();
  });
  const seedRow = el("div", "seed-row");
  seedRow.append(seedInput, dice);

  root.append(
    field("Resolution", res.el),
    field("Background removal", bg.el),
    field("UV unwrap", uv.el),
    field("Texture", tex.el),
    field("Output preset", presetBlock, summary),
    field("Seed", seedRow),
  );

  function set(p: GenParams): void {
    // gallery records saved before the Texture option have no field: textured
    params = { ...p, textures: TEXTURE_FORMAT, texture: p.texture !== false };
    mode = matchPreset(params)?.id ?? "custom";
    res.select(params.resolution);
    bg.select(params.bgRemoval);
    uv.select(params.uv);
    tex.select(params.texture);
    seedInput.value = String(params.seed);
    refreshBudget();
  }
  set(params);

  return { el: root, get: () => ({ ...params }), set };
}
