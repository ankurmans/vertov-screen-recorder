-- Better Auth tables (anonymous, magic link, passkey, Google), same shape as Kanduck's.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer);
create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
create table "passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" integer not null, "transports" text, "createdAt" date, "aaguid" text);
create index "session_userId_idx" on "session" ("userId");
create index "account_userId_idx" on "account" ("userId");
create index "verification_identifier_idx" on "verification" ("identifier");
create index "passkey_userId_idx" on "passkey" ("userId");
create index "passkey_credentialID_idx" on "passkey" ("credentialID");

-- Recordings belong to a user and exist from the first frame, before the media is complete.
ALTER TABLE `uploads` ADD `owner_id` text;
-- recording: parts still arriving; ready: playable.
ALTER TABLE `uploads` ADD `status` text DEFAULT 'ready' NOT NULL;
ALTER TABLE `uploads` ADD `multipart_upload_id` text;
ALTER TABLE `uploads` ADD `audio_key` text;
ALTER TABLE `uploads` ADD `summary` text;
-- pending, done, failed, or null when nothing will run.
ALTER TABLE `uploads` ADD `ai_status` text;
CREATE INDEX `idx_uploads_owner` ON `uploads` (`owner_id`, `created_at`);

-- ETags of uploaded parts, so finishing never depends on the browser still holding them.
CREATE TABLE `upload_parts` (
  `upload_id` text NOT NULL,
  `part_number` integer NOT NULL,
  `etag` text NOT NULL,
  `size` integer NOT NULL,
  PRIMARY KEY (`upload_id`, `part_number`)
);
