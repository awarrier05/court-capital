"""Economic invariant checks, not an accuracy claim for scenario probabilities."""
import unittest
import numpy as np
import model as m

class ModelChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d=m.draws(2000)
        cls.cash,cls.protected,cls.outcome=m.simulate(cls.d)

    def test_seed_reproduces_values(self):
        np.testing.assert_array_equal(self.cash,m.simulate(m.draws(2000))[0])

    def test_cap_growth_bounds(self):
        self.assertTrue(np.all(self.d['growth']>=0))
        self.assertTrue(np.all(self.d['growth']<=.10))
        np.testing.assert_allclose(self.d['cap'][:,0],m.CAP)

    def test_injury_does_not_change_protected_salary(self):
        stressed,protected,_=m.simulate(self.d,force_injury=True)
        np.testing.assert_array_equal(self.protected,protected)
        for j,p in enumerate(m.PROFILES):
            np.testing.assert_array_equal(self.cash[:,j,:p['guaranteed_years']],stressed[:,j,:p['guaranteed_years']])
        self.assertTrue(np.all(stressed<=self.cash+1e-12))

    def test_higher_discount_lowers_positive_pv(self):
        self.assertTrue(np.all(m.pv(self.cash,.14)<=m.pv(self.cash,.12)))

    def test_quarterly_timing_hand_calculation(self):
        self.assertAlmostEqual(float(m.pv(np.array([4.,0,0,0,0]))),sum(1/(1.12)**(q/4) for q in range(1,5)),places=12)

    def test_finite_five_year_nonnegative_cash(self):
        self.assertEqual(self.cash.shape,(2000,6,5))
        self.assertTrue(np.isfinite(self.cash).all())
        self.assertTrue((self.cash>=0).all())

    def test_salary_raises_use_first_year_not_compound(self):
        d={k:np.array(v,copy=True) for k,v in self.d.items()}
        d['default'][:]=1
        cash,_,_=m.simulate(d)
        factor=m.COLLECTION_FACTOR*(1-m.FEE)*m.PARTICIPATION/m.UNITS
        np.testing.assert_allclose(cash[:,2,3],55e6*1.15*factor)

    def test_absorbing_collection_failure(self):
        d={k:np.array(v,copy=True) for k,v in self.d.items()}
        d['default'][:]=1; d['default'][:,:,2]=0
        cash,_,_=m.simulate(d)
        np.testing.assert_array_equal(cash[:,:,2:],0)
        self.assertTrue((cash[:,:,0]>0).all())

    def test_zero_cap_growth_does_not_raise_cash(self):
        flat=m.simulate(self.d,cap_flat=True)[0]
        self.assertTrue(np.all(flat<=self.cash+1e-12))

    def test_own_dcf_irr_is_assumed_discount(self):
        mean=self.cash.mean(axis=0); prices=m.pv(self.cash).mean(axis=0)
        for j in range(6): self.assertAlmostEqual(m.irr(mean[j],prices[j]),m.DISCOUNT,places=10)

    def test_expected_equal_dollar_pv_equals_cost(self):
        values=m.pv(self.cash); prices=values.mean(axis=0)
        self.assertAlmostEqual(float((values/prices).mean()),1,places=10)

    def test_future_max_salary_shares_within_service_bounds(self):
        for p in m.PROFILES:
            self.assertLessEqual(max(p['renewal_cap_shares']),p['renewal_service_max_cap_share'])

if __name__=='__main__': unittest.main(verbosity=2)
