"""Keep both existing financial leases challenged while one command is supervised."""
from financial_gate import FinancialGate

class DualGate(FinancialGate):
    peer = None
    _checking_peer = False

    def _pump(self, timeout=0):
        peer = self.peer
        if (peer is not None and peer._quiet and not peer._released and not peer._closed
                and not self._checking_peer):
            self._checking_peer = peer._checking_peer = True
            try:
                peer.check()
            finally:
                self._checking_peer = peer._checking_peer = False
        return super()._pump(timeout)
