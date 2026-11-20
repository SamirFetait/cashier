import { Loader, Select } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "../api/client";
import type { Category, Paginated } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n";
import classes from "./CategorySelect.module.css";

export const CATEGORIES_KEY = ["categories"];
/** The option that adds the typed name as a new category; never a category id. */
const NEW_CATEGORY = "new-category";

/** All categories: for the product form's picker and the category manager. */
export function useCategories() {
  return useQuery({
    queryKey: CATEGORIES_KEY,
    queryFn: async () =>
      (await api.get<Paginated<Category>>("/categories/?page_size=500")).data.results,
  });
}

/**
 * The product form's category picker. A super admin can also type a name that
 * is not in the list and add it as a new category, which is then selected.
 */
export function CategorySelect({
  value,
  onChange,
}: {
  /** The selected category's id, or null for none. */
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { isSuperadmin } = useAuth();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const categories = useCategories();

  const create = useMutation({
    mutationFn: async (name: string) => (await api.post<Category>("/categories/", { name })).data,
    onSuccess: (category) => {
      // Listed at once so it can show as selected; the refetch restores the server's order.
      qc.setQueryData<Category[]>(CATEGORIES_KEY, (list = []) => [...list, category]);
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      onChange(String(category.id));
      notifications.show({ message: t.products.categoryAdded(category.name), color: "green" });
    },
    onError: (err) => {
      // Most often another till has just added the same name: fetch it.
      void qc.invalidateQueries({ queryKey: CATEGORIES_KEY });
      const data = (err as any)?.response?.data;
      notifications.show({
        message: t.products.categoryFailed(data?.name?.[0] ?? data?.detail ?? t.common.unknownError),
        color: "red",
      });
    },
  });

  const list = categories.data ?? [];
  const typed = search.trim();
  // Not for a name already listed in another case: "snacks" is "Snacks".
  const offerNew =
    isSuperadmin && typed !== "" && !list.some((c) => c.name.toLowerCase() === typed.toLowerCase());

  return (
    <Select
      label={t.products.category}
      placeholder={isSuperadmin ? t.products.categoryPlaceholder : undefined}
      searchable
      clearable
      classNames={{ option: classes.option }}
      data={[
        ...list.map((c) => ({ value: String(c.id), label: c.name })),
        ...(offerNew ? [{ value: NEW_CATEGORY, label: t.products.newCategory(typed) }] : []),
      ]}
      value={value}
      // Picking the new-category option never becomes the value: it creates
      // the category, and onSuccess selects that.
      onChange={(next) => (next === NEW_CATEGORY ? create.mutate(typed) : onChange(next))}
      searchValue={search}
      onSearchChange={setSearch}
      disabled={create.isPending}
      rightSection={create.isPending ? <Loader size="xs" /> : undefined}
    />
  );
}
