import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('../../config.js',()=>({config:{PUBLIC_STORE_URL:'https://store.example',PII_ENCRYPTION_KEY:'b'.repeat(64)}}));
vi.mock('../../db/client.js',()=>({sql:vi.fn()}));
vi.mock('../../modules/jobs/queue.js',()=>({enqueueJob:vi.fn()}));
vi.mock('../kb/retrieve.js',()=>({retrieve:vi.fn()}));
vi.mock('../kb/ingest.js',()=>({tenantId:vi.fn()}));
vi.mock('../../modules/commerce/pricing.js',()=>({listProducts:vi.fn(),priceCart:vi.fn()}));
import {BUILTIN_MAP,type FunctionContext} from './functions.js';
import {listProducts,priceCart} from '../../modules/commerce/pricing.js';
import {sql} from '../../db/client.js';
const context=():FunctionContext=>({conversationId:'c1',channelType:'voice',contact:{},state:{cart:[],language:'en',checkout:{name:'Synthetic',email:'synthetic@example.invalid',phone:'9876543210',address:'Test road 12',city:'Ahmedabad',state:'Gujarat',zip:'380001',country:'India'}}});
beforeEach(()=>{vi.clearAllMocks();vi.mocked(listProducts).mockResolvedValue([{id:'p1',slug:'product',name:'Product',status:'active',stockQty:3,price:10}] as any);vi.mocked(priceCart).mockResolvedValue({lines:[],total:20,unavailable:[],outOfStock:[]} as any);});
describe('voice purchase preparation',()=>{
  it('checks resulting quantity on repeat add and stock on updates',async()=>{
    const ctx=context();
    expect((await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:2},ctx)).ok).toBe(true);
    expect((await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:2},ctx)).ok).toBe(false);
    expect(ctx.state.cart[0].quantity).toBe(2);
    expect((await BUILTIN_MAP.get('update_cart')!.run({productId:'p1',quantity:4},ctx)).ok).toBe(false);
    expect((await BUILTIN_MAP.get('update_cart')!.run({productId:'p1',quantity:0},ctx)).ok).toBe(true);
    expect(ctx.state.cart).toEqual([]);
  });
  it('creates an actual review link without order, escalation or notification writes',async()=>{
    const ctx=context();await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:2},ctx);
    const result=await BUILTIN_MAP.get('create_checkout_link')!.run({},ctx);
    expect(result).toMatchObject({ok:true,data:{url:expect.stringContaining('/ai-checkout/vc1.'),order_placed:false,payment_required:true,browser_action:{action:'open_checkout'}}});
    expect(sql).not.toHaveBeenCalled();
  });
  it('does not expose browser actions on phone and never records payment details',async()=>{
    const ctx=context();ctx.channelType='calls';await BUILTIN_MAP.get('add_to_cart')!.run({productId:'p1',quantity:1},ctx);
    expect((await BUILTIN_MAP.get('create_checkout_link')!.run({},ctx)).data).not.toHaveProperty('browser_action');
    expect((await BUILTIN_MAP.get('set_customer_detail')!.run({field:'card_number',value:'1234'},ctx)).ok).toBe(false);
    expect(ctx.state.checkout).not.toHaveProperty('card_number');
  });
});
