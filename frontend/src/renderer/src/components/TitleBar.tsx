import { Image, Text, useComputedColorScheme } from "@mantine/core";
import { useEffect, useState } from "react";

import { TITLEBAR_BUTTONS_WIDTH, TITLEBAR_COLORS, TITLEBAR_HEIGHT } from "../../../shared/titlebar";
import mark from "../assets/brand/mark.webp";
import { useI18n } from "../i18n";
import { platform } from "../platform";
import classes from "./TitleBar.module.css";

/** Space every screen leaves free at the top for the title bar (0 without one). */
export const titleBarOffset = platform.hasCustomTitleBar ? TITLEBAR_HEIGHT : 0;

/**
 * The window's title bar. On Windows the window has no system one: this bar
 * moves the window (drag, double-click to maximise), and Windows draws its
 * minimize / maximize / close buttons over the right end in the colours sent
 * from here, so they match in both colour schemes.
 */
export function TitleBar() {
  const { t } = useI18n();
  const scheme = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const [version, setVersion] = useState<string | null>(null);
  const colors = TITLEBAR_COLORS[scheme];

  useEffect(() => {
    platform.appVersion().then(setVersion, () => {});
  }, []);

  useEffect(() => {
    platform.setTitleBarColors(colors);
  }, [colors]);

  if (!platform.hasCustomTitleBar) return null;
  return (
    <header
      className={classes.bar}
      style={{
        height: TITLEBAR_HEIGHT,
        paddingRight: TITLEBAR_BUTTONS_WIDTH + 12,
        background: colors.color,
        color: colors.symbolColor,
      }}
    >
      <Image src={mark} alt="" h={22} w="auto" />
      <Text size="xs" fw={600}>
        {t.app.title}
      </Text>
      {version && (
        <Text size="xs" className={classes.version}>
          v{version}
        </Text>
      )}
    </header>
  );
}
