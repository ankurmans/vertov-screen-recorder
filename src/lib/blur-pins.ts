// Hiding parts of the picture is part of the hosted service and is not included in this edition.

export type BlurPins = never;

export const parsePins = (_raw: unknown): undefined => undefined;

export const keepPins = <T,>(next: T, _previous: unknown): T => next;

export const pinBlurs = <T,>(overlays: T, _geometry: unknown, _edit?: unknown): T => overlays;
