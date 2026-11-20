import { Modal, Stack, Table, Text } from "@mantine/core";

import { useI18n } from "../i18n";
import { siteLink, useSiteUrl } from "../website/api";
import { OpenOnSite } from "../website/CataloguePage";
import { CATEGORIES_KEY, useCategories } from "./CategorySelect";
import { DeleteButton } from "./DeleteButton";

/**
 * The list of categories, for deleting ones no longer needed (super admins)
 * and opening their page on the website. New ones are added from the
 * category picker in the product form.
 */
export function CategoryManager({
  opened,
  onClose,
  productCounts,
  onWebsite,
}: {
  opened: boolean;
  onClose: () => void;
  /** Products per category id, so it is clear which ones are still in use. */
  productCounts: Map<number, number>;
  /** Categories the website lists: those with a product shown there. */
  onWebsite: Set<number>;
}) {
  const { t, lang } = useI18n();
  const site = useSiteUrl();
  const categories = useCategories();
  const list = categories.data ?? [];

  return (
    <Modal opened={opened} onClose={onClose} title={t.products.categories}>
      <Stack gap="sm">
        {list.length === 0 ? (
          <Text size="sm" c="dimmed">
            {t.products.noCategories}
          </Text>
        ) : (
          <Table verticalSpacing={6}>
            <Table.Tbody>
              {list.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>{c.name}</Table.Td>
                  <Table.Td c="dimmed" fz="sm">
                    {t.products.categoryProductCount(productCounts.get(c.id) ?? 0)}
                  </Table.Td>
                  <Table.Td w={1}>
                    <OpenOnSite
                      href={site && onWebsite.has(c.id) ? siteLink(site, { kind: "category", id: c.id }, lang) : null}
                      label={onWebsite.has(c.id) ? t.website.openCategory : t.website.categoryOff}
                    />
                  </Table.Td>
                  <Table.Td w={1}>
                    <DeleteButton
                      label={t.products.deleteCategory}
                      name={c.name}
                      url={`/categories/${c.id}/`}
                      queryKey={CATEGORIES_KEY}
                      inUse={t.products.categoryInUse}
                    />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Text size="xs" c="dimmed">
          {t.products.categoriesHint}
        </Text>
      </Stack>
    </Modal>
  );
}
