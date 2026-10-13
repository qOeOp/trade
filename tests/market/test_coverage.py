import unittest
import numpy as np
from research.market.coverage import series

class CoverageFactsTests(unittest.TestCase):
    def test_zero_volume_is_present_and_missing_interval_is_separate(self):
        value=series({'ts_open':np.array([0,60000,180000]),'volume':np.array([0,5,0])},0,240000)
        self.assertEqual((value['rows'],value['zero_volume_minutes'],value['missing_minutes']),(3,2,1))
        self.assertEqual(value['gap_intervals_ms'],[[120000,180000]])
