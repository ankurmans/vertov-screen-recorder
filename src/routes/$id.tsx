import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestUrl } from "@tanstack/react-start/server";
import type { Upload } from "@/db/schema";
import { LockedShare } from "@/components/locked-share";
import { ShareViewer } from "@/components/share-viewer";
import { accessFor, isUnclaimedGuest, publicUpload } from "@/lib/access.server";
import { ClaimGate } from "@/components/claim-gate";
import { VideoShare } from "@/components/video-share";
import { getAuthState, getSessionUser } from "@/lib/auth.server";
import { APP_NAME } from "@/lib/brand";
import { isIndexable, isoDate, isoDuration } from "@/lib/seo";
import { getBrand } from "@/lib/brand.server";
import { canManage } from "@/lib/plans";
import { roleIn } from "@/lib/workspace.server";
import { exportSignature } from "@/lib/export.server";
import {
  getLikeCount,
  getTranscript,
  getUploadAuthor,
  getUploadById,
} from "@/lib/uploads.server";

const loadShare = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const stored = await getUploadById(id);
    if (!stored) return null;
    const access = await accessFor(stored, getRequest());
    if (access !== "open") {
      // Nothing about the video leaves the server until it's unlocked.
      return { locked: access, id, origin: getRequestUrl().origin } as const;
    }
    const upload = publicUpload(stored);

    // The transcript renders server-side so the page arrives readable
    // (and indexable) without a second round trip.
    const transcript =
      upload.mediaType === "video" ? await getTranscript(stored) : null;

    return {
      locked: null,
      upload,
      author: await getUploadAuthor(stored),
      origin: getRequestUrl().origin,
      transcript,
      likeCount: await getLikeCount(id),
      brand: await getBrand(stored.workspaceId),
      // Resolved here (not client-side) so the comments/likes UI never
      // has to flash in once a follow-up request comes back.
      auth: await getAuthState(getRequest()),
      exportReady:
        upload.exportStatus === "done" && upload.exportSignature === exportSignature(stored),
      isOwner: await canEdit(stored),
      // The recorder is a guest: the link stays private until they create an account (see accessFor).
      claimRequired: Boolean(stored.ownerId) && stored.ownerId === (await getSessionUser(getRequest()))?.sub && (await isUnclaimedGuest(stored.ownerId)),
    };
  });

/** The recorder, or an owner or admin of the video's workspace. */
async function canEdit(upload: Upload): Promise<boolean> {
  const user = await getSessionUser(getRequest());
  if (!user) return false;
  if (upload.ownerId === user.sub) return true;
  return canManage(await roleIn(upload.workspaceId, user.sub));
}

const LOCKED_TITLES = {
  locked: "Protected video",
  expired: "Link expired",
  members: "Members-only video",
  removed: "Video removed",
  unclaimed: "Video not shared yet",
  email: "Email required",
} as const;

export const Route = createFileRoute("/$id")({
  validateSearch: (search: Record<string, unknown>) => ({
    panel: search.panel === "insights" ? ("insights" as const) : search.panel === "customize" ? ("customize" as const) : undefined,
    t: Number.isFinite(Number(search.t)) && Number(search.t) > 0 ? Number(search.t) : undefined,
  }),
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{8}$/.test(params.id)) throw notFound();
    const share = await loadShare({ data: params.id });
    if (!share) throw notFound();
    return share;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    if (loaderData.locked) {
      return {
        meta: [
          { title: `${LOCKED_TITLES[loaderData.locked]} — ${APP_NAME}` },
          { name: "robots", content: "noindex" },
        ],
      };
    }

    const { upload, author, origin } = loaderData;
    const isVideo = upload.mediaType === "video";
    const displayTitle =
      upload.title?.trim() || (upload.ownerId ? "Untitled video" : upload.filename);
    const dimensions =
      upload.width && upload.height
        ? ` · ${upload.width} × ${upload.height}`
        : "";
    const duration = upload.duration
      ? ` · ${Math.round(upload.duration)}s`
      : "";
    const description = upload.summary?.trim() || `Shared by ${author.name} on ${APP_NAME}${duration}${dimensions}`;
    const title = `${displayTitle} — ${APP_NAME}`;
    const indexable = isIndexable(upload);
    const previewImage = isVideo
      ? upload.posterKey
        ? `${origin}/api/poster/${upload.id}`
        : null
      : `${origin}/api/image/${upload.id}`;

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
      links: indexable ? [{ rel: "canonical", href: `${origin}/${upload.id}` }] : [],
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
        ...(previewImage
          ? [
              { property: "og:image", content: previewImage },
              { name: "twitter:card", content: "summary_large_image" },
              { name: "twitter:title", content: title },
              { name: "twitter:description", content: description },
              { name: "twitter:image", content: previewImage },
            ]
          : []),
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
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-100 px-6 text-center dark:bg-neutral-950">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">
          Share not found
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          This screenshot or recording is no longer available.
        </p>
      </div>
    </main>
  );
}
