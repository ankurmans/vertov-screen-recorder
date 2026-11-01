-- On-video annotations (text, boxes, arrows) as JSON; see src/lib/overlays.ts.
ALTER TABLE uploads ADD COLUMN overlays text;
-- off (the browser's own captions) | clean | bold | karaoke
ALTER TABLE uploads ADD COLUMN caption_style text NOT NULL DEFAULT 'off';
-- Animated GIF thumbnail for emails and link previews, made in the owner's browser.
ALTER TABLE uploads ADD COLUMN gif_key text;
