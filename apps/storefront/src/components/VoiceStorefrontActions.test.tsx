// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const fixtures=vi.hoisted(()=>({apply:vi.fn(),navigate:vi.fn(),catalog:vi.fn()}));
vi.mock('wouter',()=>({useLocation:()=>['/',fixtures.navigate]}));
vi.mock('@/contexts/cart-context',()=>({useCart:()=>({applyVoiceItems:fixtures.apply})}));
vi.mock('@/lib/api',()=>({fetchCatalog:fixtures.catalog,getDiscountedPrice:(_id:string,price:number)=>price}));
import {VoiceStorefrontActions,validCheckoutPath} from './VoiceStorefrontActions';
let root:Root;
const execute=(action:string,payload:Record<string,unknown>,signal=new AbortController().signal)=>window.EarthoraStorefrontActions!.execute({action,payload},signal);
beforeEach(()=>{
  vi.clearAllMocks();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  window.history.replaceState(null,'','/');
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
  const mount=document.createElement('div');document.body.appendChild(mount);root=createRoot(mount);
  fixtures.catalog.mockResolvedValue({products:[{id:'p1',name:'Live name',status:'active',price:9,inventory:[{total_stock:5}],images:[]}],deals:[]});
  act(()=>root.render(<VoiceStorefrontActions/>));
});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('acknowledged storefront actions',()=>{
  it('uses live catalogue details and changes only scoped product IDs',async()=>{
    expect(await execute('sync_cart',{items:[{product_id:'p1',quantity:2}],scope_product_ids:['p1']})).toEqual({ok:true});
    expect(fixtures.apply).toHaveBeenCalledWith([{id:'p1',name:'Live name',quantity:2,price:9,image:'/favicon.svg'}],['p1']);
    expect(await execute('sync_cart',{items:[{product_id:'p1',quantity:0}],scope_product_ids:['p1']})).toEqual({ok:true});
    expect(fixtures.apply).toHaveBeenLastCalledWith([],['p1']);
  });
  it('rejects unknown, out of stock, duplicate and unscoped cart mutations',async()=>{
    for(const items of [[{product_id:'unknown',quantity:2}],[{product_id:'p1',quantity:9}],[{product_id:'p1',quantity:1},{product_id:'p1',quantity:1}]])
      expect((await execute('sync_cart',{items,scope_product_ids:['p1']})).ok).toBe(false);
    expect(fixtures.apply).not.toHaveBeenCalled();
  });
  it('does not execute after cancellation or on a staff page',async()=>{
    const abort=new AbortController();abort.abort();
    expect(await execute('sync_cart',{items:[],scope_product_ids:[]},abort.signal)).toMatchObject({ok:false});
    window.history.replaceState(null,'','/sun-earthora/dashboard');
    expect(await execute('scroll_page',{direction:'down'})).toMatchObject({ok:false});
    expect(fixtures.catalog).not.toHaveBeenCalled();
  });
  it('scrolls a bounded viewport amount and verifies movement',async()=>{
    Object.defineProperty(document.documentElement,'scrollHeight',{configurable:true,value:3000});
    Object.defineProperty(window,'innerHeight',{configurable:true,value:800});
    Object.defineProperty(window,'scrollY',{configurable:true,writable:true,value:0});
    window.scrollTo=vi.fn((options:any)=>{Object.defineProperty(window,'scrollY',{configurable:true,writable:true,value:options.top});});
    expect(await execute('scroll_page',{direction:'down'})).toEqual({ok:true});expect(window.scrollY).toBe(600);
    expect(await execute('scroll_page',{direction:'bottom'})).toEqual({ok:true});expect(window.scrollY).toBe(2200);
    expect(await execute('scroll_page',{direction:'sideways'})).toMatchObject({ok:false});
  });
  it('acknowledges checkout only after successful page load and refuses arbitrary destinations',async()=>{
    const path='/ai-checkout/vc1.'+'a'.repeat(16)+'.'+'b'.repeat(20)+'.'+'c'.repeat(50);
    expect(validCheckoutPath(path)).toBe(true);
    for(const invalid of ['https://evil.test/','/sun-earthora','/ai-checkout/../../evil'])expect(validCheckoutPath(invalid)).toBe(false);
    fixtures.navigate.mockImplementation((next:string)=>window.history.pushState(null,'',next));
    const pending=execute('open_checkout',{path});
    let finished=false;void pending.then(()=>finished=true);await new Promise(resolve=>setTimeout(resolve,5));expect(finished).toBe(false);
    const ready=document.createElement('main');ready.dataset.voiceCheckoutReady='true';document.body.appendChild(ready);
    expect(await pending).toEqual({ok:true});
  });
});
