package domain

import (
	"encoding/json"
	"strings"
	"testing"
)

func mathFixCards(labels ...string) []*Card {
	cards := make([]*Card, len(labels))
	for i, label := range labels {
		if label == "JK" {
			cards[i] = NewCard(CardDesignJoker, 1, false)
			continue
		}
		cards[i] = NewCard(strings.Index("SCHD", label[1:])+1, strings.Index("A23456789TJQK", label[:1])+1, false)
	}
	return cards
}

func mathFixShoe(t *testing.T, labels ...string) *TrumpCards {
	t.Helper()
	shoe := NewTrumpCardsWithDecks(FreeBetDeckCount, 0)
	for i, wanted := range mathFixCards(labels...) {
		found := false
		for j := i; j < len(shoe.deck); j++ {
			if shoe.deck[j].GetDesign() == wanted.GetDesign() && shoe.deck[j].GetValue() == wanted.GetValue() {
				shoe.deck[i], shoe.deck[j] = shoe.deck[j], shoe.deck[i]
				found = true
				break
			}
		}
		if !found {
			t.Fatal("missing shoe fixture card", labels[i])
		}
	}
	return shoe
}

func TestFreshFreeBetAndCrazyFourShuffleBeforeFirstBet(t *testing.T) {
	cases := []struct {
		name  string
		shoe  *TrumpCards
		decks int
	}{
		{"free-bet", NewDefaultFreeBetBlackjack().shoe, FreeBetDeckCount},
		{"crazy-four", NewDefaultCrazyFourPoker().trumpCards, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ordered := NewTrumpCardsWithDecks(c.decks, 0)
			counts := [5][14]int{}
			changed := false
			if len(c.shoe.deck) != 52*c.decks || c.shoe.GetRemainingCount() != 52*c.decks {
				t.Fatal("shuffle changed shoe size or consumed cards")
			}
			for i, card := range c.shoe.deck {
				counts[card.GetDesign()][card.GetValue()]++
				if card.GetDraw() {
					t.Fatal("fresh shoe has a consumed card")
				}
				changed = changed || card.GetDesign() != ordered.deck[i].GetDesign() || card.GetValue() != ordered.deck[i].GetValue()
			}
			if !changed {
				t.Fatal("fresh constructor kept the complete sorted shoe")
			}
			for suit := 1; suit <= 4; suit++ {
				for value := 1; value <= 13; value++ {
					if counts[suit][value] != c.decks {
						t.Fatal("shuffle changed card multiplicity", suit, value)
					}
				}
			}
		})
	}
}

func TestFreeBetHouseFundedResplitAndDoublePayEveryFreeStake(t *testing.T) {
	g := NewDefaultFreeBetBlackjack()
	g.shoe = mathFixShoe(t, "5S", "5H", "TC", "QH", "4S", "5D", "6C", "4H", "KS", "QD")
	initial := g.GetChips()
	for _, move := range []func() error{
		func() error { return g.PlaceBet(100) }, g.FreeSplit, g.Stand, g.FreeSplit, g.FreeDouble, g.FreeDouble,
	} {
		if err := move(); err != nil {
			t.Fatal(err)
		}
	}
	if g.phase != FreeBetPhaseResult || len(g.hands) != 3 {
		t.Fatal("fixture did not complete three hands")
	}
	if g.hands[0].GetBet() != 100 || g.hands[1].GetBet() != 0 || g.hands[2].GetBet() != 0 {
		t.Fatal("free actions changed player-funded stakes")
	}
	if g.freeBets[0] != 0 || g.freeBets[1] != 200 || g.freeBets[2] != 200 {
		t.Fatal("free resplit/double lost a house-funded stake", g.freeBets)
	}
	if g.GetPayout() != 200 || g.handPayouts[1] != 200 || g.handPayouts[2] != 0 {
		t.Fatal("wrong winning/losing free-hand settlement", g.handPayouts)
	}
	if g.GetChips() != initial-100+200 {
		t.Fatal("free actions charged player chips")
	}
}

func TestFreeBetPaidHandDoubleAndDealer22DoNotReturnFreePrincipal(t *testing.T) {
	g := NewDefaultFreeBetBlackjack()
	g.shoe = mathFixShoe(t, "5S", "4H", "TC", "8H", "KS")
	if err := g.PlaceBet(100); err != nil {
		t.Fatal(err)
	}
	if err := g.FreeDouble(); err != nil {
		t.Fatal(err)
	}
	if g.GetPayout() != 300 || g.freeBets[0] != 100 {
		t.Fatal("paid-hand free double should return principal plus two profits", g.GetPayout())
	}
	house := NewBlackJackHand()
	house.AddCard(mathFixCards("KS")[0])
	house.AddCard(mathFixCards("QH")[0])
	house.SetFromSplit(true)
	g.dealerPushed22 = true
	_, paid := g.settleHand(house, 200, 22, false)
	if paid != 0 {
		t.Fatal("dealer 22 must not return house-funded principal", paid)
	}
	g.dealerPushed22 = false
	_, paid = g.settleHand(house, 200, 23, false)
	if paid != 200 {
		t.Fatal("dealer bust should pay the doubled free profit", paid)
	}
}

func TestPaiGowBugJokerUsesBestLegalSubstitutionWithoutMutatingCards(t *testing.T) {
	cases := []struct {
		name     string
		labels   []string
		category int
		values   []int
	}{
		{"highest straight", []string{"JK", "5C", "6D", "7H", "8S"}, PokerHandStraight, []int{9, 8, 7, 6, 5}},
		{"wheel", []string{"JK", "AS", "2C", "3D", "4H"}, PokerHandStraight, []int{5, 4, 3, 2, 1}},
		{"royal", []string{"JK", "TS", "JS", "QS", "KS"}, PokerHandRoyalFlush, []int{14, 13, 12, 11, 10}},
		{"ace-high flush", []string{"JK", "2H", "5H", "8H", "JH"}, PokerHandFlush, []int{14, 11, 8, 5, 2}},
		{"flush missing king", []string{"JK", "AS", "2S", "5S", "8S"}, PokerHandFlush, []int{14, 13, 8, 5, 2}},
		{"non-ace quads forbidden", []string{"JK", "KS", "KC", "KH", "QD"}, PokerHandThreeOfAKind, []int{13, 14, 12}},
		{"non-ace full house forbidden", []string{"JK", "KS", "KC", "QH", "QD"}, PokerHandTwoPair, []int{13, 12, 14}},
		{"ace full house", []string{"JK", "KS", "KC", "KH", "AD"}, PokerHandFullHouse, []int{13, 14}},
		{"five aces", []string{"JK", "AS", "AC", "AH", "AD"}, PokerHandFiveOfAKind, []int{14}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cards := mathFixCards(c.labels...)
			before, _ := json.Marshal(cards)
			if rank := evalPaiGowHighHand(cards); rank != c.category {
				t.Fatal("wrong legal joker category", rank, c.category)
			}
			actual := paiGowHighHandSortedValues(cards)
			if len(actual) != len(c.values) {
				t.Fatal("wrong canonical vector", actual, c.values)
			}
			for i, value := range c.values {
				if actual[i] != value {
					t.Fatal("wrong canonical vector", actual, c.values)
				}
			}
			after, _ := json.Marshal(cards)
			if string(before) != string(after) {
				t.Fatal("evaluation changed dealt cards")
			}
		})
	}
}

func TestPaiGowJokerStraightSettlementReturnsSplitResult(t *testing.T) {
	g := NewDefaultPaiGow()
	g.phase = PaiGowPhaseSetHands
	g.playerCards = mathFixCards("JK", "5C", "6D", "7H", "8S", "AH", "KH")
	g.dealerCards = mathFixCards("6C", "7D", "8H", "9S", "TC", "QD", "JD")
	g.bet = 1000
	if err := g.SetHands(5, 6); err != nil {
		t.Fatal(err)
	}
	if g.highHandResult != GameResultLose || g.lowHandResult != GameResultWin || g.GetPayout() != 1000 {
		t.Fatal("9-high joker straight must lose to 10-high, low wins and wager pushes", g.highHandResult, g.lowHandResult, g.GetPayout())
	}
	if got := comparePaiGowHighHands(mathFixCards("JK", "5C", "6D", "7H", "8S"), mathFixCards("5S", "6H", "7C", "8D", "9H")); got != 0 {
		t.Fatal("joker/natural equal straights should tie", got)
	}
}

func TestPaiGowSplitValidationAndHouseWayCompareEntireStrength(t *testing.T) {
	cases := []struct {
		name   string
		labels []string
		low    [2]int
		foul   bool
	}{
		{"low aces beats high twos", []string{"AS", "AH", "2S", "2H", "5C", "6D", "9S"}, [2]int{0, 1}, true},
		{"equal ace second kicker", []string{"AS", "QC", "9H", "5D", "2C", "AH", "KS"}, [2]int{5, 6}, true},
		{"equal pair high has kickers", []string{"AS", "AC", "AH", "AD", "KS", "QH", "9D"}, [2]int{2, 3}, false},
		{"low twos below high aces", []string{"AS", "AH", "2S", "2H", "5C", "6D", "9S"}, [2]int{2, 3}, false},
		{"equal top two high has more kickers", []string{"AS", "KC", "9H", "5D", "2C", "AH", "KS"}, [2]int{5, 6}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := NewDefaultPaiGow()
			g.phase = PaiGowPhaseSetHands
			g.playerCards = mathFixCards(c.labels...)
			g.dealerCards = mathFixCards("3S", "4C", "5H", "6D", "7S", "8C", "9H")
			g.bet = 1000
			if foul := g.IsFoulSplit(c.low[0], c.low[1]); foul != c.foul {
				t.Fatal("wrong split legality", foul)
			}
			before, _ := json.Marshal(g)
			err := g.SetHands(c.low[0], c.low[1])
			if (err != nil) != c.foul {
				t.Fatal("SetHands disagrees with legality", err)
			}
			if c.foul {
				after, _ := json.Marshal(g)
				if string(before) != string(after) {
					t.Fatal("rejected split changed the game")
				}
			}
			high, low := paiGowHouseWay(mathFixCards(c.labels...))
			if !paiGowHighBeatsLow(evalPaiGowHighHand(high), high, evalPaiGowLowHand(low), low) {
				t.Fatal("house way emitted a foul split")
			}
		})
	}
	cards := mathFixCards("AS", "AH", "2S", "2H", "5C", "6D", "9S")
	i, j, ok := paiGowHouseWayIndices(cards)
	if !ok || i != 2 || j != 3 {
		t.Fatal("house way should keep aces high, twos low", i, j, ok)
	}
}
