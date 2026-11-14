import { Button, Tooltip } from "@mantine/core";
import { IconLanguage } from "@tabler/icons-react";

import { useI18n } from "../i18n";

/** English ⇄ Arabic. The button names the other language, in its own script. */
export function LanguageToggle() {
  const { lang, t, setLang } = useI18n();
  const next = lang === "ar" ? "en" : "ar";
  return (
    // Below, not above: the button sits right under the window's title bar,
    // which would cover the tooltip.
    <Tooltip label={t.language.switch} position="bottom" withArrow>
      <Button
        variant="default"
        h={34}
        px="sm"
        leftSection={<IconLanguage size={16} />}
        onClick={() => setLang(next)}
        lang={next}
      >
        {next === "ar" ? "العربية" : "English"}
      </Button>
    </Tooltip>
  );
}
