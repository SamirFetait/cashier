/** The website's videos: the hero beside the headline, and the stories strip. */
import {
  Alert,
  AspectRatio,
  Badge,
  Button,
  Card,
  FileButton,
  Group,
  Modal,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconEye, IconEyeOff, IconMovie, IconTrash, IconUpload } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { IconButton } from "../components/IconButton";
import { useI18n } from "../i18n";
import { serverUrl } from "../webOrders/api";
import {
  formatBytes,
  formatDuration,
  readVideo,
  useListings,
  useVideoMutations,
  useVideos,
  websiteErrorText,
  type ListingRow,
  type VideoMeta,
  type WebsiteVideo,
} from "./api";
import { EmptyState, PageHead, useConfirm } from "./ui";

export function VideosPage() {
  const { t } = useI18n();
  const v = t.website.videos;
  const videos = useVideos();
  const listings = useListings();
  const { update, remove } = useVideoMutations();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);

  const list = videos.data?.videos ?? [];
  const productName = (id: number | null) => listings.data?.find((row) => row.id === id)?.name ?? "";
  const failed = (error: unknown) => notifications.show({ color: "red", message: websiteErrorText(error, t) });

  async function drop(video: WebsiteVideo) {
    if (await confirm.ask(v.deleteConfirm, t.common.delete)) remove.mutate(video.id, { onError: failed });
  }

  return (
    <>
      <PageHead title={t.website.nav.videos} intro={v.intro}>
        <Button leftSection={<IconUpload size={16} />} onClick={() => setAdding(true)}>
          {v.add}
        </Button>
      </PageHead>
      {videos.isError && <Alert color="red">{websiteErrorText(videos.error, t)}</Alert>}
      {videos.isPending && <Skeleton h={240} />}
      {videos.data && list.length === 0 && <EmptyState icon={<IconMovie size={30} />} title={v.none} />}
      {list.filter((video) => video.placement === "HERO" && video.is_active).length > 1 && (
        <Alert color="yellow">{v.onlyOneHero}</Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {list.map((video) => (
          <Card key={video.id} withBorder radius="md" opacity={video.is_active ? 1 : 0.6}>
            <Card.Section>
              <AspectRatio ratio={16 / 9} bg="dark.9">
                <video
                  src={serverUrl(video.src)}
                  poster={video.poster ? serverUrl(video.poster) : undefined}
                  controls
                  preload="none"
                  playsInline
                  style={{ objectFit: "contain" }}
                />
              </AspectRatio>
            </Card.Section>
            <Stack gap={4} mt="sm">
              <Group justify="space-between" wrap="nowrap">
                <Badge variant="light" color={video.placement === "HERO" ? "gold" : "teal"}>
                  {v[video.placement]}
                </Badge>
                <Group gap={4} wrap="nowrap">
                  <IconButton
                    label={video.is_active ? v.hide : v.show}
                    variant="subtle"
                    onClick={() => update.mutate({ id: video.id, body: { is_active: !video.is_active } }, { onError: failed })}
                  >
                    {video.is_active ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                  </IconButton>
                  <IconButton label={t.common.delete} variant="subtle" color="red" onClick={() => void drop(video)}>
                    <IconTrash size={17} />
                  </IconButton>
                </Group>
              </Group>
              <Text fw={600}>{video.title || "—"}</Text>
              {video.caption && (
                <Text size="sm" c="dimmed">
                  {video.caption}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {[
                  video.is_active ? v.visible : v.hidden,
                  formatDuration(video.duration),
                  formatBytes(video.size),
                  productName(video.product_id),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      <VideoUpload
        opened={adding}
        onClose={() => setAdding(false)}
        maxMb={videos.data?.max_mb ?? 80}
        products={listings.data ?? []}
      />
      {confirm.dialog}
    </>
  );
}

function VideoUpload({
  opened,
  onClose,
  maxMb,
  products,
}: {
  opened: boolean;
  onClose: () => void;
  maxMb: number;
  products: ListingRow[];
}) {
  const { t } = useI18n();
  const v = t.website.videos;
  const { upload } = useVideoMutations();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [placement, setPlacement] = useState<WebsiteVideo["placement"]>("STORY");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opened) return;
    setFile(null);
    setMeta(null);
    setUnreadable(false);
    setPlacement("STORY");
    setTitle("");
    setCaption("");
    setProductId(null);
    setProgress(0);
    setError(null);
  }, [opened]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function choose(chosen: File | null) {
    if (!chosen) return;
    setError(null);
    if (chosen.size > maxMb * 1024 * 1024) {
      setError(t.webOrders.errors.TOO_LARGE);
      return;
    }
    setFile(chosen);
    const read = await readVideo(chosen);
    setMeta(read);
    setUnreadable(read === null);
  }

  function submit() {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("placement", placement);
    form.set("title", title.trim());
    form.set("caption", caption.trim());
    form.set("product_id", productId ?? "");
    if (meta?.duration) form.set("duration", meta.duration.toFixed(2));
    if (meta?.width) form.set("width", String(meta.width));
    if (meta?.height) form.set("height", String(meta.height));
    if (meta?.poster) form.set("poster", meta.poster, "poster.jpg");
    setError(null);
    upload.mutate(
      { form, onProgress: setProgress },
      {
        onSuccess: () => {
          notifications.show({ color: "green", message: v.uploaded });
          onClose();
        },
        onError: (failure) => setError(websiteErrorText(failure, t)),
      }
    );
  }

  return (
    <Modal opened={opened} onClose={onClose} title={v.add} size="lg" closeOnClickOutside={!upload.isPending}>
      <Stack>
        {preview ? (
          <AspectRatio ratio={16 / 9} bg="dark.9">
            <video src={preview} controls muted playsInline style={{ objectFit: "contain" }} />
          </AspectRatio>
        ) : (
          <FileButton onChange={(chosen) => void choose(chosen)} accept="video/mp4,video/webm,video/quicktime">
            {(props) => (
              <UnstyledButton
                {...props}
                p="xl"
                style={{
                  border: "2px dashed var(--mantine-color-default-border)",
                  borderRadius: "var(--mantine-radius-md)",
                }}
              >
                <Group justify="center" gap="sm">
                  <IconMovie size={26} />
                  <div>
                    <Text fw={600}>{v.choose}</Text>
                    <Text size="xs" c="dimmed">
                      {v.fileHint(maxMb)}
                    </Text>
                  </div>
                </Group>
              </UnstyledButton>
            )}
          </FileButton>
        )}
        {file && (
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {[file.name, formatBytes(file.size), formatDuration(meta?.duration ?? null)].filter(Boolean).join(" · ")}
            </Text>
            <FileButton onChange={(chosen) => void choose(chosen)} accept="video/mp4,video/webm,video/quicktime">
              {(props) => (
                <Button {...props} size="compact-sm" variant="subtle">
                  {v.choose}
                </Button>
              )}
            </FileButton>
          </Group>
        )}
        {unreadable && <Alert color="yellow">{v.cannotPreview}</Alert>}
        <div>
          <Text size="sm" fw={500} mb={4}>
            {v.placement}
          </Text>
          <SegmentedControl
            fullWidth
            value={placement}
            onChange={(value) => setPlacement(value as WebsiteVideo["placement"])}
            data={[
              { value: "STORY", label: v.STORY },
              { value: "HERO", label: v.HERO },
            ]}
          />
        </div>
        <TextInput
          label={v.title}
          description={t.website.optional}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
        />
        <TextInput
          label={v.caption}
          description={t.website.optional}
          maxLength={255}
          value={caption}
          onChange={(e) => setCaption(e.currentTarget.value)}
        />
        <Select
          label={v.product}
          description={t.website.optional}
          placeholder={v.noProduct}
          searchable
          clearable
          value={productId}
          onChange={setProductId}
          data={products.map((row) => ({ value: String(row.id), label: row.name }))}
        />
        {upload.isPending && <Progress value={progress * 100} animated />}
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={upload.isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} loading={upload.isPending} disabled={!file} leftSection={<IconUpload size={16} />}>
            {v.upload}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
