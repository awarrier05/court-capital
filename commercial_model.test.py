"""Economic accounting and timing checks for commercial venture scenarios."""
import unittest
from unittest.mock import patch
import numpy as np
import commercial_model as m

class CommercialChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d=m.make_draws(1500); cls.b=m.simulate(cls.d)

    def test_seed_reproducibility(self):
        np.testing.assert_array_equal(self.b['cash'],m.simulate(m.make_draws(1500))['cash'])

    def test_quarterly_cash_shape_and_nonnegativity(self):
        self.assertEqual(self.b['cash'].shape,(1500,6,20))
        self.assertTrue(np.isfinite(self.b['cash']).all())
        self.assertTrue((self.b['cash']>=0).all())

    def test_injury_leaves_signed_sponsor_minimums_unchanged(self):
        stress=m.simulate(self.d,force_injury=True)
        np.testing.assert_array_equal(self.b['signed'],stress['signed'])
        self.assertTrue(np.all(m.pv(stress['cash'])<=m.pv(self.b['cash'])+1e-10))

    def test_sponsor_minimums_only_first_two_years(self):
        np.testing.assert_array_equal(self.b['signed'][:,:,2:],0)

    def test_liquidation_leaves_no_cash(self):
        np.testing.assert_array_equal(self.b['ending_cash'],0)
        self.assertTrue(np.all(self.b['cash'][:,:,-1]>=self.b['terminal']))

    def test_bankruptcy_is_absorbing(self):
        bankrupt_profiles=[dict(p,fixed_expenses=1e12) for p in m.PROFILES]
        with patch.object(m,'PROFILES',bankrupt_profiles):
            b=m.simulate(self.d)
        self.assertTrue(b['failure'].all())
        np.testing.assert_array_equal(b['cash'],0)
        np.testing.assert_array_equal(b['terminal'],0)

    def test_reserve_return_exactly_once_without_operations_or_interest(self):
        profiles=[dict(p,gross_revenue=0,fixed_expenses=0) for p in m.PROFILES]
        with patch.object(m,'PROFILES',profiles),patch.object(m,'RF',0):
            b=m.simulate(self.d)
        np.testing.assert_array_equal(b['cash'][:,:,:-1],0)
        for j,p in enumerate(profiles):
            np.testing.assert_allclose(b['cash'][:,j,:].sum(axis=1),p['reserve']/m.UNITS)

    def test_discount_rate_monotonicity(self):
        self.assertTrue(np.all(m.pv(self.b['cash'],.14)<=m.pv(self.b['cash'],.12)))

    def test_timing_of_terminal_cash(self):
        c=np.zeros(20);c[-1]=100
        self.assertAlmostEqual(float(m.pv(c)),100/1.12**5,places=11)

    def test_raise_reconciles_reserve_fee_and_license(self):
        prices=m.pv(self.b['cash']).mean(axis=0)
        for j,p in enumerate(m.PROFILES):
            raised=prices[j]*m.UNITS;fee=raised*m.ISSUE_FEE;license=raised-fee-p['reserve']
            self.assertGreater(license,0)
            self.assertAlmostEqual(raised,p['reserve']+fee+license,places=7)

    def test_more_rights_expense_cannot_raise_equity_pv(self):
        high=m.simulate(self.d,rights_fee=.1)
        self.assertTrue(np.all(m.pv(high['cash'])<=m.pv(self.b['cash'])+1e-10))

    def test_equal_dollar_portfolio_mean_pv_equals_cost(self):
        v=m.pv(self.b['cash']); prices=v.mean(axis=0)
        self.assertAlmostEqual(float((v/prices).mean()),1,places=10)

    def test_counterparty_failure_removes_sponsor_floor(self):
        d={k:np.array(v,copy=True) for k,v in self.d.items()}; d['sponsor_default'][:]=0
        s=m.simulate(d)
        np.testing.assert_array_equal(s['signed'],0)

if __name__=='__main__':unittest.main(verbosity=2)
