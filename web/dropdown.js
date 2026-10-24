const chevron='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>';
let activePicker=null;
function copy(label){
 const parts=label.split(' · '),box=document.createElement('span'),title=document.createElement('span');
 box.className='select-copy';title.className='select-title';title.textContent=parts.shift();box.append(title);
 if(parts.length){const sub=document.createElement('span');sub.className='select-meta';sub.textContent=parts.join(' · ');box.append(sub);}
 return box;
}
function sync(select){
 const menu=select.nextElementSibling;if(!menu?.classList.contains('select-menu'))return;
 const summary=menu.querySelector('summary');summary.replaceChildren(copy(select.selectedOptions[0]?.textContent||'请选择'));summary.insertAdjacentHTML('beforeend',chevron);
 const list=menu.querySelector('.select-options')||(activePicker?.menu===menu?activePicker.list:null);
 list?.querySelectorAll('[role=option]').forEach(button=>{const selected=button.dataset.value===select.value;button.setAttribute('aria-selected',String(selected));button.classList.toggle('is-selected',selected);});
}
export function syncDropdowns(root=document){root.querySelectorAll('select.select-source').forEach(sync);}
export function enhanceDropdowns(root=document){
 root.querySelectorAll('select:not(.select-source)').forEach(select=>{
  const menu=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('div');
  const title=select.closest('.field')?.querySelector('span')?.textContent||select.getAttribute('aria-label')||'内容';
  menu.className='select-menu';list.className='select-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',title);
  if(select.options.length&&[...select.options].every(option=>option.value.split('/').every(value=>/^\d{4}-\d{2}-\d{2}$/.test(value))))menu.classList.add('select-date');
  let search,searchWrap,empty,picker,updateViewport;
  function filter(){
   const keyword=search?.value.trim().toLowerCase()||'';let found=0;
   list.querySelectorAll('[role=option]').forEach(button=>{button.hidden=!button.textContent.toLowerCase().includes(keyword);if(!button.hidden&&!button.disabled)found++;});
   if(empty)empty.hidden=found>0;list.scrollTop=0;
  }
  function closePicker(){
   if(!picker)return;const previous=picker;picker=null;
   window.visualViewport?.removeEventListener('resize',updateViewport);window.visualViewport?.removeEventListener('scroll',updateViewport);
   if(searchWrap)list.prepend(searchWrap);menu.append(list);
   if(previous.open)previous.close();previous.remove();if(activePicker?.dialog===previous)activePicker=null;
  }
  function closeDropdown(){menu.open=false;summary.setAttribute('aria-expanded','false');closePicker();if(summary.isConnected)summary.focus({preventScroll:true});}
  function scrollToSelected(){
   const chosen=list.querySelector('[aria-selected=true]:not(:disabled)');
   if(chosen&&!chosen.hidden)list.scrollTop=Math.max(0,chosen.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop-12);
  }
  function keys(event){
   const buttons=[...list.querySelectorAll('[role=option]:not(:disabled):not([hidden])')],index=buttons.indexOf(document.activeElement);
   if(event.key==='Escape'){event.preventDefault();closeDropdown();}
   else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)&&!(event.target.matches('input')&&['Home','End'].includes(event.key))){
    event.preventDefault();menu.open=true;
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.max(0,Math.min(buttons.length-1,index+(event.key==='ArrowDown'?1:-1)));buttons[next]?.focus();
   }
  }
  if(select.dataset.search==='true'){
   search=document.createElement('input');search.type='search';search.className='select-search';search.placeholder=select.dataset.searchPlaceholder||'输入名称或规格查找';search.setAttribute('aria-label','搜索选项');
   searchWrap=document.createElement('div');searchWrap.className='select-search-wrap';searchWrap.append(search);
   empty=document.createElement('p');empty.className='select-empty small';empty.textContent='没有找到匹配内容';empty.hidden=true;
   list.append(searchWrap,empty);search.addEventListener('input',filter);
  }
  for(const option of select.options){
   const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.dataset.value=option.value;button.disabled=option.disabled;button.append(copy(option.textContent));
   const check=document.createElement('span');check.className='select-check';check.textContent='✓';check.setAttribute('aria-hidden','true');button.append(check);
   button.addEventListener('click',event=>{event.preventDefault();select.value=option.value;sync(select);closeDropdown();select.dispatchEvent(new Event('change',{bubbles:true}));});
   list.append(button);
  }
  select.classList.add('select-source');select.setAttribute('aria-hidden','true');select.tabIndex=-1;select.after(menu);menu.append(summary,list);sync(select);
  menu.addEventListener('toggle',()=>{
   summary.setAttribute('aria-expanded',String(menu.open));if(!menu.open){closePicker();return;}
   if(activePicker&&activePicker.menu!==menu)activePicker.close();
   document.querySelectorAll('.select-menu[open]').forEach(other=>{if(other!==menu)other.open=false;});
   if(search)search.value='';filter();
   if(search&&window.matchMedia('(max-width:700px)').matches){
    picker=document.createElement('dialog');picker.className='select-picker';picker.setAttribute('aria-label','选择'+title);
    const header=document.createElement('div'),row=document.createElement('div'),heading=document.createElement('h2'),cancel=document.createElement('button');
    header.className='select-picker-header';row.className='select-picker-heading';heading.textContent='选择'+title;cancel.type='button';cancel.className='select-picker-close';cancel.textContent='关闭';cancel.setAttribute('aria-label','关闭选择');cancel.addEventListener('click',closeDropdown);
    row.append(heading,cancel);header.append(row,searchWrap);picker.append(header,list);document.body.append(picker);
    activePicker={menu,dialog:picker,list,close:closeDropdown};picker.addEventListener('keydown',keys);
    picker.addEventListener('cancel',event=>{event.preventDefault();closeDropdown();});
    const current=picker;picker.addEventListener('close',()=>{if(picker===current)closeDropdown();});
    picker.addEventListener('click',event=>{if(event.target!==current)return;const r=current.getBoundingClientRect();if(event.clientY<r.top||event.clientY>r.bottom||event.clientX<r.left||event.clientX>r.right)closeDropdown();});
    updateViewport=()=>{if(!picker)return;const view=window.visualViewport;picker.style.setProperty('--picker-max-height',Math.max(160,(view?.height||innerHeight)-12)+'px');picker.style.setProperty('--picker-bottom',Math.max(0,innerHeight-(view?view.height+view.offsetTop:innerHeight))+'px');};
    updateViewport();window.visualViewport?.addEventListener('resize',updateViewport);window.visualViewport?.addEventListener('scroll',updateViewport);
    picker.showModal();cancel.focus({preventScroll:true});scrollToSelected();
   }else{
    const rect=summary.getBoundingClientRect(),dialog=menu.closest('dialog'),bounds=dialog?.getBoundingClientRect(),nav=document.querySelector('.nav'),navHeight=nav&&!dialog?Math.max(0,innerHeight-nav.getBoundingClientRect().top):0;
    const below=Math.min(innerHeight-navHeight-12,bounds?bounds.bottom-20:innerHeight)-rect.bottom-8,above=rect.top-Math.max(12,bounds?bounds.top+20:12)-8,up=below<200&&above>below;
    menu.classList.toggle('opens-up',up);menu.style.setProperty('--dropdown-height',Math.max(120,Math.min(340,up?above:below))+'px');scrollToSelected();
   }
  });
  menu.addEventListener('keydown',keys);
  select.addEventListener('invalid',event=>{event.preventDefault();summary.setAttribute('aria-invalid','true');menu.open=true;summary.focus();});
  select.addEventListener('change',()=>{summary.removeAttribute('aria-invalid');sync(select);});
 });
}
document.addEventListener('click',event=>document.querySelectorAll('.select-menu[open]').forEach(menu=>{if(!menu.contains(event.target)&&!(activePicker?.menu===menu&&activePicker.dialog.contains(event.target)))menu.open=false;}));
