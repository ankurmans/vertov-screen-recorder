import { emailButton, emailFrame, emailVisual, escapeEmail as esc } from "./email-layout";

export type Lesson = {
  id: string;
  day: number;
  skip: string;
  subject: string;
  preheader: string;
  intro: string;
  action: string;
  reply: string;
  cta: string;
  path: string;
  image: string | null;
  alt: string | null;
  replyOnly?: boolean;
};
export const LESSONS: ReadonlyArray<Lesson> = [
  {
    id: "welcome", day: 0, skip: "record",
    subject: "Your first Vertov ⚡",
    preheader: "Show me where it gets stuck.",
    intro: "Got a bug, a design decision, or a handoff waiting in a draft? Show the part that is easier to see than describe.",
    action: "Open the recorder, walk through one thing on your screen, and stop when your point is clear. Send the link to the person who needs the context.",
    reply: "If recording gets awkward, reply and tell me where.",
    cta: "Record a walkthrough",
    path: "/record",
    image: "record-first.gif",
    alt: "Three steps: record the explanation, stop, and share its link.",
  },
  {
    id: "first-recording", day: 1, skip: "record",
    subject: "One useful minute ⚡",
    preheader: "Your first video needs a point, not a script.",
    intro: "You do not need an introduction or a polished demo. Start with something you already need to explain.",
    action: "Show a bug happening, walk through a change, or point out the decision someone needs to make. Record that one thing. You can stop there.",
    reply: "",
    cta: "Make your first video",
    path: "/record",
    image: "first-recording.png",
    alt: "Three possible first recordings: a bug, a decision, or a handoff.",
  },
  {
    id: "first-view", day: 3, skip: "view",
    subject: "Send the link ↗️",
    preheader: "Give someone the context they need.",
    intro: "Got someone in mind for your walkthrough? Your video is ready whenever you want to send it.",
    action: "Open the video and copy its link. Send it with one sentence about what you want the other person to look at or do next.",
    reply: "",
    cta: "Open your video",
    path: "/home",
    image: "copy-share-link.gif",
    alt: "Open the video, copy its link, and send it to the intended recipient.",
  },
  {
    id: "help", day: 7, skip: "view",
    subject: "What got stuck? 💬",
    preheader: "Tell me the step that needs work.",
    intro: "Was there a step in Vertov that made the handoff harder than it should have been?",
    action: "Recording, sharing, playback, or something missing: tell me what you were trying to do and where you got stuck. A rough reply is plenty.",
    reply: "What happened? Hit reply.",
    cta: "",
    path: "/home",
    image: null,
    alt: null,
    replyOnly: true,
  },
  {
    id: "edit", day: 10, skip: "edit",
    subject: "Cut the detour ✂️",
    preheader: "Remove a detour by cutting its words.",
    intro: "Said the same thing twice? You can shorten the explanation without recording it again.",
    action: "Open Edit on your video and select the transcript words you want to cut. Remove them, then play the result to check the join.",
    reply: "",
    cta: "Edit this video",
    path: "/home",
    image: "cut-by-transcript.gif",
    alt: "Illustration: a repeated sentence is selected and cut from a transcript.",
  },
  {
    id: "layout", day: 14, skip: "layout",
    subject: "Move your camera 🎬",
    preheader: "Give the detail on screen room to breathe.",
    intro: "Your face should not hide the thing you are explaining.",
    action: "Open Customize and move the camera away from the detail that matters. With a separate camera track, you can adjust its layout after recording.",
    reply: "",
    cta: "Adjust this layout",
    path: "/home",
    image: "move-camera.gif",
    alt: "Camera-layout illustration: the camera moves away from the content.",
  },
  {
    id: "loom-import", day: 18, skip: "import",
    subject: "Bring a Loom 📦",
    preheader: "Try the move with a video worth keeping.",
    intro: "You do not have to record a useful explanation again just to give it a new home.",
    action: "Open Import from Loom and paste a public share link. You can scan pasted links and choose what to bring over. Check playback in Vertov before sending the new link. The web importer needs public videos; private Looms use the separate Chrome extension import.",
    reply: "What would you need before moving more of your library?",
    cta: "Import a Loom",
    path: "/home?import=1",
    image: "loom-import.png",
    alt: "A Loom share link becomes a Vertov video, ready for a playback check and a new share link.",
  },
  {
    id: "privacy", day: 22, skip: "privacy",
    subject: "Who can watch? 🔒",
    preheader: "Review access before the link travels.",
    intro: "A client walkthrough and an internal handoff may need different access settings.",
    action: "Open your video and review Who can watch. Add a password when you need that extra gate, and test the viewer link before you send it.",
    reply: "",
    cta: "Review access",
    path: "/home",
    image: "access-controls.png",
    alt: "Review the audience, optionally add a password, and test the viewer link.",
  },
  {
    id: "thank-you", day: 26, skip: "none",
    subject: "How did it go? 💬",
    preheader: "Your last handoff is the useful example.",
    intro: "I am figuring out what to build next in Vertov. Your actual workflow is the best place to start.",
    action: "Think about your last Vertov video. What were you trying to explain, and what happened next? If you sent it to someone, did they have what they needed, or did something still need explaining?",
    reply: "A rough reply is plenty.",
    cta: "",
    path: "/home",
    image: null,
    alt: null,
    replyOnly: true,
  },
  {
    id: "mastery", day: 30, skip: "none",
    subject: "Your next handoff 🎓",
    preheader: "Finish with the next step.",
    intro: "For your next handoff, give the other person the context they need to act.",
    action: "Show the current state, explain the decision, and finish with what needs to happen next. Send the recording with that next step in your message.",
    reply: "",
    cta: "Record a handoff",
    path: "/record",
    image: "handoff.png",
    alt: "A handoff in three parts: current state, decision, and next action.",
  },
  {
    id: "import-review", day: 0, skip: "none",
    subject: "Check your import 📥",
    preheader: "Check the playback before sharing its new link.",
    intro: "Your video is in Vertov. Give it a quick playback check before you send its new link.",
    action: "Play the start, jump to the part that matters, and check the sound. Once it looks right, copy the Vertov link for your next handoff.",
    reply: "If anything looks or sounds wrong, reply with what happened.",
    cta: "Review your import",
    path: "/home",
    image: "import-review.png",
    alt: "Playback checklist: check the start, the important passage, and the sound.",
  },
  {
    id: "come-back", day: 0, skip: "none",
    subject: "Something to show? ⚡",
    preheader: "Start with the explanation already on your screen.",
    intro: "Next time you find yourself typing a long explanation of something on screen, try showing it.",
    action: "Open the thing you need to explain and record the part that matters. Send it when you are ready.",
    reply: "If something got in the way last time, tell me the specific step.",
    cta: "Record a walkthrough",
    path: "/record",
    image: "come-back.png",
    alt: "Open the work, record the important part, and send it when ready.",
  },
];
export function renderLesson(
  lesson: Lesson,
  name: string,
  unsubscribe: string,
  postal: string,
  appOrigin = "https://vertov.app",
  video?: { id: string; title: string | null },
) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const videoLesson = ["first-view", "edit", "layout", "privacy", "import-review"].includes(lesson.id);
  const target = new URL(video && videoLesson ? `/${encodeURIComponent(video.id)}` : lesson.path, appOrigin);
  target.searchParams.set("utm_source", "email");
  target.searchParams.set("utm_medium", "lifecycle");
  target.searchParams.set("utm_campaign", lesson.id);
  const href = target.href;
  const visual = lesson.image ? emailVisual(lesson.image, lesson.alt!, href) : "";
  const context = video && videoLesson ? `For your video: ${video.title || "Untitled video"}.` : "";
  const button = lesson.replyOnly ? "" : `<p style="margin:20px 0">${emailButton(href, lesson.cta)}</p>`;
  const text = [`Hi ${first},`, context, lesson.intro, lesson.action, lesson.replyOnly ? "" : `${lesson.cta}: ${href}`, lesson.reply, "The Vertov team", `Vertov tips for your account. Unsubscribe: ${unsubscribe}`, postal].filter(Boolean).join("\n\n");
  const html = emailFrame(
    `<h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;letter-spacing:-.7px">${esc(lesson.preheader)}</h1>${visual}<p>Hi ${esc(first)},</p>${context ? `<p style="font-size:13px;color:#585b60">${esc(context)}</p>` : ""}<p>${esc(lesson.intro)}</p><p>${esc(lesson.action)}</p>${button}${lesson.reply ? `<p>${esc(lesson.reply)}</p>` : ""}<p>The Vertov team</p><p style="font-size:12px;color:#585b60">You’re receiving Vertov tips because you signed up.<br><a href="${esc(unsubscribe)}" style="color:#585b60">Unsubscribe from tips</a></p>`,
    lesson.preheader,
    postal,
  );
  return { subject: lesson.subject, html, text };
}
