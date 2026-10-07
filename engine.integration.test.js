'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Market,HORIZON}=require('./engine.js');
const model=JSON.parse(fs.readFileSync(path.join(__dirname,'data/commercial_model.json'),'utf8'));
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,`${a} differs from ${b}`);
function market(){return new Market(20261007,model.assets.map(a=>({ticker:a.ticker,name:a.name,price:a.fair_value_per_unit,dividend:a.expected_annual_payout_per_unit[0],quarterlyDistributions:a.expected_quarterly_payout_per_unit})));}
function noCarry(m){m.rf=0;m.marginRate=0;for(const a of m.assets)a.borrowRate=0;}
function reconcile(m){const s=m.snapshot();near(s.cash,100000+m.ledger.reduce((n,e)=>n+e.amount,0));near(s.equity,s.cash+s.stockValue+s.optionsValue+s.futuresUnrealized);assert.ok(Number.isFinite(s.equity));return s;}

test('commercial data: every quarterly payment matches exact source schedule and terminal cash appears only at quarter twenty',()=>{
  const m=market();noCarry(m);const qty=100;
  for(const a of model.assets)assert.ok(m.order({ticker:a.ticker,side:'buy',qty,type:'market'}).ok);
  let expected=0;
  for(let quarter=0;quarter<20;quarter++){
    const before=m.dividends;m.advance(63);
    const qExpected=qty*model.assets.reduce((n,a)=>n+a.expected_quarterly_payout_per_unit[quarter],0);
    near(m.dividends-before,qExpected);expected+=qExpected;reconcile(m);
    if(quarter===18){
      for(const a of model.assets){
        const paid=m.ledger.filter(e=>e.type==='dividend'&&e.ticker===a.ticker).reduce((n,e)=>n+e.amount,0);
        near(paid,qty*a.expected_quarterly_payout_per_unit.slice(0,19).reduce((n,v)=>n+v,0));
      }
    }
  }
  near(m.dividends,expected);assert.equal(m.ledger.filter(e=>e.type==='dividend').length,120);
  assert.ok(Object.values(m.prices).every(p=>p===0));assert.ok(Object.values(m.positions).every(q=>q===0));
  assert.ok(m.ledger.some(e=>e.type==='claim_expiry'));assert.equal(m.snapshot().positions.length,0);
});
test('commercial shorts owe the same twenty cash payments including final liquidation, with no duplicate principal redemption',()=>{
  const m=market();noCarry(m);const qty=10;
  for(const a of model.assets)assert.ok(m.order({ticker:a.ticker,side:'short',qty,type:'market'}).ok);
  m.advance(HORIZON);const s=reconcile(m);
  near(s.dividends,-qty*model.assets.reduce((n,a)=>n+a.expected_quarterly_payout_per_unit.reduce((x,y)=>x+y,0),0));
  assert.equal(m.marginCalls,0);assert.equal(m.ledger.filter(e=>e.type==='dividend').length,120);
  assert.ok(Object.values(m.positions).every(q=>q===0));assert.equal(s.collateralRequired,0);
});
test('terminal-quarter futures and 100-unit options reconcile premium, fees, variation and final intrinsic cash exactly',()=>{
  const m=market();noCarry(m);m.advance(HORIZON-90);
  const cash=m.cash,K=m.prices.PRIME;
  assert.ok(m.future({ticker:'PRIME',side:'long',qty:10,days:90}).ok);
  assert.ok(m.future({ticker:'PRIME',side:'short',qty:8,days:90}).ok);
  assert.ok(m.option({ticker:'PRIME',type:'call',qty:1,strike:K,days:90}).ok);
  assert.ok(m.option({ticker:'PRIME',type:'put',qty:1,strike:K,days:90}).ok);
  const expected=cash-m.fees-m.options.reduce((n,o)=>n+o.premiumPaid,0)+m.futures.reduce((n,f)=>n-f.sign*f.qty*f.entryPrice,0)+K*100;
  for(let i=0;i<90;i++){m.advance();const s=reconcile(m);near(s.futuresUnrealized,0);}
  near(m.cash,expected);assert.ok(m.futures.every(f=>f.status==='expired'));assert.ok(m.options.every(o=>o.status==='expired'));
  assert.equal(m.snapshot().optionsValue,0);assert.equal(m.snapshot().futuresNotional,0);assert.equal(m.marginCalls,0);
});
test('split preserves actual commercial-quarter cash including the terminal reserve and supports export/reset without aliasing',()=>{
  const m=market();noCarry(m);const source=model.assets.find(a=>a.ticker==='ANCHOR');
  assert.ok(m.order({ticker:'ANCHOR',side:'buy',qty:100,type:'market'}).ok);
  const before=m.snapshot().equity;assert.ok(m.split('ANCHOR',3).ok);near(m.snapshot().equity,before);
  for(let q=0;q<20;q++)near(300*m.dividendOn('ANCHOR',(q+1)*63),100*source.expected_quarterly_payout_per_unit[q]);
  const saved=JSON.parse(JSON.stringify(m.exportState()));saved.assets[2].quarterlyDistributions[19]=999;saved.positionUnits.ANCHOR=999;
  assert.equal(m.positions.ANCHOR,300);assert.notEqual(m._asset('ANCHOR').quarterlyDistributions[19],999);
  m.advance(HORIZON);near(m.dividends,100*source.expected_quarterly_payout_per_unit.reduce((s,d)=>s+d,0));reconcile(m);
  m.reset();near(m.prices.ANCHOR,source.fair_value_per_unit);near(m.dividendOn('ANCHOR',1260),source.expected_quarterly_payout_per_unit[19]);assert.equal(m.cash,100000);assert.equal(m.ledger.length,0);assert.equal(m.day,0);
});
test('material distribution-information marks are separate from cash and reconcile gains/losses for long and short holdings',()=>{
  for(const qty of [100,-100]){
    const m=market();noCarry(m);m.day=HORIZON;m.positions.RISE=qty;m._setPrice('RISE',.01);
    const before=m.snapshot().equity,cash=m.cash,declared=m.dividendOn('RISE',HORIZON);m._payDividends();
    const event=m.ledger.find(e=>e.type==='distribution_information_repricing'&&e.ticker==='RISE');
    assert.ok(event);near(event.amount,0);near(m.cash-cash,qty*declared);near(m.snapshot().equity-before,event.markPnl);
    near(m.prices.RISE,0);near(event.markPnl,qty*(declared-.01));
  }
});
