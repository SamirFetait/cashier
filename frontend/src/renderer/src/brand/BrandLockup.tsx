import { Group, Image, Stack, Text } from "@mantine/core";

import mark from "../assets/brand/mark.webp";
import { useI18n } from "../i18n";
import { BRAND } from "./brand";

/**
 * Header lockup: the hexagon emblem beside the bilingual name, as on the
 * ribbon. The interface language's name leads; Arabic keeps the logo's brown.
 */
export function BrandLockup() {
  const { lang } = useI18n();
  const arabicFirst = lang === "ar";

  const english = (
    <Text key="en" fw={800} size={arabicFirst ? "xs" : "md"} lh={1.1} tt="uppercase" lts="0.04em">
      {BRAND.name}
    </Text>
  );
  const arabic = (
    <Text
      key="ar"
      lang="ar"
      size={arabicFirst ? "md" : "sm"}
      fw={arabicFirst ? 800 : 600}
      lh={1.25}
      c="light-dark(var(--mantine-color-wood-8), var(--mantine-color-wood-3))"
    >
      {BRAND.nameAr}
    </Text>
  );

  return (
    <Group gap={10} wrap="nowrap">
      {/* Decorative: the name is right beside it. */}
      <Image src={mark} alt="" h={36} w="auto" />
      <Stack gap={0}>{arabicFirst ? [arabic, english] : [english, arabic]}</Stack>
    </Group>
  );
}
