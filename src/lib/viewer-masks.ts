// Hiding parts of the picture is part of the hosted service and is not included in this edition, so the copy viewers
// get only has removed stretches blanked.

export type Masks = { screen?: never; camera?: never };

export const trackMasks = (_video: unknown): Masks => ({});

export const masksCover = (_made: Masks | undefined, _wanted: Masks): boolean => true;
