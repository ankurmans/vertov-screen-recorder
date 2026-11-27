import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestUrl } from "@tanstack/react-start/server";
import type { Upload } from "@/db/schema";
import { LockedShare } from "@/components/locked-share";
import { ShareViewer } from "@/components/share-viewer";
import { accessFor, isUnclaimedGuest, publicUpload } from "@/lib/access.server";
import { ClaimGate } from "@/components/claim-gate";
import { VideoShare } from "@/components/video-share";
import { getAuthState, shareSessionReader, type SessionUser } from "@/lib/auth.server";
import { APP_NAME, ogImageMeta } from "@/lib/brand";
import { isIndexable, isoDate, isoDuration } from "@/lib/seo";
import { canManage } from "@/lib/plans";
import { likesAndReply } from "@/lib/requests.server";
import { roleIn } from "@/lib/workspace.server";
import type { MessageKey } from "@/lib/i18n/en/index";
import { translatorFromMatches, useT } from "@/lib/i18n/react";
import { exportSignature } from "@/lib/export.server";
import {
  getTranscript,
  getUploadAuthor,
  getUploadById,
  getViewerTranscript,
} from "@/lib/uploads.server";
import { playbackFor } from "@/lib/viewer-copy-access.server";

const loadShare = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const stored = await getUploadById(id);
    if (!stored) return null;
    const request = getRequest();
    const readUser = shareSessionReader(request);
    const access = await accessFor(stored, request, readUser);
    if (access !== "open") {
      // Nothing about the video leaves the server until it's unlocked.
      return { locked: access, id, origin: getRequestUrl().origin } as const;
    }
    const upload = publicUpload(stored);
    // The transcript renders server-side so the page arrives readable
    // (and indexable) without a second round trip.
    const isOwner = await canEdit(stored, await readUser());
    // Viewers never get what was trimmed or cut out; the editor needs all of it.
    const transcript =
      upload.mediaType === "video" ? await (isOwner ? getTranscript : getViewerTranscript)(stored) : null;

    const share = {
      locked: null,
      upload,
      author: await getUploadAuthor(stored),
      origin: getRequestUrl().origin,
      transcript,
      ...(await likesAndReply(id)),
      // Resolved here (not client-side) so the comments/likes UI never
      // has to flash in once a follow-up request comes back.
      auth: await getAuthState(request, readUser),
      exportReady:
        upload.exportStatus === "done" && upload.exportSignature === exportSignature(stored),
      playback: playbackFor(stored),
      isOwner,
      // The recorder is a guest: the link stays private until they create an account (see accessFor).
      claimRequired: Boolean(stored.ownerId) && stored.ownerId === (await readUser())?.sub && (await isUnclaimedGuest(stored.ownerId)),
    };
    return share;
  });

/** The recorder, or an owner or admin of the video's workspace. */
async function canEdit(upload: Upload, user: SessionUser | null): Promise<boolean> {
  if (!user) return false;
  if (upload.ownerId === user.sub) return true;
  return canManage(await roleIn(upload.workspaceId, user.sub));
}

/**
 * The picture a link preview shows for an open share, or null to use the default card. Videos use the GIF thumbnail where
 * there is one, else the poster; their pixel size isn't stored, so none is claimed.
 */
function shareImageOf(share: Awaited<ReturnType<typeof loadShare>>) {
  if (!share || share.locked) return null;
  const { upload, origin } = share;
  if (upload.mediaType !== "video")
    return { url: `${origin}/api/image/${upload.id}`, type: upload.contentType, width: upload.width, height: upload.height };
  if (upload.gifKey) return { url: `${origin}/api/gif/${upload.id}`, type: "image/gif" };
  return upload.posterKey ? { url: `${origin}/api/poster/${upload.id}`, type: "image/jpeg" } : null;
}

const LOCKED_TITLES = {
  members: "video.locked.titleMembers",
  removed: "video.locked.titleRemoved",
  unclaimed: "video.locked.titleUnclaimed",
  email: "video.locked.titleEmail",
} as const satisfies Record<string, MessageKey>;

export const Route = createFileRoute("/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    panel: search.panel === "customize" ? ("customize" as const) : undefined,
    t: Number.isFinite(Number(search.t)) && Number(search.t) > 0 ? Number(search.t) : undefined,
  }),
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{8}$/.test(params.id)) throw notFound();
    const share = await loadShare({ data: params.id });
    if (!share) throw notFound();
    return share;
  },
  staticData: { writesShareImage: true },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return { meta: ogImageMeta() };
    const t = translatorFromMatches(matches);
    if (loaderData.locked) {
      return {
        meta: [
          { title: `${t(LOCKED_TITLES[loaderData.locked])} — ${APP_NAME}` },
          { name: "robots", content: "noindex" },
          ...ogImageMeta(),
        ],
      };
    }

    const { upload, author, origin } = loaderData;
    const isVideo = upload.mediaType === "video";
    const displayTitle =
      upload.title?.trim() || (upload.ownerId ? t("video.common.untitled") : upload.filename);
    const dimensions =
      upload.width && upload.height
        ? ` · ${upload.width} × ${upload.height}`
        : "";
    const duration = upload.duration
      ? ` · ${Math.round(upload.duration)}s`
      : "";
    const description = upload.summary?.trim() || t("video.page.sharedBy", { author: author.name, app: APP_NAME, details: `${duration}${dimensions}` });
    const title = `${displayTitle} — ${APP_NAME}`;
    const indexable = isIndexable(upload);
    const previewImage = isVideo
      ? upload.posterKey
        ? `${origin}/api/poster/${upload.id}`
        : null
      : `${origin}/api/image/${upload.id}`;
    // Where an app can animate it, the link preview is the GIF thumbnail; the structured data keeps the still poster.
    const shareImage = shareImageOf(loaderData);

    return {
      // Share links are unlisted unless the owner opts this video in to search.
      ...(indexable
        ? {
            scripts: [
              {
                type: "application/ld+json",
                children: JSON.stringify({
                  "@context": "https://schema.org",
                  "@type": "VideoObject",
                  name: displayTitle,
                  description,
                  uploadDate: isoDate(upload.createdAt),
                  ...(previewImage ? { thumbnailUrl: previewImage } : {}),
                  ...(upload.duration ? { duration: isoDuration(upload.duration) } : {}),
                  contentUrl: `${origin}/api/media/${upload.id}`,
                  embedUrl: `${origin}/embed/${upload.id}`,
                }).replace(/</g, "\\u003c"),
              },
            ],
          }
        : {}),
      links: [
        ...(indexable ? [{ rel: "canonical", href: `${origin}/${upload.id}` }] : []),
        // The page's text (title, summary, chapters, transcript) for an agent that is handed the link.
        ...(isVideo ? [{ rel: "alternate", type: "text/markdown", href: `${origin}/api/prompt/${upload.id}?plain=1` }] : []),
      ],
      meta: [
        { title },
        ...(indexable ? [] : [{ name: "robots", content: "noindex" }]),
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: isVideo ? "video.other" : "website" },
        ...(isVideo
          ? [
              {
                tagName: "link",
                rel: "alternate",
                type: "application/json+oembed",
                href: `${origin}/api/oembed?url=${encodeURIComponent(`${origin}/${upload.id}`)}`,
              },
            ]
          : []),
        ...(isVideo
          ? [
              {
                property: "og:video",
                content: `${origin}/api/media/${upload.id}`,
              },
              { property: "og:video:type", content: upload.contentType },
              ...(upload.width && upload.height
                ? [
                    {
                      property: "og:video:width",
                      content: String(upload.width),
                    },
                    {
                      property: "og:video:height",
                      content: String(upload.height),
                    },
                  ]
                : []),
            ]
          : []),
        ...(shareImage
          ? [
              { property: "og:image", content: shareImage.url },
              { property: "og:image:type", content: shareImage.type },
              ...(shareImage.width && shareImage.height
                ? [
                    { property: "og:image:width", content: String(shareImage.width) },
                    { property: "og:image:height", content: String(shareImage.height) },
                  ]
                : []),
              { property: "og:image:alt", content: displayTitle },
              { name: "twitter:card", content: "summary_large_image" },
              { name: "twitter:title", content: title },
              { name: "twitter:description", content: description },
              { name: "twitter:image", content: shareImage.url },
              { name: "twitter:image:alt", content: displayTitle },
            ]
          : ogImageMeta()),
      ],
    };
  },
  component: SharedMediaPage,
  notFoundComponent: ShareNotFound,
});

function SharedMediaPage() {
  const share = Route.useLoaderData();
  const { t, panel } = Route.useSearch();
  if (share.locked) return <LockedShare id={share.id} reason={share.locked} />;
  const page = share.upload.mediaType === "video" ? <VideoShare {...share} initialTime={t} initialPanel={panel} /> : <ShareViewer {...share} />;
  if (!share.claimRequired) return page;
  return (
    <>
      <div inert aria-hidden="true">{page}</div>
      <ClaimGate id={share.upload.id} title={share.upload.title} providers={share.auth.providers} />
    </>
  );
}

function ShareNotFound() {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-6 text-center dark:bg-neutral-950">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">
          {t("video.page.notFoundTitle")}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {t("video.page.notFoundBody")}
        </p>
      </div>
    </main>
  );
}
