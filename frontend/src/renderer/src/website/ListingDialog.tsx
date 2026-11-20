/** How one product shows on the website: shown or not, featured, its badge,
 * description and nutrition facts. Opened from the website catalogue and
 * from the Products page. */
import {
  Button,
  Fieldset,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import {
  fieldErrors,
  NUTRIENTS,
  useSaveListing,
  websiteErrorText,
  type ListingInput,
  type ListingRow,
} from "./api";

const FACTS = [...NUTRIENTS, "piece_grams"] as const;
type Fact = (typeof FACTS)[number];
const NO_FACTS = Object.fromEntries(FACTS.map((key) => [key, ""])) as Record<Fact, string>;

export function ListingDialog({ row, onClose }: { row: ListingRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const c = t.website.catalogue;
  const save = useSaveListing();
  const [shown, setShown] = useState(true);
  const [featured, setFeatured] = useState(false);
  const [badge, setBadge] = useState("");
  const [description, setDescription] = useState("");
  const [facts, setFacts] = useState<Record<Fact, string>>(NO_FACTS);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!row) return;
    setShown(!row.hidden);
    setFeatured(row.featured);
    setBadge(row.badge);
    setDescription(row.description);
    setFacts(Object.fromEntries(FACTS.map((key) => [key, row[key] ?? ""])) as Record<Fact, string>);
    setErrors({});
  }, [row]);

  function submit() {
    if (!row) return;
    // An empty box clears that figure; a comma counts as a decimal point.
    const figures = Object.fromEntries(
      FACTS.map((key) => [key, facts[key].trim() === "" ? null : facts[key].trim().replace(",", ".")])
    ) as ListingInput;
    save.mutate(
      { id: row.id, body: { hidden: !shown, featured, badge, description, ...figures } },
      {
        onSuccess: () => {
          notifications.show({ color: "green", message: t.website.saved });
          onClose();
        },
        onError: (error) => {
          setErrors(fieldErrors(error));
          notifications.show({ color: "red", message: websiteErrorText(error, t) });
        },
      }
    );
  }

  const factLabel = (key: Fact) => (key === "piece_grams" ? c.pieceGrams : c[key]);

  return (
    <Modal opened={row !== null} onClose={onClose} title={row?.name} size="lg" closeOnClickOutside={!save.isPending}>
      <Stack>
        <Group gap="xl">
          <Switch label={c.show} checked={shown} onChange={(e) => setShown(e.currentTarget.checked)} />
          <Switch label={c.featured} checked={featured} onChange={(e) => setFeatured(e.currentTarget.checked)} />
        </Group>
        <TextInput
          label={c.badge}
          description={t.website.optional}
          placeholder={c.badgePlaceholder}
          maxLength={40}
          value={badge}
          error={errors.badge}
          onChange={(e) => setBadge(e.currentTarget.value)}
        />
        <Textarea
          label={c.description}
          description={t.website.optional}
          placeholder={c.descriptionPlaceholder}
          maxLength={600}
          autosize
          minRows={3}
          value={description}
          error={errors.description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <Fieldset legend={c.nutrition}>
          <Text size="xs" c="dimmed" mb="sm">
            {c.nutritionHint}
          </Text>
          <SimpleGrid cols={{ base: 2, sm: 3 }}>
            {FACTS.filter((key) => key !== "piece_grams" || row?.sold_by !== "WEIGHT").map((key) => (
              <TextInput
                key={key}
                label={factLabel(key)}
                description={key === "piece_grams" ? c.pieceGramsHint : undefined}
                inputMode="decimal"
                dir="ltr"
                maxLength={8}
                value={facts[key]}
                error={errors[key]}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setFacts((current) => ({ ...current, [key]: value }));
                }}
              />
            ))}
          </SimpleGrid>
        </Fieldset>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={save.isPending}>
            {t.common.cancel}
          </Button>
          <Button loading={save.isPending} onClick={submit}>
            {t.common.save}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
