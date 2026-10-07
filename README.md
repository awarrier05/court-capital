# Court Capital

[Live analytical app](https://court-capital.netlify.app/) · [Research brief and pitch](https://court-capital.netlify.app/Research_Brief.pdf)

A research prototype for valuing and simulating equity in fictional athlete commercial ventures. The principal case is a five-year company that sells licensed sponsorship, merchandise, content and event products. Investor distributions come from venture earnings and remaining cash at liquidation. There is **no NBA salary assignment, ownership of an athlete, or automatic payment from game statistics**.

This repository contains a working analytical prototype and a conditional business model. It is not a launched investment platform, an approved securities offering, or evidence that athlete participation and customer demand have been obtained. The six tickers are fictional archetypes.

## Included components

- `index.html`, `style.css`, `app.js`: browser application.
- `engine.js`, `engine.test.js`, `engine.integration.test.js`: paper-market simulation and accounting tests. Simulated market quotes and execution are separate from the valuation model's scenario probabilities.
- `commercial_model.py`: principal PlayerCo commercial-equity cash-flow model.
- `commercial_model.test.py`: economic accounting and timing checks.
- `data/commercial_model.json`: 20,000-scenario results, assumptions, sensitivities and platform economics.
- `data/commercial_scenarios_sample.csv`: the first 1,000 draws, with per-unit PV and annual distributions. It is a compact inspection sample, not the complete dataset used for reported results.
- `model.py`, `model.test.py`, `data/model.json`: original hypothetical salary-receivable comparison. This is an analytical appendix, not the recommended commercial structure.
- `data/sources.json`: primary-source evidence register. The reproducibility ZIP also contains report source text and report builders under `report/`.
- `PROJECT_PROFILE.txt`: factual project description and suggested resume wording.

## Reproduce the financial analysis

Python 3.11 or newer is recommended. The financial generators require NumPy; no paid APIs, credentials or network data downloads are needed once dependencies are installed.

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 commercial_model.test.py
python3 model.test.py
python3 commercial_model.py
python3 model.py
```

Both generators use seed `20261007` and 20,000 paired draws. They overwrite their generated JSON and full compressed CSV under `data/`. Repeated runs in the same Python/NumPy environment reproduce the scenario values. Minor floating-point differences across environments are possible. Full commercial draws include all 20 quarterly distributions per asset; the sample CSV aggregates them into five annual columns.

The bundled report builders also require ReportLab and their configured fonts. The financial reproduction commands above do not rebuild the PDFs. Report styling and local font paths are independent of the model outputs.

## Run the application and engine checks

Node.js 20 or newer is recommended for the built-in test runner. There are no npm package dependencies.

```sh
npm test
npm run test:models
npm run build:data
npm run serve
```

Open `http://127.0.0.1:8767` while the local server is running. Use a local server rather than opening `index.html` directly because the application loads JSON files. Activate the Python environment before the npm scripts that call Python.

## Company cash flows and funding

All model revenues, fee rates, margins, probabilities and reserve balances are assumptions. Each fictional company issues 100,000 equity units representing 100% of its modeled five-year venture. Starting gross sales budgets range from $1.3m to $12m. These are hypothetical commercial sales budgets, not NBA salaries or historical athlete revenue.

The quarterly operating model deducts an athlete IP/service fee of 25% of gross revenue, a conditional third-party rights cost of 5%, fulfillment/marketing of 30%, platform servicing of 2%, and profile-specific fixed expenses. Any rights required for a proposed product must first be obtained; the model's 5% allowance is not a published league fee or proof that permission is available. An illustrative 21% tax applies to positive quarterly pretax income, without loss carryforwards or jurisdiction-specific treatment.

Signed sponsor minimums equal 40% of baseline annual gross revenue in years one and two only. This is an assumed enforceable commercial contract, not an actual agreement. Injury reduces uncommitted sales; it does not cancel those minimums. A separate assumed counterparty failure process can stop the minimums.

Positive after-tax income is distributed 90%, with 10% retained. Cash earns an assumed 4% annual effective rate. Losses consume the reserve. Insolvency is absorbing, investor liability is limited, and the model makes no additional capital calls. Quarter 20 pays the actual remaining cash balance once. No terminal earnings multiple or guaranteed principal repayment is added.

The initial offering allocation reconciles as follows:

```text
Investor equity proceeds = DCF value of future distributions and actual liquidation cash
Issuance fee              = 2% × equity proceeds
Upfront IP license price  = equity proceeds − issuance fee − operating cash reserve
```

A negative residual license price means the offering cannot fund the modeled reserve and issuance fee at that DCF price. A positive residual is a model-implied maximum allocation, not evidence that an athlete would accept those terms. The upfront acquisition payment and recurring IP/service fee are deliberately separate hypothetical contract terms.

## Valuation and risk conventions

The base discount rate is 12%: an assumed 4% risk-free rate plus an 8% premium. This is not a current Treasury quote. The scenarios are judgmental physical scenarios, not calibrated or risk-neutral probabilities. Expected quarterly cash flows include the final cash liquidation in the last quarter only.

The displayed IRR of expected cash flows equals the pricing discount rate by construction. It is not an independently measured return or a promise of 12% performance. Funding loss is `1 − scenario discounted payout value / initial price`; its VaR and expected shortfall are discounted-value shortfall measures, not historical trading losses. P5/P50/P95 are scenario percentiles, not confidence intervals.

The equal-dollar portfolio purchases each venture at its own modeled expected DCF price. Common commercial demand remains correlated across the ventures. A low modeled insolvency frequency is conditional on the selected assumptions and sample; it does not establish safety.

## Platform economics

Platform income separates annual servicing, one-time initial issuance and hypothetical secondary trading fees. Scaling cases use 25, 75 or 150 issuers and turnover assumptions of 1, 3 or 8 times a 20% active float. None of these volumes has customer validation. One-time offering fees are not counted as recurring income.

The base model's servicing-only break-even is 29 issuers, conditional on an equal mix of the six archetypes, approximately $100,299 collected annual servicing per issuer, $15,000 annual issuer-specific operating costs, and $2.4m fixed annual costs. This is a unit-economics calculation, not a market-size or traction claim. Secondary trading fees require a legally permitted venue and are not essential to that particular break-even calculation.

## Evidence and limitations

Official NBA releases support historical salary-cap context, and the NBA/NBPA collective bargaining agreement supports the original comparison's employment-contract mechanics. Those facts do not validate the commercial revenue forecasts. Primary references include the [2026–27 NBA cap release](https://www.nba.com/news/nba-salary-cap-2026-27-season), [NBPA's current CBA](https://nbpa.com/cba), and the specific URLs in the evidence registers.

The commercial structure still requires athlete consent, verified ownership and licensing of every relevant right, enforceable commercial contracts, securities-law analysis, financial controls and independently validated demand. Changing the cash-flow source from salary to commercial revenue does not itself establish a legal workaround. Securities, derivatives, short selling and market access shown in a paper simulator are not confirmed launch permissions.

There is no trained AI prediction model, real athlete valuation, historical backtest, investor money, completed offering or customer traction in this repository. Statistical sophistication cannot substitute for those missing inputs. The reproducible code, scenario definitions and accounting tests allow the assumptions to be challenged and replaced.

## Verification scope

The commercial model has 13 passing invariant checks covering cash timing, insolvency, sponsor protection, funding reconciliation, liquidation, expense sensitivity and reproducibility. The salary comparison has 12 passing checks. These verify the implemented accounting rules; they do not verify the realism of the assumed distributions or the legal availability of the business.


The engine has 29 passing tests, including five integrations with the commercial model. Account data is session-only; export is available, but there is no import/resume interface.
