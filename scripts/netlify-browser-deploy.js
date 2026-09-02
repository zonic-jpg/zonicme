
window.__ZM_DEPLOY = async function(token, siteId){
  const base = location.origin;
  const manRes = await fetch(base + '/scripts/netlify-manifest.json', {cache:'no-store'});
  const files = await manRes.json();
  const dr = await fetch('https://api.netlify.com/api/v1/sites/'+siteId+'/deploys', {
    method:'POST', headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body: JSON.stringify({files})
  });
  const deploy = await dr.json();
  if(!dr.ok) return {ok:false, step:'create', deploy, status:dr.status};
  const required = new Set(deploy.required||[]);
  const paths = Object.keys(files);
  let uploaded=0, errors=[];
  for (const path of paths){
    const sha = files[path];
    if(!required.has(sha)) continue;
    const res = await fetch(base + path);
    const buf = await res.arrayBuffer();
    const ur = await fetch('https://api.netlify.com/api/v1/deploys/'+deploy.id+'/files'+path, {
      method:'PUT', headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},
      body: buf
    });
    if(!ur.ok){ errors.push({path, status:ur.status, text: await ur.text()}); }
    else uploaded++;
  }
  // poll
  let final=deploy;
  for(let i=0;i<40;i++){
    const pr = await fetch('https://api.netlify.com/api/v1/deploys/'+deploy.id,{headers:{Authorization:'Bearer '+token}});
    final = await pr.json();
    if(['ready','current','error'].includes(final.state)) break;
    await new Promise(r=>setTimeout(r,1500));
  }
  return {ok: final.state==='ready'||final.state==='current', uploaded, errors, final};
};
