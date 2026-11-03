import { Tabs, useKumoToastManager } from "@cloudflare/kumo";
import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import {
  ArrowSquareOutIcon,
  DownloadSimpleIcon,
  LinkIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicUpload as Upload } from "@/db/schema";
import type { Author } from "@/lib/uploads.server";
import type { Transcript } from "@/lib/transcript";
import type { Chapter } from "@/lib/chapters";
import type { AuthState } from "@/lib/use-auth";
import type { FloatingReaction } from "@/components/stage-layer";
import type { StudioState } from "@/components/studio-panel";
import type { Cut } from "@/lib/cuts";
import type { Overlay } from "@/lib/overlays";
import { AnnotateEditor } from "@/components/annotate-editor";
import { CaptionLayer } from "@/components/caption-layer";
import { CommentsPanel } from "@/components/comments-panel";
import { InsightsPanel } from "@/components/insights-panel";
import { LikeButton } from "@/components/like-button";
import { WatchLaterButton } from "@/components/watch-later-button";
import { LivePlayer } from "@/components/live-player";
import { OverlayLayer } from "@/components/overlay-layer";
import { ShareHeader } from "@/components/share-header";
import { brandStyle } from "@/lib/brand-theme";
import type { Brand } from "@/lib/brand-theme";
import { CameraTrack, countCtaClick, EndCard, ReactionLayer } from "@/components/stage-layer";
import { AiPanel } from "@/components/ai-panel";
import { StudioPanel } from "@/components/studio-panel";
import { TranscriptEditor } from "@/components/transcript-editor";
import { TranscriptPanel } from "@/components/transcript-panel";
import { makeAnimatedThumbnail } from "@/lib/gif";
import { parseCuts } from "@/lib/cuts";
import { parseOverlays } from "@/lib/overlays";
import { useSkipCuts } from "@/lib/use-skip-cuts";
import { VideoPlayer } from "@/components/video-player-lazy";
import { getChapterAtTime } from "@/lib/chapters";
import { formatDuration, formatTimeAgo, formatViews } from "@/lib/format";
import { REACTION_EMOJIS, anonymousViewerId } from "@/lib/reactions";
import { ReactionIcon, reactionLabel } from "@/components/reaction-icon";
import { VertovIcon } from "@/components/vertov-icon";
import { BACKGROUNDS, parseStyle, stageGeometry } from "@/lib/stage";
import { isCaptionStyle } from "@/lib/caption-styles";
import { parseStoryboardMeta } from "@/lib/storyboard";
import { useAuth } from "@/lib/use-auth";
import { recordShareView } from "@/lib/viewer-identity";

interface VideoShareProps {
  upload: Upload;
  author: Author;
  origin: string;
  transcript: Transcript | null;
  likeCount: number;
  auth: AuthState;
  isOwner: boolean;
  exportReady: boolean;
  initialTime?: number;
  initialPanel?: "insights";
  brand?: Brand | null;
}

interface StoredReaction {
  id: string;
  emoji: string;
  timestamp: number;
  viewerName: string | null;
}

/** The share page: the composed stage (screen + camera + background),
 *  a sidebar for transcript/comments/insights, and the owner's studio. */
export function VideoShare({
  upload,
  author,
  origin,
  transcript,
  likeCount,
  auth: initialAuth,
  isOwner,
  exportReady,
  initialTime = 0,
  initialPanel,
  brand,
}: VideoShareProps) {
  const [mounted, setMounted] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [activeTab, setActiveTab] = useState(
    initialPanel === "insights" && isOwner ? "insights" : transcript ? "transcript" : "comments",
  );
  const [views, setViews] = useState(upload.views);
  const [mainVideo, setMainVideo] = useState<HTMLVideoElement | null>(null);
  const [ended, setEnded] = useState(false);
  const [floating, setFloating] = useState<Array<FloatingReaction>>([]);
  const [reactions, setReactions] = useState<Array<StoredReaction>>([]);
  const [studioOpen, setStudioOpen] = useState(false);
  const [zoomFocusPicker, setZoomFocusPicker] = useState<((x: number, y: number) => void) | null>(null);
  const pickZoomFocus = useCallback((picker: ((x: number, y: number) => void) | null) => {
    setZoomFocusPicker(() => picker);
  }, []);
  const [studio, setStudio] = useState<StudioState>(() => ({
    style: parseStyle(upload.style),
    trimStart: upload.trimStart,
    trimEnd: upload.trimEnd,
    ctaLabel: upload.ctaLabel,
    ctaUrl: upload.ctaUrl,
    socialEnabled: upload.socialEnabled,
    hasPassword: upload.hasPassword,
    expiresAt: upload.expiresAt,
    downloadsEnabled: upload.downloadsEnabled,
    requireEmail: upload.requireEmail,
    searchIndexing: upload.searchIndexing,
    openLink: upload.visibility === "link",
    captionStyle: isCaptionStyle(upload.captionStyle) ? upload.captionStyle : "off",
  }));
  const [overlays, setOverlays] = useState<Array<Overlay>>(() => parseOverlays(upload.overlays));
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const overlaySaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [cuts, setCuts] = useState<Array<Cut>>(() => parseCuts(upload.cuts));
  const cutSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastTimeRef = useRef(initialTime);
  const progressRef = useRef({ max: 0, sent: 0 });
  const toastManager = useKumoToastManager();
  const { auth, signOut } = useAuth(initialAuth);

  useEffect(() => setMounted(true), []);

  // Straight from the recorder: confirm the link is ready, then tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("new")) return;
    if (isOwner) {
      toastManager.add({ title: "Your link is on the clipboard. Paste it anywhere." });
    }
    url.searchParams.delete("new");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const notify = useCallback(
    (message: string, variant?: "error") => toastManager.add({ title: message, variant }),
    [toastManager],
  );

  const mediaSource = `${origin}/api/media/${upload.id}`;

  // Every video gets an animated thumbnail for emails: made once, in the owner's browser, the first
  // time they open it after recording. It never blocks anything and fails quietly.
  const gifTried = useRef(false);
  useEffect(() => {
    if (!isOwner || upload.gifKey || upload.status !== "ready" || upload.mediaType !== "video" || (upload.duration ?? 0) < 2 || gifTried.current) return;
    gifTried.current = true;
    const timer = setTimeout(() => {
      const from = Math.max(upload.trimStart ?? 0, 0) + 0.3;
      void makeAnimatedThumbnail(mediaSource, from, from + 6)
        .then((blob) => fetch(`/api/recordings/${upload.id}/sidecar?kind=gif`, { method: "PUT", headers: { "content-type": "image/gif" }, body: blob }))
        .catch(() => {});
    }, 4000);
    return () => clearTimeout(timer);
  }, [isOwner, upload.gifKey, upload.status, upload.mediaType, upload.duration, upload.trimStart, upload.id, mediaSource]);
  const cameraSource = upload.cameraKey ? `${origin}/api/camera/${upload.id}` : null;
  const posterSource = upload.posterKey
    ? `${origin}/api/poster/${upload.id}?v=${encodeURIComponent(upload.posterKey)}`
    : undefined;
  const subtitlesUrl =
    upload.transcriptKey
      ? `${origin}/api/captions/${upload.id}`
      : undefined;
  const thumbnailsUrl = upload.storyboardKey
    ? `${origin}/api/storyboard-vtt/${upload.id}`
    : undefined;
  const hasTranscript = transcript !== null;
  const showComments = studio.socialEnabled;
  const hasSidebar = hasTranscript || showComments || isOwner;
  const isRecording = upload.status !== "ready";
  const aiPending = upload.aiStatus === "pending";
  const duration = upload.duration ?? 0;
  const trimStart = studio.trimStart ?? 0;
  const trimEnd = studio.trimEnd ?? null;

  // Transcript, title and summary arrive a few seconds after the video is playable.
  useEffect(() => {
    if (!isRecording && !aiPending) return;
    // A recording in progress polls for its end itself (see LivePlayer).
    if (upload.status === "recording") return;
    const timer = setTimeout(() => window.location.reload(), 6000);
    return () => clearTimeout(timer);
  }, [isRecording, aiPending]);

  const aspect =
    upload.width && upload.height ? upload.width / upload.height : 16 / 9;
  const geometry = useMemo(
    () => stageGeometry(studio.style, aspect, Boolean(cameraSource)),
    [studio.style, aspect, cameraSource],
  );
  const background = BACKGROUNDS[studio.style.background] ?? BACKGROUNDS.none;

  const storyboard = useMemo(() => {
    if (!upload.storyboardKey || !upload.storyboardMeta) return null;
    try {
      const meta = parseStoryboardMeta(JSON.parse(upload.storyboardMeta));
      return meta
        ? { url: `${origin}/api/storyboard/${upload.id}`, meta }
        : null;
    } catch {
      return null;
    }
  }, [upload.storyboardKey, upload.storyboardMeta, upload.id, origin]);

  const chapters = useMemo<Array<Chapter> | undefined>(() => {
    if (!upload.chapters) return undefined;
    try {
      const parsed: Array<{ title: string; start: number }> = JSON.parse(
        upload.chapters,
      );
      if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
      return parsed.map((chapter, index) => ({
        title: chapter.title,
        startTime: chapter.start,
        endTime:
          index < parsed.length - 1
            ? parsed[index + 1].start
            : (upload.duration ?? Number.MAX_SAFE_INTEGER),
      }));
    } catch {
      return undefined;
    }
  }, [upload.chapters, upload.duration]);

  const currentChapter = useMemo(() => {
    if (!chapters?.length) return null;
    return getChapterAtTime(chapters, currentTime);
  }, [chapters, currentTime]);

  useEffect(() => {
    if (!studio.socialEnabled) return;
    void fetch(`/api/reactions/${upload.id}`)
      .then((response) =>
        response.ok
          ? response.json<{ reactions: Array<StoredReaction> }>()
          : { reactions: [] },
      )
      .then((body) => setReactions(body.reactions))
      .catch(() => {});
  }, [upload.id, studio.socialEnabled]);

  const float = useCallback((emoji: string, name?: string | null) => {
    const key = crypto.randomUUID();
    setFloating((items) => [...items.slice(-12), { key, emoji, name }]);
    setTimeout(() => setFloating((items) => items.filter((item) => item.key !== key)), 2700);
  }, []);

  const sendProgress = useCallback(
    (element: HTMLVideoElement) => {
      if (isOwner) return;
      const span = (trimEnd ?? (element.duration || duration)) - trimStart;
      if (!(span > 0)) return;
      const percent = Math.min(1, Math.max(0, (progressRef.current.max - trimStart) / span));
      if (percent - progressRef.current.sent < 0.04 && percent < 0.99) return;
      progressRef.current.sent = percent;
      void fetch(`/api/progress/${upload.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewerKey: anonymousViewerId(), percent, seconds: progressRef.current.max }),
        keepalive: true,
      }).catch(() => {});
    },
    [isOwner, trimEnd, trimStart, duration, upload.id],
  );

  const handlePlayerActivate = useCallback((element: HTMLVideoElement) => {
    activeVideoRef.current = element;
    setMainVideo((current) => (current === element ? current : element));
  }, []);

  const handlePlayerTimeUpdate = useCallback(
    (time: number, element: HTMLVideoElement) => {
      activeVideoRef.current = element;
      setMainVideo((current) => (current === element ? current : element));
      if (time < (trimEnd ?? element.duration) - 0.05) setEnded(false);
      // Trimmed playback: start at the trim-in point, stop at the trim-out point.
      if (trimStart > 0 && time < trimStart - 0.05 && !element.paused) {
        element.currentTime = trimStart;
      }
      if (trimEnd != null && time >= trimEnd) {
        element.pause();
        element.currentTime = trimEnd;
        setEnded(true);
      }
      const previous = lastTimeRef.current;
      // Replay reactions the moment playback passes them (not on seeks).
      if (time > previous && time - previous < 1.5 && !element.paused) {
        for (const reaction of reactions) {
          if (reaction.timestamp > previous && reaction.timestamp <= time) {
            float(reaction.emoji, reaction.viewerName);
          }
        }
      }
      lastTimeRef.current = time;
      progressRef.current.max = Math.max(progressRef.current.max, time);
      setCurrentTime(time);
      sendProgress(element);
    },
    [trimStart, trimEnd, reactions, float, sendProgress],
  );

  useSkipCuts(mainVideo, cuts);

  const updateCuts = useCallback(
    (next: Array<Cut>) => {
      setCuts(next);
      clearTimeout(cutSaveTimer.current);
      cutSaveTimer.current = setTimeout(() => {
        void fetch(`/api/recordings/${upload.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cuts: next }),
        }).then((response) => {
          if (!response.ok) notify("Couldn't save your edit", "error");
        });
      }, 500);
    },
    [upload.id, notify],
  );

  useEffect(() => {
    const element = mainVideo;
    if (!element) return;
    const onPlay = () => {
      setEnded(false);
      if (element.currentTime < trimStart || (trimEnd != null && element.currentTime >= trimEnd - 0.05)) {
        element.currentTime = trimStart;
      }
    };
    const onPause = () => sendProgress(element);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    if (trimStart > 0 && element.currentTime < trimStart) element.currentTime = trimStart;
    return () => {
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
    };
  }, [mainVideo, trimStart, trimEnd, sendProgress]);

  const handleSeek = useCallback((time: number) => {
    const el = activeVideoRef.current;
    if (el) {
      el.currentTime = time;
      void el.play().catch(() => {});
    }
    setCurrentTime(time);
  }, []);

  const replay = useCallback(() => {
    setEnded(false);
    handleSeek(trimStart);
  }, [handleSeek, trimStart]);

  const react = useCallback(
    async (emoji: string) => {
      const timestamp = activeVideoRef.current?.currentTime ?? currentTime;
      float(emoji, auth.user?.name);
      const response = await fetch(`/api/reactions/${upload.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji, timestamp, viewerId: anonymousViewerId() }),
      }).catch(() => null);
      if (response?.ok) {
        const body: { reaction: StoredReaction } = await response.json();
        setReactions((items) => [...items, body.reaction].sort((a, b) => a.timestamp - b.timestamp));
      }
    },
    [currentTime, float, upload.id, auth.user?.name],
  );

  const getFrame = useCallback(async () => {
    const element = activeVideoRef.current;
    if (!element || !element.videoWidth) return null;
    const scale = Math.min(1, 1280 / element.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(element.videoWidth * scale);
    canvas.height = Math.round(element.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  }, []);

  // Count each viewer once, client-guarded.
  useEffect(() => {
    if (isOwner) return;
    void recordShareView(upload.id).then(
      (counted) => counted && setViews((count) => count + 1),
    );
  }, [upload.id, isOwner]);

  const tabs = [
    ...(hasTranscript ? [{ value: "transcript", label: "Transcript" }] : []),
    ...(isOwner && transcript?.words?.length ? [{ value: "edit", label: "Edit" }] : []),
    ...(isOwner && !isRecording ? [{ value: "annotate", label: "Annotate" }] : []),
    ...(showComments ? [{ value: "comments", label: "Comments" }] : []),
    ...(isOwner ? [{ value: "insights", label: "Insights" }] : []),
    ...(isOwner && !isRecording ? [{ value: "ai", label: "AI" }] : []),
  ];
  const tab = tabs.some((item) => item.value === activeTab) ? activeTab : (tabs[0]?.value ?? "");
  const sidebarTabs =
    tabs.length > 1 ? (
      <div className="shrink-0 overflow-x-auto border-b border-neutral-200 px-3 py-3">
        <Tabs tabs={tabs} value={tab} onValueChange={setActiveTab} className="min-w-max" />
      </div>
    ) : null;

  const sidebarContent =
    tab === "transcript" && transcript ? (
      <TranscriptPanel
        transcript={transcript}
        currentTime={currentTime}
        onSeek={handleSeek}
        storyboard={storyboard}
        className="h-full"
      />
    ) : tab === "edit" && transcript && isOwner ? (
      <TranscriptEditor
        transcript={transcript}
        cuts={cuts}
        duration={duration}
        currentTime={currentTime}
        onSeek={handleSeek}
        onChange={updateCuts}
        className="h-full"
      />
    ) : tab === "annotate" && isOwner ? (
      <AnnotateEditor
        uploadId={upload.id}
        overlays={overlays}
        selectedId={selectedOverlay}
        currentTime={currentTime}
        duration={duration}
        onSelect={setSelectedOverlay}
        onChange={updateOverlays}
        onSeek={handleSeek}
        className="h-full"
      />
    ) : tab === "comments" && showComments ? (
      <CommentsPanel
        uploadId={upload.id}
        currentTime={currentTime}
        onSeek={handleSeek}
        auth={auth}
        className="h-full"
      />
    ) : tab === "insights" && isOwner ? (
      <InsightsPanel uploadId={upload.id} className="h-full" />
    ) : tab === "ai" && isOwner ? (
      <AiPanel uploadId={upload.id} className="h-full" />
    ) : null;

  function updateOverlays(next: Array<Overlay>) {
    setOverlays(next);
    clearTimeout(overlaySaveTimer.current);
    overlaySaveTimer.current = setTimeout(() => {
      void fetch(`/api/recordings/${upload.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overlays: next }),
      }).then((response) => {
        if (!response.ok) notify("Couldn't save the annotations", "error");
      });
    }, 500);
  }

  const player = upload.status === "recording" ? (
    <LivePlayer id={upload.id} />
  ) : isRecording ? (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-neutral-900 text-sm text-neutral-300">
      <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
      {upload.status === "importing"
        ? "Bringing this video over. It usually takes under a minute."
        : upload.status === "rendering"
          ? "Combining the clips into one video. This page updates when it's done."
        : upload.status === "failed"
          ? "This video couldn't be finished. If it came from Loom, make sure the Loom is public, then try again."
          : "Still recording. This page updates when it's done."}
    </div>
  ) : !mounted ? (
    // The player is client-only; the poster holds the space until it mounts.
    <div className="relative w-full bg-black" style={{ aspectRatio: String(geometry.stageAspect) }}>
      {posterSource && <img src={posterSource} alt="" className="size-full object-contain" />}
    </div>
  ) : (
    <VideoPlayer
      src={mediaSource}
      poster={posterSource}
      initialTime={Math.max(initialTime, trimStart)}
      subtitlesUrl={subtitlesUrl}
      thumbnailsUrl={thumbnailsUrl}
      onActivate={handlePlayerActivate}
      onTimeUpdate={handlePlayerTimeUpdate}
      onEnded={() => setEnded(true)}
      stageAspect={geometry.stageAspect}
      stageBackground={background.css}
      screenBox={geometry.screen}
      zooms={studio.style.zooms}
      onPickZoomFocus={zoomFocusPicker ? (x, y) => { zoomFocusPicker(x, y); setZoomFocusPicker(null); } : undefined}
      className="block h-full w-full"
    >
      {cameraSource && geometry.camera && (
        <CameraTrack
          src={cameraSource}
          main={mainVideo}
          box={geometry.camera}
          shape={studio.style.layout === "side" ? "rounded" : studio.style.shape}
          full={studio.style.layout === "camera"}
          editable={isOwner && studioOpen && studio.style.layout === "bubble"}
          onCornerChange={(corner) => {
            const style = { ...studio.style, corner };
            setStudio({ ...studio, style });
            void fetch(`/api/recordings/${upload.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ style }),
            });
          }}
        />
      )}
      {overlays.length > 0 && (
        <OverlayLayer
          overlays={overlays}
          time={currentTime}
          aspect={geometry.stageAspect}
          edit={isOwner && tab === "annotate"}
          selectedId={selectedOverlay}
          onSelect={setSelectedOverlay}
          onChange={(next) => updateOverlays(overlays.map((item) => (item.id === next.id ? next : item)))}
        />
      )}
      {transcript && studio.captionStyle !== "off" && <CaptionLayer transcript={transcript} time={currentTime} video={mainVideo} style={studio.captionStyle} />}
      <ReactionLayer items={floating} />
      {ended && <EndCard ctaLabel={studio.ctaLabel} ctaUrl={studio.ctaUrl} uploadId={upload.id} onReplay={replay} />}
    </VideoPlayer>
  );

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50" style={brandStyle(brand)}>
      <ShareHeader user={auth.user} onSignOut={() => void signOut()} brand={brand} />

      <div className="flex-1 px-4 py-4 lg:px-8 lg:py-6">
        <div className={`mx-auto grid w-full grid-cols-1 items-start gap-6 ${hasSidebar ? "max-w-[1600px] lg:grid-cols-[minmax(0,1fr)_384px]" : "max-w-6xl"}`}>
          <div className="min-w-0">
            <div
              className="mx-auto w-full overflow-hidden rounded-xl ring-1 ring-neutral-200"
              style={geometry.stageAspect < 1 ? { maxWidth: `calc(max(320px, 100dvh - 260px) * ${geometry.stageAspect})` } : undefined}
            >
              {player}
            </div>
            {!isRecording && studio.socialEnabled && (
              <ReactionBar onReact={(emoji) => void react(emoji)} reactions={reactions} duration={trimEnd ?? duration} onSeek={handleSeek} />
            )}
            <div className="mt-4 w-full">
              <VideoInfo
                upload={upload}
                origin={origin}
                author={author}
                views={views}
                likeCount={likeCount}
                auth={auth}
                showLike={showComments}
                mediaSource={mediaSource}
                isOwner={isOwner}
                exportReady={exportReady}
                aiPending={aiPending}
                ctaLabel={studio.ctaLabel}
                ctaUrl={studio.ctaUrl}
                uploadId={upload.id}
                currentTime={currentTime}
                studioOpen={studioOpen}
                onToggleStudio={() => setStudioOpen((open) => !open)}
                onNotify={notify}
              />

              {currentChapter && <CurrentChapterIndicator chapter={currentChapter} />}

              {isOwner && studioOpen && !isRecording && (
                <StudioPanel
                  uploadId={upload.id}
                  state={studio}
                  onChange={setStudio}
                  hasCamera={Boolean(cameraSource)}
                  currentTime={currentTime}
                  duration={duration}
                  getFrame={getFrame}
                  mediaSource={mediaSource}
                  hasTranscript={hasTranscript}
                  onNotify={notify}
                  onSeek={(time) => { if (activeVideoRef.current) { activeVideoRef.current.currentTime = time; activeVideoRef.current.pause(); } setCurrentTime(time); }}
                  onPickZoomFocus={pickZoomFocus}
                />
              )}
            </div>
          </div>

          {hasSidebar && (
            <aside aria-label="Video details" className="flex h-[480px] min-h-0 min-w-0 flex-col rounded-xl border border-neutral-200 bg-white lg:sticky lg:top-6 lg:h-[720px]" style={{ maxHeight: "calc(100dvh - 104px)" }}>
              {sidebarTabs}
              <div className="min-h-0 flex-1 py-3">
                {sidebarContent}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

/** Quick reactions under the player, with markers on a mini timeline. */
function ReactionBar({
  onReact,
  reactions,
  duration,
  onSeek,
}: {
  onReact: (emoji: string) => void;
  reactions: Array<StoredReaction>;
  duration: number;
  onSeek: (time: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 pt-3">
      <div className="flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white p-1">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            className="flex size-8 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-[var(--brand-accent,#de2b14)] active:scale-95"
            aria-label={`React: ${reactionLabel(emoji)}`}
            title={reactionLabel(emoji)}
          >
            <ReactionIcon code={emoji} />
          </button>
        ))}
      </div>
      {reactions.length > 0 && duration > 0 && (
        <div className="relative h-7 min-w-32 flex-1" title="Reactions on the timeline">
          <div className="absolute inset-x-0 top-1/2 h-px bg-neutral-200" />
          {reactions.map((reaction) => (
            <button
              key={reaction.id}
              type="button"
              onClick={() => onSeek(reaction.timestamp)}
              className="absolute top-0 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-[var(--brand-accent,#de2b14)] transition-transform hover:scale-110"
              style={{ left: `${Math.min(100, (reaction.timestamp / duration) * 100)}%` }}
              title={`${reactionLabel(reaction.emoji)} · ${reaction.viewerName ?? "Someone"} at ${formatDuration(reaction.timestamp)}`}
              aria-label={`${reactionLabel(reaction.emoji)} by ${reaction.viewerName ?? "Someone"} at ${formatDuration(reaction.timestamp)}`}
            >
              <ReactionIcon code={reaction.emoji} size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoInfo({
  upload,
  origin,
  author,
  views,
  likeCount,
  auth,
  showLike,
  mediaSource,
  isOwner,
  exportReady,
  aiPending,
  ctaLabel,
  ctaUrl,
  uploadId,
  currentTime,
  studioOpen,
  onToggleStudio,
  onNotify,
}: {
  upload: Upload;
  origin: string;
  author: Author;
  views: number;
  likeCount: number;
  auth: AuthState;
  showLike: boolean;
  mediaSource: string;
  isOwner: boolean;
  exportReady: boolean;
  aiPending: boolean;
  ctaLabel: string | null;
  ctaUrl: string | null;
  uploadId: string;
  currentTime: number;
  studioOpen: boolean;
  onToggleStudio: () => void;
  onNotify: (message: string, variant?: "error") => void;
}) {
  const [title, setTitle] = useState(
    upload.title?.trim() || (aiPending ? "Naming your video…" : "Untitled video"),
  );
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const saveTitle = async (next: string) => {
    setEditing(false);
    const trimmed = next.trim();
    if (!trimmed || trimmed === title) return;
    setTitle(trimmed);
    const response = await fetch(`/api/recordings/${upload.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!response.ok) onNotify("Couldn't rename the video", "error");
  };

  const metadata = [
    formatTimeAgo(upload.createdAt),
    upload.duration ? formatDuration(upload.duration) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(message);
    } catch {
      onNotify("Couldn't copy", "error");
    }
    setShareOpen(false);
  };
  const pageUrl = `${origin}/${upload.id}`;
  const at = Math.floor(currentTime);

  return (
    <div className="flex flex-col">
      {editing ? (
        <input
          autoFocus
          defaultValue={title}
          maxLength={200}
          onBlur={(event) => void saveTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setEditing(false);
          }}
          className="w-full rounded-md border border-neutral-300 px-2 py-1 text-lg font-semibold text-neutral-900 lg:text-xl"
        />
      ) : (
        <h1
          className={`text-lg font-semibold text-neutral-900 lg:text-xl ${isOwner ? "cursor-text rounded hover:bg-neutral-100" : ""}`}
          title={isOwner ? "Click to rename" : undefined}
          onClick={() => isOwner && setEditing(true)}
        >
          {title}
        </h1>
      )}
      {upload.summary && (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-600">{upload.summary}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src={author.avatar} alt={author.name} className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0">
            <p className="font-medium text-neutral-900">{author.name}</p>
            <p className="text-xs text-neutral-500">{metadata}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-medium text-neutral-500">{formatViews(views)}</span>
          {showLike && <LikeButton uploadId={upload.id} auth={auth} initialCount={likeCount} />}
          {auth.user && !isOwner && <WatchLaterButton uploadId={upload.id} />}
          {ctaLabel && ctaUrl && (
            <LinkButton href={ctaUrl} onClick={() => countCtaClick(uploadId)} target="_blank" rel="noopener noreferrer" variant="primary" icon={<ArrowSquareOutIcon weight="bold" />}>
              {ctaLabel}
            </LinkButton>
          )}
          <div className="relative">
            <Button variant="secondary" icon={<LinkIcon weight="bold" />} onClick={() => setShareOpen((open) => !open)}>
              Share
            </Button>
            {shareOpen && (
              <div className="pop-in absolute right-0 z-30 mt-1 w-60 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                <MenuItem onClick={() => void copy(pageUrl, "Link copied")}>Copy link</MenuItem>
                {at > 0 && (
                  <MenuItem onClick={() => void copy(`${pageUrl}?t=${at}`, `Link at ${formatDuration(at)} copied`)}>
                    Copy link at {formatDuration(at)}
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() =>
                    void copy(
                      `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${origin}/embed/${upload.id}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`,
                      "Embed code copied",
                    )
                  }
                >
                  Copy embed code
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setShareOpen(false);
                    // A promised blob keeps the click's permission to write the clipboard while the brief loads.
                    const brief = fetch(`/api/prompt/${upload.id}`).then((response) => {
                      if (!response.ok) throw new Error("prompt failed");
                      return response.blob();
                    });
                    void navigator.clipboard
                      .write([new ClipboardItem({ "text/plain": brief.then((blob) => new Blob([blob], { type: "text/plain" })) })])
                      .then(
                        () => onNotify("Copied. Paste it into Claude, Cursor or any agent"),
                        () => onNotify("Couldn't copy", "error"),
                      );
                  }}
                >
                  Copy for an AI agent
                </MenuItem>
                {(upload.posterKey || upload.gifKey) && (
                  <MenuItem
                    onClick={() =>
                      void copyRich(
                        `<a href="${pageUrl}"><img src="${origin}/api/${upload.gifKey ? "gif" : "poster"}/${upload.id}" alt="${title.replace(/"/g, "&quot;")}" width="480" style="border-radius:12px;max-width:100%"></a><br><a href="${pageUrl}">Watch “${title.replace(/</g, "&lt;")}”</a>`,
                        pageUrl,
                      ).then(
                        () => onNotify("Paste it into an email"),
                        () => onNotify("Couldn't copy", "error"),
                      )
                    }
                  >
                    Copy for email (thumbnail + link)
                  </MenuItem>
                )}
              </div>
            )}
          </div>
          {isOwner ? (
            <DownloadMenu uploadId={upload.id} mediaSource={mediaSource} filename={upload.filename} captions={Boolean(upload.transcriptKey)} onNotify={onNotify} />
          ) : upload.downloadsEnabled && (
            <LinkButton
              href={exportReady ? `${origin}/api/export/${upload.id}` : mediaSource}
              download={exportReady ? undefined : upload.filename}
              variant="secondary"
              icon={<DownloadSimpleIcon weight="bold" />}
            >
              Download
            </LinkButton>
          )}
          {isOwner && (
            <Button variant={studioOpen ? "primary" : "secondary"} onClick={onToggleStudio}>
              {!studioOpen && <VertovIcon name="customize" />} {studioOpen ? "Done" : "Customize"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Owner download: the MP4 with the layout rendered in, or the raw screen track. */
function DownloadMenu({
  uploadId,
  mediaSource,
  filename,
  captions,
  onNotify,
}: {
  uploadId: string;
  mediaSource: string;
  filename: string;
  captions: boolean;
  onNotify: (message: string, variant?: "error") => void;
}) {
  const [open, setOpen] = useState(false);
  const [rendering, setRendering] = useState(false);

  const exportVideo = async () => {
    setOpen(false);
    setRendering(true);
    try {
      let response = await fetch(`/api/recordings/${uploadId}/export`, { method: "POST" });
      let body = await response.json<{ status?: string }>();
      if (body.status !== "done") onNotify("Rendering your video. It downloads when it's ready.");
      const started = Date.now();
      while (body.status === "pending" && Date.now() - started < 20 * 60 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        response = await fetch(`/api/recordings/${uploadId}/export`);
        body = await response.json<{ status?: string }>();
      }
      if (body.status === "done") window.location.href = `/api/export/${uploadId}`;
      else onNotify("The render didn't finish. Try again in a minute.", "error");
    } catch {
      onNotify("The render didn't finish. Try again in a minute.", "error");
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="relative">
      <Button
        variant="secondary"
        icon={<DownloadSimpleIcon weight="bold" />}
        disabled={rendering}
        onClick={() => setOpen((value) => !value)}
      >
        {rendering ? "Rendering…" : "Download"}
      </Button>
      {open && (
        <div className="pop-in absolute right-0 z-30 mt-1 w-64 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
          <MenuItem onClick={() => void exportVideo()}>
            <span className="font-medium">MP4 with your layout</span>
            <span className="block text-xs text-neutral-500">Camera, background and trim baked in</span>
          </MenuItem>
          <a
            href={mediaSource}
            download={filename}
            onClick={() => setOpen(false)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <span className="font-medium">Original screen recording</span>
            <span className="block text-xs text-neutral-500">As recorded, no camera</span>
          </a>
          {captions && (
            <a
              href={`/api/captions/${uploadId}?format=srt`}
              onClick={() => setOpen(false)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span className="font-medium">Captions (.srt)</span>
              <span className="block text-xs text-neutral-500">For YouTube, editors and other players</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

async function copyRich(html: string, text: string) {
  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([text], { type: "text/plain" }),
    }),
  ]);
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
    >
      {children}
    </button>
  );
}

function CurrentChapterIndicator({ chapter }: { chapter: Chapter }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700">
        <span className="size-1.5 animate-pulse rounded-full bg-neutral-900" />
        {chapter.title}
      </span>
      <span className="font-mono text-xs text-neutral-400 tabular-nums">
        {formatDuration(chapter.startTime)}
      </span>
    </div>
  );
}
