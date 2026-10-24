// Keep navigation out of the keyboard area without disabling page zoom or scrolling.
export function installKeyboardNavigation(win=window,doc=document){
 const root=doc.documentElement,view=win.visualViewport;
 let baseline=win.innerHeight,lastWidth=win.innerWidth,pendingFocus=false,wasOpen=false,focusTimer;
 const editing=()=>{
  const el=doc.activeElement;
  if(!el||el.disabled||el.readOnly)return false;
  if(el.isContentEditable||el.tagName==='TEXTAREA')return true;
  return el.tagName==='INPUT'&&!['checkbox','radio','range','file','color','button','submit','reset','hidden','date','month','week','time','datetime-local'].includes(el.type);
 };
 function sync(){
  if(Math.abs(win.innerWidth-lastWidth)>80){baseline=win.innerHeight;lastWidth=win.innerWidth;}
  const touch=win.matchMedia('(any-pointer: coarse)').matches,narrow=win.innerWidth<=900||touch;
  // Scale compensation prevents a pinch gesture being mistaken for a keyboard.
  const visibleHeight=Math.min(win.innerHeight,view?view.height*view.scale:win.innerHeight);
  const reduced=baseline-visibleHeight>Math.max(140,baseline*.18),focused=editing();
  const open=narrow&&((pendingFocus&&focused&&touch)||(reduced&&(focused||(wasOpen&&touch))));
  root.classList.toggle('keyboard-open',open);
  if(open)root.style.setProperty('--app-viewport-height',Math.round(visibleHeight)+'px');
  else root.style.removeProperty('--app-viewport-height');
  wasOpen=open;
  if(!focused&&!open)baseline=win.innerHeight;
 }
 doc.addEventListener('focusin',()=>{
  win.clearTimeout(focusTimer);pendingFocus=editing();sync();
  // Restore navigation for a hardware keyboard, or when the software keyboard was dismissed.
  focusTimer=win.setTimeout(()=>{pendingFocus=false;sync();},650);
 });
 doc.addEventListener('focusout',()=>win.setTimeout(()=>{pendingFocus=false;sync();},0));
 win.addEventListener('resize',sync);
 view?.addEventListener('resize',sync);view?.addEventListener('scroll',sync);
 sync();return sync;
}
