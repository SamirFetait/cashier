import { ActionIcon, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";

import { useI18n } from "../i18n";

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
    <Tooltip label={isDark ? t.theme.toLight : t.theme.toDark} withArrow>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label={t.theme.toggle}
        onClick={() => setColorScheme(isDark ? "light" : "dark")}
      >
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}
