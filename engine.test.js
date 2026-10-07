'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {Market,blackScholes,optionGreeks,futureFairValue,HORIZON}=require('./engine.js');
const close=(actual,expected,tol=1e-7)=>assert.ok(Math.abs(actual-expected)<=tol,`${actual} differs from ${expected}`);
const noCarry=m=>{m.rf=0;m.marginRate=0;for(const a of m.assets)a.borrowRate=0;};

test('stock trades reconcile cash, signed holdings, spread and explicit fees',()=>{
  const m=new Market();const p=m.prices.RISE;
  const result=m.order({ticker:'RISE',side:'buy',qty:100,type:'market'});assert.ok(result.ok);
  const o=m.orders[0];close(m.cash,100000-100*o.averageFill-100*o.averageFill*m.feeRate);
  close(m.snapshot().equity,100000+100*(p-o.averageFill)-m.fees);
  assert.ok(m.order({ticker:'RISE',side:'sell',qty:100,type:'market'}).ok);
  close(m.cash,100000+m.ledger.reduce((s,l)=>s+l.amount,0));
  close(m.snapshot().equity,m.cash);assert.ok(m.cash<100000);
});
test('short proceeds do not create equity; locates, negative dividends and borrow fees apply',()=>{
  const m=new Market();const r=m.order({ticker:'PRIME',side:'short',qty:100,type:'market'});assert.ok(r.ok);
  assert.ok(m.cash>100000);assert.ok(m.snapshot().equity<100000);
  close(m.snapshot().collateralRequired,1.5*100*m.prices.PRIME);
  assert.equal(m.order({ticker:'REBOUND',side:'short',qty:8000,type:'limit',limit:m.prices.REBOUND*1.02}).ok,false);
  m.advance(63);assert.ok(m.borrowCost>0);assert.ok(m.dividends<0);
  close(m.cash,100000+m.ledger.reduce((s,l)=>s+l.amount,0),1e-6);
});
test('ex-dividend price and signed cash conserve long and short wealth when no price floor binds',()=>{
  for(const qty of [100,-100]){
    const m=new Market();m.positions.PRIME=qty;m.day=63;
    const before=m.snapshot().equity;const stockBefore=m.prices.PRIME;
    m._payDividends();close(m.snapshot().equity,before);close(m.prices.PRIME,stockBefore-2.5);
    close(m.dividends,qty*2.5);
  }
});
test('short-sale cash is restricted from earning risk-free interest',()=>{
  const m=new Market();m.positions.PRIME=-100;m.cash=100000+100*m.prices.PRIME;
  for(const a of m.assets){a.vol=0;a.borrowRate=0;}
  const rf=m.rf;m.advance();
  const restricted=100*m.prices.PRIME;
  close(m.interest,(100000+4600-restricted)*rf/252);
});
test('price process is seeded and read-only snapshots consume no randomness',()=>{
  const a=new Market(53),b=new Market(53),c=new Market(54);
  a.snapshot();a.snapshot();a.advance(90);b.advance(90);c.advance(90);
  assert.deepEqual(a.prices,b.prices);assert.notDeepEqual(a.prices,c.prices);
  assert.deepEqual(a.history,b.history);
});
test('finite market depth causes partial IOC execution, never fabricated full fills',()=>{
  const m=new Market();const total=m.snapshot().orderBook.RISE.asks.reduce((s,l)=>s+l.qty,0);
  const r=m.order({ticker:'RISE',side:'buy',qty:total+100,type:'market'});assert.ok(r.ok);
  assert.equal(r.filled,total);assert.equal(m.positions.RISE,total);assert.equal(r.status,'partially-filled-cancelled');
  assert.equal(m.snapshot().openOrders.length,0);
});
test('limit orders reserve initial margin, are price-collared, and process FIFO',()=>{
  const m=new Market();assert.equal(m.order({ticker:'RISE',side:'buy',qty:1,type:'limit',limit:1000}).ok,false);
  const first=m.order({ticker:'RISE',side:'buy',qty:1000,type:'limit',limit:23});assert.ok(first.ok);assert.equal(first.filled,0);
  const second=m.order({ticker:'RISE',side:'buy',qty:100,type:'limit',limit:23});assert.ok(second.ok);
  assert.ok(m.snapshot().pendingReserve>0);m._setPrice('RISE',22);m._processOrders('RISE');
  assert.equal(m.orders[0].filled,840);assert.equal(m.orders[1].filled,0);
  assert.equal(m.cancel(first.orderId).ok,true);assert.ok(m.snapshot().pendingReserve>0);
});
test('oversized market or resting limits cannot bypass margin or reuse the same collateral',()=>{
  const m=new Market();assert.equal(m.order({ticker:'PRIME',side:'buy',qty:100000,type:'market'}).ok,false);
  assert.ok(m.order({ticker:'PRIME',side:'buy',qty:3900,type:'limit',limit:45}).ok);
  assert.equal(m.order({ticker:'RISE',side:'buy',qty:2000,type:'limit',limit:23}).ok,false);
  assert.equal(m.order({ticker:'PRIME',side:'buy',qty:NaN,type:'market'}).ok,false);
  assert.equal(m.order({ticker:'PRIME',side:'buy',qty:0,type:'market'}).ok,false);
});
test('borrow is reserved by pending shorts, and reducing orders cannot sell unowned units',()=>{
  const m=new Market();m._asset('REBOUND').borrowAvailable=10;
  assert.ok(m.order({ticker:'REBOUND',side:'short',qty:10,type:'limit',limit:12.5}).ok);
  assert.equal(m.order({ticker:'REBOUND',side:'short',qty:1,type:'limit',limit:12.5}).ok,false);
  assert.equal(m.order({ticker:'RISE',side:'sell',qty:1,type:'market'}).ok,false);
  assert.equal(m.order({ticker:'RISE',side:'cover',qty:1,type:'market'}).ok,false);
});
test('futures daily variation and final settlement telescope exactly without principal double counting',()=>{
  for(const side of ['long','short']){
    const m=new Market();noCarry(m);m.feeRate=0;
    const r=m.future({ticker:'RISE',side,qty:100,days:30});assert.ok(r.ok);
    const f=m.futures[0];close(m.cash,100000);
    m.advance();close(m.snapshot().futuresUnrealized,0,1e-8);
    close(m.cash-100000,f.sign*f.qty*(f.settlementPrice-f.entryPrice));
    m.advance(29);assert.equal(f.status,'expired');
    close(m.cash-100000,f.sign*f.qty*(m.prices.RISE-f.entryPrice),1e-6);
    close(m.snapshot().equity,m.cash);close(m.snapshot().futuresNotional,0);
  }
});
test('forward carry deducts scheduled dividends rather than adding income to a long future',()=>{
  const m=new Market(),a=m._asset('PRIME');
  const expected=(m.prices.PRIME-(a.distributions[0]/4)*Math.exp(-m.rf*63/252))*Math.exp(m.rf*90/252);
  close(m.forwardPrice('PRIME',90),expected);
});
test('European option function satisfies dividend-adjusted put-call parity',()=>{
  const S=45,K=42,T=90/252,r=.04,sigma=.3,q=.06;
  const c=blackScholes(S,K,T,r,sigma,q,'call'),p=blackScholes(S,K,T,r,sigma,q,'put');
  close(c-p,S*Math.exp(-q*T)-K*Math.exp(-r*T),1e-10);
  close(blackScholes(45,42,0,r,sigma,q,'call'),3);
  close(blackScholes(0,42,T,r,sigma,q,'put'),42*Math.exp(-r*T));
});
test('long options pay full premium, lose no more than premium and fees, and settle once at expiry',()=>{
  const m=new Market();noCarry(m);m.feeRate=0;
  const r=m.option({ticker:'RISE',type:'call',qty:1,strike:20,days:30});assert.ok(r.ok);
  const o=m.options[0];close(m.cash,100000-o.premiumPaid);
  m.advance(30);assert.equal(o.status,'expired');
  close(m.cash,100000-o.premiumPaid+Math.max(0,m.prices.RISE-20)*100,1e-6);
  assert.ok(m.cash>=100000-o.premiumPaid-1e-8);
  assert.equal(m.closeOption(o.id).ok,false);
  assert.equal(m.option({ticker:'PRIME',type:'put',qty:10000,strike:100,days:30}).ok,false);
});
test('split preserves marked wealth and promised future cash, and rejects open derivatives',()=>{
  const m=new Market();m.order({ticker:'RISE',side:'buy',qty:100,type:'market'});
  const before=m.snapshot().equity,totalIncome=m.positions.RISE*m._asset('RISE').distributions.reduce((a,b)=>a+b,0);
  assert.ok(m.split('RISE',2).ok);close(m.snapshot().equity,before);
  assert.equal(m.positions.RISE,200);close(m.positions.RISE*m._asset('RISE').distributions.reduce((a,b)=>a+b,0),totalIncome);
  m.future({ticker:'RISE',side:'long',qty:1,days:30});assert.equal(m.split('RISE',2).ok,false);
});
test('injury does not cut guaranteed income assumption; rates reprice derivative carry',()=>{
  const m=new Market();const distributions=[...m._asset('RISE').distributions];
  const p=m.prices.RISE;m.shock('injury','RISE');close(m.prices.RISE,p*.7);assert.deepEqual(m._asset('RISE').distributions,distributions);
  const old=m.forwardPrice('PRIME',30);m.shock('ratesUp');assert.ok(m.forwardPrice('PRIME',30)>old);
});
test('maintenance liquidation cancels orders and records an insolvency deficit after an extreme gap',()=>{
  const m=new Market();m.positions.RISE=-8000;m.cash=100000+8000*24;
  m._setPrice('RISE',100);m._checkMaintenance();
  assert.equal(m.positions.RISE,0);assert.equal(m.marginCalls,1);assert.equal(m.insolvent,true);
  close(m.deficit,-m.cash);assert.ok(m.ledger.some(l=>l.type==='liquidation_auction'));
  assert.equal(m.order({ticker:'PRIME',side:'buy',qty:1,type:'market'}).ok,false);
});
test('borrow recall closes short position and removes future locate inventory',()=>{
  const m=new Market();m.order({ticker:'RISE',side:'short',qty:100,type:'market'});
  assert.ok(m.shock('borrowRecall','RISE').ok);assert.equal(m.positions.RISE,0);
  assert.equal(m.order({ticker:'RISE',side:'short',qty:1,type:'market'}).ok,false);
});
test('finite horizon pays scheduled income, expires without redemption and limits derivative tenor',()=>{
  const m=new Market();m.day=HORIZON-1;m.positions.PRIME=1;noCarry(m);
  assert.equal(m.future({ticker:'PRIME',side:'long',qty:1,days:30}).ok,false);
  m.advance();assert.equal(m.day,HORIZON);close(m.prices.PRIME,0);
  close(m.cash,100000+2.5);assert.equal(m.order({ticker:'PRIME',side:'buy',qty:1,type:'market'}).ok,false);
});
test('asset overrides drive actual price and annual distribution schedules',()=>{
  const m=new Market(17,[{ticker:'RISE',price:17,dividend:2,distributions:[2,3,4,5,6]}]);
  close(m.prices.RISE,17);m.day=315;m.positions.RISE=100;const before=m.cash;m._payDividends();close(m.cash-before,75);
});
test('reported option sensitivities agree with finite differences and state their scale',()=>{
  const S=45,K=42,T=90/252,r=.04,sigma=.3,q=.06,eps=1e-4;
  for(const type of ['call','put']){
    const g=optionGreeks(S,K,T,r,sigma,q,type);
    close(g.delta,(blackScholes(S+eps,K,T,r,sigma,q,type)-blackScholes(S-eps,K,T,r,sigma,q,type))/(2*eps),2e-5);
    close(g.vega,.01*(blackScholes(S,K,T,r,sigma+eps,q,type)-blackScholes(S,K,T,r,sigma-eps,q,type))/(2*eps),2e-5);
    close(g.rho,.01*(blackScholes(S,K,T,r+eps,sigma,q,type)-blackScholes(S,K,T,r-eps,sigma,q,type))/(2*eps),2e-5);
    assert.equal(g.units.theta,'per trading day');
  }
});
test('standalone forward helper matches engine dividend carry quote',()=>{
  const m=new Market();close(futureFairValue(46,90,.04,[{day:63,amount:2.5}]),m.forwardPrice('PRIME',90));
});
test('twenty-quarter schedule keeps terminal cash in quarter twenty and forward carry respects exact timing',()=>{
  const schedule=Array(20).fill(.25);schedule[19]=10.25;
  const m=new Market(17,[{ticker:'RISE',quarterlyDistributions:schedule}]);
  close(m._asset('RISE').distributions[4],11);
  close(m.dividendOn('RISE',1134),.25);close(m.dividendOn('RISE',1197),.25);close(m.dividendOn('RISE',1260),10.25);
  close(m.dividendOn('RISE',1259),0);
  m.day=1134;m.positions.RISE=1;const before=m.cash;m._payDividends();close(m.cash-before,.25);
  m.day=1170;const expected=futureFairValue(m.prices.RISE,90,m.rf,[{day:27,amount:.25},{day:90,amount:10.25}]);
  close(m.forwardPrice('RISE',90),expected);
});
test('large realized payout has explicit information repricing followed by exact ex-distribution transfer',()=>{
  const m=new Market();m.day=63;m.positions.RISE=100;m._setPrice('RISE',.1);
  const before=m.snapshot().equity,oldCash=m.cash;m._payDividends();
  const r=m.ledger.find(x=>x.type==='distribution_information_repricing'&&x.ticker==='RISE');
  assert.ok(r);close(r.amount,0);close(m.snapshot().equity-before,r.markPnl);
  close(m.cash-oldCash,95);close(m.prices.RISE,.01);
});
test('commercial growth and injury quote scenarios do not rewrite conditional or protected cash schedules',()=>{
  const schedule=Array(20).fill(1);schedule[19]=15;
  const m=new Market(11,[{ticker:'RISE',quarterlyDistributions:schedule}]);
  m.shock('injury','RISE');m.shock('extension','RISE');assert.deepEqual(m._asset('RISE').quarterlyDistributions,schedule);
});
