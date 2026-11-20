/** Which products the website shows, and how. Products themselves come from
 * the cashier; here they are only presented. */
import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Group,
  SegmentedControl,
  Skeleton,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBuildingStore, IconEdit, IconExternalLink, IconSearch, IconStar, IconStarFilled } from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { IconButton } from "../components/IconButton";
import { ProductThumb } from "../components/ProductThumb";
import { useI18n } from "../i18n";
import { money, quantityText, serverUrl, toNumber } from "../webOrders/api";
import { siteLink, useListings, useSaveListing, useSiteUrl, websiteErrorText, type ListingInput, type ListingRow } from "./api";
import { ListingDialog } from "./ListingDialog";
import { EmptyState, PageHead } from "./ui";

type Filter = "all" | "shown" | "hidden" | "featured";

export function CataloguePage() {
  const { t, lang } = useI18n();
  const c = t.website.catalogue;
  const listings = useListings();
  const save = useSaveListing();
  const site = useSiteUrl();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<ListingRow | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const all = listings.data ?? [];
  const term = search.trim().toLowerCase();
  const rows = useMemo(
    () =>
      all.filter(
        (row) =>
          (!term || `${row.name} ${row.category}`.toLowerCase().includes(term)) &&
          (filter === "all" ||
            (filter === "shown" && !row.hidden) ||
            (filter === "hidden" && row.hidden) ||
            (filter === "featured" && row.featured))
      ),
    [all, term, filter]
  );

  function update(row: ListingRow, body: ListingInput) {
    setBusy(row.id);
    save.mutate(
      { id: row.id, body },
      {
        onError: (error) => notifications.show({ color: "red", message: websiteErrorText(error, t) }),
        onSettled: () => setBusy(null),
      }
    );
  }

  const shownCount = all.filter((row) => !row.hidden).length;

  return (
    <>
      <PageHead title={t.website.nav.catalogue} intro={c.intro} />
      <Group justify="space-between" wrap="wrap">
        <Group wrap="wrap">
          <TextInput
            w={280}
            leftSection={<IconSearch size={16} />}
            placeholder={c.search}
            aria-label={c.search}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <SegmentedControl
            value={filter}
            onChange={(value) => setFilter(value as Filter)}
            data={[
              { value: "all", label: c.filterAll },
              { value: "shown", label: c.filterShown },
              { value: "hidden", label: c.filterHidden },
              { value: "featured", label: c.featured },
            ]}
          />
        </Group>
        {listings.data && (
          <Text c="dimmed" size="sm">
            {c.shownCount(shownCount, all.length)}
          </Text>
        )}
      </Group>

      {listings.isError && <Alert color="red">{websiteErrorText(listings.error, t)}</Alert>}
      {listings.isPending && <Skeleton h={320} />}
      {listings.data && rows.length === 0 && (
        <EmptyState icon={<IconBuildingStore size={30} />} title={c.none} />
      )}
      {rows.length > 0 && (
        <Card withBorder radius="md" p={0}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={56} />
                <Table.Th>{t.common.item}</Table.Th>
                <Table.Th>{t.common.price}</Table.Th>
                <Table.Th>{c.stock}</Table.Th>
                <Table.Th>{c.show}</Table.Th>
                <Table.Th w={1} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.id} opacity={row.hidden ? 0.6 : 1}>
                  <Table.Td>
                    <ProductThumb src={row.thumb ? serverUrl(row.thumb) : null} size={44} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text fw={600}>{row.name}</Text>
                      {row.badge && (
                        <Badge size="sm" variant="light">
                          {row.badge}
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      {[row.category, row.kcal !== null ? c.kcalShort(row.kcal) : ""].filter(Boolean).join(" · ")}
                    </Text>
                    {row.description && (
                      <Text size="xs" c="dimmed" lineClamp={1} maw={420}>
                        {row.description}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{money(row.price, t)}</Table.Td>
                  <Table.Td>
                    <Text size="sm">{quantityText(row.stock, row.sold_by, row.unit)}</Text>
                    {toNumber(row.reserved) > 0 && (
                      <Text size="xs" c="dimmed">
                        {quantityText(row.reserved, row.sold_by, row.unit)} {c.reserved}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Switch
                      aria-label={c.show}
                      checked={!row.hidden}
                      disabled={busy === row.id}
                      onChange={(e) => update(row, { hidden: !e.currentTarget.checked })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <IconButton
                        label={c.featured}
                        variant={row.featured ? "light" : "subtle"}
                        color={row.featured ? "gold.6" : "gray"}
                        aria-pressed={row.featured}
                        disabled={busy === row.id}
                        onClick={() => update(row, { featured: !row.featured })}
                      >
                        {row.featured ? <IconStarFilled size={17} /> : <IconStar size={17} />}
                      </IconButton>
                      <IconButton label={c.edit} variant="subtle" onClick={() => setEditing(row)}>
                        <IconEdit size={17} />
                      </IconButton>
                      <OpenOnSite
                        href={site && !row.hidden ? siteLink(site, { kind: "product", id: row.id }, lang) : null}
                        label={row.hidden ? c.hiddenNoLink : t.website.openProduct}
                      />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}
      <ListingDialog row={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Opens a page of the website in the browser; dimmed while it has none. */
export function OpenOnSite({ href, label }: { href: string | null; label: string }) {
  const icon = <IconExternalLink size={17} />;
  if (!href) {
    return (
      <IconButton label={label} variant="subtle" color="gray" disabled>
        {icon}
      </IconButton>
    );
  }
  return (
    <Tooltip label={label} withArrow>
      <ActionIcon
        component="a"
        href={href}
        target="_blank"
        rel="noreferrer"
        variant="subtle"
        color="teal"
        aria-label={label}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
}
