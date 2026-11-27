/** What `/embed/:id` tells a same-origin page around it while it plays. `hold` means it ends on a button the viewer should see. */
export type PlayerMessage = { type: "vertov:player"; id: string; time: number; ended: boolean; hold: boolean }
