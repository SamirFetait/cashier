/** The website's healthy swap finder: each swap is a craving, why the
 * alternative is better, and the shop's products that answer it. */
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  ScrollArea,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconEdit, IconPlus, IconRepeat, IconSearch, IconTrash } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import { IconButton } from "../components/IconButton";
import { ProductThumb } from "../components/ProductThumb";
import { useI18n } from "../i18n";
import { serverUrl } from "../webOrders/api";
import { fieldErrors, useListings, useSwapMutations, useSwaps, websiteErrorText, type WebsiteSwap } from "./api";
import { EmptyState, PageHead, useConfirm } from "./ui";

const MAX_PRODUCTS = 12;

export function SwapsPage() {
  const { t } = useI18n();
  const s = t.website.swaps;
  const swaps = useSwaps();
  const { save, remove } = useSwapMutations();
  const confirm = useConfirm();
  // undefined: closed; null: a new swap.
  const [editing, setEditing] = useState<WebsiteSwap | null | undefined>(undefined);
  const list = swaps.data ?? [];
  const failed = (error: unknown) => notifications.show({ color: "red", message: websiteErrorText(error, t) });

  async function drop(swap: WebsiteSwap) {
    if (await confirm.ask(s.deleteConfirm, t.common.delete)) remove.mutate(swap.id, { onError: failed });
  }

  return (
    <>
      <PageHead title={t.website.nav.swaps} intro={s.intro}>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(null)}>
          {s.add}
        </Button>
      </PageHead>
      {swaps.isError && <Alert color="red">{websiteErrorText(swaps.error, t)}</Alert>}
      {swaps.isPending && <Skeleton h={200} />}
      {swaps.data && list.length === 0 && <EmptyState icon={<IconRepeat size={30} />} title={s.none} />}
      <Stack gap="sm">
        {list.map((swap) => (
          <Card key={swap.id} withBorder radius="md" opacity={swap.is_active ? 1 : 0.6}>
            <Group align="flex-start" wrap="nowrap">
              <Text fz={34} lh={1} aria-hidden>
                {swap.emoji || "🌿"}
              </Text>
              <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={700}>{swap.craving}</Text>
                {swap.reason && (
                  <Text size="sm" c="dimmed">
                    {swap.reason}
                  </Text>
                )}
                <Group gap={6}>
                  {swap.products.length === 0 ? (
                    <Text size="xs" c="dimmed">
                      {s.noProducts}
                    </Text>
                  ) : (
                    swap.products.map((product) => (
                      <Badge
                        key={product.id}
                        variant="light"
                        color={product.is_active ? "teal" : "gray"}
                        size="lg"
                        radius="sm"
                        leftSection={
                          <Avatar src={product.thumb ? serverUrl(product.thumb) : null} size={18} radius="xl" />
                        }
                        td={product.is_active ? undefined : "line-through"}
                      >
                        {product.name}
                      </Badge>
                    ))
                  )}
                </Group>
              </Stack>
              <Stack align="flex-end" gap="xs">
                <Switch
                  label={s.active}
                  checked={swap.is_active}
                  onChange={(e) =>
                    save.mutate({ id: swap.id, body: { is_active: e.currentTarget.checked } }, { onError: failed })
                  }
                />
                <Group gap={4}>
                  <IconButton label={s.edit} variant="subtle" onClick={() => setEditing(swap)}>
                    <IconEdit size={17} />
                  </IconButton>
                  <IconButton label={t.common.delete} variant="subtle" color="red" onClick={() => void drop(swap)}>
                    <IconTrash size={17} />
                  </IconButton>
                </Group>
              </Stack>
            </Group>
          </Card>
        ))}
      </Stack>
      <SwapDialog swap={editing} nextSort={list.length} onClose={() => setEditing(undefined)} />
      {confirm.dialog}
    </>
  );
}

function SwapDialog({
  swap,
  nextSort,
  onClose,
}: {
  swap: WebsiteSwap | null | undefined;
  nextSort: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const s = t.website.swaps;
  const listings = useListings();
  const { save } = useSwapMutations();
  const opened = swap !== undefined;
  const [craving, setCraving] = useState("");
  const [emoji, setEmoji] = useState("");
  const [reason, setReason] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [sort, setSort] = useState<number | string>(0);
  const [active, setActive] = useState(true);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!opened) return;
    setCraving(swap?.craving ?? "");
    setEmoji(swap?.emoji ?? "");
    setReason(swap?.reason ?? "");
    setChosen(swap?.products.map((p) => p.id) ?? []);
    setSort(swap?.sort ?? nextSort);
    setActive(swap?.is_active ?? true);
    setSearch("");
    setErrors({});
  }, [opened, swap, nextSort]);

  const term = search.trim().toLowerCase();
  const products = useMemo(() => {
    const rows = listings.data ?? [];
    // The chosen ones first, then the rest, filtered by the search.
    const matching = rows.filter((row) => !term || `${row.name} ${row.category}`.toLowerCase().includes(term));
    return [...matching].sort((a, b) => Number(chosen.includes(b.id)) - Number(chosen.includes(a.id)));
  }, [listings.data, term, chosen]);

  function toggle(id: number) {
    setChosen((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length < MAX_PRODUCTS
          ? [...current, id]
          : current
    );
  }

  function submit() {
    setErrors({});
    save.mutate(
      {
        id: swap?.id ?? null,
        body: {
          craving: craving.trim(),
          emoji: emoji.trim(),
          reason: reason.trim(),
          product_ids: chosen,
          sort: Number(sort) || 0,
          is_active: active,
        },
      },
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

  return (
    <Modal opened={opened} onClose={onClose} title={swap ? s.edit : s.add} size="lg" closeOnClickOutside={!save.isPending}>
      <Stack>
        <Group grow align="flex-end">
          <TextInput
            label={s.craving}
            placeholder={s.cravingPlaceholder}
            required
            maxLength={80}
            value={craving}
            error={errors.craving}
            onChange={(e) => setCraving(e.currentTarget.value)}
          />
          <TextInput
            label={s.emoji}
            description={s.emojiHint}
            placeholder="🍫 🥤 🍟 🍦"
            maxLength={16}
            value={emoji}
            error={errors.emoji}
            onChange={(e) => setEmoji(e.currentTarget.value)}
          />
          <NumberInput label={s.order} value={sort} onChange={setSort} error={errors.sort} allowDecimal={false} />
        </Group>
        <Textarea
          label={s.reason}
          description={t.website.optional}
          placeholder={s.reasonPlaceholder}
          maxLength={500}
          autosize
          minRows={2}
          value={reason}
          error={errors.reason}
          onChange={(e) => setReason(e.currentTarget.value)}
        />
        <div>
          <Text size="sm" fw={500}>
            {s.products}
          </Text>
          <Text size="xs" c={errors.product_ids ? "red" : "dimmed"} mb={6}>
            {errors.product_ids ?? `${s.productsHint} ${s.selected(chosen.length)}`}
          </Text>
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder={s.search}
            aria-label={s.search}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            mb={6}
          />
          <ScrollArea h={260} type="auto">
            <Stack gap={2}>
              {products.map((row) => {
                const on = chosen.includes(row.id);
                return (
                  <Checkbox.Card
                    key={row.id}
                    checked={on}
                    onChange={() => toggle(row.id)}
                    disabled={!on && chosen.length >= MAX_PRODUCTS}
                    radius="sm"
                    p={6}
                    withBorder={false}
                    bg={on ? "var(--mantine-primary-color-light)" : undefined}
                    opacity={row.hidden ? 0.6 : 1}
                  >
                    <Group wrap="nowrap" gap="sm">
                      <Checkbox.Indicator />
                      <ProductThumb src={row.thumb ? serverUrl(row.thumb) : null} size={32} />
                      <div>
                        <Text size="sm">{row.name}</Text>
                        <Text size="xs" c="dimmed">
                          {row.category}
                        </Text>
                      </div>
                    </Group>
                  </Checkbox.Card>
                );
              })}
            </Stack>
          </ScrollArea>
        </div>
        <Switch label={s.active} checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={save.isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={!craving.trim()}>
            {t.common.save}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
