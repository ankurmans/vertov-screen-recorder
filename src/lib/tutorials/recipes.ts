import { recipeSchema } from "./recipe"
import type { Recipe } from "./recipe"

/**
 * Recipes the runner can perform. Written by hand and checked against the live interface before they are registered:
 * a control that exists in the source is only a candidate until a run has clicked it.
 */
const RECIPES: Array<unknown> = [
  {
    id: "create-space-and-organize",
    version: 1,
    title: "How to create a space and organize a video",
    summary: "Make a shared space in your library, then move a recording into it so your team can find it.",
    allowedOrigins: ["app"],
    preconditions: ["The demo account has at least one video in My videos.", "No space called the chosen name exists yet."],
    parameters: [{ name: "spaceName", label: "Space name", description: "Shown in the library and to everyone in the workspace.", default: "Design reviews", maxLength: 40 }],
    steps: [
      {
        id: "open-library",
        goal: "Open the library",
        narration: "This is your Vertov library. Everything you record lands here. Let's make a shared space so your team can find the right videos.",
        actions: [{ type: "goto", path: "/app" }, { type: "wait", until: { role: "navigation", name: "Library" } }],
        expect: [{ type: "visible", target: { role: "navigation", name: "Library" } }],
        hold: 1,
      },
      {
        id: "new-space",
        goal: "Start a new space",
        narration: "In the sidebar, choose the plus button beside Spaces. This opens the Create a space dialog.",
        actions: [{ type: "click", target: { role: "button", name: "New space", exact: true } }, { type: "wait", until: { role: "dialog", name: "Create a space" } }],
        expect: [{ type: "visible", target: { role: "dialog", name: "Create a space" } }],
        hold: 1,
      },
      {
        id: "name-space",
        goal: "Name the space",
        narration: "Give the space a clear name. Here we'll call it {{spaceName}}. Everyone in your workspace will see it, so pick something your team will recognise.",
        actions: [{ type: "fill", target: { label: "Space name" }, value: "{{spaceName}}" }],
        expect: [{ type: "visible", target: { role: "button", name: "Create space", exact: true } }],
        hold: 1.5,
      },
      {
        id: "create-space",
        goal: "Create the space",
        narration: "Choose Create space. Vertov opens the new space straight away, and it's empty for now.",
        actions: [{ type: "click", target: { role: "button", name: "Create space", exact: true } }, { type: "wait", until: { text: "Give this space its first video." } }],
        expect: [{ type: "hidden", target: { role: "dialog", name: "Create a space" } }, { type: "visible", target: { text: "Give this space its first video." } }],
        hold: 2,
      },
      {
        id: "back-to-videos",
        goal: "Return to My videos",
        narration: "Now let's move a recording into it. Go back to My videos.",
        actions: [{ type: "click", target: { role: "button", name: "My videos", exact: true, within: { role: "navigation", name: "Library" } } }, { type: "wait", until: { role: "list", name: "Recordings" } }],
        expect: [{ type: "visible", target: { role: "list", name: "Recordings" } }],
        hold: 1,
      },
      {
        id: "open-menu",
        goal: "Open a video's menu",
        narration: "Open the More menu on a video, then choose Move.",
        actions: [
          { type: "click", target: { role: "button", name: "More", exact: true, nth: 0 } },
          { type: "click", target: { role: "button", name: "Move…" } },
          { type: "wait", until: { role: "dialog" } },
        ],
        expect: [{ type: "visible", target: { role: "dialog" } }],
        hold: 1,
      },
      {
        id: "choose-space",
        goal: "Pick the space",
        narration: "Pick {{spaceName}} from the list of places. Everyone in the workspace will be able to see this video in that space.",
        actions: [{ type: "click", target: { label: "{{spaceName}}" } }],
        expect: [{ type: "visible", target: { text: "Everyone in the workspace will see it in this space." } }],
        hold: 2,
      },
      {
        id: "confirm-move",
        goal: "Move the video",
        narration: "Choose Move. The video leaves My videos and now lives in the space.",
        actions: [{ type: "click", target: { role: "button", name: "Move", exact: true, within: { role: "dialog" } } }],
        expect: [{ type: "hidden", target: { role: "dialog" } }],
        hold: 1.5,
      },
      {
        id: "see-result",
        goal: "Open the space and see the video",
        narration: "Open {{spaceName}} in the sidebar, and there's your video. Your team can find it here, and you can add more any time.",
        actions: [{ type: "click", target: { role: "button", name: "{{spaceName}}", exact: true, within: { role: "navigation", name: "Library" } } }, { type: "wait", until: { role: "list", name: "Recordings" } }],
        expect: [{ type: "visible", target: { role: "list", name: "Recordings" } }],
        hold: 3,
      },
    ],
  },
]

export const recipes: Array<Recipe> = RECIPES.map((raw) => recipeSchema.parse(raw))

export const recipeById = (id: string) => recipes.find((recipe) => recipe.id === id) ?? null
