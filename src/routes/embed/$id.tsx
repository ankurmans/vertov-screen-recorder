import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestUrl } from "@tanstack/react-start/server";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicUpload } from "@/db/schema";
import type { Transcript } from "@/lib/transcript";
import { CaptionLayer } from "@/components/caption-layer";
import { OverlayLayer } from "@/components/overlay-layer";
import { CameraTrack, EndCard } from "@/components/stage-layer";
import { VideoPlayer } from "@/components/video-player-lazy";
import { APP_NAME } from "@/lib/brand";
import { getBrand } from "@/lib/brand.server";
import { brandStyle } from "@/lib/brand-theme";
import type { Brand } from "@/lib/brand-theme";
import { isCaptionStyle } from "@/lib/caption-styles";
import { parseCuts } from "@/lib/cuts";
import { parseOverlays } from "@/lib/overlays";
import { BACKGROUNDS, parseStyle, stageGeometry } from "@/lib/stage";
import { useSkipCuts } from "@/lib/use-skip-cuts";
import { accessFor, publicUpload } from "@/lib/access.server";
import { getTranscript, getUploadById } from "@/lib/uploads.server";

const loadEmbed = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const upload = await getUploadById(id);
    if (!upload || upload.mediaType !== "video" || upload.status !== "ready") return null;
    const access = await accessFor(upload, getRequest());
    const open = access === "open";
    // Styled captions are drawn from the transcript, so it travels with the page.
    const transcript = open && upload.captionStyle !== "off" ? await getTranscript(upload) : null;
    return { upload: open ? publicUpload(upload) : null, transcript, id, origin: getRequestUrl().origin, brand: open ? await getBrand(upload.workspaceId) : null };
  });

export const Route = createFileRoute("/embed/$id")({
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{8}$/.test(params.id)) throw notFound();
    const embed = await loadEmbed({ data: params.id });
    if (!embed) throw notFound();
    return embed;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.upload?.title ?? "Video"} — ${APP_NAME}` }],
  }),
  component: EmbedPage,
});

/** Chrome-free player for iframes: the composed stage and a link back to the page. */
function EmbedPage() {
  const { upload, transcript, id, origin, brand } = Route.useLoaderData();
  if (!upload) {
    return (
      <main className="flex h-dvh w-full items-center justify-center bg-neutral-950 p-6 text-center text-white">
        <a href={`${origin}/${id}`} target="_blank" rel="noreferrer" className="rounded-xl bg-white/10 px-5 py-3 text-sm font-medium hover:bg-white/20">
          This video is protected. Open it on {APP_NAME} to watch.
        </a>
      </main>
    );
  }
  return <EmbedPlayer upload={upload} transcript={transcript} origin={origin} brand={brand} />;
}

function EmbedPlayer({ upload, transcript, origin, brand }: { upload: PublicUpload; transcript: Transcript | null; origin: string; brand: Brand | null }) {
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState(0);
  const overlays = useMemo(() => parseOverlays(upload.overlays), [upload.overlays]);
  const captionStyle = isCaptionStyle(upload.captionStyle) ? upload.captionStyle : "off";
  const [main, setMain] = useState<HTMLVideoElement | null>(null);
  const [ended, setEnded] = useState(false);
  useEffect(() => setMounted(true), []);

  const style = parseStyle(upload.style);
  const cameraSource = upload.cameraKey ? `${origin}/api/camera/${upload.id}` : null;
  const aspect = upload.width && upload.height ? upload.width / upload.height : 16 / 9;
  const geometry = useMemo(() => stageGeometry(style, aspect, Boolean(cameraSource)), [style, aspect, cameraSource]);
  const cuts = useMemo(() => parseCuts(upload.cuts), [upload.cuts]);
  useSkipCuts(main, cuts);
  const trimStart = upload.trimStart ?? 0;
  const trimEnd = upload.trimEnd;

  const onTime = useCallback(
    (now: number, element: HTMLVideoElement) => {
      setMain((current) => (current === element ? current : element));
      setTime(now);
      if (trimStart > 0 && now < trimStart - 0.05 && !element.paused) element.currentTime = trimStart;
      if (trimEnd != null && now >= trimEnd) {
        element.pause();
        setEnded(true);
      }
    },
    [trimStart, trimEnd],
  );

  return (
    <main className="flex h-dvh w-full items-center justify-center overflow-hidden bg-black" style={brandStyle(brand)}>
      <div className="relative max-h-full w-full" style={{ maxWidth: `calc(100dvh * ${geometry.stageAspect})` }}>
        {mounted && (
          <VideoPlayer
            src={`${origin}/api/media/${upload.id}`}
            poster={upload.posterKey ? `${origin}/api/poster/${upload.id}` : undefined}
            initialTime={trimStart}
            subtitlesUrl={upload.transcriptKey && captionStyle === "off" ? `${origin}/api/captions/${upload.id}` : undefined}
            onActivate={(element) => setMain((current) => (current === element ? current : element))}
            onTimeUpdate={onTime}
            onEnded={() => setEnded(true)}
            stageAspect={geometry.stageAspect}
            stageBackground={(BACKGROUNDS[style.background] ?? BACKGROUNDS.none).css}
            screenBox={geometry.screen}
          >
            {cameraSource && geometry.camera && (
              <CameraTrack
                src={cameraSource}
                main={main}
                box={geometry.camera}
                shape={style.layout === "side" ? "rounded" : style.shape}
                full={style.layout === "camera"}
                editable={false}
              />
            )}
            {overlays.length > 0 && <OverlayLayer overlays={overlays} time={time} aspect={geometry.stageAspect} />}
            {transcript && captionStyle !== "off" && <CaptionLayer transcript={transcript} time={time} video={main} style={captionStyle} />}
            {ended && (
              <EndCard
                ctaLabel={upload.ctaLabel}
                ctaUrl={upload.ctaUrl}
                onReplay={() => {
                  setEnded(false);
                  if (main) {
                    main.currentTime = trimStart;
                    void main.play();
                  }
                }}
              />
            )}
          </VideoPlayer>
        )}
        <a
          href={`${origin}/${upload.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 left-2 z-30 max-w-[70%] truncate rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/80"
        >
          {brand?.logo && <img src={brand.logo} alt="" className="mr-1.5 inline-block h-4 max-w-16 object-contain align-text-bottom" />}
          {upload.title ?? "Watch"} · {brand?.logo ? brand.name : APP_NAME} ↗
        </a>
      </div>
    </main>
  );
}
