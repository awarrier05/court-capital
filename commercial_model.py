"""Fictional PlayerCo commercial equity research, with explicit quarterly cash ledger.
No athlete salary assigned. No legal availability or demand validation implied.
Run: python commercial_model.py (requires NumPy only).
"""
from pathlib import Path
import csv,gzip,io,json,math
import numpy as np

ROOT=Path(__file__).resolve().parent
N,SEED,YEARS,UNITS=20000,20261007,5,100000
RATE=.12; RF=.04; IP_FEE=.25; RIGHTS_FEE=.05; FULFILLMENT=.30; SERVICE=.02; TAX=.21; PAYOUT=.90; ISSUE_FEE=.02
PROFILES=[
 dict(ticker='RISE',name='Emerging athlete commercial venture',gross_revenue=1.8e6,growth=.12,reserve=.35e6,fixed_expenses=.30e6,volatility=.35,injury_hazard=.08),
 dict(ticker='PRIME',name='Established star commercial venture',gross_revenue=7e6,growth=.05,reserve=.65e6,fixed_expenses=.80e6,volatility=.25,injury_hazard=.10),
 dict(ticker='ANCHOR',name='Global veteran commercial venture',gross_revenue=12e6,growth=.02,reserve=.80e6,fixed_expenses=1.25e6,volatility=.20,injury_hazard=.11),
 dict(ticker='ROLE',name='Local audience commercial venture',gross_revenue=1.3e6,growth=.08,reserve=.30e6,fixed_expenses=.24e6,volatility=.40,injury_hazard=.08),
 dict(ticker='VET',name='Legacy athlete commercial venture',gross_revenue=5e6,growth=-.03,reserve=.60e6,fixed_expenses=.65e6,volatility=.32,injury_hazard=.16),
 dict(ticker='REBOUND',name='Recovery narrative commercial venture',gross_revenue=2.5e6,growth=.07,reserve=.45e6,fixed_expenses=.45e6,volatility=.50,injury_hazard=.22),
]

def make_draws(n=N):
    rng=np.random.default_rng(SEED)
    common=rng.standard_normal(n)
    return dict(common=common,demand=.65*common[:,None]+math.sqrt(1-.65**2)*rng.standard_normal((n,YEARS)),
        idio=rng.standard_normal((n,6,YEARS)),injury=rng.random((n,6,YEARS)),
        sponsor_default=rng.random((n,6,YEARS)),catalyst=rng.random((n,6,YEARS)))

def simulate(d,revenue_multiplier=1.,rights_fee=RIGHTS_FEE,reserve_multiplier=1.,force_injury=False,market_shock=1.):
    n=len(d['common']); cash=np.zeros((n,6,20)); annual_revenue=np.zeros((n,6,5));
    terminal=np.zeros((n,6)); failure=np.zeros((n,6),bool); signed=np.zeros((n,6,5))
    ending=np.zeros((n,6)); op_profit=np.zeros((n,6,5)); service_collected=np.zeros((n,6,5))
    for j,p in enumerate(PROFILES):
        balance=np.full(n,p['reserve']*reserve_multiplier); alive=np.ones(n,bool)
        sponsor_alive=np.cumprod((d['sponsor_default'][:,j,:]>=.02).astype(float),axis=1)
        for y in range(YEARS):
            is_injured=d['injury'][:,j,y]<p['injury_hazard']
            if force_injury: is_injured[:]=True
            # 0.55 common + idiosyncratic log demand; expectation one before injury/catalysts.
            z=.55*d['demand'][:,y]+math.sqrt(1-.55**2)*d['idio'][:,j,y]
            demand=np.exp(p['volatility']*z-.5*p['volatility']**2)
            catalyst=np.where(d['catalyst'][:,j,y]<.20,1.25,np.where(d['catalyst'][:,j,y]>.85,.80,1.))
            floor=p['gross_revenue']*.4*sponsor_alive[:,y] if y<2 else np.zeros(n)
            unsold_share=.6 if y<2 else 1.
            unsold=p['gross_revenue']*((1+p['growth'])**y)*unsold_share*demand*catalyst*np.where(is_injured,.45,1.)
            # Sales stress affects unsold business, not already-signed minimum amounts.
            gross=floor+unsold*revenue_multiplier*market_shock
            signed[:,j,y]=floor
            for q in range(4):
                idx=4*y+q; interest=balance*((1+RF)**.25-1)
                operating=gross/4*(1-IP_FEE-rights_fee-FULFILLMENT-SERVICE)-p['fixed_expenses']*(1.03**y)/4
                pre_tax=operating+interest
                after_tax=pre_tax-TAX*np.maximum(pre_tax,0)
                dividend=PAYOUT*np.maximum(after_tax,0)
                next_balance=balance+after_tax-dividend
                failed=alive & (next_balance<0)
                # A failed quarter pays nothing; no recapitalization or negative investor cash.
                payable=alive & ~failed
                cash[:,j,idx]=np.where(payable,dividend,0)
                annual_revenue[:,j,y]+=np.where(payable,gross/4,0)
                op_profit[:,j,y]+=np.where(payable,operating,0)
                service_collected[:,j,y]+=np.where(payable,gross/4*SERVICE,0)
                alive &= ~failed; failure[:,j]|=failed
                balance=np.where(alive,next_balance,0)
            if y==YEARS-1:
                terminal[:,j]=balance
                cash[:,j,-1]+=balance
                balance[:]=0
        ending[:,j]=balance
    return dict(cash=cash/UNITS,revenue=annual_revenue,terminal=terminal/UNITS,failure=failure,signed=signed,
        ending_cash=ending,operating_profit=op_profit,service_collected=service_collected)

def pv(cash,rate=RATE): return np.sum(cash/(1+rate)**(np.arange(1,21)/4),axis=-1)
def risk(ratio):
    loss=1-ratio; cutoff=np.quantile(loss,.95)
    return dict(mean_pv_ratio=float(ratio.mean()),p05_pv_ratio=float(np.quantile(ratio,.05)),median_pv_ratio=float(np.median(ratio)),
        p95_pv_ratio=float(np.quantile(ratio,.95)),pv_shortfall_probability=float(np.mean(ratio<1)),
        funding_loss_var95=float(cutoff),funding_loss_es95=float(loss[loss>=cutoff].mean()))

def run():
    d=make_draws(); base=simulate(d); values=pv(base['cash']); price=values.mean(axis=0)
    assets=[]
    annual=base['cash'].reshape(N,6,5,4).sum(axis=-1)
    for j,p in enumerate(PROFILES):
        a=dict(p); raise_amount=price[j]*UNITS; issuance=raise_amount*ISSUE_FEE; residual=raise_amount-issuance-p['reserve']
        a.update(dict(fair_value_per_unit=float(price[j]),fair_equity_value=float(raise_amount),
            units=UNITS,ownership='100% of hypothetical five-year venture equity issued to investors; no equity in the athlete or NBA team.',
            expected_annual_payout_per_unit=annual[:,j,:].mean(axis=0).tolist(),
            expected_quarterly_payout_per_unit=base['cash'][:,j,:].mean(axis=0).tolist(),
            expected_annual_commercial_revenue=base['revenue'][:,j,:].mean(axis=0).tolist(),
            expected_annual_operating_profit=base['operating_profit'][:,j,:].mean(axis=0).tolist(),
            expected_annual_platform_servicing=base['service_collected'][:,j,:].mean(axis=0).tolist(),
            mean_total_payout_per_unit=float(base['cash'][:,j,:].sum(axis=1).mean()),
            pv_p05=float(np.quantile(values[:,j],.05)),pv_p50=float(np.quantile(values[:,j],.50)),pv_p95=float(np.quantile(values[:,j],.95)),
            liquidation_mean_per_unit=float(base['terminal'][:,j].mean()),
            liquidation_pv_share=float(np.mean(base['terminal'][:,j]/1.12**5)/price[j]),
            five_year_insolvency_probability=float(base['failure'][:,j].mean()),
            mean_estimate_mc_standard_error=float(values[:,j].std(ddof=1)/np.sqrt(N)),
            sponsor_minimums_years_1_2=.4*p['gross_revenue'],
            initial_funding={'gross_investor_equity_proceeds':float(raise_amount),'issuance_fee':float(issuance),'operating_cash_reserve':p['reserve'],
                'upfront_ip_license_payment':float(residual) if residual>=0 else None,'financing_gap':float(max(0,-residual)),
                'fundable_at_model_dcf':bool(residual>=0),'reconciliation_error':float(raise_amount-issuance-p['reserve']-residual)},
            risk=risk(values[:,j]/price[j])))
        operating_dividend=base['cash'][:,j,:].mean(axis=0)
        operating_dividend[-1]-=base['terminal'][:,j].mean()
        a['expected_quarterly_operating_dividend_per_unit']=operating_dividend.tolist()
        a['expected_annual_signed_sponsor_floor_before_issuer_failure']=base['signed'][:,j,:].mean(axis=0).tolist()
        assets.append(a)
    ratios=values/price; portfolio=risk(ratios.mean(axis=1))
    portfolio.update({'weights':[1/6]*6,'budget':10000,'units_by_asset':(10000/6/price).tolist(),
        'asset_pv_correlation':np.corrcoef(values,rowvar=False).tolist(),
        'expected_annual_payout':(annual*(10000/6/price)[None,:,None]).sum(axis=1).mean(axis=0).tolist(),
        'expected_quarterly_payout':(base['cash']*(10000/6/price)[None,:,None]).sum(axis=1).mean(axis=0).tolist()})
    sensitivity={}; stresses={}
    for label,kwargs in [('commercial_sales_minus_25pct',{'revenue_multiplier':.75}),('commercial_sales_plus_25pct',{'revenue_multiplier':1.25}),
        ('rights_fee_0pct',{'rights_fee':0}),('rights_fee_10pct',{'rights_fee':.10}),
        ('reserve_half',{'reserve_multiplier':.5}),('reserve_double',{'reserve_multiplier':2}),
        ('injury_every_year',{'force_injury':True}),('common_unsold_sales_shock_minus_30pct',{'market_shock':.70})]:
        s=simulate(d,**kwargs); v=pv(s['cash']).mean(axis=0)
        entry={'prices':dict(zip([p['ticker'] for p in PROFILES],v.tolist())),
            'change_from_base_pct':dict(zip([p['ticker'] for p in PROFILES],(v/price-1).tolist())),
            'equal_dollar_portfolio_pv_change':float(np.mean(v/price)-1),
            'insolvency_probabilities':dict(zip([p['ticker'] for p in PROFILES],s['failure'].mean(axis=0).tolist()))}
        sensitivity[label]=entry
        if label=='injury_every_year':
            for j,a in enumerate(assets):
                a['injury_stress_expected_quarterly_payout_per_unit']=s['cash'][:,j,:].mean(axis=0).tolist()
                a['injury_stress_liquidation_mean_per_unit']=float(s['terminal'][:,j].mean())
        if label in ['commercial_sales_minus_25pct','injury_every_year','common_unsold_sales_shock_minus_30pct']:stresses[label]=entry
    for rf in [.02,.04,.06]:
        v=pv(base['cash'],rf+.08).mean(axis=0)
        sensitivity[f'discount_rate_{rf+.08:.2f}']={'prices':dict(zip([p['ticker'] for p in PROFILES],v.tolist())),
            'equal_dollar_portfolio_pv_change':float(np.mean(v/price)-1)}
    # Unit-economics scaling is an explicit mix assumption, not a market-size claim.
    average_equity=float((price*UNITS).mean())
    # Actual modeled revenue includes zeros following insolvency; five-year annual mean.
    avg_servicing=float(base['service_collected'].sum(axis=2).mean()/YEARS)
    active_float=.20; trade_fee=.0005; fixed_budget=2.4e6; onboarding_cost=15000
    platform=[]
    for issuers in [25,75,150]:
        for turns in [1,3,8]:
            servicing=issuers*avg_servicing
            volume=issuers*average_equity*active_float*turns
            trading=volume*trade_fee
            issue=issuers*average_equity*ISSUE_FEE
            annual_cost=fixed_budget+issuers*onboarding_cost
            recurring=servicing+trading
            platform.append(dict(issuers=issuers,annual_turnover=turns,active_float_fraction=active_float,
                annual_trading_notional=volume,annual_servicing_revenue=servicing,annual_trading_revenue=trading,
                one_time_issuance_revenue=issue,annual_operating_cost=annual_cost,
                recurring_operating_result=recurring-annual_cost,
                launch_year_result_including_one_time_fees=recurring+issue-annual_cost,
                recurring_break_even_issuer_count=math.ceil(fixed_budget/(avg_servicing+average_equity*active_float*turns*trade_fee-onboarding_cost))))
    low=d['common']<=np.quantile(d['common'],.1)
    output=dict(project='Court Capital | PlayerCo commercial ventures',version='2.0.0',as_of='2026-10-07',seed=SEED,draws=N,
        evidence_status='Fictional venture financial feasibility research. No athlete agreement, securities approval, trained AI predictor, investor demand validation or realized returns.',
        assumptions={'horizon_years':5,'units':UNITS,'investor_ownership':1,'salary_assignment':False,
            'base_salary_cap_context_only':164961000,'discount_rate':RATE,'risk_free_rate':RF,'risk_premium':.08,
            'quarterly_payments':True,'terminal_multiple':0,'liquidation':'Quarter20 distributes actual remaining cash; it is not guaranteed principal and is included exactly once.',
            'cashflow_timing':'Quarterly operations and interest; positive quarterly after-tax profit distributed90%, retained10%; losses consume cash; insolvency absorbs all future cashflows.',
            'interest_annual_effective':RF,'income_tax_rate':TAX,'tax_definition':'Illustrative flat rate on positive quarterly pretax income; no loss carryforward, deferred taxes or jurisdiction-specific analysis.',
            'athlete_annual_ip_service_fee':IP_FEE,'conditional_third_party_rights_fee':RIGHTS_FEE,'fulfillment_marketing_rate':FULFILLMENT,
            'platform_servicing_rate':SERVICE,'annual_fixed_cost_growth':.03,'positive_profit_distribution_rate':PAYOUT,
            'offering_issuance_fee':ISSUE_FEE,'offering_reconciliation':'DCF equity raise = operating reserve +2% issuance fee +residual upfront IP license payment. If residual negative, financing fails.',
            'upfront_and_ongoing_ip_fee':'Separate hypothetical upfront license acquisition payment and annual athlete service/IP payment; deliberate dual compensation, requiring negotiation.',
            'sponsor_minimum':'40% of baseline gross revenue during years1-2 only, assumed enforceable signed commercial contracts. Floors survive injury, not independent sponsor default.',
            'sponsor_default_hazard_annual':.02,'injury_unsold_revenue_multiplier':.45,'rights_gate':'All commercial rights, including any team/league marks, must be licensed before any sales.5% is an assumed negotiated cost, not a published fee.',
            'base_revenue_meaning':'Hypothetical pre-risk sales budget, not expected observed sales; not an NBA salary or athlete earnings assignment.',
            'sales_mix':'Sponsor floors plus uncommitted merchandise, content and event sales, modeled in aggregate; no empirical customer demand data.',
            'sales_driver':'Correlated lognormal demand, profile trend, and hypothetical attention catalysts:20% chance1.25x,15% chance0.8x,otherwise1x. Performance/contract news may affect sales attention only.',
            'correlation':'Common demand persists across years with0.65loading; each athlete demand has0.55common loading. Marginal lognormal variance from profilevolatility.',
            'investor_duties':'Limited liability, no additional capital calls; no investor rights over training, playing, injuries or contract decisions.',
            'excluded':['Actual issuer diligence','specific exemption eligibility','secondary trading approval','legal and broker fees beyond assumed issuance cost','bid-ask spreads','investor taxes','working-capital receivables','seasonality','insurance','residual IP sale value']},
        assets=assets,portfolio=portfolio,sensitivities=sensitivity,stress_tests=stresses,
        common_factor_stress={'definition':'Bottom decile of shared demand factor in base draws','draw_count':int(low.sum()),'equal_dollar_pv_change':float(ratios[low].mean()-1)},
        platform_business={'assumptions':{'average_issuer_dcf_equity':average_equity,'average_annual_collected_servicing_per_issuer':avg_servicing,
            'fixed_operating_budget':fixed_budget,'annual_per_issuer_compliance_servicing_cost':onboarding_cost,'trading_fee_per_dollar':trade_fee,
            'recurring_break_even_issuers_without_trading':math.ceil(fixed_budget/(avg_servicing-onboarding_cost)),
            'active_float_fraction':active_float,'scale_mix':'Equal mix of the six fictional archetypes. Turnover, active float and issuer counts have no demand validation.',
            'trading_gate':'Secondary trading and all related fees only if permitted through a properly authorized venue. Base servicing business must be evaluated without trading income.',
            'one_time_fee_warning':'Issuance fee is one-time for initial offerings; do not count as recurring without independently justified new issuance.'},'scenarios':platform},
        warnings=['Equity in a commercial entity does not by itself establish lawful offering or trading; counsel and rights-owner review remain necessary.',
            'No dividends arise from NBA salary, salary-cap share or a game-statistic score. Dividends require venture distributable earnings/cash.',
            'Percentiles reflect assumed scenarios, not statistical confidence intervals or validated forecasts.',
            'The12% discount rate is an assumption. Mean cashflow IRR equals it by construction, not evidence of returns.',
            'Platform income estimates are scale scenarios, not traction or market validation.'])
    (ROOT/'data/commercial_model.json').write_text(json.dumps(output,indent=2))
    with gzip.GzipFile(filename=str(ROOT/'data/commercial_draws.csv.gz'),mode='wb',mtime=0) as gz,io.TextIOWrapper(gz,newline='') as f:
        w=csv.writer(f);w.writerow(['draw','common_factor']+[f'{p["ticker"]}_pv' for p in PROFILES]+[f'{p["ticker"]}_q{q+1}_cash' for p in PROFILES for q in range(20)])
        for k in range(N):w.writerow([k,round(float(d['common'][k]),8)]+[round(float(x),10) for x in values[k]]+[round(float(x),10) for x in base['cash'][k].ravel()])
    print(json.dumps({'prices':{a['ticker']:a['fair_value_per_unit'] for a in assets},'portfolio':portfolio,'stress':{k:v['equal_dollar_portfolio_pv_change'] for k,v in stresses.items()},'common_factor':output['common_factor_stress'],'platform':platform},indent=2))

if __name__=='__main__':run()
