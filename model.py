"""Court Capital: finite, fictional five-year income-claim scenario research.

Run with Python 3 and NumPy. No network access; not fitted to athlete data.
Draws describe judgmental physical scenarios, not risk-neutral probabilities.
"""
from pathlib import Path
import csv, gzip, io, json, math
import numpy as np

ROOT = Path(__file__).resolve().parent
N, SEED, YEARS = 20_000, 20261007, 5
CAP = 164_961_000.0
PARTICIPATION, UNITS = .01, 100_000
COLLECTION_FACTOR, FEE, DEFAULT_HAZARD = .95, .02, .005
DISCOUNT, RISK_FREE, PREMIUM = .12, .04, .08
PROFILES = [
 dict(ticker='RISE', name='Emerging prospect', salary=8e6, guaranteed_years=2, injury_hazard=.08, probabilities=[.25,.45,.20,.10], renewal_cap_shares=[.25,.16,.06,0], performance_cap_share=.18),
 dict(ticker='PRIME', name='Established star', salary=35e6, guaranteed_years=3, injury_hazard=.10, probabilities=[.20,.50,.22,.08], renewal_cap_shares=[.35,.28,.14,0], performance_cap_share=.31),
 dict(ticker='ANCHOR', name='Long-contract veteran star', salary=55e6, guaranteed_years=4, injury_hazard=.11, probabilities=[.10,.45,.30,.15], renewal_cap_shares=[.35,.30,.16,0], performance_cap_share=.34),
 dict(ticker='ROLE', name='Rotation contributor', salary=18e6, guaranteed_years=2, injury_hazard=.08, probabilities=[.15,.50,.25,.10], renewal_cap_shares=[.18,.12,.05,0], performance_cap_share=.14),
 dict(ticker='VET', name='Late-career starter', salary=38e6, guaranteed_years=2, injury_hazard=.16, probabilities=[.05,.30,.35,.30], renewal_cap_shares=[.30,.18,.07,0], performance_cap_share=.17),
 dict(ticker='REBOUND', name='Recovery and renewal candidate', salary=12e6, guaranteed_years=1, injury_hazard=.22, probabilities=[.18,.30,.27,.25], renewal_cap_shares=[.22,.12,.045,0], performance_cap_share=.11),
]
for profile,service in zip(PROFILES,[2,7,10,4,12,5]):
    profile['current_years_of_service']=service
    future_service=service+profile['guaranteed_years']
    profile['renewal_service_max_cap_share']=.35 if future_service>=10 else (.30 if future_service>=7 else .25)
    assert max(profile['renewal_cap_shares'])<=profile['renewal_service_max_cap_share']

def draws(n=N):
    rng=np.random.default_rng(SEED)
    # Common driver changes cap growth and renewal demand across every athlete.
    macro=rng.standard_normal(n)
    # Gaussian rank -> uniform using the normal CDF; triangular inverse CDF.
    cdf=np.array([.5*(1+math.erf(x/math.sqrt(2))) for x in macro])
    independent=rng.random((n,YEARS-1))
    # Conditional uniform rank mixture gives identical marginal triangular laws.
    shared=rng.random((n,YEARS-1)) < .45
    u=np.where(shared,cdf[:,None],independent)
    growth=np.where(u<.6,np.sqrt(u*.1*.06),.1-np.sqrt((1-u)*.1*.04))
    cap=np.column_stack([np.full(n,CAP),CAP*np.cumprod(1+growth,axis=1)])
    return dict(macro=macro,cap=cap,growth=growth,
        performance=.35*macro[:,None]+math.sqrt(1-.35**2)*rng.standard_normal((n,6)),
        injury=rng.random((n,6,YEARS)), default=rng.random((n,6,YEARS)),
        renewal_u=rng.random((n,6)))

def simulate(d, force_injury=False, cap_flat=False, upside=False, renewal_multiplier=1., guarantee_shift=0):
    n=len(d['macro']); cash=np.zeros((n,6,YEARS)); protected=np.zeros_like(cash)
    outcomes=np.zeros((n,6),dtype=int)
    caps=np.full((n,YEARS),CAP) if cap_flat else d['cap']
    for j,p in enumerate(PROFILES):
        g=int(np.clip(p['guaranteed_years']+guarantee_shift,0,YEARS))
        alive=np.cumprod((d['default'][:,j,:]>=DEFAULT_HAZARD).astype(float),axis=1)
        for t in range(g):
            protected[:,j,t]=p['salary']*(1+.05*t)
        cash[:,j,:]=protected[:,j,:]
        if g<YEARS:
            # Injury before renewal changes offered terms, never already-protected pay.
            last=max(1,min(g,2))
            injured=np.any(d['injury'][:,j,max(0,g-last):max(1,g)]<p['injury_hazard'],axis=1)
            if force_injury: injured[:]=True
            logits=np.log(np.array(p['probabilities']))[None,:]+d['performance'][:,j,None]*np.array([.65,.20,-.25,-.65])[None,:]
            logits+=injured[:,None]*np.array([-.8,-.3,.25,.85])[None,:]
            probs=np.exp(logits-logits.max(axis=1,keepdims=True)); probs/=probs.sum(axis=1,keepdims=True)
            # Multiplier applies to total chance of receiving any new contract.
            contract=np.minimum(.999999,(1-probs[:,3])*renewal_multiplier)
            probs[:,:3]*=contract[:,None]/probs[:,:3].sum(axis=1,keepdims=True)
            probs[:,3]=1-contract
            out=np.sum(d['renewal_u'][:,j,None]>np.cumsum(probs,axis=1),axis=1)
            if upside: out[:]=0
            outcomes[:,j]=out
            first=caps[:,g]*np.array(p['renewal_cap_shares'])[out]
            for t in range(g,YEARS): cash[:,j,t]=first*(1+.05*(t-g))
        cash[:,j,:]*=alive*COLLECTION_FACTOR*(1-FEE)*PARTICIPATION/UNITS
        protected[:,j,:]*=alive*COLLECTION_FACTOR*(1-FEE)*PARTICIPATION/UNITS
    return cash,protected,outcomes

def pv(cash,rate=DISCOUNT):
    # Each modeled annual cash amount pays one quarter at each quarter-end.
    year_factors=np.mean((1+rate)**(-np.arange(1,YEARS*4+1).reshape(YEARS,4)/4),axis=1)
    return np.sum(cash*year_factors,axis=-1)

def irr(mean_cash,price):
    # Nonnegative finite future payouts ensure a unique IRR if any payment exists.
    if not np.any(mean_cash>0): return None
    lo,hi=-.999999,100.0
    for _ in range(100):
        mid=(lo+hi)/2
        if pv(mean_cash,mid)>price: lo=mid
        else: hi=mid
    return (lo+hi)/2

def risk_summary(value_ratio):
    # Funding loss is cost minus discounted payout value, not realized return.
    loss=1-value_ratio
    cutoff=float(np.quantile(loss,.95))
    return dict(mean_pv_ratio=float(value_ratio.mean()),p05_pv_ratio=float(np.quantile(value_ratio,.05)),
        median_pv_ratio=float(np.median(value_ratio)),p95_pv_ratio=float(np.quantile(value_ratio,.95)),
        pv_shortfall_probability=float(np.mean(value_ratio<1)),
        funding_loss_var95=cutoff,funding_loss_es95=float(loss[loss>=cutoff].mean()),
        definition='Funding loss = 1 - discounted payout value / initial purchase cost; no terminal principal repayment.')

def main():
    (ROOT/'data').mkdir(exist_ok=True)
    d=draws(); c,g,o=simulate(d); v=pv(c); gv=pv(g); prices=v.mean(axis=0)
    assets=[]
    for j,p in enumerate(PROFILES):
        asset=dict(p)
        asset.update(dict(fair_value_per_unit=float(prices[j]),fair_claim_value=float(prices[j]*UNITS),
            current_cap_share=p['salary']/CAP,performance_cap_value=p['performance_cap_share']*CAP,
            conceptual_cap_surplus=p['performance_cap_share']*CAP-p['salary'],
            expected_annual_payout_per_unit=c[:,j,:].mean(axis=0).tolist(),
            expected_annual_payout_claim=(c[:,j,:].mean(axis=0)*UNITS).tolist(),
            mean_total_payout_per_unit=float(c[:,j,:].sum(axis=1).mean()),
            pv_p05=float(np.quantile(v[:,j],.05)),pv_p50=float(np.quantile(v[:,j],.5)),pv_p95=float(np.quantile(v[:,j],.95)),
            contracted_pv_share=float(gv[:,j].mean()/prices[j]),future_contract_pv_share=float(1-gv[:,j].mean()/prices[j]),
            simulated_renewal_outcomes={name:float(np.mean(o[:,j]==i)) for i,name in enumerate(['upside','base','downside','out_of_league'])},
            irr_of_mean_cashflows=irr(c[:,j,:].mean(axis=0),prices[j]),
            zero_payout_probability=float(np.mean(c[:,j,:].sum(axis=1)==0)),
            risk=risk_summary(v[:,j]/prices[j]),
            mean_estimate_mc_standard_error=float(v[:,j].std(ddof=1)/np.sqrt(N)),
            cashflow_percentiles_by_year={f'p{q:02}':np.percentile(c[:,j,:],q,axis=0).tolist() for q in [5,50,95]},
            guaranteed_gross_schedule=[p['salary']*(1+.05*t) if t<p['guaranteed_years'] else 0 for t in range(YEARS)]))
        assets.append(asset)
    ratios=v/prices[None,:]
    portfolio=risk_summary(ratios.mean(axis=1))
    portfolio.update(dict(name='Equal dollars across six fictional claims',weights=[1/6]*6,
        budget=10000,units_by_asset=(10000/6/prices).tolist(),
        expected_annual_payout=(c*(10000/6/prices)[None,:,None]).sum(axis=1).mean(axis=0).tolist(),
        asset_pv_correlation=np.corrcoef(v,rowvar=False).tolist()))
    sensitivities={}
    for rf in [.02,.04,.06]:
        sensitivities[f'risk_free_{rf:.2f}']={'risk_free':rf,'premium':PREMIUM,'discount_rate':rf+PREMIUM,'prices':dict(zip([p['ticker'] for p in PROFILES],pv(c,rf+PREMIUM).mean(axis=0).tolist()))}
    for mul in [.75,1,1.10]:
        alt=simulate(d,renewal_multiplier=mul)[0]
        sensitivities[f'renewal_probability_x{mul:.2f}']={'multiplier':mul,'prices':dict(zip([p['ticker'] for p in PROFILES],pv(alt).mean(axis=0).tolist()))}
    for shift in [-1,0,1]:
        alt=simulate(d,guarantee_shift=shift)[0]
        sensitivities[f'protected_years_shift_{shift}']={'shift':shift,'prices':dict(zip([p['ticker'] for p in PROFILES],pv(alt).mean(axis=0).tolist())),'interpretation':'Contract-design counterfactual; replacing renewal exposure with scheduled protected pay also changes renewal timing. Not pure protection effect.'}
    stresses={}
    for key,kwargs in [('injury_before_renewal',{'force_injury':True}),('zero_cap_growth',{'cap_flat':True}),('all_upside_renewals',{'upside':True})]:
        sc=simulate(d,**kwargs)[0]; sp=pv(sc).mean(axis=0)
        stresses[key]={'prices':dict(zip([p['ticker'] for p in PROFILES],sp.tolist())),
            'change_from_base_pct':dict(zip([p['ticker'] for p in PROFILES],(sp/prices-1).tolist())),
            'equal_dollar_portfolio_pv_change':float(np.mean(sp/prices)-1)}
    sp=pv(c,.14).mean(axis=0)
    stresses['discount_rate_plus_200bp']={'prices':dict(zip([p['ticker'] for p in PROFILES],sp.tolist())),
        'change_from_base_pct':dict(zip([p['ticker'] for p in PROFILES],(sp/prices-1).tolist())),
        'equal_dollar_portfolio_pv_change':float(np.mean(sp/prices)-1)}
    low=d['macro']<=np.quantile(d['macro'],.10)
    common_stress={'definition':'Bottom decile of shared demand factor, conditional subset of base draws; not a separate forecast.',
        'draw_count':int(low.sum()),'equal_dollar_pv_change':float(ratios[low].mean()-1),
        'asset_pv_change':dict(zip([p['ticker'] for p in PROFILES],(ratios[low].mean(axis=0)-1).tolist()))}
    result=dict(project='Court Capital',version='1.0.0',as_of='2026-10-07',seed=SEED,draws=N,
        evidence_status='Fictional archetypes and judgmental scenario model; no real athlete investments, trained AI model, observed returns or backtest.',
        assumptions={'horizon_years':YEARS,'seasons':['2026-27','2027-28','2028-29','2029-30','2030-31'],
            'base_cap':CAP,'cap_growth_triangular':{'min':0,'mode':.06,'max':.10},
            'cap_rule_continuation':'2030-31 extends beyond current CBA term; same bounds assumed. Opt-out after 2028-29 is not modeled.',
            'nominal_usd':True,'payment_timing':'Four equal quarterly installments for each annual modeled cash amount, at year offsets .25,.50,.75,1.00. Prototype convention, not actual NBA payroll.','participation':PARTICIPATION,'units':UNITS,
            'net_collection_factor':COLLECTION_FACTOR,'net_collection_definition':'Assumed 5% recurring collection friction haircut; not tax, escrow or a CBA rule.',
            'collection_fee':FEE,'default_hazard_annual':DEFAULT_HAZARD,
            'default_definition':'Independent annual absorbing failure of hypothetical collection vehicle. Subsequent payouts zero. Separate from athlete injury; not empirically estimated.',
            'risk_free_rate':RISK_FREE,'risk_premium':PREMIUM,'discount_rate':DISCOUNT,
            'discount_definition':'Assumed required return used to discount physical-scenario expected cashflows; not risk-neutral valuation or a Treasury quote.',
            'terminal_principal':0,'terminal_value':0,'annual_raise':.05,
            'raise_definition':'5% of first-year salary added annually; no compounding, both protected schedule and each new contract.',
            'renewal_outcomes':['upside','base','downside','out_of_league'],
            'renewal_method':'Softmax of log baseline probabilities + performance*[.65,.20,-.25,-.65] + injury*[-.8,-.3,.25,.85]. Single renewal at end of protected period; new contract covers remaining horizon.',
            'injury_definition':'Any injury draw within two periods before renewal (one for one-year contract); affects renewal outcomes only. New signed pay protected for remaining model horizon.',
            'performance_driver':'0.35*common normal demand + sqrt(1-0.35^2)*independent normal; hypothetical, not trained ML.',
            'common_cap_driver':'Each year uses common normal-demand percentile with probability45%, otherwise independent uniform; triangular marginal distribution.',
            'performance_cap_value':'User-defined illustrative basketball value as cap share, not observed wins or model-estimated revenue.',
            'excluded':['Taxes','trading liquidity','bid-ask spread','athlete consent pricing','securities issuance costs','legal eligibility','endorsements','options','bonuses','buyouts','real contract details'],
            'source_ids':['nba_cap_2026','cba2023']},
        assets=assets,portfolio=portfolio,sensitivities=sensitivities,stress_tests=stresses,common_factor_stress=common_stress,
        cap_paths={'mean':d['cap'].mean(axis=0).tolist(),'p05':np.percentile(d['cap'],5,axis=0).tolist(),'p95':np.percentile(d['cap'],95,axis=0).tolist()},
        formulas={'eligible_distribution':'gross_salary * survival * .95 * (1-.02) * .01 / 100000',
            'fair_value':'mean(sum_t sum_q (annual_distribution[t]/4)/(1+.12)^(t+q/4)), t=0..4, q=1..4',
            'funding_loss':'1 - scenario_PV / purchase_price','equal_dollar_portfolio':'mean(asset_scenario_PV / own_mean_PV)'},
        warnings=['Scenario percentiles are uncertainty ranges under assumptions, not confidence intervals or observed investment returns.',
            'IRR of expected cashflows equals assumed discount rate by construction; it is not independent performance evidence.',
            'Diversification comparisons use own-DCF prices and identical paired scenarios; fees and illiquidity beyond collection fee are omitted.',
            'Share of NBA salary cap is not legal ownership, distributable revenue, league payroll or market size.'])
    (ROOT/'data/model.json').write_text(json.dumps(result,indent=2))
    with gzip.GzipFile(filename=str(ROOT/'data/draws.csv.gz'),mode='wb',mtime=0) as gz, io.TextIOWrapper(gz,newline='') as f:
        w=csv.writer(f); w.writerow(['draw','common_factor']+[f'{p["ticker"]}_pv_per_unit' for p in PROFILES]+[f'{p["ticker"]}_y{t+1}_cash_per_unit' for p in PROFILES for t in range(YEARS)])
        for k in range(N): w.writerow([k,round(float(d['macro'][k]),8)]+[round(float(x),10) for x in v[k]]+[round(float(x),10) for x in c[k].ravel()])
    print(json.dumps({'assets':[{k:a[k] for k in ['ticker','fair_value_per_unit','contracted_pv_share','pv_p05','pv_p95']} for a in assets], 'portfolio':portfolio,'common_factor':common_stress,'stress':stresses},indent=2))

if __name__=='__main__': main()
