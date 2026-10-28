/* Import des données exportées depuis la version Claude */
(function(){
  const $=s=>document.querySelector(s);
  $("#impOpen").onclick=()=>{ $("#impPanel").hidden=false; $("#impPanel").scrollIntoView({behavior:"smooth"}); };
  $("#impFile").addEventListener("change", async e=>{
    const f=e.target.files[0]; if (!f) return; const out=$("#impLog"); const log=t=>{ out.textContent=t; };
    let data; try{ data=JSON.parse(await f.text()); }catch{ return log("Fichier illisible."); }
    const db=await window.claude.use("db"), assets=await window.claude.use("assets");
    const docs=data.docs||[], files=Object.fromEntries((data.photos||[]).map(p=>[p.name,p.b64]));
    let n=0, ph=0;
    for (const d of docs){
      const body={...d.data};
      if (d.path.startsWith("photos/") && body.importFile){
        const b64=files[body.importFile]; delete body.importFile;
        if (!b64) continue;
        const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
        const up=await assets.upload(new Blob([bin],{type:"image/jpeg"}),{type:"image/jpeg"});
        body.asset=up.id; ph++;
      }
      await db.doc(d.path).set(body); n++;
      log(`Import en cours : ${n} / ${docs.length} éléments (${ph} photos)…`);
    }
    log(`Import terminé : ${n} éléments, dont ${ph} photos. Tu peux recharger l'application.`);
  });
  $("#logout").onclick=()=>window.transfoAuth.signOut();
})();
