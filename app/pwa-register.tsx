"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js?v=12").catch(() => {
        // The app remains fully usable online if registration is unavailable.
      });
    }
  }, []);

  return null;
}
