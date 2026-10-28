/* Couche de stockage Supabase : reproduit l'API db / assets / downloads utilisée par l'application */
(function(){
  const CFG=window.TRANSFO_CONFIG||{};
  const sb=window.supabase.createClient(CFG.url, CFG.key, {auth:{persistSession:true, autoRefreshToken:true, storageKey:"transfo-auth"}});
  let uid=null, readyRes; const ready=new Promise(r=>readyRes=r);
  const cache={};            // coll -> Map(id -> data)
  const loaded={};           // coll -> Promise
  const listeners={};        // coll -> Set(fn)
  const docListeners={};     // path -> Set(fn)
  const split=p=>{ const a=p.split("/"); return {coll:a.slice(0,-1).join("/"), id:a.at(-1)}; };
  const snapDoc=(id,d)=>({id, exists:d!==undefined, data:()=>d, metadata:{fromCache:false,hasPendingWrites:false}});
  function emit(coll){
    const m=cache[coll]||new Map();
    const docs=[...m.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([id,d])=>snapDoc(id,d));
    (listeners[coll]||[]).forEach(fn=>{ try{ fn({docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{fromCache:false,hasPendingWrites:false}}); }catch(e){ console.error(e); } });
    for (const [p,set] of Object.entries(docListeners)){ const s=split(p); if (s.coll!==coll) continue; set.forEach(fn=>{ try{ fn(snapDoc(s.id, m.get(s.id))); }catch(e){ console.error(e); } }); }
  }
  async function fetchColl(coll){
    const m=new Map(); let from=0;
    for(;;){ const {data,error}=await sb.from("docs").select("path,data").eq("coll",coll).range(from,from+999); if (error) throw error;
      for (const r of data) m.set(split(r.path).id, r.data); if (data.length<1000) break; from+=1000; }
    cache[coll]=m; emit(coll); return m;
  }
  const load=coll=> loaded[coll] ||= fetchColl(coll).catch(e=>{ delete loaded[coll]; throw e; });
  document.addEventListener("visibilitychange", ()=>{ if (document.visibilityState==="visible" && uid) for (const c of Object.keys(loaded)) fetchColl(c).catch(()=>{}); });
  const isObj=o=>o&&typeof o==="object"&&!Array.isArray(o);
  const merge=(a,b)=>{ const o={...a}; for (const k in b){ o[k]= isObj(b[k])&&isObj(a?.[k]) ? merge(a[k],b[k]) : b[k]; } return o; };
  function docRef(path){
    const {coll,id}=split(path);
    return { id, path,
      async get(){ await load(coll); return snapDoc(id, cache[coll].get(id)); },
      async set(data){ (cache[coll] ||= new Map()).set(id, JSON.parse(JSON.stringify(data))); emit(coll);
        const {error}=await sb.from("docs").upsert({path, coll, data, updated_at:new Date().toISOString()}); if (error) throw {code:"unavailable",message:error.message}; },
      async update(data){ await load(coll); const cur=cache[coll].get(id); if (cur===undefined) throw {code:"invalid_argument",message:"absent"}; return this.set(merge(cur,data)); },
      async delete(){ cache[coll]?.delete(id); emit(coll); const {error}=await sb.from("docs").delete().eq("path",path); if (error) throw {code:"unavailable",message:error.message}; },
      onSnapshot(next, err){ (docListeners[path] ||= new Set()).add(next); load(coll).then(()=>next(snapDoc(id, cache[coll].get(id)))).catch(e=>err&&err({code:"unavailable",message:String(e?.message||e)})); return ()=>docListeners[path].delete(next); },
      collection(sub){ return collRef(path+"/"+sub); } };
  }
  function collRef(coll){
    return { path:coll,
      doc(id){ return docRef(coll+"/"+(id||crypto.randomUUID().replace(/-/g,"").slice(0,20))); },
      async add(d){ const r=this.doc(); await r.set(d); return r; },
      async get(){ await load(coll); const docs=[...cache[coll].entries()].map(([id,d])=>snapDoc(id,d)); return {docs,size:docs.length,empty:!docs.length}; },
      onSnapshot(next, err){ (listeners[coll] ||= new Set()).add(next); if (cache[coll]) emit(coll); load(coll).catch(e=>err&&err({code:"unavailable",message:String(e?.message||e)})); return ()=>listeners[coll].delete(next); } };
  }
  const db={ doc:docRef, collection:collRef };

  // Photos : stockage privé, liens signés gardés 6 jours pour profiter du cache du navigateur
  const URLKEY="transfo-urls"; let urls={}; try{ urls=JSON.parse(localStorage.getItem(URLKEY)||"{}"); }catch{}
  const keep=()=>{ try{ localStorage.setItem(URLKEY, JSON.stringify(urls)); }catch{} };
  const pathOf=id=>`${uid}/${id}.jpg`;
  window.__blobs={
    url:id=> urls[id]&&urls[id].exp>Date.now() ? urls[id].url : null,
    async prep(ids){ const need=[...new Set(ids)].filter(id=>id && !(urls[id]&&urls[id].exp>Date.now()+864e5));
      for (let i=0;i<need.length;i+=200){ const part=need.slice(i,i+200);
        const {data,error}=await sb.storage.from("photos").createSignedUrls(part.map(pathOf), 7*86400); if (error) break;
        data.forEach((d,j)=>{ if (d.signedUrl) urls[part[j]]={url:d.signedUrl, exp:Date.now()+6*864e5}; }); }
      keep(); }
  };
  const assets={
    async upload(blob,opt){ const id=crypto.randomUUID().replace(/-/g,"");
      const {error}=await sb.storage.from("photos").upload(pathOf(id), blob, {contentType:opt?.type||blob.type||"image/jpeg", cacheControl:"31536000", upsert:false});
      if (error) throw {code:/size|large/i.test(error.message)?"too_large":"upstream_error", message:error.message};
      await window.__blobs.prep([id]); return {id, url:window.__blobs.url(id), sizeBytes:blob.size, contentType:"image/jpeg"}; },
    async list(){ let files=[], off=0; for(;;){ const {data,error}=await sb.storage.from("photos").list(uid,{limit:1000,offset:off}); if (error) throw error; files=files.concat(data); if (data.length<1000) break; off+=1000; }
      const bytes=files.reduce((a,f)=>a+(f.metadata?.size||0),0);
      return {assets:files.map(f=>({id:f.name.replace(/\.jpg$/,""),url:"",contentType:"image/jpeg",sizeBytes:f.metadata?.size||0,createdAt:f.created_at})), usage:{files:files.length,bytes,maxFiles:100000,maxBytes:1024*1048576}}; },
    async delete(id){ const {error}=await sb.storage.from("photos").remove([pathOf(id)]); if (error) throw {code:"upstream_error",message:error.message}; delete urls[id]; keep(); return {deleted:true}; }
  };
  const downloads={ async save({filename,data}){ const b=data instanceof Blob?data:new Blob([data],{type:"text/plain;charset=utf-8"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=filename; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u),4000); return {saved:true}; } };

  const caps={db, assets, downloads};
  window.claude={ use:name=>ready.then(()=>caps[name]||null) };
  window.transfoAuth={ sb, signOut:async()=>{ await sb.auth.signOut(); try{ localStorage.removeItem(URLKEY); }catch{} location.reload(); } };

  // Écran de connexion
  async function boot(){
    const {data:{session}}=await sb.auth.getSession();
    if (session){ uid=session.user.id; document.documentElement.classList.remove("needs-login"); readyRes(); return; }
    document.documentElement.classList.add("needs-login");
    const f=document.getElementById("loginForm");
    f.addEventListener("submit", async e=>{ e.preventDefault(); const msg=document.getElementById("loginMsg"); msg.textContent="Connexion…";
      const {data,error}=await sb.auth.signInWithPassword({email:document.getElementById("lgEmail").value.trim(), password:document.getElementById("lgPass").value});
      if (error){ msg.textContent="Email ou mot de passe incorrect."; return; }
      uid=data.user.id; document.documentElement.classList.remove("needs-login"); readyRes(); });
  }
  boot();
})();
