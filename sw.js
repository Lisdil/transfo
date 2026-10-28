/* Service worker : l'app fonctionne sans réseau (salle de sport) */
const C="transfo-v2";
const SHELL=["./","index.html","config.js","shim.js","import.js","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png","ciqual.json"];
self.addEventListener("install", e=>{ self.skipWaiting(); e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).catch(()=>{})); });
self.addEventListener("activate", e=>e.waitUntil((async()=>{ for (const k of await caches.keys()) if (k!==C) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener("fetch", e=>{
  const r=e.request; if (r.method!=="GET") return;
  const u=new URL(r.url);
  const same=u.origin===self.location.origin;
  const cdn=/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.host);
  if (!same && !cdn) return; // Supabase et Open Food Facts : toujours en direct
  if (same){ // réseau d'abord, cache si hors ligne
    e.respondWith(fetch(r).then(res=>{ if (res.ok){ const cp=res.clone(); caches.open(C).then(c=>c.put(r,cp)); } return res; }).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match("index.html"))));
  } else { // bibliothèques : cache d'abord
    e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{ const cp=res.clone(); caches.open(C).then(c=>c.put(r,cp)); return res; })));
  }
});
