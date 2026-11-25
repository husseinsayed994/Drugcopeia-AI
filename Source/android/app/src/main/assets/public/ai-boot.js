/* Drugcopeia AI: runs first. Chat-only mode and Arabic as the first language. */
(function(){
  var h=document.documentElement;
  h.classList.add('ai-only');
  /* r199 renamed every storage key from dawaya-* to drugcopeia-ai-*. Copy the plain settings across
     once, but only where the origin belongs to this app alone (native shells and the Windows
     loopback page). On the shared github.io origin the old Drugcopeia app keeps its own data and it
     must never flow into this one. Old keys are left in place; encrypted chat history and the
     model state are not migrated. */
  try{
    var own=/^(capacitor|ionic|file):$/.test(location.protocol)||location.hostname==='127.0.0.1'||location.hostname==='localhost';
    if(own&&!localStorage.getItem('drugcopeia-ai-migrated-v1')){
      ['reminders-v1','reminder-taken-v1','custom-drugs-v1','calc-history','study-stats','theme','language','type-scale','offline-mode','ai-settings-v1'].forEach(function(k){
        var old=localStorage.getItem('dawaya-'+k);
        if(old!==null&&localStorage.getItem('drugcopeia-ai-'+k)===null)localStorage.setItem('drugcopeia-ai-'+k,old);
      });
      localStorage.setItem('drugcopeia-ai-migrated-v1','1');
    }
  }catch(_){}
  try{
    if(!localStorage.getItem('drugcopeia-ai-language'))localStorage.setItem('drugcopeia-ai-language','ar');
    var l=localStorage.getItem('drugcopeia-ai-language');
    h.lang=l==='en'?'en':'ar';h.dir=l==='en'?'ltr':'rtl';
  }catch(_){h.lang='ar';h.dir='rtl'}
})();
