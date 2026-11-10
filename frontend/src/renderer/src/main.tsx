import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import {
  ColorSchemeScript,
  DirectionProvider,
  MantineProvider,
  useDirection,
} from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./i18n/arabic.css";

import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { theme } from "./brand/theme";
import { titleBarOffset } from "./components/TitleBar";
import { useI18n } from "./i18n";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

/** Keeps Mantine's direction (popover sides, sliders…) in step with the language. */
function DirectionSync({ dir }: { dir: "ltr" | "rtl" }) {
  const { setDirection } = useDirection();
  useEffect(() => {
    setDirection(dir);
    // setDirection is a new function on every render; only dir matters.
  }, [dir]);
  return null;
}

function Root() {
  const { dir } = useI18n();
  return (
    <DirectionProvider initialDirection={dir} detectDirection={false}>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <DirectionSync dir={dir} />
        <Notifications
          position={dir === "rtl" ? "top-left" : "top-right"}
          // Below the window's title bar, clear of the Windows buttons.
          style={{ top: `calc(var(--mantine-spacing-md) + ${titleBarOffset}px)` }}
        />
        <QueryClientProvider client={queryClient}>
          <HashRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </HashRouter>
        </QueryClientProvider>
      </MantineProvider>
    </DirectionProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ColorSchemeScript defaultColorScheme="light" />
    <Root />
  </React.StrictMode>
);
