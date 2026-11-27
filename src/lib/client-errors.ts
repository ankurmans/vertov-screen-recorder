/**
 * Runs in the page head, before the app loads, so a crash during hydration is still reported. At most three reports per page
 * load, each distinct message once, sent with sendBeacon to /api/client-error. It sends the message, the first stack frames and
 * the page path (no query string): nothing typed by the visitor and no identifier.
 */
export const clientErrorScript = `(function(){var sent={},n=0;function send(name,message,stack){try{if(n>=3)return;var key=name+message;if(sent[key])return;sent[key]=1;n++;var body=JSON.stringify({name:String(name||"Error").slice(0,80),message:String(message||"").slice(0,500),stack:String(stack||"").slice(0,1200),path:location.pathname});if(navigator.sendBeacon)navigator.sendBeacon("/api/client-error",new Blob([body],{type:"application/json"}));}catch(e){}}
addEventListener("error",function(e){if(!e.error&&!e.message)return;send(e.error&&e.error.name,e.message||(e.error&&e.error.message),e.error&&e.error.stack||(e.filename+":"+e.lineno));});
addEventListener("unhandledrejection",function(e){var r=e.reason;send(r&&r.name||"UnhandledRejection",r&&r.message||String(r),r&&r.stack);});})();`
