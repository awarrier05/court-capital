/* Court Capital: deterministic educational paper-market accounting.
 * Fictional, finite-horizon commercial-business equity; not NBA salary rights.
 * T+0, 252-day years, house margins, and liquidity are teaching assumptions.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CourtEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const YEAR = 252, HORIZON = 1260, OPTION_MULTIPLIER = 100;
  const BASE = [
    {ticker:'RISE',name:'Emerging scorer',price:24,dividend:3.8,vol:.42,borrowRate:.085,borrowAvailable:9000,floatShares:100000},
    {ticker:'PRIME',name:'Prime creator',price:46,dividend:10.0,vol:.24,borrowRate:.025,borrowAvailable:16000,floatShares:100000},
    {ticker:'ANCHOR',name:'Defensive anchor',price:32,dividend:7.0,vol:.22,borrowRate:.03,borrowAvailable:15000,floatShares:100000},
    {ticker:'ROLE',name:'Rotation specialist',price:16,dividend:3.4,vol:.30,borrowRate:.055,borrowAvailable:12000,floatShares:100000},
    {ticker:'VET',name:'Veteran contributor',price:21,dividend:5.2,vol:.29,borrowRate:.045,borrowAvailable:11000,floatShares:100000},
    {ticker:'REBOUND',name:'Recovery prospect',price:12,dividend:2.0,vol:.55,borrowRate:.14,borrowAvailable:7000,floatShares:100000}
  ];
  const clone = x => JSON.parse(JSON.stringify(x));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const positiveInt = x => finite(x) && Number.isSafeInteger(x) && x > 0;
  const clamp = (x,a,b) => Math.min(b,Math.max(a,x));
  function normalCDF(x) {
    const t = 1/(1+.2316419*Math.abs(x));
    const poly = t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
    const p = 1-.3989422804014327*Math.exp(-x*x/2)*poly;
    return x >= 0 ? p : 1-p;
  }
  function blackScholes(S,K,T,r,sigma,q=0,type='call') {
    if (![S,K,T,r,sigma,q].every(finite) || S < 0 || K <= 0 || T < 0 || sigma < 0) throw new Error('Invalid option inputs');
    if (!['call','put'].includes(type)) throw new Error('Invalid option type');
    if (T === 0) return Math.max(type === 'call' ? S-K : K-S,0);
    if (S === 0) return type === 'put' ? K*Math.exp(-r*T) : 0;
    if (sigma === 0) return Math.max(type === 'call' ? S*Math.exp(-q*T)-K*Math.exp(-r*T) : K*Math.exp(-r*T)-S*Math.exp(-q*T),0);
    const d1 = (Math.log(S/K)+(r-q+.5*sigma*sigma)*T)/(sigma*Math.sqrt(T));
    const d2 = d1-sigma*Math.sqrt(T);
    const c = S*Math.exp(-q*T)*normalCDF(d1)-K*Math.exp(-r*T)*normalCDF(d2);
    return Math.max(0,type === 'call' ? c : c-S*Math.exp(-q*T)+K*Math.exp(-r*T));
  }
  function optionGreeks(S,K,T,r,sigma,q=0,type='call') {
    const value=blackScholes(S,K,T,r,sigma,q,type);
    if(S<=0||T<=0||sigma<=0)return {value,delta:type==='call'?(S>K?1:0):(S<K?-1:0),gamma:0,vega:0,theta:0,rho:0};
    const sqrtT=Math.sqrt(T),d1=(Math.log(S/K)+(r-q+.5*sigma*sigma)*T)/(sigma*sqrtT),d2=d1-sigma*sqrtT;
    const density=Math.exp(-.5*d1*d1)/Math.sqrt(2*Math.PI),sq=S*Math.exp(-q*T),kr=K*Math.exp(-r*T);
    const call=type==='call';
    return {value,delta:Math.exp(-q*T)*(call?normalCDF(d1):normalCDF(d1)-1),
      gamma:Math.exp(-q*T)*density/(S*sigma*sqrtT),
      vega:.01*sq*density*sqrtT,
      theta:(-sq*density*sigma/(2*sqrtT)+(call?q*sq*normalCDF(d1)-r*kr*normalCDF(d2):-q*sq*normalCDF(-d1)+r*kr*normalCDF(-d2)))/YEAR,
      rho:.01*(call?T*kr*normalCDF(d2):-T*kr*normalCDF(-d2)),
      units:{delta:'per unit spot change',gamma:'delta per unit spot change',vega:'per 1 percentage point volatility',theta:'per trading day',rho:'per 1 percentage point rate'}};
  }
  function futureFairValue(spot,days,rate,dividends=[]) {
    if(!finite(spot)||spot<0||!finite(days)||days<0||!finite(rate))throw new Error('Invalid forward inputs');
    let pv=0;
    for(const d of dividends) {
      if(!finite(d.day)||!finite(d.amount)||d.amount<0)throw new Error('Invalid distribution schedule');
      if(d.day>0&&d.day<=days)pv+=d.amount*Math.exp(-rate*d.day/YEAR);
    }
    return Math.max(0,(spot-pv)*Math.exp(rate*days/YEAR));
  }
  class Market {
    constructor(seed=20261007, overrides) {
      this.seed = Number.isFinite(Number(seed)) ? Number(seed)>>>0 : 20261007;
      const input = Array.isArray(overrides) ? overrides : (overrides && overrides.assets) || [];
      this._originalAssets = BASE.map(a => {
        const supplied = input.find(x=>x.ticker===a.ticker) || {};
        const out = {...a,...clone(supplied)};
        if (!finite(out.price) || out.price<=0 || !finite(out.dividend) || out.dividend<0 || !finite(out.vol) || out.vol<0) throw new Error('Invalid asset assumptions');
        if (!positiveInt(out.floatShares) || !finite(out.borrowAvailable) || out.borrowAvailable<0 || !finite(out.borrowRate) || out.borrowRate<0) throw new Error('Invalid supply assumptions');
        if (out.distributions && (!Array.isArray(out.distributions)||out.distributions.length!==5 || out.distributions.some(x=>!finite(x)||x<0))) throw new Error('Distributions must contain five nonnegative annual per-unit values');
        out.distributions = out.distributions || Array(5).fill(out.dividend);
        if(out.quarterlyDistributions&&(!Array.isArray(out.quarterlyDistributions)||out.quarterlyDistributions.length!==20||out.quarterlyDistributions.some(x=>!finite(x)||x<0)))throw new Error('Quarterly distributions must contain twenty nonnegative per-unit values');
        out.quarterlyDistributions=out.quarterlyDistributions||out.distributions.flatMap(d=>Array(4).fill(d/4));
        out.distributions=Array.from({length:5},(_,y)=>out.quarterlyDistributions.slice(y*4,y*4+4).reduce((s,d)=>s+d,0));
        out.dividend=out.distributions[0];
        out.spread = finite(out.spread) && out.spread>=0 ? out.spread : .004;
        out.dailyDepth = positiveInt(out.dailyDepth) ? out.dailyDepth : 120;
        return out;
      });
      this.reset();
    }
    reset() {
      this._rng = this.seed || 1;
      this._sequence = 0;
      this._ledgerSequence = 0;
      this.day=0; this.cash=100000; this.initialCash=100000;
      this.rf=.04; this.marginRate=.10; this.feeRate=.001;
      this.assets=clone(this._originalAssets);
      this.positions={}; this.prices={}; this.initialPrices={}; this.averagePrices={};
      for (const a of this.assets) {
        this.positions[a.ticker]=0; this.prices[a.ticker]=a.price;
        this.initialPrices[a.ticker]=a.price; this.averagePrices[a.ticker]=0;
      }
      this.orders=[]; this.ledger=[]; this.futures=[]; this.options=[]; this.history=[];
      this.fees=0; this.borrowCost=0; this.interest=0; this.dividends=0;
      this.marginCalls=0; this.insolvent=false; this.deficit=0; this.liquidityFactor=1; this._liquidating=false;
      this._resetDepth(); this._recordHistory();
      return {ok:true,message:'Paper account reset to $100,000.'};
    }
    _id(prefix) { return prefix+(++this._sequence); }
    _asset(ticker) { return this.assets.find(a=>a.ticker===ticker); }
    _uniform() {
      let x=this._rng;
      x^=x<<13; x^=x>>>17; x^=x<<5;
      this._rng=x>>>0;
      return (this._rng+.5)/4294967296;
    }
    _normal() { return Math.sqrt(-2*Math.log(this._uniform()))*Math.cos(2*Math.PI*this._uniform()); }
    _log(type,amount,description,extra={}) {
      this.ledger.push({id:++this._ledgerSequence,day:this.day,type,amount,description,cashAfter:this.cash,...extra});
    }
    _cash(amount,type,description,extra={}) {
      this.cash+=amount;
      this._log(type,amount,description,extra);
    }
    _fee(amount,description,extra={}) {
      if (amount<=0) return;
      this.fees+=amount; this._cash(-amount,'fee',description,extra);
    }
    _setPrice(ticker,price) {
      this.prices[ticker]=Math.max(0,price);
      this._asset(ticker).price=this.prices[ticker];
    }
    _annualDistribution(a,day=this.day) {
      return day>=HORIZON ? 0 : a.distributions[Math.min(4,Math.floor(day/YEAR))];
    }
    _dividendAt(a,paymentDay) {
      return a.quarterlyDistributions[Math.min(19,Math.floor((paymentDay-1)/63))];
    }
    dividendOn(ticker,paymentDay) {
      const a=this._asset(ticker);
      if(!a||!positiveInt(paymentDay)||paymentDay>HORIZON||paymentDay%63!==0)return 0;
      return this._dividendAt(a,paymentDay);
    }
    _forwardPrice(ticker,expiry) {
      const a=this._asset(ticker), remaining=Math.max(0,expiry-this.day), T=remaining/YEAR;
      if (remaining===0) return this.prices[ticker];
      let pv=0;
      for (let d=(Math.floor(this.day/63)+1)*63;d<=Math.min(expiry,HORIZON);d+=63) pv+=this._dividendAt(a,d)*Math.exp(-this.rf*(d-this.day)/YEAR);
      // A zero floor makes the teaching model explicit at inconsistent price/dividend extremes.
      return Math.max(0,(this.prices[ticker]-pv)*Math.exp(this.rf*T));
    }
    forwardPrice(ticker,days) {
      if (!this._asset(ticker) || !finite(days) || days<0 || this.day+days>HORIZON) return NaN;
      return this._forwardPrice(ticker,this.day+days);
    }
    _optionMark(o) {
      const a=this._asset(o.ticker), S=this.prices[o.ticker], T=Math.max(0,o.expiry-this.day)/YEAR;
      const q=S>0 ? this._annualDistribution(a)/S : 0;
      return blackScholes(S,o.strike,T,this.rf,a.vol,q,o.type);
    }
    _activeOrders() { return this.orders.filter(o=>o.status==='open'||o.status==='partially-filled'); }
    _pendingReserve(excludeId) {
      return this._activeOrders().filter(o=>o.id!==excludeId).reduce((n,o)=>n+this._orderReserve(o,o.remaining),0);
    }
    _orderReserve(o,qty) {
      return ['buy','short'].includes(o.side) ? qty*Math.max(this.prices[o.ticker],o.limit||this.prices[o.ticker])*(.5+this.feeRate) : 0;
    }
    _borrowRemaining(ticker,excludeId) {
      const a=this._asset(ticker);
      const reserved=this._activeOrders().filter(o=>o.id!==excludeId&&o.ticker===ticker&&o.side==='short').reduce((n,o)=>n+o.remaining,0);
      return Math.max(0,Math.floor(a.borrowAvailable)-Math.max(0,-this.positions[ticker])-reserved);
    }
    _metrics(positions=this.positions,cash=this.cash) {
      let stockValue=0,stockGross=0,shortValue=0;
      for (const a of this.assets) {
        const v=positions[a.ticker]*this.prices[a.ticker];
        stockValue+=v; stockGross+=Math.abs(v); if(v<0)shortValue-=v;
      }
      const activeFutures=this.futures.filter(f=>f.status==='open');
      const futuresUnrealized=activeFutures.reduce((s,f)=>s+f.sign*f.qty*(this._forwardPrice(f.ticker,f.expiry)-f.settlementPrice),0);
      const futuresNotional=activeFutures.reduce((s,f)=>s+f.qty*this.prices[f.ticker],0);
      const optionsValue=this.options.filter(o=>o.status==='open').reduce((s,o)=>s+this._optionMark(o)*o.qty*o.multiplier,0);
      const equity=cash+stockValue+optionsValue+futuresUnrealized;
      return {cash,stockValue,stockGross,shortValue,optionsValue,futuresUnrealized,futuresNotional,equity,
        grossExposure:stockGross+futuresNotional+optionsValue,
        initialRequired:.5*stockGross+.10*futuresNotional+optionsValue,
        maintenanceRequired:.3*stockGross+.075*futuresNotional+optionsValue,
        collateralRequired:1.5*shortValue+.10*futuresNotional};
    }
    _resetDepth() {
      this._depth={};
      for(const a of this.assets) {
        const levels=[1,2,4].map(k=>Math.max(1,Math.floor(k*a.dailyDepth/this.liquidityFactor)));
        this._depth[a.ticker]={buy:[...levels],sell:[...levels]};
      }
    }
    _book(ticker) {
      const a=this._asset(ticker), p=this.prices[ticker];
      const s=Math.min(.12,a.spread*this.liquidityFactor);
      const bids=[],asks=[];
      for(let level=0;level<3;level++) {
        const offset=Math.min(.099,s/2+level*.0015*this.liquidityFactor);
        bids.push({price:p*(1-offset),qty:this.day>=HORIZON?0:this._depth[ticker].sell[level],level});
        asks.push({price:p*(1+offset),qty:this.day>=HORIZON?0:this._depth[ticker].buy[level],level});
      }
      return {mid:p,bid:bids[0].price,ask:asks[0].price,spread:asks[0].price-bids[0].price,bids,asks,
        collarLow:.9*p,collarHigh:1.1*p,borrowRemaining:this._borrowRemaining(ticker)};
    }
    snapshot() {
      const m=this._metrics(), pendingReserve=this._pendingReserve();
      const rows=this.assets.filter(a=>this.positions[a.ticker]!==0).map(a=>({ticker:a.ticker,name:a.name,qty:this.positions[a.ticker],side:this.positions[a.ticker]>0?'long':'short',price:this.prices[a.ticker],value:this.positions[a.ticker]*this.prices[a.ticker],averagePrice:this.averagePrices[a.ticker],unrealizedPnl:this.positions[a.ticker]*(this.prices[a.ticker]-this.averagePrices[a.ticker]),borrowRate:a.borrowRate}));
      return {day:this.day,horizon:HORIZON,seed:this.seed,rf:this.rf,marginRate:this.marginRate,feeRate:this.feeRate,
        ...m,pendingReserve,availableBuyingPower:Math.max(0,(m.equity-m.initialRequired-pendingReserve)/.5),
        availableCash:Math.max(0,this.cash-m.collateralRequired-pendingReserve),pnl:m.equity-this.initialCash,
        fees:this.fees,borrowCost:this.borrowCost,interest:this.interest,dividends:this.dividends,
        insolvent:this.insolvent,deficit:Math.max(0,-m.equity),marginCalls:this.marginCalls,
        positions:rows,prices:{...this.prices},initialPrices:{...this.initialPrices},
        assets:this.assets.map(a=>({...clone(a),dividend:this._annualDistribution(a),borrowRemaining:this._borrowRemaining(a.ticker)})),
        orders:clone(this.orders),openOrders:clone(this._activeOrders()),ledger:clone(this.ledger),
        futures:this.futures.map(f=>({...f,mark:this._forwardPrice(f.ticker,f.expiry),unrealized:f.status==='open'?f.sign*f.qty*(this._forwardPrice(f.ticker,f.expiry)-f.settlementPrice):0})),
        options:this.options.map(o=>({...o,mark:this._optionMark(o),value:o.status==='open'?this._optionMark(o)*o.qty*o.multiplier:0})),
        orderBook:Object.fromEntries(this.assets.map(a=>[a.ticker,this._book(a.ticker)])),history:clone(this.history),
        assumptions:{settlement:'T+0 simulation',stockInitial:.5,stockMaintenance:.3,futuresInitial:.10,futuresMaintenance:.075,optionMultiplier:OPTION_MULTIPLIER,yearDays:YEAR,incomeHorizonDays:HORIZON,liquidation:'Stylized auction with adverse spread and size impact; no guaranteed real-world liquidity',futuresCarry:'Discrete conditional quarterly cash distributions; nonnegative forward-price floor',optionPricing:'European Black-Scholes approximation with continuous current distribution yield',shortInterest:'Restricted short proceeds earn no cash interest',distributionRealization:'Expected quarterly cash becomes realized cash in the scenario. If needed, a separately logged information repricing first lifts the cum-distribution mark to cover declared cash; subsequent cash transfer is wealth-neutral. Not an arbitrage-free joint pricing model.',corporateShocks:'Injury and commercial-growth shocks affect quotes only; they do not amend protected sponsor terms or the chosen quarterly cash scenario.'}
      };
    }
    _recordHistory() {
      const m=this._metrics();
      const point={day:this.day,equity:m.equity,cash:this.cash,prices:{...this.prices},rf:this.rf};
      if(this.history.length&&this.history[this.history.length-1].day===this.day)this.history[this.history.length-1]=point;
      else this.history.push(point);
    }
    _error(message) { return {ok:false,message}; }
    _ready(ticker) {
      if(!this._asset(ticker))return 'Unknown paper asset.';
      if(this.insolvent)return 'Account has an insolvency deficit. Reset before trading.';
      if(this.day>=HORIZON)return 'The five-year commercial-business scenario has liquidated. There is no guaranteed redemption at issue price.';
      return null;
    }
    _stockRisk(o,qty,price,remainingAfter=0) {
      const p=this.positions[o.ticker], sign=['buy','cover'].includes(o.side)?1:-1;
      if(o.side==='buy'&&p<0)return 'Use cover to reduce an existing short.';
      if(o.side==='short'&&p>0)return 'Sell the existing long before opening a short.';
      if(o.side==='sell'&&(p<=0||qty>p))return 'Insufficient long units to sell.';
      if(o.side==='cover'&&(p>=0||qty>-p))return 'Insufficient short units to cover.';
      if(o.side==='short'&&qty+remainingAfter>this._borrowRemaining(o.ticker,o.id))return 'Insufficient located borrow inventory.';
      if(['buy','short'].includes(o.side)&&Math.abs(p+sign*qty)>this._asset(o.ticker).floatShares)return 'Position exceeds the modeled free float.';
      const cost=qty*price, fee=cost*this.feeRate;
      const projected={...this.positions,[o.ticker]:p+sign*qty};
      const old=this._metrics(), m=this._metrics(projected,this.cash-sign*cost-fee);
      // A favorable hypothetical limit fill is not collateral before it actually occurs.
      const conservEquity=Math.min(m.equity,old.equity-fee);
      const extraMark=.5*Math.abs(projected[o.ticker])*Math.max(0,price-this.prices[o.ticker]);
      const reserve=this._pendingReserve(o.id)+(o.type==='limit'?this._orderReserve(o,remainingAfter):0);
      if(m.initialRequired+extraMark+reserve>conservEquity+1e-8 && ['buy','short'].includes(o.side))return 'Initial margin is insufficient after execution, fees and reserved orders.';
      if(m.equity<0 && ['buy','short'].includes(o.side))return 'Trade would leave negative equity.';
      return null;
    }
    order(request={}) {
      const {ticker,side,qty,type='market',limit}=request;
      const ready=this._ready(ticker); if(ready)return this._error(ready);
      if(!['buy','sell','short','cover'].includes(side)||!['market','limit'].includes(type))return this._error('Choose a valid side and market/limit order.');
      if(!positiveInt(qty))return this._error('Quantity must be a positive whole number of units.');
      if(type==='limit'&&(!finite(limit)||limit<=0))return this._error('Limit must be a positive finite price.');
      const p=this.prices[ticker];
      if(type==='limit'&&(limit<.9*p||limit>1.1*p))return this._error('Limit rejected by the simulation’s ±10% price collar.');
      const other=this._activeOrders().filter(o=>o.ticker===ticker);
      if(other.some(o=>o.side!==side))return this._error('Cancel the open order on this asset before changing sides.');
      if(['sell','cover'].includes(side)) {
        const held=Math.abs(this.positions[ticker]);
        if(qty+other.reduce((s,o)=>s+o.remaining,0)>held)return this._error('Units already committed to another order.');
      }
      const o={id:this._id('O'),day:this.day,ticker,side,qty,remaining:qty,filled:0,type,limit:type==='limit'?limit:null,status:'open',averageFill:0};
      const book=this._book(ticker), levels=['buy','cover'].includes(side)?book.asks:book.bids;
      const worst=type==='limit'?limit:levels[2].price;
      const problem=this._stockRisk(o,qty,worst,0);
      if(problem)return this._error(problem);
      this.orders.push(o);
      this._log('order',0,`${side} ${qty} ${ticker} ${type} order entered.`,{ticker,orderId:o.id});
      this._processOrders(ticker);
      this._checkMaintenance();this._recordHistory();
      return {ok:true,message:o.filled?`${o.filled} of ${qty} units filled; ${o.status}.`:o.status==='cancelled'?`Order cancelled: ${o.reason}`:`Limit order queued with ${qty} units remaining.`,orderId:o.id,filled:o.filled,status:o.status};
    }
    _trade(ticker,side,qty,price,reason,orderId) {
      const sign=['buy','cover'].includes(side)?1:-1, old=this.positions[ticker], next=old+sign*qty;
      if(side==='buy'||side==='short')this.averagePrices[ticker]=(Math.abs(old)*this.averagePrices[ticker]+qty*price)/Math.abs(next);
      this.positions[ticker]=next;
      if(next===0)this.averagePrices[ticker]=0;
      this._cash(-sign*qty*price,'stock_trade',reason,{ticker,side,qty,price,orderId});
      this._fee(qty*price*this.feeRate,'Stock execution fee.',{ticker,orderId});
    }
    _processOrders(ticker) {
      for(const o of this._activeOrders().filter(x=>!ticker||x.ticker===ticker)) {
        const buying=['buy','cover'].includes(o.side), depthSide=buying?'buy':'sell';
        const levels=buying?this._book(o.ticker).asks:this._book(o.ticker).bids;
        for(const level of levels) {
          if(o.remaining===0)break;
          if(o.type==='limit'&&(buying?level.price>o.limit:level.price<o.limit))break;
          const available=this._depth[o.ticker][depthSide][level.level];
          if(!available)continue;
          const qty=Math.min(o.remaining,available);
          const risk=this._stockRisk(o,qty,level.price,o.type==='limit'?o.remaining-qty:0);
          if(risk){o.status='cancelled';o.reason=risk;this._log('order_cancel',0,risk,{orderId:o.id,ticker:o.ticker});break;}
          this._trade(o.ticker,o.side,qty,level.price,'Paper order execution.',o.id);
          o.averageFill=(o.averageFill*o.filled+qty*level.price)/(o.filled+qty);
          o.filled+=qty;o.remaining-=qty;this._depth[o.ticker][depthSide][level.level]-=qty;
          o.status=o.remaining?'partially-filled':'filled';
        }
        if(o.type==='market'&&o.remaining&&o.status!=='cancelled') {
          o.status=o.filled?'partially-filled-cancelled':'cancelled';
          o.reason='Market order is immediate-or-cancel; displayed depth exhausted.';
          this._log('order_cancel',0,o.reason,{orderId:o.id,ticker:o.ticker});
        }
      }
    }
    cancel(id) {
      const o=this._activeOrders().find(x=>x.id===id);
      if(!o)return this._error('No open order with that ID.');
      o.status='cancelled';o.reason='Cancelled by user.';
      this._log('order_cancel',0,o.reason,{orderId:id,ticker:o.ticker});
      return {ok:true,message:'Order cancelled and its reservations released.'};
    }
    future({ticker,side,qty,days}={}) {
      const ready=this._ready(ticker);if(ready)return this._error(ready);
      if(!['long','short'].includes(side)||!positiveInt(qty)||![30,90].includes(days))return this._error('Futures require long/short, positive whole units, and 30 or 90 trading days.');
      if(this.day+days>HORIZON)return this._error('Derivative maturity exceeds the income claim’s five-year horizon.');
      const sign=side==='long'?1:-1, expiry=this.day+days, fair=this._forwardPrice(ticker,expiry);
      const execution=fair*(1+sign*.0005*this.liquidityFactor), fee=qty*this.prices[ticker]*this.feeRate;
      const m=this._metrics(), slippage=qty*Math.abs(execution-fair);
      if(m.initialRequired+.1*qty*this.prices[ticker]+this._pendingReserve()>m.equity-fee-slippage)return this._error('Insufficient initial margin for this futures position.');
      const f={id:this._id('F'),ticker,side,sign,qty,opened:this.day,expiry,entryPrice:execution,settlementPrice:execution,status:'open',variation:0,realized:0};
      this.futures.push(f);this._fee(fee,'Futures opening fee.',{ticker,positionId:f.id});
      this._log('future_open',0,'Futures notional is not a cash purchase; initial margin is reserved.',{ticker,positionId:f.id,qty,price:execution});
      this._recordHistory();
      return {ok:true,message:`${side} future opened for ${qty} units; daily cash variation applies.`,positionId:f.id};
    }
    _settleFuture(f,price,final=false,reason='Daily futures variation margin.') {
      const amount=f.sign*f.qty*(price-f.settlementPrice);
      f.variation+=amount;f.realized+=amount;f.settlementPrice=price;
      if(Math.abs(amount)>1e-12)this._cash(amount,'futures_variation',reason,{ticker:f.ticker,positionId:f.id,price});
      if(final){f.status='expired';f.closed=this.day;this._log('future_expiry',0,'Cash-settled at underlying spot; no notional principal exchange.',{ticker:f.ticker,positionId:f.id});}
    }
    closeFuture(id) {
      const f=this.futures.find(x=>x.id===id&&x.status==='open');
      if(!f)return this._error('No open future with that ID.');
      const price=this._forwardPrice(f.ticker,f.expiry)*(1-f.sign*.0005*this.liquidityFactor);
      this._settleFuture(f,price,false,'Futures closing cash settlement.');
      this._fee(f.qty*this.prices[f.ticker]*this.feeRate,'Futures closing fee.',{ticker:f.ticker,positionId:id});
      f.status='closed';f.closed=this.day;
      if(!this._liquidating)this._checkMaintenance();
      this._recordHistory();
      return {ok:true,message:'Future closed; accumulated cash variation retained.'};
    }
    option({ticker,type,qty,strike,days}={}) {
      const ready=this._ready(ticker);if(ready)return this._error(ready);
      if(!['call','put'].includes(type)||!positiveInt(qty)||!finite(strike)||strike<=0||![30,90].includes(days))return this._error('Options require call/put, positive whole contracts, a positive strike, and 30 or 90 trading days.');
      if(this.day+days>HORIZON)return this._error('Derivative maturity exceeds the income claim’s five-year horizon.');
      const o={id:this._id('P'),ticker,type,qty,strike,opened:this.day,expiry:this.day+days,multiplier:OPTION_MULTIPLIER,status:'open'};
      const fair=this._optionMark(o), price=fair*(1+.025*this.liquidityFactor), cost=price*qty*o.multiplier, fee=cost*this.feeRate;
      const m=this._metrics(), reserve=this._pendingReserve();
      if(cost+fee>this.cash-m.collateralRequired-reserve || m.initialRequired+fair*qty*o.multiplier+reserve>m.equity-(price-fair)*qty*o.multiplier-fee)return this._error('Long options require full premium from available cash and sufficient unencumbered equity.');
      o.entryPrice=price;o.premiumPaid=cost;
      this.options.push(o);this._cash(-cost,'option_premium','Purchased fully paid long European option.',{ticker,positionId:o.id,qty,price});
      this._fee(fee,'Option premium execution fee.',{ticker,positionId:o.id});this._recordHistory();
      return {ok:true,message:`${qty} long ${type} contract(s) purchased; ${OPTION_MULTIPLIER} units per contract.`,positionId:o.id};
    }
    closeOption(id) {
      const o=this.options.find(x=>x.id===id&&x.status==='open');
      if(!o)return this._error('No open option with that ID.');
      const price=this._optionMark(o)*Math.max(0,1-.025*this.liquidityFactor), value=price*o.qty*o.multiplier;
      this._cash(value,'option_sale','Sold existing long option at modeled bid.',{ticker:o.ticker,positionId:id,price});
      this._fee(value*this.feeRate,'Option closing fee.',{ticker:o.ticker,positionId:id});
      o.status='closed';o.closed=this.day;o.exitPrice=price;
      if(!this._liquidating)this._checkMaintenance();
      this._recordHistory();
      return {ok:true,message:'Long option closed.'};
    }
    _payDividends() {
      if(this.day===0||this.day%63!==0)return;
      for(const a of this.assets) {
        const distribution=this._dividendAt(a,this.day), amount=distribution*this.positions[a.ticker];
        // Conditional business cash is realized here. A quote below declared cash
        // requires an explicit information revaluation, not a hidden dividend gain.
        const previous=this.prices[a.ticker], minimumExMark=this.day===HORIZON?0:.01;
        const cumDistribution=Math.max(previous,distribution+minimumExMark);
        if(cumDistribution>previous+1e-12) {
          this._setPrice(a.ticker,cumDistribution);
          this._log('distribution_information_repricing',0,`Quarterly cash realization revalues ${a.ticker} from ${previous.toFixed(4)} to ${cumDistribution.toFixed(4)} before its ${distribution.toFixed(4)} distribution. Separate market-information P/L; no cash credited by this entry.`,{ticker:a.ticker,oldPrice:previous,newPrice:cumDistribution,markPnl:(cumDistribution-previous)*this.positions[a.ticker]});
        }
        this._setPrice(a.ticker,cumDistribution-distribution);
        if(amount!==0){this.dividends+=amount;this._cash(amount,'dividend',amount>0?'Realized quarterly commercial-business cash distribution.':'Short position owes the realized quarterly cash distribution.',{ticker:a.ticker,perUnit:distribution});}
      }
    }
    _expireOptions() {
      for(const o of this.options.filter(x=>x.status==='open'&&x.expiry<=this.day)) {
        const price=Math.max(o.type==='call'?this.prices[o.ticker]-o.strike:o.strike-this.prices[o.ticker],0), value=price*o.qty*o.multiplier;
        this._cash(value,'option_expiry','European cash settlement at intrinsic value.',{ticker:o.ticker,positionId:o.id,price});
        o.status='expired';o.closed=this.day;o.exitPrice=price;
      }
    }
    _auctionPrice(ticker,qty,buying) {
      const a=this._asset(ticker), impact=Math.min(.099,a.spread*this.liquidityFactor/2+.001*qty/(a.dailyDepth/this.liquidityFactor));
      return this.prices[ticker]*(1+(buying?1:-1)*impact);
    }
    _liquidateStock(ticker,reason) {
      const qty=this.positions[ticker];if(!qty)return;
      const side=qty>0?'sell':'cover', price=this._auctionPrice(ticker,Math.abs(qty),qty<0);
      this._trade(ticker,side,Math.abs(qty),price,reason);
      this._log('liquidation_auction',0,'Stylized liquidation auction assumes completion at an adverse spread/size-impact price; real liquidity is not guaranteed.',{ticker,price,qty:Math.abs(qty)});
    }
    _checkMaintenance() {
      const m=this._metrics();
      if(this.insolvent){this.deficit=Math.max(0,-m.equity);return;}
      if(m.equity+1e-8>=m.maintenanceRequired)return;
      this.marginCalls++;
      this._liquidating=true;
      this._log('margin_call',0,'Maintenance breach: open orders cancelled and all positions liquidated under the modeled auction assumption.',{equity:m.equity,maintenance:m.maintenanceRequired});
      for(const o of this._activeOrders()){o.status='cancelled';o.reason='Margin liquidation.';this._log('order_cancel',0,o.reason,{orderId:o.id,ticker:o.ticker});}
      for(const f of this.futures.filter(x=>x.status==='open'))this.closeFuture(f.id);
      for(const o of this.options.filter(x=>x.status==='open'))this.closeOption(o.id);
      for(const a of this.assets)this._liquidateStock(a.ticker,'Forced margin liquidation.');
      this.deficit=Math.max(0,-this.cash);this.insolvent=this.deficit>1e-8;
      this._liquidating=false;
      if(this.insolvent)this._log('insolvency',0,'Liquidation leaves a deficit; no negative-balance protection is assumed.',{deficit:this.deficit});
    }
    advance(days=1) {
      if(!positiveInt(days)||days>HORIZON)return this._error('Advance by 1 to 1,260 whole trading days.');
      if(this.day>=HORIZON)return this._error('The commercial-business scenario has liquidated. Reset to begin another run.');
      const count=Math.min(days,HORIZON-this.day), beforeCalls=this.marginCalls;
      for(let k=0;k<count;k++) {
        this.day++;
        const common=this._normal();
        for(const a of this.assets) {
          const z=Math.sqrt(.45)*common+Math.sqrt(.55)*this._normal();
          const old=this.prices[a.ticker], change=(.055-.5*a.vol*a.vol)/YEAR+a.vol*z/Math.sqrt(YEAR);
          this._setPrice(a.ticker,Math.max(.01,old*Math.exp(change)));
        }
        this._payDividends();
        if(this.day===HORIZON) {
          const expiredPositions={...this.positions};
          const markPnl=-this.assets.reduce((s,a)=>s+this.positions[a.ticker]*this.prices[a.ticker],0);
          for(const a of this.assets)this._setPrice(a.ticker,0);
          for(const a of this.assets){this.positions[a.ticker]=0;this.averagePrices[a.ticker]=0;}
          for(const o of this._activeOrders()){o.status='cancelled';o.reason='Underlying income claim expired.';}
          this._log('claim_expiry',0,'Five-year commercial equity extinguished after the conditional final cash distribution. No guaranteed issue-price redemption; any residual ex-distribution quote is written off.',{expiredPositions,markPnl});
        }
        for(const f of this.futures.filter(x=>x.status==='open'))this._settleFuture(f,this._forwardPrice(f.ticker,f.expiry),f.expiry<=this.day);
        this._expireOptions();
        const m=this._metrics();
        const eligibleCash=this.cash>=0?Math.max(0,this.cash-m.shortValue):this.cash;
        const accrued=eligibleCash*(eligibleCash>=0?this.rf:this.marginRate)/YEAR;
        if(accrued!==0){this.interest+=accrued;this._cash(accrued,'interest',accrued>=0?'Interest on cash excluding restricted short proceeds.':'Interest expense on cash borrowing.');}
        for(const a of this.assets) {
          if(this.positions[a.ticker]<0) {
            const cost=-this.positions[a.ticker]*this.prices[a.ticker]*a.borrowRate/YEAR;
            if(cost){this.borrowCost+=cost;this._cash(-cost,'borrow_fee','Daily short borrow fee.',{ticker:a.ticker,rate:a.borrowRate});}
          }
          a.dividend=this._annualDistribution(a);
        }
        this._resetDepth();
        this._checkMaintenance();
        if(!this.insolvent&&this.day<HORIZON)this._processOrders();
        this._checkMaintenance();this._recordHistory();
      }
      return {ok:true,message:`Advanced ${count} trading day(s).${this.marginCalls>beforeCalls?' Maintenance breach triggered liquidation.':''}${this.day===HORIZON?' Five-year claims have expired.':''}`};
    }
    shock(kind,ticker) {
      if(this.day>=HORIZON)return this._error('The paper income claims have expired.');
      const allowed=['injury','extension','ratesUp','ratesDown','marketCrash','borrowRecall','liquidityDry'];
      if(!allowed.includes(kind))return this._error('Unknown scenario shock.');
      const a=this._asset(ticker||this.assets[0].ticker);if(!a)return this._error('Unknown paper asset.');
      if(kind==='injury'){this._setPrice(a.ticker,this.prices[a.ticker]*.70);a.vol=Math.min(1.5,a.vol*1.25);}
      if(kind==='extension')this._setPrice(a.ticker,this.prices[a.ticker]*1.12);
      if(kind==='marketCrash')for(const item of this.assets)this._setPrice(item.ticker,this.prices[item.ticker]*.8);
      if(kind==='ratesUp'||kind==='ratesDown') {
        const old=this.rf;this.rf=clamp(this.rf+(kind==='ratesUp'?.01:-.01),-.02,.25);
        this.marginRate=clamp(this.marginRate+this.rf-old,0,.35);
      }
      if(kind==='liquidityDry'){this.liquidityFactor=Math.min(8,this.liquidityFactor*2);this._resetDepth();}
      if(kind==='borrowRecall') {
        for(const o of this._activeOrders().filter(o=>o.ticker===a.ticker&&o.side==='short'))this.cancel(o.id);
        if(this.positions[a.ticker]<0)this._liquidateStock(a.ticker,'Forced cover after modeled borrow recall.');
        a.borrowAvailable=0;
      }
      const detail=kind==='injury'?' Commercial-risk quote and volatility shock only. Protected sponsorship terms and the selected conditional cash-flow scenario remain unchanged.':kind==='extension'?' Commercial-growth quote shock only. It does not amend sponsorship terms, quarterly operating distributions, or terminal cash reserves.':'';
      this._log('shock',0,`${kind} scenario applied.${detail}`,{ticker:['injury','extension','borrowRecall'].includes(kind)?a.ticker:null});
      this._checkMaintenance();this._recordHistory();
      return {ok:true,message:`${kind} scenario applied.${detail}`};
    }
    split(ticker,ratio=2) {
      const ready=this._ready(ticker);if(ready)return this._error(ready);
      if(!positiveInt(ratio)||ratio<2||ratio>10)return this._error('Split ratio must be a whole number from 2 to 10.');
      if(this.futures.some(f=>f.ticker===ticker&&f.status==='open')||this.options.some(o=>o.ticker===ticker&&o.status==='open')||this._activeOrders().some(o=>o.ticker===ticker))return this._error('Close derivatives and cancel open orders on this asset before a split; derivative adjustment rules are outside this prototype.');
      const a=this._asset(ticker);
      if(!Number.isSafeInteger(a.floatShares*ratio)||!Number.isSafeInteger(this.positions[ticker]*ratio))return this._error('Split would exceed the safe whole-unit accounting range.');
      this.positions[ticker]*=ratio;this.averagePrices[ticker]/=ratio;
      this._setPrice(ticker,this.prices[ticker]/ratio);this.initialPrices[ticker]/=ratio;
      a.dividend/=ratio;a.distributions=a.distributions.map(d=>d/ratio);a.quarterlyDistributions=a.quarterlyDistributions.map(d=>d/ratio);a.floatShares*=ratio;a.borrowAvailable*=ratio;a.dailyDepth*=ratio;
      this._resetDepth();
      this._log('split',0,`${ratio}-for-1 paper unit split; price, units and distributions adjusted without creating wealth.`,{ticker,ratio});this._recordHistory();
      return {ok:true,message:`${ratio}-for-1 split applied with wealth and future income preserved.`};
    }
    exportState() {
      return {schema:'court-capital-paper-market-v2',...this.snapshot(),positionUnits:{...this.positions},rngState:this._rng,notice:'Fictional educational commercial-business equity market. No actual security, NBA salary assignment, ownership of a player, or real-money trading.'};
    }
  }
  return {Market,blackScholes,optionValue:blackScholes,optionGreeks,futureFairValue,normalCDF,YEAR,HORIZON,OPTION_MULTIPLIER};
});
