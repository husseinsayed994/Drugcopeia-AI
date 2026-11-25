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
      var v;
      v=localStorage.getItem('dawaya-reminders-v1');if(v!==null&&localStorage.getItem('drugcopeia-ai-reminders-v1')===null)localStorage.setItem('drugcopeia-ai-reminders-v1',v);
      v=localStorage.getItem('dawaya-reminder-taken-v1');if(v!==null&&localStorage.getItem('drugcopeia-ai-reminder-taken-v1')===null)localStorage.setItem('drugcopeia-ai-reminder-taken-v1',v);
      v=localStorage.getItem('dawaya-custom-drugs-v1');if(v!==null&&localStorage.getItem('drugcopeia-ai-custom-drugs-v1')===null)localStorage.setItem('drugcopeia-ai-custom-drugs-v1',v);
      v=localStorage.getItem('dawaya-calc-history');if(v!==null&&localStorage.getItem('drugcopeia-ai-calc-history')===null)localStorage.setItem('drugcopeia-ai-calc-history',v);
      v=localStorage.getItem('dawaya-study-stats');if(v!==null&&localStorage.getItem('drugcopeia-ai-study-stats')===null)localStorage.setItem('drugcopeia-ai-study-stats',v);
      v=localStorage.getItem('dawaya-theme');if(v!==null&&localStorage.getItem('drugcopeia-ai-theme')===null)localStorage.setItem('drugcopeia-ai-theme',v);
      v=localStorage.getItem('dawaya-language');if(v!==null&&localStorage.getItem('drugcopeia-ai-language')===null)localStorage.setItem('drugcopeia-ai-language',v);
      v=localStorage.getItem('dawaya-type-scale');if(v!==null&&localStorage.getItem('drugcopeia-ai-type-scale')===null)localStorage.setItem('drugcopeia-ai-type-scale',v);
      v=localStorage.getItem('dawaya-offline-mode');if(v!==null&&localStorage.getItem('drugcopeia-ai-offline-mode')===null)localStorage.setItem('drugcopeia-ai-offline-mode',v);
      v=localStorage.getItem('dawaya-ai-settings-v1');if(v!==null&&localStorage.getItem('drugcopeia-ai-ai-settings-v1')===null)localStorage.setItem('drugcopeia-ai-ai-settings-v1',v);
      localStorage.setItem('drugcopeia-ai-migrated-v1','1');
    }
  }catch(_){}
  try{
    if(!localStorage.getItem('drugcopeia-ai-language'))localStorage.setItem('drugcopeia-ai-language','ar');
    var l=localStorage.getItem('drugcopeia-ai-language');
    h.lang=l==='en'?'en':'ar';h.dir=l==='en'?'ltr':'rtl';
  }catch(_){h.lang='ar';h.dir='rtl'}
})();
