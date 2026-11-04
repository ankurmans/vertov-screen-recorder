import { createFileRoute } from "@tanstack/react-router";
import { accessFor } from "@/lib/access.server";
import { json, optionsResponse } from "@/lib/api.server";
import { APP_NAME } from "@/lib/brand";
import { getUploadAuthor, getUploadById } from "@/lib/uploads.server";

/** oEmbed so Notion, Slack, Linear and friends can embed a playable video. */
export const Route = createFileRoute("/api/oembed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const target = requestUrl.searchParams.get("url") ?? "";
        const id = /\/([a-f0-9]{8})(?:[/?#]|$)/.exec(target)?.[1];
        const upload = id ? await getUploadById(id) : null;
        if (!upload || upload.mediaType !== "video") return json({ error: "Not found" }, 404);
        // Locked, members-only or unclaimed videos give embedders nothing, not even the title.
        if ((await accessFor(upload, request)) !== "open") return json({ error: "Not found" }, 404);
        const origin = requestUrl.origin;
        const maxWidth = Number(requestUrl.searchParams.get("maxwidth")) || 960;
        const aspect = upload.width && upload.height ? upload.width / upload.height : 16 / 9;
        const width = Math.min(960, maxWidth);
        const height = Math.round(width / aspect);
        const author = await getUploadAuthor(upload);
        return json({
          version: "1.0",
          type: "video",
          provider_name: APP_NAME,
          provider_url: origin,
          title: upload.title ?? "Video",
          author_name: author.name,
          width,
          height,
          ...(upload.posterKey
            ? { thumbnail_url: `${origin}/api/poster/${upload.id}`, thumbnail_width: 1280, thumbnail_height: Math.round(1280 / aspect) }
            : {}),
          html: `<iframe src="${origin}/embed/${upload.id}" width="${width}" height="${height}" frameborder="0" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>`,
        });
      },
      OPTIONS: () => optionsResponse(),
    },
  },
});
