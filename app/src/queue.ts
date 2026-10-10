// Generation queue: images waiting to run after the current job.
//
// trellis-server runs one generation at a time (a mutex around trellis_run in
// trellis-server.cpp), so the queue lives entirely in the UI: main.ts starts
// the next item when a run finishes, and the server only ever sees one
// request in flight. The queue is in-memory and does not survive a restart.
//
// Each item captures its settings (GenParams) when it is added, so later
// edits to the settings panel never change work already queued. Which
// settings get captured is decided by the caller (see `queueSameSettings` in
// prefs.ts); this module only stores and shows them.
//
// This module owns the item list and its strip of thumbnails in the left
// panel. Starting jobs, and deciding when to, stays in main.ts.

import { newId } from "./store";
import { paramChips, tileLabel } from "./options";
import type { GenParams } from "./types";

/** One image waiting to be generated. */
export interface QueueItem {
  id: string;
  image: Blob;
  /** Original file name, used for the output file and the gallery entry. */
  name: string;
  /** Settings this item will run with, fixed when it was queued. */
  params: GenParams;
  /** Object URL for the thumbnail; revoked when the item leaves the queue. */
  thumbUrl: string;
}

/** DOM elements the queue renders into (see #queue in index.html). */
export interface QueueElements {
  /** Container; hidden while the queue is empty. */
  wrap: HTMLElement;
  /** Heading text, e.g. "Queued · 3". */
  label: HTMLElement;
  /** Horizontal strip of thumbnails. */
  list: HTMLElement;
  /** "Clear" button. */
  clearBtn: HTMLElement;
}

/** FIFO queue of pending generations, with its own thumbnail strip. */
export class GenerationQueue {
  private items: QueueItem[] = [];

  /**
   * @param els      Where to render the queue.
   * @param onChange Called after every add/remove/clear/take, so the caller
   *                 can refresh things that depend on the queue (e.g. whether
   *                 Generate is enabled).
   */
  constructor(
    private readonly els: QueueElements,
    private readonly onChange: () => void = () => {},
  ) {
    els.clearBtn.addEventListener("click", () => this.clear());
    this.render();
  }

  /** Number of images waiting. */
  get size(): number {
    return this.items.length;
  }

  /** Append an image to the end of the queue with the given settings. */
  add(image: Blob, name: string, params: GenParams): void {
    this.items.push({ id: newId(), image, name, params, thumbUrl: URL.createObjectURL(image) });
    this.changed();
  }

  /**
   * Remove and return the next item, or undefined if the queue is empty.
   * Its thumbnail URL is revoked; the image Blob itself stays valid.
   */
  take(): QueueItem | undefined {
    const item = this.items.shift();
    if (!item) return undefined;
    URL.revokeObjectURL(item.thumbUrl);
    this.changed();
    return item;
  }

  /** Remove one item by id (the ✕ on its thumbnail). */
  remove(id: string): void {
    const i = this.items.findIndex((q) => q.id === id);
    if (i < 0) return;
    URL.revokeObjectURL(this.items[i].thumbUrl);
    this.items.splice(i, 1);
    this.changed();
  }

  /** Drop everything that's waiting. Does not affect a job already running. */
  clear(): void {
    this.items.forEach((q) => URL.revokeObjectURL(q.thumbUrl));
    this.items = [];
    this.changed();
  }

  private changed(): void {
    this.render();
    this.onChange();
  }

  /**
   * Rebuild the thumbnail strip. Items reuse the gallery's tile styles
   * (.gitem/.gmeta/.gdel in ui.css) at a smaller size (.qitem).
   */
  private render(): void {
    const { wrap, label, list } = this.els;
    wrap.classList.toggle("hidden", this.items.length === 0);
    label.textContent = `Queued · ${this.items.length}`;
    list.innerHTML = "";

    this.items.forEach((q, i) => {
      const tile = document.createElement("div");
      tile.className = "gitem qitem";
      tile.title = `${i + 1}. ${q.name} · ${describeParams(q.params)}`;

      const img = document.createElement("img");
      img.src = q.thumbUrl;
      img.alt = q.name;
      tile.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "gmeta";
      meta.textContent = tileLabel(q.params);
      tile.appendChild(meta);

      const del = document.createElement("button");
      del.className = "gdel";
      del.textContent = "✕";
      del.title = "Remove from queue";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.remove(q.id);
      });
      tile.appendChild(del);

      list.appendChild(tile);
    });
  }
}

/** Human-readable summary of every setting: "1024 · bg auto · xatlas · Game 50K/2048 · seed 42". */
export function describeParams(p: GenParams): string {
  return paramChips(p).join(" · ");
}
