/**
 * Vertov for Google Workspace.
 * Gmail compose: insert a recording as an animated thumbnail linked to its share page.
 * Calendar: attach a recording link to the open event.
 * Everything talks to https://vertov.app with the user's own API key (Authorization: Bearer rk_...).
 */

var BASE = "https://vertov.app";
var KEY_PROPERTY = "VERTOV_KEY";
var RECENT = 8;

// ---------- entry points (named in appsscript.json) ----------

function onHomepage() {
  return card_(homeSections_());
}

function onComposeOpen() {
  return card_(pickerSections_("compose", ""));
}

function onCalendarEventOpen() {
  return card_(pickerSections_("calendar", ""));
}

// ---------- actions ----------

function onSaveKey(e) {
  var key = String((e.formInput && e.formInput.key) || "").trim();
  if (!/^rk_[a-f0-9]{40}$/.test(key)) return notify_("That doesn't look like a Vertov key. It starts with rk_.");
  var check = request_(key, "");
  if (check.error) return notify_(check.error);
  PropertiesService.getUserProperties().setProperty(KEY_PROPERTY, key);
  return replace_(card_(homeSections_()), "Connected to Vertov.");
}

function onDisconnect() {
  PropertiesService.getUserProperties().deleteProperty(KEY_PROPERTY);
  return replace_(card_(homeSections_()), "Disconnected.");
}

function onSearch(e) {
  var mode = (e.parameters && e.parameters.mode) || "compose";
  var query = String((e.formInput && e.formInput.q) || "").trim();
  return replace_(card_(pickerSections_(mode, query)));
}

function onInsertIntoDraft(e) {
  var video = videoFrom_(e);
  var url = video.url;
  var title = esc_(video.title);
  var html =
    '<div><a href="' + esc_(url) + '"><img src="' + BASE + "/api/gif/" + esc_(video.id) +
    '" alt="' + title + '" width="480" style="max-width:100%;border-radius:8px"></a></div>' +
    '<div><a href="' + esc_(url) + '">' + title + "</a></div><br>";
  var action = CardService.newUpdateDraftBodyAction()
    .addUpdateContent(html, CardService.ContentType.MUTABLE_HTML)
    .setUpdateType(CardService.UpdateDraftBodyType.IN_PLACE_INSERT);
  return CardService.newUpdateDraftActionResponseBuilder().setUpdateDraftBodyAction(action).build();
}

function onAttachToEvent(e) {
  var video = videoFrom_(e);
  var attachment = CardService.newAttachment()
    .setResourceUrl(video.url)
    .setTitle(video.title)
    .setMimeType("text/html")
    .setIconUrl(BASE + "/logo.png");
  return CardService.newCalendarEventActionResponseBuilder().addAttachments([attachment]).build();
}

// ---------- cards ----------

function card_(sections) {
  var builder = CardService.newCardBuilder().setHeader(
    CardService.newCardHeader().setTitle("Vertov").setImageUrl(BASE + "/logo.png").setImageStyle(CardService.ImageStyle.SQUARE)
  );
  sections.forEach(function (s) { builder.addSection(s); });
  return builder.build();
}

function homeSections_() {
  var key = getKey_();
  if (!key) return [connectSection_()];
  var section = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText("Connected. Open a new Gmail message and choose <b>Insert a Vertov video</b> from the add-on menu, or attach one to a Calendar event."))
    .addWidget(CardService.newTextButton().setText("Record a new video").setOpenLink(CardService.newOpenLink().setUrl(BASE + "/record")))
    .addWidget(CardService.newTextButton().setText("Open my library").setOpenLink(CardService.newOpenLink().setUrl(BASE)))
    .addWidget(CardService.newTextButton().setText("Disconnect").setOnClickAction(CardService.newAction().setFunctionName("onDisconnect")));
  return [section];
}

function connectSection_() {
  return CardService.newCardSection()
    .setHeader("Connect Vertov")
    .addWidget(CardService.newTextParagraph().setText("Paste an API key from your Vertov settings. The key stays in your Google account's add-on storage and is only sent to vertov.app."))
    .addWidget(CardService.newTextButton().setText("Create a key").setOpenLink(CardService.newOpenLink().setUrl(BASE + "/settings")))
    .addWidget(CardService.newTextInput().setFieldName("key").setTitle("API key (rk_…)"))
    .addWidget(CardService.newTextButton().setText("Connect").setOnClickAction(CardService.newAction().setFunctionName("onSaveKey")));
}

/** mode is "compose" (insert into the draft) or "calendar" (attach to the event). */
function pickerSections_(mode, query) {
  var key = getKey_();
  if (!key) return [connectSection_()];
  var result = request_(key, query);
  var search = CardService.newCardSection()
    .addWidget(CardService.newTextInput().setFieldName("q").setTitle("Search your videos").setValue(query))
    .addWidget(CardService.newTextButton().setText("Search").setOnClickAction(CardService.newAction().setFunctionName("onSearch").setParameters({ mode: mode })));
  var list = CardService.newCardSection().setHeader(query ? "Results" : "Recent videos");
  if (result.error) {
    list.addWidget(CardService.newTextParagraph().setText(esc_(result.error)));
    return [search, list];
  }
  var videos = result.videos.filter(function (v) { return v.status === "ready"; }).slice(0, RECENT);
  if (!videos.length) {
    list.addWidget(CardService.newTextParagraph().setText(query ? "No videos match." : "No videos yet."));
    list.addWidget(CardService.newTextButton().setText("Record a new video").setOpenLink(CardService.newOpenLink().setUrl(BASE + "/record")));
    return [search, list];
  }
  var fn = mode === "calendar" ? "onAttachToEvent" : "onInsertIntoDraft";
  var label = mode === "calendar" ? "Attach" : "Insert";
  videos.forEach(function (v) {
    list.addWidget(
      CardService.newDecoratedText()
        .setText(esc_(v.title || "Untitled"))
        .setBottomLabel(clock_(v.duration))
        .setWrapText(true)
        .setButton(
          CardService.newTextButton().setText(label).setOnClickAction(
            CardService.newAction().setFunctionName(fn).setParameters({ id: String(v.id), title: String(v.title || "Untitled"), url: String(v.url) })
          )
        )
    );
  });
  return [search, list];
}

// ---------- helpers ----------

function getKey_() {
  return PropertiesService.getUserProperties().getProperty(KEY_PROPERTY);
}

/** GET /api/v1/videos. Returns {videos} or {error}. */
function request_(key, query) {
  var url = BASE + "/api/v1/videos" + (query ? "?q=" + encodeURIComponent(query) : "");
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + key, Accept: "application/json", "User-Agent": "VertovWorkspaceAddon/1.0" },
      muteHttpExceptions: true,
    });
  } catch (err) {
    return { error: "Couldn't reach vertov.app. Try again in a moment." };
  }
  var code = response.getResponseCode();
  if (code === 401 || code === 403) {
    var looksJson = String(response.getHeaders()["Content-Type"] || "").indexOf("json") !== -1;
    if (code === 403 && !looksJson) return { error: "vertov.app blocked this request. Contact support@vertov.app." };
    return { error: "Your key was rejected. Disconnect and paste a fresh key from Vertov settings." };
  }
  if (code !== 200) return { error: "Vertov returned an error (" + code + ")." };
  try {
    var body = JSON.parse(response.getContentText());
    return { videos: body.videos || [] };
  } catch (err) {
    return { error: "Vertov sent something unreadable." };
  }
}

function videoFrom_(e) {
  var p = e.parameters || {};
  return { id: p.id, title: p.title || "Untitled", url: p.url };
}

function clock_(seconds) {
  var s = Math.round(Number(seconds) || 0);
  if (!s) return "";
  var m = Math.floor(s / 60);
  return m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
}

function esc_(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function notify_(text) {
  return CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(text)).build();
}

function replace_(card, text) {
  var builder = CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(card));
  if (text) builder.setNotification(CardService.newNotification().setText(text));
  return builder.build();
}
