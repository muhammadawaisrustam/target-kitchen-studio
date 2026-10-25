/**
 * Automatic cabinet detection is kept behind this interface so a real model can be added later
 * without touching the editor.
 *
 * No service is configured in this build. The editor asks `getSegmentationService()` and, when it
 * reports `available: false`, says so and offers the manual tools (smart select, brush, polygon).
 * Nothing in the UI claims automatic detection unless a service reports itself available.
 *
 * A future implementation must keep photos on the device (run in the browser, e.g. an open model
 * via WebGPU/WASM) or, if it calls a server, explain that to the user and ask for consent first.
 * See docs/photo-visualiser.md, "Adding automatic detection".
 */
import type { Mask, Point } from "./mask";
import type { RgbaImage } from "./composite";

export interface SegmentationCandidate {
  mask: Mask;
  /** Model's own label, if it has one (e.g. "cabinet"). */
  label?: string;
  /** 0 to 1. */
  score: number;
}

export interface SegmentationStatus {
  available: boolean;
  /** Shown to the user. */
  message: string;
  /** True if the photo would leave the device. The UI must ask for consent before calling segment(). */
  sendsPhotoOffDevice: boolean;
}

export interface SegmentationService {
  id: string;
  name: string;
  status(): Promise<SegmentationStatus>;
  /** Finds likely cabinet surfaces. `hints` are optional clicked points inside a cabinet. */
  segment(image: RgbaImage, hints?: Point[], signal?: AbortSignal): Promise<SegmentationCandidate[]>;
}

/** Used when nothing is configured: reports itself unavailable and never pretends to detect anything. */
export const noSegmentation: SegmentationService = {
  id: "none",
  name: "Not configured",
  async status() {
    return {
      available: false,
      sendsPhotoOffDevice: false,
      message: "Automatic cabinet detection is not set up in this version. Use Smart select, the brush or the shape tool to mark cabinet surfaces.",
    };
  },
  async segment() {
    throw new Error("Automatic cabinet detection is not configured.");
  },
};

let configured: SegmentationService = noSegmentation;

/** Registers a real implementation (for example from a plug-in module). */
export function setSegmentationService(service: SegmentationService) {
  configured = service;
}

export function getSegmentationService(): SegmentationService {
  return configured;
}
