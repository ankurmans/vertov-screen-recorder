import { emailFrame, escapeEmail as esc } from "./email-layout";
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
};
export const LESSONS: readonly Lesson[] = [
  {
    id: "welcome",
    day: 0,
    skip: "record",
    subject: "Your first Vertov ⚡",
    preheader: "The next explanation belongs in a video.",
    intro:
      "I’m building Vertov for people who want to show their work and get on with it. If Loom has been your default, give your next walkthrough to Vertov.",
    action:
      "Record one explanation you were about to type. A bug, a design decision, a handoff. Keep it focused, then send the link to the person who needs it.",
    reply: "What would make Vertov your default? Reply and tell me.",
    cta: "Record a walkthrough",
    path: "/record",
    image: "hero.webp",
    alt: "Example Vertov share page: a demo website recording beside its transcript.",
  },
  {
    id: "first-recording",
    day: 1,
    skip: "record",
    subject: "One useful minute ⚡",
    preheader: "Start with the thing you need to explain.",
    intro: "A first recording doesn’t need a script. It needs a point.",
    action:
      "Open the recorder and walk through one thing on your screen. Stop when the explanation is finished. Your first useful video matters more than a polished introduction.",
    reply: "What stopped you from recording? Hit reply.",
    cta: "Make your first video",
    path: "/record",
    image: "hero.webp",
    alt: "Vertov demo recording with a readable transcript.",
  },
  {
    id: "first-view",
    day: 3,
    skip: "view",
    subject: "Send the link ↗",
    preheader: "A walkthrough earns its place when someone watches.",
    intro: "A recording sitting in your library hasn’t helped anyone yet.",
    action:
      "Open your video, copy its link, and send it to the person waiting on your explanation. Ask them to leave their question on the video so the context stays together.",
    reply: "Who is your next walkthrough for?",
    cta: "Open your library",
    path: "/app",
    image: "email-preview.gif",
    alt: "Animated preview of an example website walkthrough recorded in Vertov.",
  },
  {
    id: "help",
    day: 7,
    skip: "view",
    subject: "What got in the way? 💬",
    preheader: "Tell me where the handoff broke down.",
    intro:
      "I want Vertov to earn the spot Loom has in your workflow. That starts with a recording someone actually watches.",
    action:
      "If you haven’t reached that point, reply with the step that got in your way. Recording, sharing, playback, something missing – I want the specific problem.",
    reply: "What should I fix first?",
    cta: "Try your next walkthrough",
    path: "/record",
    image: null,
    alt: null,
  },
  {
    id: "edit",
    day: 10,
    skip: "edit",
    subject: "Cut the words ✂",
    preheader: "Edit the explanation by editing its transcript.",
    intro:
      "You know the sentence that should have been cut. You shouldn’t have to hunt through a timeline to remove it.",
    action:
      "Open a recording and use Edit to select the words you want to cut from its transcript. Play it back and hear the shorter version.",
    reply: "What do you usually cut from a walkthrough?",
    cta: "Edit a recording",
    path: "/app",
    image: "edit-by-text.webp",
    alt: "Vertov Edit panel showing removed filler words and a selected transcript word.",
  },
  {
    id: "layout",
    day: 14,
    skip: "layout",
    subject: "Make it yours 🎬",
    preheader: "The camera bubble can move after recording.",
    intro:
      "Your camera shouldn’t cover the part of the screen you’re explaining.",
    action:
      "Open Customize on a recording and move the camera bubble. Try a side-by-side layout when your face and the screen both need room.",
    reply: "Which layout fits your work?",
    cta: "Customize a video",
    path: "/app",
    image: "customize.webp",
    alt: "Customize panel with camera layouts, backgrounds and trim controls.",
  },
  {
    id: "loom-import",
    day: 18,
    skip: "import",
    subject: "Bring a Loom over 📦",
    preheader: "Try Vertov with a recording you already have.",
    intro:
      "You don’t have to record everything again to try a different home for your videos.",
    action:
      "Use Import from Loom in your library and paste a public Loom share link. Start with one video, then check playback in Vertov before you share its new link. Private Loom videos aren’t supported by this importer.",
    reply: "What would you need before moving more of your library?",
    cta: "Open your library",
    path: "/app",
    image: null,
    alt: null,
  },
  {
    id: "privacy",
    day: 22,
    skip: "privacy",
    subject: "Choose your audience 🔒",
    preheader: "A shared link needs the right access settings.",
    intro:
      "Some walkthroughs are meant for a client. Some should stay inside the team.",
    action:
      "Open Customize on a video and review Who can watch. Set a password when the recipient needs an extra gate, then test the link as a viewer before sending it.",
    reply: "What access control does your team depend on?",
    cta: "Review a video",
    path: "/app",
    image: "customize.webp",
    alt: "Who can watch controls showing password and link expiry options.",
  },
  {
    id: "thank-you",
    day: 26,
    skip: "none",
    subject: "Help shape Vertov 💬",
    preheader: "Your real workflow is the product brief.",
    intro:
      "I want Vertov to be the tool you reach for without thinking when something is easier to show.",
    action:
      "Reply with the last video you made and what happened after you sent it. Did it answer the question? Did someone still need a call? That tells me more than a feature wish list.",
    reply: "What happened after your last walkthrough?",
    cta: "Open Vertov",
    path: "/app",
    image: null,
    alt: null,
  },
  {
    id: "mastery",
    day: 30,
    skip: "none",
    subject: "The next handoff 🎓",
    preheader: "Give one real handoff to Vertov.",
    intro:
      "Here’s a useful test for Vertov: use it for the next handoff that would normally become a meeting.",
    action:
      "Show the current state, explain the decision, and finish with what the other person needs to do. Send the recording and let their questions tell you what was missing.",
    reply: "Did the recording replace the call, or did you still need one?",
    cta: "Record the handoff",
    path: "/record",
    image: "email-preview.gif",
    alt: "Example animated preview of a website walkthrough in Vertov.",
  },
];
export function renderLesson(
  lesson: Lesson,
  name: string,
  unsubscribe: string,
  postal: string,
) {
  const first = name.trim().split(/\s+/)[0] || "there";
  const target = new URL(
    lesson.id === "loom-import" ? "/app?import=1" : lesson.path,
    "https://vertov.app",
  );
  target.searchParams.set("utm_source", "email");
  target.searchParams.set("utm_medium", "lifecycle");
  target.searchParams.set("utm_campaign", lesson.id);
  const href = target.href;
  const visual = "";
  const text = `Hi ${first},\n\n${lesson.intro}\n\n${lesson.action}\n\n${lesson.cta}: ${href}\n\n${lesson.reply}\n\nSpeak soon,\nThe Vertov team\n\nVertov tips for your account. Unsubscribe: ${unsubscribe}\n${postal}`;
  const html = emailFrame(
    `<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;letter-spacing:-.7px">${esc(lesson.preheader)}</h1>${visual}<p>Hi ${esc(first)},</p><p>${esc(lesson.intro)}</p><p>${esc(lesson.action)}</p><p style="margin:28px 0"><a href="${esc(href)}" style="background:#d92b14;color:#fff;text-decoration:none;padding:14px 20px;display:inline-block;font-weight:bold">${esc(lesson.cta)} →</a></p><p>${esc(lesson.reply)}</p><p>Speak soon,<br>The Vertov team</p><p style="font-size:12px;color:#585b60">${lesson.image ? "Visual: product demo, not a customer recording.<br>" : ""}You’re receiving Vertov tips because you signed up.<br><a href="${esc(unsubscribe)}" style="color:#585b60">Unsubscribe from tips</a><br>${esc(postal)}</p>`,
    lesson.preheader,
  );
  return { subject: lesson.subject, html, text };
}
