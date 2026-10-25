"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import Studio from "./Studio";
import ModeTabs, { type AppMode } from "./ModeTabs";

// The photo visualiser is loaded only when first opened, so the 3D studio's start-up is unchanged.
const PhotoStudio = dynamic(() => import("./photo/PhotoStudio"), {
  ssr: false,
  loading: () => <p className="p-8 text-center text-sm text-muted">Loading My Kitchen Photo…</p>,
});

const MODE_PARAM = "mode";

/**
 * Two clearly separated modes on one page. Both stay mounted once opened, so switching back and
 * forth keeps the 3D design and the photo work in progress.
 */
export default function KitchenApp() {
  const [mode, setMode] = useState<AppMode>("3d");
  const [photoOpened, setPhotoOpened] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get(MODE_PARAM) === "photo") {
      setMode("photo");
      setPhotoOpened(true);
    }
  }, []);

  const switchTo = useCallback((m: AppMode) => {
    setMode(m);
    if (m === "photo") setPhotoOpened(true);
    const url = new URL(window.location.href);
    if (m === "photo") url.searchParams.set(MODE_PARAM, "photo");
    else url.searchParams.delete(MODE_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search);
    window.scrollTo(0, 0);
  }, []);

  return (
    <>
      <div hidden={mode !== "3d"} data-testid="mode-panel-3d">
        <Studio modeSwitch={<ModeTabs mode="3d" onChange={switchTo} />} />
      </div>
      {photoOpened && (
        <div hidden={mode !== "photo"} data-testid="mode-panel-photo">
          <PhotoStudio modeSwitch={<ModeTabs mode="photo" onChange={switchTo} />} active={mode === "photo"} />
        </div>
      )}
    </>
  );
}
