import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";

import { useI18n } from "../i18n";
import { IconButton } from "./IconButton";

/**
 * Sun/moon button that flips between light and dark mode.
 * Mantine persists the choice to localStorage automatically, so it
 * survives restarts of the desktop app.
 */
export function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const isDark = computed === "dark";
  const { t } = useI18n();

  return (
    <IconButton
      label={isDark ? t.theme.toLight : t.theme.toDark}
      // Below, not above: the button sits right under the window's title bar.
      tooltipPosition="bottom"
      variant="default"
      size="lg"
      onClick={() => setColorScheme(isDark ? "light" : "dark")}
    >
      {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </IconButton>
  );
}
