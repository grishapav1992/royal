package domain

import "testing"

func royalHRCardIds(ids ...int) []*Card {
	cards := make([]*Card, len(ids))
	for i, id := range ids {
		cards[i] = NewCard(id/13+1, id%13+1, true)
	}
	return cards
}

func TestRoyalHoldemStandardMainSettlement(t *testing.T) {
	for rank := PokerHandHighCard; rank <= PokerHandRoyalFlush; rank++ {
		for _, result := range []GameResult{GameResultWin, GameResultDraw, GameResultLose} {
			for mask := 0; mask < 4; mask++ {
				for _, ante := range []int{10, 1000, 10000} {
					g := &TexasHoldemBonus{anteBet: ante, flopBet: 2 * ante, playerHandRank: rank, result: result}
					if mask&1 != 0 {
						g.turnBet = ante
					}
					if mask&2 != 0 {
						g.riverBet = ante
					}
					g.calculatePayouts()
					wantAnte, wantPlay := 0, 0
					switch result {
					case GameResultWin:
						wantAnte, wantPlay = ante, 2*g.totalPlayBet()
						if rank >= PokerHandStraight {
							wantAnte += ante
						}
					case GameResultDraw:
						wantAnte, wantPlay = ante, g.totalPlayBet()
					}
					if g.antePayout != wantAnte || g.playPayout != wantPlay || g.GetTotalPayout() > 10*ante {
						t.Fatalf("rank=%d result=%d mask=%d ante=%d got=%d/%d want=%d/%d", rank, result, mask, ante, g.antePayout, g.playPayout, wantAnte, wantPlay)
					}
				}
			}
		}
	}
}

func TestRoyalHoldemLosingStraightHasNoUnfundedBonus(t *testing.T) {
	g := &TexasHoldemBonus{anteBet: 1000, flopBet: 2000, playerHand: royalHRCardIds(1, 15), dealerHand: royalHRCardIds(8, 22), community: royalHRCardIds(3, 17, 31, 45, 7)}
	g.resolve()
	if g.result != GameResultLose || g.playerHandRank != PokerHandStraight || g.GetTotalPayout() != 0 {
		t.Fatalf("losing straight paid: result=%d rank=%d payout=%d", g.result, g.playerHandRank, g.GetTotalPayout())
	}
}

func TestRoyalHoldemSymmetricFixedStrategyHasNonpositiveEV(t *testing.T) {
	// Always Play/Check/Check places the same wagers for either player.
	// Swap the two private hands: each winner/loser pair previously had net0.
	// The new qualified Ante settlement subtracts one Ante on a low-hand win.
	// Every pair therefore has net0 or -1 Ante, including shared-board ties.
	for _, ranks := range [][2]int{{PokerHandOnePair, PokerHandHighCard}, {PokerHandFlush, PokerHandStraight}, {PokerHandRoyalFlush, PokerHandRoyalFlush}} {
		for _, cmp := range []int{-1, 0, 1} {
			pairedNet := 0
			for swap := 0; swap < 2; swap++ {
				p, result := ranks[swap], GameResultDraw
				if cmp != 0 {
					if cmp*(1-2*swap) > 0 {
						result = GameResultWin
					} else {
						result = GameResultLose
					}
				}
				g := &TexasHoldemBonus{anteBet: 1000, flopBet: 2000, result: result, playerHandRank: p}
				g.calculatePayouts()
				pairedNet += g.GetTotalPayout() - 3000
			}
			if pairedNet > 0 {
				t.Fatalf("symmetric always-play pair produced positive EV: ranks=%v cmp=%d net=%d", ranks, cmp, pairedNet)
			}
		}
	}
}

func TestRoyalHoldemFundedHoleBonusRemainsNegativeEV(t *testing.T) {
	returned, hands := 0, 0
	for a := 0; a < 51; a++ {
		for b := a + 1; b < 52; b++ {
			cards := royalHRCardIds(a, b)
			mult := bonusMultiplier(cards[0], cards[1])
			if mult > 0 {
				returned += 1 + mult
			}
			hands++
		}
	}
	if returned != 1208 || hands != 1326 || returned >= hands {
		t.Fatalf("funded side bonus changed: %d/%d", returned, hands)
	}
}

func TestRoyalRummyBonusAndSettlementBranches(t *testing.T) {
	for player := 0; player <= 30; player++ {
		for dealer := 0; dealer <= 30; dealer++ {
			g := &ThreeCardRummy{anteBet: 1000, playBet: 1000, playerScore: player, dealerScore: dealer}
			g.dealerQualified = g.checkDealerQualifies()
			base := 0
			switch {
			case dealer > 20:
				g.result, base = GameResultWin, 3
			case player < dealer:
				g.result, base = GameResultWin, 4
			case player == dealer:
				g.result, base = GameResultDraw, 2
			default:
				g.result = GameResultLose
			}
			bonus := 0
			if player == 0 {
				bonus = 9
			} else if player <= 5 {
				bonus = 3
			}
			g.calculatePayouts()
			g.evaluateAnteBonus()
			if g.GetTotalPayout() != 1000*(base+bonus) || g.GetTotalPayout() > 13000 {
				t.Fatalf("player=%d dealer=%d return=%d want=%d", player, dealer, g.GetTotalPayout(), 1000*(base+bonus))
			}
			g.playerScore = 30
			g.evaluateAnteBonus()
			if g.anteBonusPayout != 0 {
				t.Fatal("old ante bonus survived recalculation")
			}
		}
	}
}

func TestRoyalRummyRulesMatchPreservedScorer(t *testing.T) {
	for _, test := range []struct {
		ids   []int
		score int
	}{{[]int{0, 26, 51}, 12}, {[]int{1, 14, 40}, 0}, {[]int{0, 1, 2}, 0}, {[]int{0, 11, 12}, 0}, {[]int{0, 1, 3}, 7}} {
		if score := ThreeCardRummyScore(royalHRCardIds(test.ids...)); score != test.score {
			t.Fatalf("cards=%v score=%d want=%d", test.ids, score, test.score)
		}
	}
}
