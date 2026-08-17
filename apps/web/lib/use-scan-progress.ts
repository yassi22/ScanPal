"use client";

import { useEffect, useState } from "react";
import {
  createScanProgressController,
  type ScanViewState,
} from "./scan-progress-client";

export type { ScanViewState } from "./scan-progress-client";

export function useScanProgress(
  scanId: string,
  initial: ScanViewState,
): ScanViewState {
  const [state, setState] = useState(initial);
  const initialStatus = initial.status;

  useEffect(() => {
    if (
      initialStatus === "completed" ||
      initialStatus === "failed" ||
      initialStatus === "canceled"
    ) {
      return;
    }

    const controller = createScanProgressController({
      scanId,
      onUpdate: (patch) => setState((prev) => ({ ...prev, ...patch })),
    });
    controller.start();
    return () => controller.stop();
  }, [scanId, initialStatus]);

  return state;
}
