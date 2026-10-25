"use client";

import { useEffect, useRef, useState } from "react";
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES, formatBytes, validateImageFile } from "@/lib/photo/validation";

interface Props {
  /** Called when the user confirms the photo. Resolves to an error message, or null on success. */
  onUse: (file: File) => Promise<string | null>;
  onOpenSaved: () => void;
  savedCount: number;
}

type Picked = { file: File; url: string; width?: number; height?: number };

/** Drag-and-drop or file picker, quick checks, and a preview before the photo is processed. */
export default function PhotoUpload({ onUse, onOpenSaved, savedCount }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const pickedUrl = picked?.url;
  useEffect(
    () => () => {
      if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    },
    [pickedUrl],
  );

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const check = validateImageFile(file, head);
    if (!check.ok) {
      setPicked(null);
      setError(check.error);
      return;
    }
    setPicked({ file, url: URL.createObjectURL(file) });
  };

  const use = async () => {
    if (!picked) return;
    setBusy(true);
    setError(await onUse(picked.file));
    setBusy(false);
  };

  const remove = () => {
    setPicked(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 lg:py-10">
      <h1 className="font-display text-2xl sm:text-3xl">See Target panels on your own kitchen</h1>
      <p className="mt-2 text-sm text-muted">
        Upload a photo of your kitchen, mark the cabinet doors and panels, and try real panel finishes on them. The result is an approximate visual preview to help you choose, not an exact
        render.
      </p>

      {!picked && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload a kitchen photo: drop a file here or press to choose one"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), inputRef.current?.click())}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void choose(e.dataTransfer.files[0]);
          }}
          className={`mt-6 grid cursor-pointer place-items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${dragging ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-[#c9c1b5]"}`}
          data-testid="photo-dropzone"
        >
          <div>
            <p className="text-base font-medium">Drop a kitchen photo here</p>
            <p className="mt-1 text-sm text-muted">or</p>
            <span className="mt-2 inline-block rounded-full bg-ink px-4 py-2 text-sm font-medium text-white">Choose a photo</span>
            <p className="mt-3 text-xs text-muted">JPG, JPEG, PNG or WebP, up to {formatBytes(MAX_FILE_BYTES)}. A straight-on photo in daylight works best.</p>
          </div>
        </div>
      )}
      <input ref={inputRef} type="file" accept={ACCEPT_ATTRIBUTE} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void choose(e.target.files?.[0])} data-testid="photo-input" />

      {picked && (
        <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface" data-testid="photo-pending">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={picked.url}
            alt="Selected kitchen photo"
            className="max-h-[50svh] w-full bg-canvas object-contain"
            onLoad={(e) => {
              const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
              setPicked((p) => (p ? { ...p, width, height } : p));
            }}
            onError={() => setError("This photo could not be displayed. It may be damaged or in a format this browser cannot read.")}
          />
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">{picked.file.name}</p>
              <p className="text-xs text-muted">
                {formatBytes(picked.file.size)}
                {picked.width && ` · ${picked.width} × ${picked.height} px`}
              </p>
            </div>
            <button type="button" onClick={remove} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-canvas" data-testid="photo-remove">
              Remove
            </button>
            <button type="button" onClick={() => inputRef.current?.click()} className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-canvas" data-testid="photo-replace">
              Choose another
            </button>
            <button type="button" onClick={use} disabled={busy} className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60" data-testid="photo-use">
              {busy ? "Preparing…" : "Use this photo"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn" role="alert" data-testid="photo-error">
          {error}
        </p>
      )}

      <div className="mt-6 rounded-xl bg-canvas px-4 py-3 text-[13px] leading-relaxed text-muted" data-testid="photo-privacy">
        <p className="font-medium text-ink">Your photo stays on this device</p>
        <p>
          The photo is processed entirely in your browser. It is not uploaded to Target or to any other service. If you save a design, it is kept in this browser only. If you request a
          quote, only the panel codes are sent, plus a preview image if you choose to attach one.
        </p>
      </div>

      {savedCount > 0 && (
        <button type="button" onClick={onOpenSaved} className="mt-4 text-sm font-medium text-accent hover:underline" data-testid="photo-open-saved">
          Open a saved photo design ({savedCount})
        </button>
      )}
    </div>
  );
}
